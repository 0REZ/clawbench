package ai

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"clawbench/internal/model"
)

// ---------------------------------------------------------------------------
// reapProcess — unified, serialized process kill+reap (regression tests for the
// idle-sweep vs. new-prompt concurrent Wait deadlock).
// ---------------------------------------------------------------------------

// newTestSleep starts a `sleep` process in its own process group (matching
// production spawnLocked) and returns it. The test must reap/kill it.
func newTestSleep(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sleep", "60")
	setProcessGroup(cmd)
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { killProcessGroup(cmd.Process) })
	return cmd
}

// stdoutFilterClosed reports whether f.Close() has been called.
func stdoutFilterClosed(f *acpStdoutFilter) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

// TestRefactor_ConcurrentReapProcess_NoDeadlock reproduces the race that hung
// a session: the ACP idle sweep and a newly arriving prompt both try to reap
// the SAME agent process at the same time. exec.Cmd.Wait()/Process.Wait() are
// not safe for concurrent invocation and can deadlock, leaving GetOrCreateConn
// (and thus the whole session) blocked forever. reapProcess must serialize all
// reaps via procMu so they never overlap and every caller returns promptly.
func TestRefactor_ConcurrentReapProcess_NoDeadlock(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping: process reaping semantics differ on Windows")
	}
	orig := crashDiagWaitTimeout
	crashDiagWaitTimeout = 2 * time.Second
	defer func() { crashDiagWaitTimeout = orig }()

	agent := &model.Agent{ID: "test-reap-race", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "test-reap-race")

	cmd := newTestSleep(t)

	conn.mu.Lock()
	conn.cmd = cmd
	conn.mu.Unlock()

	const n = 8
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			conn.reapProcess(cmd, nil)
		}()
	}
	close(start)

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		// All reapProcess calls returned — no deadlock.
	case <-time.After(5 * time.Second):
		t.Fatal("concurrent reapProcess calls deadlocked on the same process")
	}
}

// TestRefactor_ReapProcess_NilOrNoProcess verifies reapProcess is a safe no-op
// when given a nil Cmd or a Cmd with no process, and never blocks.
func TestRefactor_ReapProcess_NilOrNoProcess(t *testing.T) {
	agent := &model.Agent{ID: "test-reap-nil", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "test-reap-nil")

	conn.reapProcess(nil, nil)         // nil cmd — no-op
	conn.reapProcess(&exec.Cmd{}, nil) // cmd with nil Process — no-op

	// Should not panic or block.
}

// TestRefactor_ReapProcess_SerializedAgainstSpawnKill verifies that two
// different code paths that tear down the same process (e.g. killAndMarkDead
// from the idle sweep and spawnLocked's old-process teardown) serialize via
// procMu instead of racing on Wait. Both complete within a bounded window.
func TestRefactor_ReapProcess_SerializedAgainstSpawnKill(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping: process reaping semantics differ on Windows")
	}
	orig := crashDiagWaitTimeout
	crashDiagWaitTimeout = 2 * time.Second
	defer func() { crashDiagWaitTimeout = orig }()

	agent := &model.Agent{ID: "test-reap-serialize", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "test-reap-serialize")

	cmd := newTestSleep(t)

	conn.mu.Lock()
	conn.cmd = cmd
	conn.alive = true
	conn.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	// Path A: idle sweep → killAndMarkDead (preserves acpSID).
	go func() {
		defer wg.Done()
		conn.killAndMarkDead()
	}()
	// Path B: new prompt → spawnLocked teardown (reap the current process).
	go func() {
		defer wg.Done()
		conn.mu.Lock()
		cur := conn.cmd
		filter := conn.stdoutFilter
		conn.mu.Unlock()
		conn.reapProcess(cur, filter)
	}()

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		// Both paths completed without deadlock.
	case <-time.After(5 * time.Second):
		t.Fatal("killAndMarkDead and reapProcess deadlocked on the same process")
	}

	conn.mu.Lock()
	alive := conn.alive
	conn.mu.Unlock()
	require.False(t, alive, "connection should be marked dead after reap")
}

// TestRefactor_ReapProcess_DoesNotCloseRespawnedFilter guards the filter-binding
// contract: reapProcess must close ONLY the stdout filter tied to the process
// being reaped (oldFilter), never the connection's current c.stdoutFilter. In
// the idle-sweep vs. new-prompt race, the sweep captures the OLD filter, then a
// respawn installs a NEW filter before the sweep's reap runs. If reapProcess
// closed the connection's current filter instead, it would break the freshly
// respawned session's stdout. This test simulates that exact interleaving.
func TestRefactor_ReapProcess_DoesNotCloseRespawnedFilter(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping: process reaping semantics differ on Windows")
	}
	orig := crashDiagWaitTimeout
	crashDiagWaitTimeout = 2 * time.Second
	defer func() { crashDiagWaitTimeout = orig }()

	agent := &model.Agent{ID: "test-reap-filter", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "test-reap-filter")

	// Old process + its filter (belongs to the process the sweep is reaping).
	oldCmd := newTestSleep(t)
	oldFilter := newACPStdoutFilter(strings.NewReader(""))

	// The connection currently points at the OLD process/filter.
	conn.mu.Lock()
	conn.cmd = oldCmd
	conn.stdoutFilter = oldFilter
	conn.mu.Unlock()

	// Simulate the respawn that happens between the sweep capturing oldFilter
	// and the sweep's reapProcess actually running: a NEW process + filter is
	// installed on the connection.
	newCmd := newTestSleep(t)
	newFilter := newACPStdoutFilter(strings.NewReader(""))
	conn.mu.Lock()
	conn.cmd = newCmd
	conn.stdoutFilter = newFilter
	conn.mu.Unlock()

	// The sweep's reap now runs with the OLD filter binding it captured.
	conn.reapProcess(oldCmd, oldFilter)

	require.True(t, stdoutFilterClosed(oldFilter),
		"old process's filter should be closed by reapProcess")
	require.False(t, stdoutFilterClosed(newFilter),
		"respawned process's filter must NOT be closed by reaping the old process")

	conn.mu.Lock()
	still := conn.stdoutFilter
	conn.mu.Unlock()
	require.Same(t, newFilter, still, "connection must still own the new filter")
}

