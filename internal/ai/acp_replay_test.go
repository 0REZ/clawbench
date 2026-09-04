package ai

import (
	"context"
	"testing"

	acp "github.com/coder/acp-go-sdk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"clawbench/internal/model"
)

// ---------------------------------------------------------------------------
// Replayed-chunk filter (codebuddy resume defect defense)
//
// codebuddy CLI occasionally re-emits the final agent_message_chunk of the
// PREVIOUS turn at the start of the NEW turn's stream when an ACP session is
// reused across prompts. mapACPSessionUpdate drops such chunks (identified by
// requestId == lastCompletedRequestID) so stale text never reaches the UI or
// DB persistence, and the stale _meta never pollutes the message metadata.
// ---------------------------------------------------------------------------

// codebuddyChunk builds a codebuddy agent_message_chunk update carrying the
// given requestId and text.
func codebuddyChunk(requestID, text string) acp.SessionUpdate {
	meta := map[string]any{}
	if requestID != "" {
		meta[metaKeyCodeBuddyRequestID] = requestID
		meta[metaKeyCodeBuddyTraceID] = "trace-" + requestID
	}
	return acp.SessionUpdate{
		AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
			Content: acp.ContentBlock{Text: &acp.ContentBlockText{Text: text}},
			Meta:    meta,
		},
	}
}

func codebuddyThoughtChunk(requestID, text string) acp.SessionUpdate {
	meta := map[string]any{}
	if requestID != "" {
		meta[metaKeyCodeBuddyRequestID] = requestID
	}
	return acp.SessionUpdate{
		AgentThoughtChunk: &acp.SessionUpdateAgentThoughtChunk{
			Content: acp.ContentBlock{Text: &acp.ContentBlockText{Text: text}},
			Meta:    meta,
		},
	}
}

// drainCh reads all currently available events from ch, returning their types
// and, for content/thinking events, the concatenated text.
func drainCh(t *testing.T, ch <-chan StreamEvent) (types []string, content string) {
	t.Helper()
	for {
		select {
		case evt := <-ch:
			types = append(types, evt.Type)
			if evt.Type == "content" || evt.Type == "thinking" {
				content += evt.Content
			}
		default:
			return types, content
		}
	}
}

func TestMapACPSessionUpdate_DropsReplayedPrevTurnChunk(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	// First chunk carries the PREVIOUS turn's rid → must be dropped entirely
	// (no content forward, no _meta accumulation).
	mapACPSessionUpdate(codebuddyChunk("prev-turn-rid", "REPLAYED-STALE-TEXT"),
		ch, context.Background(), conn, nil)

	types, content := drainCh(t, ch)
	// thinking_done is harmless and still emitted; no content event though.
	assert.NotContains(t, types, "content", "stale chunk must not forward content")
	assert.Empty(t, content)

	// The stale chunk's meta must NOT be merged into the turn accumulator.
	acc := conn.getMetaAccum()
	if acc != nil && acc.Trace != nil {
		assert.NotEqual(t, "prev-turn-rid", acc.Trace.RequestID,
			"stale chunk _meta must not pollute metaAccum")
	}
}

func TestMapACPSessionUpdate_RealStreamPassesAndKeepsOrder(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	// Stale chunk first.
	mapACPSessionUpdate(codebuddyChunk("prev-turn-rid", "REPLAYED-"),
		ch, context.Background(), conn, nil)
	// Genuine chunks all share the NEW turn rid — the filter must NOT drop them.
	mapACPSessionUpdate(codebuddyChunk("new-turn-rid", "真"),
		ch, context.Background(), conn, nil)
	mapACPSessionUpdate(codebuddyChunk("new-turn-rid", "实"),
		ch, context.Background(), conn, nil)
	mapACPSessionUpdate(codebuddyChunk("new-turn-rid", "内"),
		ch, context.Background(), conn, nil)

	_, content := drainCh(t, ch)
	assert.Equal(t, "真实内", content, "genuine stream content must survive intact")
	assert.NotContains(t, content, "REPLAYED-", "stale text must not be concatenated")

	// metaAccum reflects the genuine turn rid only.
	acc := conn.getMetaAccum()
	require.NotNil(t, acc)
	require.NotNil(t, acc.Trace)
	assert.Equal(t, "new-turn-rid", acc.Trace.RequestID)
}

func TestMapACPSessionUpdate_FirstTurnNoLastRID(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	// lastCompletedRequestID is empty on a fresh connection → no filtering.
	mapACPSessionUpdate(codebuddyChunk("any-rid", "你好"),
		ch, context.Background(), conn, nil)

	types, content := drainCh(t, ch)
	assert.Contains(t, types, "content")
	assert.Equal(t, "你好", content)
}

