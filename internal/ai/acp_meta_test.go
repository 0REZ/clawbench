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
// extractCodeBuddyMeta — OpenAI-style usage + usageByCategory + trace
// ---------------------------------------------------------------------------

func TestExtractCodeBuddyMeta_Usage(t *testing.T) {
	meta := map[string]any{
		"usage": map[string]any{
			"prompt_tokens":               29495,
			"completion_tokens":           3,
			"completion_thinking_tokens":  0,
			"prompt_cache_hit_tokens":     8192,
			"prompt_cache_miss_tokens":    21303,
			"prompt_cache_write_tokens":   0,
			"cache_creation_input_tokens": 0,
			"credit":                      1.48,
		},
	}
	ext := extractCodeBuddyMeta(meta)
	require.NotNil(t, ext)
	require.NotNil(t, ext.Usage)
	u := ext.Usage
	assert.True(t, u.Present)
	assert.Equal(t, 29495, u.InputTokens)
	assert.Equal(t, 3, u.OutputTokens)
	assert.Equal(t, 8192, u.CacheHitTokens)
	assert.Equal(t, 8192, u.CachedReadTokens)
	assert.Equal(t, 21303, u.CacheMissTokens)
	assert.Equal(t, 1.48, u.Credit)
}

func TestExtractCodeBuddyMeta_UsageByCategory(t *testing.T) {
	meta := map[string]any{
		"codebuddy.ai/usageByCategory": map[string]any{
			"conversation": 3894,
			"tools":        22701,
			"systemPrompt": 1769,
			"skills":       1121,
			"mcp":          10,
			"version":      1,
		},
	}
	ext := extractCodeBuddyMeta(meta)
	require.NotNil(t, ext)
	require.NotNil(t, ext.Category)
	assert.True(t, ext.Category.Present)
	assert.Equal(t, int64(3894), ext.Category.Categories["conversation"])
	assert.Equal(t, int64(22701), ext.Category.Categories["tools"])
	assert.Equal(t, int64(1769), ext.Category.Categories["systemPrompt"])
	assert.Equal(t, int64(1121), ext.Category.Categories["skills"])
	assert.Equal(t, int64(10), ext.Category.Categories["mcp"])
}

func TestExtractCodeBuddyMeta_Trace(t *testing.T) {
	meta := map[string]any{
		"codebuddy.ai/requestId":       "req-123",
		"codebuddy.ai/traceId":         "trace-456",
		"codebuddy.ai/messageId":       "msg-789",
		"codebuddy.ai/requestModelId":  "glm-5.1",
		"codebuddy.ai/responseModelId": "ep-b3mrev6r",
		"codebuddy.ai/finishReason":    "stop",
		"codebuddy.ai/outcome":         "SUCCESS",
		"codebuddy.ai/agentPhase":      "completing",
	}
	ext := extractCodeBuddyMeta(meta)
	require.NotNil(t, ext)
	require.NotNil(t, ext.Trace)
	tr := ext.Trace
	assert.True(t, tr.HasData())
	assert.Equal(t, "req-123", tr.RequestID)
	assert.Equal(t, "trace-456", tr.TraceID)
	assert.Equal(t, "msg-789", tr.MessageID)
	assert.Equal(t, "glm-5.1", tr.RequestModelID)
	assert.Equal(t, "ep-b3mrev6r", tr.ResponseModelID)
	assert.Equal(t, "stop", tr.FinishReason)
	assert.Equal(t, "SUCCESS", tr.Outcome)
	assert.Equal(t, "completing", tr.AgentPhase)
}

func TestExtractCodeBuddyMeta_Empty(t *testing.T) {
	assert.Nil(t, extractCodeBuddyMeta(nil))
	assert.Nil(t, extractCodeBuddyMeta(map[string]any{}))
	// Only unrecognized keys → nil (no data).
	assert.Nil(t, extractCodeBuddyMeta(map[string]any{"timestamp": "2026-01-01"}))
}

