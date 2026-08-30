package ai

import (
	"bytes"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEmitStreamEvent_SendsWhenBufferAvailable verifies a normal (non-full)
// channel accepts the event.
func TestEmitStreamEvent_SendsWhenBufferAvailable(t *testing.T) {
	ch := make(chan StreamEvent, 1)
	emitStreamEvent(ch, "test-src", StreamEvent{Type: "content", Content: "hello"})

	select {
	case ev := <-ch:
		assert.Equal(t, "content", ev.Type)
		assert.Equal(t, "hello", ev.Content)
	case <-time.After(time.Second):
		t.Fatal("event was not delivered")
	}
}

// TestEmitStreamEvent_DropsAndWarnsOnFullChannel verifies that a full channel
// does NOT block the caller and logs a WARN naming the event type + source.
func TestEmitStreamEvent_DropsAndWarnsOnFullChannel(t *testing.T) {
	// Capture slog output.
	var buf bytes.Buffer
	origHandler := slog.Default().Handler()
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.SetDefault(logger)
	defer slog.SetDefault(slog.New(origHandler))

	// Fill the channel completely.
	ch := make(chan StreamEvent, 1)
	ch <- StreamEvent{Type: "content", Content: "occupied"}

	// Must return immediately (non-blocking) despite the full buffer.
	done := make(chan struct{})
	go func() {
		emitStreamEvent(ch, "test-src", StreamEvent{Type: "thinking", Content: "dropped"})
		close(done)
	}()

	select {
	case <-done:
		// Non-blocking: returned without waiting for space.
	case <-time.After(500 * time.Millisecond):
		t.Fatal("emitStreamEvent blocked on a full channel — must be non-blocking")
	}

	// The original event is untouched; the dropped event never arrived.
	select {
	case ev := <-ch:
		assert.Equal(t, "occupied", ev.Content, "only the pre-existing event should be present")
	default:
		t.Fatal("pre-existing event missing")
	}

	// WARN must be logged with type + source.
	assert.Contains(t, buf.String(), "stream channel full, dropping event")
	assert.Contains(t, buf.String(), "thinking")
	assert.Contains(t, buf.String(), "test-src")
}

// TestEmitStreamEvent_NoPanicOnClosedChannel verifies that sending to an
// already-closed channel is recovered (no panic), mirroring forwardACPEvent's
// safety for producer goroutines that outlive the channel close.
func TestEmitStreamEvent_NoPanicOnClosedChannel(t *testing.T) {
	ch := make(chan StreamEvent, 1)
	close(ch)

	assert.NotPanics(t, func() {
		emitStreamEvent(ch, "test-src", StreamEvent{Type: "done"})
	})
}

// TestForwardACPEvent_ReusesEmitStreamEvent verifies forwardACPEvent still
// behaves as before: non-blocking, WARN on full channel, no panic on closed.
func TestForwardACPEvent_ReusesEmitStreamEvent(t *testing.T) {
	// Full channel → drops, no block, no panic.
	ch := make(chan StreamEvent, 1)
	ch <- StreamEvent{Type: "content", Content: "x"}
	assert.NotPanics(t, func() {
		forwardACPEvent(ch, StreamEvent{Type: "tool_use"})
	})
	require.Len(t, ch, 1, "forwardACPEvent must not overwrite the buffered event")

	// Closed channel → no panic.
	close(ch)
	assert.NotPanics(t, func() {
		forwardACPEvent(ch, StreamEvent{Type: "done"})
	})
}
