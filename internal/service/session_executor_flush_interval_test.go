package service

import (
	"context"
	"testing"
	"time"

	"clawbench/internal/ai"
	"clawbench/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestExecutor_FlushInterval_RealTime verifies the rate-limited flush actually
// persists tool-call rows within roughly one flushInterval window of the event
// arriving, NOT only at finalization. This is a real-time test of the
// handleNonTerminalEvent flush gate (`time.Since(e.lastFlush) >= flushInterval`)
// and the RunWithChannel flushTicker.
func TestExecutor_FlushInterval_RealTime(t *testing.T) {
	setupExecutorDB(t)
	model.Agents = map[string]*model.Agent{
		"test-agent": {ID: "test-agent", Name: "Test", Backend: "test"},
	}
	defer func() { model.Agents = nil }()

	sid := setupExecutorSession(t, "test-agent")
	msgID := getStreamingMsgIDForTest(t, sid)
	executor := NewSessionExecutor(context.Background(), RunConfig{
		Mode:               ModeInteractive,
		ProjectPath:        "/test",
		BackendName:        "test",
		SessionID:          sid,
		AgentID:            "test-agent",
		StreamingMessageID: msgID,
	})
	defer executor.unregisterActiveStream()

	eventCh := make(chan ai.StreamEvent, 16)
	runResultCh := make(chan RunResult, 1)
	go func() {
		runResultCh <- executor.RunWithChannel(eventCh)
	}()

	// Wait for the stream to start, then emit a tool_use that stays "running"
	// for a while (a long tool call, no result yet). lastFlush is zeroed, so the
	// first event trips the immediate flush.
	eventCh <- ai.StreamEvent{Type: "tool_use", Tool: &ai.ToolCall{Name: "Bash", ID: "rt-1", Input: `{"command":"sleep 30"}`, Done: false}}

	// The tool call must be persisted to chat_tool_calls well before the stream
	// finishes — within a couple of flush windows at most, not only at Finalize.
	deadline := time.Now().Add(2 * flushInterval)
	persistedAt := time.Time{}
	for time.Now().Before(deadline) {
		rec, err := GetToolCall("rt-1", msgID)
		require.NoError(t, err)
		if rec != nil {
			persistedAt = time.Now()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	require.False(t, persistedAt.IsZero(),
		"tool call must be persisted to DB during streaming (rate-limited flush), not only at finalization")

	// The flush must NOT have required the tool to complete — it persisted with
	// done=false, proving mid-stream persistence, not a Finalize-only write.
	rec, err := GetToolCall("rt-1", msgID)
	require.NoError(t, err)
	require.NotNil(t, rec)
	assert.False(t, rec.Done, "in-progress tool call must persist with done=false")

	// Finish the stream and verify the terminal path doesn't regress.
	eventCh <- ai.StreamEvent{Type: "done"}
	select {
	case result := <-runResultCh:
		assert.True(t, result.ReceivedTerminal)
	case <-time.After(5 * time.Second):
		t.Fatal("RunWithChannel did not exit after terminal event")
	}
}

// TestExecutor_FlushInterval_QueuedToolCallLandsBeforeFinalize verifies that a
// tool event arriving just before the terminal event is still persisted by the
// flush path (Finalize calls flushStreamingMessage), so no tool-call row is
// lost to the queue.
func TestExecutor_FlushInterval_QueuedToolCallLandsBeforeFinalize(t *testing.T) {
	setupExecutorDB(t)
	model.Agents = map[string]*model.Agent{
		"test-agent": {ID: "test-agent", Name: "Test", Backend: "test"},
	}
	defer func() { model.Agents = nil }()

	sid := setupExecutorSession(t, "test-agent")
	msgID := getStreamingMsgIDForTest(t, sid)
	executor := NewSessionExecutor(context.Background(), RunConfig{
		Mode:               ModeInteractive,
		ProjectPath:        "/test",
		BackendName:        "test",
		SessionID:          sid,
		AgentID:            "test-agent",
		StreamingMessageID: msgID,
	})
	defer executor.unregisterActiveStream()

	// Queue a tool call without flushing (simulates event arriving in the last
	// <500ms before the terminal event).
	executor.handleNonTerminalEvent(ai.StreamEvent{Type: "tool_use", Tool: &ai.ToolCall{Name: "Read", ID: "rt-2", Input: `{"file_path":"/a.go"}`, Done: true}})

	// Finalize flushes queued side-writes before writing the final content.
	result := executor.buildResult(true, time.Now())
	finalized := executor.Finalize(result, nil)
	require.NotZero(t, finalized.MsgID)

	rec, err := GetToolCall("rt-2", msgID)
	require.NoError(t, err)
	require.NotNil(t, rec, "tool call queued just before terminal must be persisted by Finalize flush")
	assert.True(t, rec.Done)
}