// ---------------------------------------------------------------------------
// extractClaudeMeta — quota.token_count (Claude / Codex shared shape)
// ---------------------------------------------------------------------------

func TestExtractClaudeMeta_Quota(t *testing.T) {
	meta := map[string]any{
		"quota": map[string]any{
			"token_count": map[string]any{
				"cachedInputTokens":     0,
				"cachedWriteTokens":     41053,
				"inputTokens":           142,
				"outputTokens":          18,
				"reasoningOutputTokens": 0,
				"totalTokens":           41213,
			},
		},
	}
	ext := extractClaudeMeta(meta)
	require.NotNil(t, ext)
	require.NotNil(t, ext.Usage)
	u := ext.Usage
	assert.True(t, u.Present)
	assert.Equal(t, 142, u.InputTokens)
	assert.Equal(t, 18, u.OutputTokens)
	assert.Equal(t, 41213, u.TotalTokens)
	assert.Equal(t, 41053, u.CachedWriteTokens)
	assert.Equal(t, 0, u.CachedReadTokens)
	assert.Equal(t, 0, u.ThoughtTokens)
}

func TestExtractClaudeMeta_ReasoningTokens(t *testing.T) {
	// Codex reports reasoningOutputTokens.
	meta := map[string]any{
		"quota": map[string]any{
			"token_count": map[string]any{
				"inputTokens":           13085,
				"outputTokens":          32,
				"reasoningOutputTokens": 30,
				"totalTokens":           13117,
			},
		},
	}
	ext := extractClaudeMeta(meta)
	require.NotNil(t, ext)
	require.NotNil(t, ext.Usage)
	assert.Equal(t, 30, ext.Usage.ThoughtTokens)
	assert.Equal(t, 13117, ext.Usage.TotalTokens)
}

func TestExtractClaudeMeta_MissingQuota(t *testing.T) {
	assert.Nil(t, extractClaudeMeta(nil))
	assert.Nil(t, extractClaudeMeta(map[string]any{"goal": map[string]any{"supported": true}}))
	// quota without token_count → nil.
	assert.Nil(t, extractClaudeMeta(map[string]any{"quota": map[string]any{"model_usage": []any{}}}))
}

// ---------------------------------------------------------------------------
// extractGenericMeta — recursive fallback for unknown backends
// ---------------------------------------------------------------------------

func TestExtractGenericMeta_OpenAIKeys(t *testing.T) {
	meta := map[string]any{
		"nested": map[string]any{
			"usage": map[string]any{
				"prompt_tokens":            100,
				"completion_tokens":        20,
				"prompt_cache_hit_tokens":  50,
				"prompt_cache_miss_tokens": 50,
			},
		},
	}
	ext := extractGenericMeta(meta)
	require.NotNil(t, ext)
	require.NotNil(t, ext.Usage)
	assert.Equal(t, 100, ext.Usage.InputTokens)
	assert.Equal(t, 20, ext.Usage.OutputTokens)
	assert.Equal(t, 50, ext.Usage.CacheHitTokens)
	assert.Equal(t, 50, ext.Usage.CacheMissTokens)
}

func TestExtractGenericMeta_BridgeKeys(t *testing.T) {
	meta := map[string]any{
		"quota": map[string]any{
			"token_count": map[string]any{
				"cachedWriteTokens": 5,
				"totalTokens":       30,
			},
		},
	}
	ext := extractGenericMeta(meta)
	require.NotNil(t, ext)
	assert.Equal(t, 5, ext.Usage.CachedWriteTokens)
	assert.Equal(t, 30, ext.Usage.TotalTokens)
}

func TestExtractGenericMeta_NoMatches(t *testing.T) {
	assert.Nil(t, extractGenericMeta(map[string]any{"foo": "bar", "baz": []any{1, 2, 3}}))
}

// ---------------------------------------------------------------------------
// extractMetaUsage dispatch
// ---------------------------------------------------------------------------