func TestMapACPSessionUpdate_ChunkWithoutRIDNotFiltered(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	// A chunk with no requestId must be forwarded normally and must not update
	// the completed-turn baseline.
	mapACPSessionUpdate(codebuddyChunk("", "无 rid"),
		ch, context.Background(), conn, nil)

	types, _ := drainCh(t, ch)
	assert.Contains(t, types, "content")
	assert.Equal(t, "prev-turn-rid", conn.getLastCompletedRequestID(),
		"a rid-less chunk must not clobber the completed-turn baseline")
}

func TestMapACPSessionUpdate_ThinkingNotFiltered(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	// agent_thought_chunk carrying the previous rid is left untouched — a
	// thinking-only turn can legitimately reuse a requestId (msg 43244 case).
	mapACPSessionUpdate(codebuddyThoughtChunk("prev-turn-rid", "思考中"),
		ch, context.Background(), conn, nil)

	types, content := drainCh(t, ch)
	assert.Contains(t, types, "thinking")
	assert.Equal(t, "思考中", content)
}

func TestMapACPSessionUpdate_NonCodeBuddyBackendNotFiltered(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "oc", Backend: "opencode"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	// Filter is scoped to codebuddy — other backends that don't emit
	// codebuddy.ai/* _meta are never dropped.
	mapACPSessionUpdate(codebuddyChunk("prev-turn-rid", "opencode text"),
		ch, context.Background(), conn, nil)

	types, content := drainCh(t, ch)
	assert.Contains(t, types, "content")
	assert.Equal(t, "opencode text", content)
}

func TestMapACPSessionUpdate_NilConnNoPanic(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	// conn == nil is used by MapACPSessionUpdateForTest paths — filter must be skipped.
	mapACPSessionUpdate(codebuddyChunk("any-rid", "nil conn text"),
		ch, context.Background(), nil, nil)

	types, content := drainCh(t, ch)
	assert.Contains(t, types, "content")
	assert.Equal(t, "nil conn text", content)
}

func TestEmitPromptTailMetadata_RecordsCompletedRID(t *testing.T) {
	// Simulate a completed CodeBuddy turn: message chunks accumulate their
	// _meta (genuine new rid), then the tail-metadata path records the
	// completed-turn requestId baseline.
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	mapACPSessionUpdate(codebuddyChunk("prev-turn-rid", "REPLAYED"),
		ch, context.Background(), conn, nil)
	mapACPSessionUpdate(codebuddyChunk("current-turn-rid", "真实内容"),
		ch, context.Background(), conn, nil)

	// Drain the content events so the channel holds only the tail metadata.
	drainCh(t, ch)

	conn.emitPromptTailMetadata(acp.PromptResponse{StopReason: acp.StopReason("end_turn")}, ch)

	// Completed-turn baseline is the genuine current rid, not the stale one.
	assert.Equal(t, "current-turn-rid", conn.getLastCompletedRequestID())

	// The metadata event forwarded for persistence carries the genuine rid.
	select {
	case evt := <-ch:
		require.Equal(t, "metadata", evt.Type)
		require.NotNil(t, evt.Meta)
		assert.Equal(t, "current-turn-rid", evt.Meta.RequestID)
		assert.NotEqual(t, "prev-turn-rid", evt.Meta.RequestID)
	default:
		t.Fatal("expected a metadata event from emitPromptTailMetadata")
	}
}

func TestEmitPromptTailMetadata_RidlessTurnKeepsBaseline(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	conn.setLastCompletedRequestID("prev-turn-rid")

	// A turn with no _meta (e.g. bare stopReason) must not clear the baseline.
	conn.emitPromptTailMetadata(acp.PromptResponse{StopReason: acp.StopReason("end_turn")}, ch)
	assert.Equal(t, "prev-turn-rid", conn.getLastCompletedRequestID(),
		"a turn without a requestId must keep the previous baseline")
}

// TestSetLastCompletedRequestID_IgnoresEmpty guards the setter contract.
func TestSetLastCompletedRequestID_IgnoresEmpty(t *testing.T) {
	conn := &ACPConn{}
	conn.setLastCompletedRequestID("")
	assert.Empty(t, conn.getLastCompletedRequestID())
	conn.setLastCompletedRequestID("rid-a")
	assert.Equal(t, "rid-a", conn.getLastCompletedRequestID())
	conn.setLastCompletedRequestID("") // no-op
	assert.Equal(t, "rid-a", conn.getLastCompletedRequestID())
}