// ---------------------------------------------------------------------------
// GracefulStopAll — cancels prompts, waits for clean exit, then SIGKILLs stragglers
// ---------------------------------------------------------------------------

// TestGracefulStopAll_CancelsPromptAndReaps verifies the happy path: an
// in-flight prompt is cancelled, and after the agent process exits cleanly the
// connection is reaped and removed from the registry. Uses a short-lived sleep
// that exits on its own (prompt cancellation is simulated by setting a cancel
// func that runs immediately; a cancelled sleep keeps running to full duration,
// so this exercises the wait-then-SIGKILL fallback for a non-cooperating
// process).
func TestGracefulStopAll_CancelsPromptAndReaps(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping: process semantics differ on Windows")
	}
	orig := crashDiagWaitTimeout
	crashDiagWaitTimeout = 2 * time.Second
	defer func() { crashDiagWaitTimeout = orig }()

	mgr := &ACPConnManager{
		conns:     make(map[string]*ACPConn),
		stopSweep: make(chan struct{}),
	}
	agent := &model.Agent{ID: "test-graceful", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "sid-graceful")

	// Simulate an in-flight prompt with a cancel func.
	cancelled := make(chan struct{})
	conn.mu.Lock()
	conn.promptCancel = func() { close(cancelled) }
	conn.cmd = newTestSleep(t)
	conn.alive = true
	conn.mu.Unlock()
	mgr.conns["sid-graceful"] = conn

	mgr.GracefulStopAll(200 * time.Millisecond)

	// Prompt cancel must have been invoked.
	select {
	case <-cancelled:
	default:
		t.Fatal("GracefulStopAll did not cancel the in-flight prompt")
	}

	// Connection must be removed from the registry and marked dead.
	mgr.mu.Lock()
	_, stillRegistered := mgr.conns["sid-graceful"]
	mgr.mu.Unlock()
	require.False(t, stillRegistered, "connection must be removed after graceful stop")

	conn.mu.Lock()
	alive := conn.alive
	cmd := conn.cmd
	conn.mu.Unlock()
	require.False(t, alive, "connection must be marked dead")
	require.Nil(t, cmd, "process must be reaped")
}

// TestGracefulStopAll_NoConnections verifies GracefulStopAll is a safe no-op
// with an empty registry and unclosed stopSweep.
func TestGracefulStopAll_NoConnections(t *testing.T) {
	mgr := &ACPConnManager{
		conns:     make(map[string]*ACPConn),
		stopSweep: make(chan struct{}),
	}
	assert.NotPanics(t, func() { mgr.GracefulStopAll(50 * time.Millisecond) })
}

// TestGracefulStopAll_ThenStopAll verifies the shutdown sequence does not
// panic on the second sweep stop: the graceful path runs first, then the
// deferred StopAll backstop runs against the same manager.
func TestGracefulStopAll_ThenStopAll(t *testing.T) {
	mgr := &ACPConnManager{
		conns:     make(map[string]*ACPConn),
		stopSweep: make(chan struct{}),
	}
	assert.NotPanics(t, func() { mgr.GracefulStopAll(10 * time.Millisecond) })
	assert.NotPanics(t, mgr.StopAll, "second sweep stop must be idempotent")
}

// TestWaitProcessExitTimeout_ReturnsTrueWhenExited verifies that a process that
// exits quickly reports true via the connection's once-guarded wait.
func TestWaitProcessExitTimeout_ReturnsTrueWhenExited(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping: process semantics differ on Windows")
	}
	agent := &model.Agent{ID: "test-wait-exit", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "sid-wait-exit")
	cmd := exec.Command("sleep", "0.05") // exits on its own quickly
	require.NoError(t, cmd.Start())
	defer func() { killProcessGroup(cmd.Process) }()
	conn.mu.Lock()
	conn.cmd = cmd
	conn.mu.Unlock()

	exited := conn.waitProcessExit(2 * time.Second)
	require.True(t, exited, "quick-exiting process should report exited")
}

// TestWaitProcessExitTimeout_ReturnsFalseWhenStillRunning verifies that a
// long-running process reports false when the deadline expires before exit.
func TestWaitProcessExitTimeout_ReturnsFalseWhenStillRunning(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping: process semantics differ on Windows")
	}
	agent := &model.Agent{ID: "test-wait-running", Backend: "acp-stdio", AcpCommand: "sleep"}
	conn := newACPConn(agent, "sid-wait-running")
	cmd := newTestSleep(t) // sleeps 60s; cleanup kills it
	conn.mu.Lock()
	conn.cmd = cmd
	conn.mu.Unlock()

	exited := conn.waitProcessExit(100 * time.Millisecond)
	require.False(t, exited, "long-running process must report not-exited at deadline")

	// Reap the process now (once-guarded Wait is safe after the timeout).
	conn.reapProcess(cmd, nil)
}