func TestExtractMetaUsage_Dispatch(t *testing.T) {
	cbMeta := map[string]any{"usage": map[string]any{"prompt_tokens": 10}}
	ext := extractMetaUsage("codebuddy", cbMeta)
	require.NotNil(t, ext)
	assert.Equal(t, 10, ext.Usage.InputTokens)

	clMeta := map[string]any{"quota": map[string]any{"token_count": map[string]any{"inputTokens": 5}}}
	for _, backend := range []string{"claude", "codex", "qoder"} {
		ext := extractMetaUsage(backend, clMeta)
		require.NotNil(t, ext, backend)
		assert.Equal(t, 5, ext.Usage.InputTokens, backend)
	}

	// Unknown backend falls through to generic scan.
	ext = extractMetaUsage("mystery-agent", map[string]any{"deep": map[string]any{"outputTokens": 7}})
	require.NotNil(t, ext)
	assert.Equal(t, 7, ext.Usage.OutputTokens)

	// OpenCode reports no _meta extensions.
	assert.Nil(t, extractMetaUsage("opencode", map[string]any{"timestamp": "t"}))
}

// ---------------------------------------------------------------------------
// applyMetaExtractionToUsageState / applyMetaExtractionToMetadata
// ---------------------------------------------------------------------------

func TestApplyMetaExtractionToUsageState(t *testing.T) {
	ext := &metaExtraction{
		Usage: &metaTokenUsage{
			Present:             true,
			InputTokens:         29495,
			OutputTokens:        3,
			CachedReadTokens:    8192,
			CacheHitTokens:      8192,
			CacheMissTokens:     21303,
			CacheCreationTokens: 0,
			Credit:              1.48,
		},
		Category: &metaCategoryUsage{Present: true, Categories: map[string]int64{"tools": 22701}},
	}
	state := &UsageState{Used: 29495, Size: 200000}
	applyMetaExtractionToUsageState(state, ext)
	assert.Equal(t, 29495, state.InputTokens)
	assert.Equal(t, 3, state.OutputTokens)
	assert.Equal(t, 8192, state.CachedReadTokens)
	assert.Equal(t, 8192, state.CacheHitTokens)
	assert.Equal(t, 21303, state.CacheMissTokens)
	assert.Equal(t, 1.48, state.Credit)
	assert.Equal(t, int64(22701), state.UsageByCategory["tools"])
}

func TestApplyMetaExtractionToMetadata(t *testing.T) {
	ext := &metaExtraction{
		Usage: &metaTokenUsage{
			Present:           true,
			InputTokens:       142,
			OutputTokens:      18,
			TotalTokens:       41213,
			CachedWriteTokens: 41053,
			ThoughtTokens:     30,
		},
		Trace: &metaTrace{
			RequestID:       "req-1",
			TraceID:         "trace-1",
			MessageID:       "msg-1",
			RequestModelID:  "glm-5.1",
			ResponseModelID: "ep-x",
			FinishReason:    "stop",
			Outcome:         "SUCCESS",
			AgentPhase:      "completing",
		},
		Category: &metaCategoryUsage{Present: true, Categories: map[string]int64{"conversation": 3894}},
	}
	meta := &Metadata{Model: "preset-model"}
	applyMetaExtractionToMetadata(meta, ext)
	assert.Equal(t, 142, meta.InputTokens)
	assert.Equal(t, 18, meta.OutputTokens)
	assert.Equal(t, 41213, meta.TotalTokens)
	assert.Equal(t, 41053, meta.CachedWriteTokens)
	assert.Equal(t, 30, meta.ThoughtTokens)
	assert.Equal(t, "req-1", meta.RequestID)
	assert.Equal(t, "trace-1", meta.TraceID)
	assert.Equal(t, "msg-1", meta.MessageID)
	// Existing model preserved — RequestModelID only fills when empty.
	assert.Equal(t, "preset-model", meta.Model)
	assert.Equal(t, "ep-x", meta.ResponseModelID)
	assert.Equal(t, "stop", meta.FinishReason)
	assert.Equal(t, "SUCCESS", meta.Outcome)
	assert.Equal(t, int64(3894), meta.UsageByCategory["conversation"])
}

