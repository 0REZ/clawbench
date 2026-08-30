package ai

import (
	"log/slog"
)

// emitStreamEvent sends a StreamEvent to the stream channel with a NON-blocking
// send. When the channel buffer is full (consumer can't keep up — typically the
// DB persistence path stalling the SessionExecutor event loop), the event is
// DROPPED and a WARN is logged so the data loss is observable in server logs.
//
// source identifies the producer for log correlation (e.g. "claude", "codex",
// "cli"). It must be a short, stable lowercase token; parsers shared across
// backends (StreamParser/claude_tool) use "cli" since they run on CLI stream
// channels.
//
// A send to a closed channel panics; the recover makes it safe for producer
// goroutines that may outlive the channel close on cancellation (mirrors
// forwardACPEvent).
func emitStreamEvent(ch chan<- StreamEvent, source string, event StreamEvent) {
	defer func() {
		if r := recover(); r != nil {
			slog.Debug(source+": send on closed stream channel, ignoring", "type", event.Type)
		}
	}()
	select {
	case ch <- event:
	default:
		slog.Warn(source+": stream channel full, dropping event",
			"type", event.Type,
			"source", source)
	}
}