// ---------------------------------------------------------------------------
// mapACPSessionUpdate — usage_update merges per-agent _meta
// ---------------------------------------------------------------------------

func TestMapACPSessionUpdate_UsageUpdate_CodeBuddyMeta(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	meta := map[string]any{
		"usage": map[string]any{
			"prompt_tokens":            29495,
			"completion_tokens":        3,
			"prompt_cache_hit_tokens":  8192,
			"prompt_cache_miss_tokens": 21303,
			"credit":                   1.48,
		},
		"codebuddy.ai/usageByCategory": map[string]any{"tools": 22701},
	}
	update := acp.SessionUpdate{
		UsageUpdate: &acp.SessionUsageUpdate{
			Meta: meta,
			Used: 29495,
			Size: 200000,
		},
	}
	mapACPSessionUpdate(update, ch, context.Background(), conn, nil)

	var found *StreamEvent
	select {
	case evt := <-ch:
		found = &evt
	default:
		t.Fatal("expected usage_update event")
	}
	require.NotNil(t, found.Usage)
	assert.Equal(t, 29495, found.Usage.Used)
	assert.Equal(t, 200000, found.Usage.Size)
	assert.Equal(t, 29495, found.Usage.InputTokens)
	assert.Equal(t, 3, found.Usage.OutputTokens)
	assert.Equal(t, 8192, found.Usage.CacheHitTokens)
	assert.Equal(t, 21303, found.Usage.CacheMissTokens)
	assert.Equal(t, 1.48, found.Usage.Credit)
	assert.Equal(t, int64(22701), found.Usage.UsageByCategory["tools"])

	// Cached state also reflects the merged usage.
	require.NotNil(t, conn.GetCachedUsageState())
	assert.Equal(t, 29495, conn.GetCachedUsageState().InputTokens)
}

func TestMapACPSessionUpdate_AgentMessageChunk_AccumulatesMeta(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "cb", Backend: "codebuddy"}}
	update := acp.SessionUpdate{
		AgentMessageChunk: &acp.SessionUpdateAgentMessageChunk{
			Content: acp.ContentBlock{Text: &acp.ContentBlockText{Text: "好"}},
			Meta: map[string]any{
				"codebuddy.ai/requestId": "req-123",
				"codebuddy.ai/messageId": "msg-456",
			},
		},
	}
	mapACPSessionUpdate(update, ch, context.Background(), conn, nil)

	// Content events emitted (thinking_done + content).
	var types []string
	for range 2 {
		select {
		case evt := <-ch:
			types = append(types, evt.Type)
		default:
			break
		}
	}
	assert.Contains(t, types, "content")

	// Meta accumulated on the connection.
	acc := conn.getMetaAccum()
	require.NotNil(t, acc)
	require.NotNil(t, acc.Trace)
	assert.Equal(t, "req-123", acc.Trace.RequestID)
	assert.Equal(t, "msg-456", acc.Trace.MessageID)
}

func TestMapACPSessionUpdate_UsageUpdate_NoMeta(t *testing.T) {
	ch := make(chan StreamEvent, 10)
	conn := &ACPConn{agent: &model.Agent{ID: "opencode", Backend: "opencode"}}
	update := acp.SessionUpdate{
		UsageUpdate: &acp.SessionUsageUpdate{Used: 12576, Size: 204800},
	}
	mapACPSessionUpdate(update, ch, context.Background(), conn, nil)

	select {
	case evt := <-ch:
		assert.Equal(t, 12576, evt.Usage.Used)
		assert.Equal(t, 0, evt.Usage.InputTokens)
		assert.Empty(t, evt.Usage.UsageByCategory)
	default:
		t.Fatal("expected usage_update event")
	}
}
