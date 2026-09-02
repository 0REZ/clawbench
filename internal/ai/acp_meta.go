package ai

import (
	"encoding/json"
)

// ---------------------------------------------------------------------------
// ACP _meta extension parsing — per-agent adapters
// ---------------------------------------------------------------------------
//
// ACP reserves the `_meta` field on every request/response/notification for
// agent-specific extensions. Each agent packs useful information there in a
// different shape:
//
//   - CodeBuddy: OpenAI-style token usage (`_meta.usage` with prompt_tokens /
//     completion_tokens / prompt_cache_* / credit) plus a `codebuddy.ai/*`
//     namespace (usageByCategory, requestId, traceId, modelId, ...). Reported
//     both on session/update notifications and the PromptResponse.
//   - Claude / Codex (shared bridge protocol stack): `PromptResponse._meta.quota`
//     with a per-model `token_count` (cachedInputTokens / cachedWriteTokens /
//     inputTokens / outputTokens / reasoningOutputTokens / totalTokens).
//   - OpenCode: no _meta extensions — its usage arrives through the standard
//     usage_update notification and PromptResponse.Usage.
//
// The dispatch mirrors parseACPToolCall: per-agent functions handle their own
// shape, an unknown backend falls through to a generic recursive scan, and
// callers merge whatever is found into the canonical UsageState / Metadata.

// metaTokenUsage is the canonical, agent-agnostic token/cost detail extracted
// from a _meta payload.
type metaTokenUsage struct {
	// Token counters (0 = not reported by this agent).
	InputTokens       int
	OutputTokens      int
	TotalTokens       int
	CachedReadTokens  int
	CachedWriteTokens int
	ThoughtTokens     int
	// Cache splits (CodeBuddy OpenAI-style detail).
	CacheCreationTokens int
	CacheHitTokens      int
	CacheMissTokens     int
	Credit              float64
	// Present reports whether any token/cost field was found at all.
	Present bool
}

// metaTrace is the canonical trace/identity detail extracted from a _meta payload.
type metaTrace struct {
	RequestID       string
	TraceID         string
	MessageID       string
	RequestModelID  string
	ResponseModelID string
	FinishReason    string
	Outcome         string
	AgentPhase      string
}

// HasData reports whether any trace field was found.
func (t *metaTrace) HasData() bool {
	return t != nil && (t.RequestID != "" || t.TraceID != "" || t.MessageID != "" ||
		t.RequestModelID != "" || t.ResponseModelID != "" || t.FinishReason != "" ||
		t.Outcome != "" || t.AgentPhase != "")
}

// metaCategoryUsage extracts the context-window breakdown map. Currently only
// CodeBuddy reports it (_meta.codebuddy.ai/usageByCategory).
type metaCategoryUsage struct {
	Categories map[string]int64
	Present    bool
}

// metaExtraction bundles everything extracted from one _meta payload.
type metaExtraction struct {
	Usage    *metaTokenUsage
	Trace    *metaTrace
	Category *metaCategoryUsage
}

// HasData reports whether any field was extracted.
func (e *metaExtraction) HasData() bool {
	return e != nil && ((e.Usage != nil && e.Usage.Present) || (e.Trace != nil && e.Trace.HasData()) ||
		(e.Category != nil && e.Category.Present))
}

// extractMetaUsage dispatches _meta parsing to the per-agent adapter.
// backend is the BackendID (e.g. "codebuddy", "claude", "codex", "opencode").
func extractMetaUsage(backend string, meta map[string]any) *metaExtraction {
	switch backend {
	case "codebuddy":
		return extractCodeBuddyMeta(meta)
	case "claude", "codex", "qoder":
		return extractClaudeMeta(meta)
	default:
		return extractGenericMeta(meta)
	}
}

// ---------------------------------------------------------------------------
// Shared _meta helpers
// ---------------------------------------------------------------------------

// metaFloat reads a numeric field that may be float64, int, or json.Number.
func metaFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}

// metaInt reads an integer field that may be float64, int, or json.Number.
func metaInt(v any) int {
	return int(metaFloat(v))
}

// metaString reads a string field.
func metaString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// metaMaxInt returns the maximum of base and vals (used to keep the richest
// value across multiple notifications).
func metaMaxInt(base int, vals ...int) int {
	out := base
	for _, v := range vals {
		if v > out {
			out = v
		}
	}
	return out
}

// metaMergeUsage overlays src onto dst, keeping non-zero src values.
func metaMergeUsage(dst *metaTokenUsage, src *metaTokenUsage) {
	if src == nil || dst == nil {
		return
	}
	dst.InputTokens = metaMaxInt(dst.InputTokens, src.InputTokens)
	dst.OutputTokens = metaMaxInt(dst.OutputTokens, src.OutputTokens)
	dst.TotalTokens = metaMaxInt(dst.TotalTokens, src.TotalTokens)
	dst.CachedReadTokens = metaMaxInt(dst.CachedReadTokens, src.CachedReadTokens)
	dst.CachedWriteTokens = metaMaxInt(dst.CachedWriteTokens, src.CachedWriteTokens)
	dst.ThoughtTokens = metaMaxInt(dst.ThoughtTokens, src.ThoughtTokens)
	dst.CacheCreationTokens = metaMaxInt(dst.CacheCreationTokens, src.CacheCreationTokens)
	dst.CacheHitTokens = metaMaxInt(dst.CacheHitTokens, src.CacheHitTokens)
	dst.CacheMissTokens = metaMaxInt(dst.CacheMissTokens, src.CacheMissTokens)
	if src.Credit > dst.Credit {
		dst.Credit = src.Credit
	}
	dst.Present = dst.Present || src.Present
}

// metaMergeTrace overlays src onto dst, filling empty fields.
func metaMergeTrace(dst *metaTrace, src *metaTrace) {
	if src == nil || dst == nil {
		return
	}
	if dst.RequestID == "" {
		dst.RequestID = src.RequestID
	}
	if dst.TraceID == "" {
		dst.TraceID = src.TraceID
	}
	if dst.MessageID == "" {
		dst.MessageID = src.MessageID
	}
	if dst.RequestModelID == "" {
		dst.RequestModelID = src.RequestModelID
	}
	if dst.ResponseModelID == "" {
		dst.ResponseModelID = src.ResponseModelID
	}
	if dst.FinishReason == "" {
		dst.FinishReason = src.FinishReason
	}
	if dst.Outcome == "" {
		dst.Outcome = src.Outcome
	}
	if dst.AgentPhase == "" {
		dst.AgentPhase = src.AgentPhase
	}
}

// metaMergeCategory overlays src onto dst (per-key max).
func metaMergeCategory(dst *metaCategoryUsage, src *metaCategoryUsage) {
	if src == nil || dst == nil || !src.Present {
		return
	}
	dst.Present = true
	if dst.Categories == nil {
		dst.Categories = make(map[string]int64)
	}
	for k, v := range src.Categories {
		if v > dst.Categories[k] {
			dst.Categories[k] = v
		}
	}
}

// metaMergeExtraction merges src into dst.
func metaMergeExtraction(dst *metaExtraction, src *metaExtraction) {
	if src == nil || dst == nil {
		return
	}
	if src.Usage != nil && src.Usage.Present {
		if dst.Usage == nil {
			dst.Usage = &metaTokenUsage{}
		}
		metaMergeUsage(dst.Usage, src.Usage)
	}
	if src.Trace != nil && src.Trace.HasData() {
		if dst.Trace == nil {
			dst.Trace = &metaTrace{}
		}
		metaMergeTrace(dst.Trace, src.Trace)
	}
	if src.Category != nil && src.Category.Present {
		if dst.Category == nil {
			dst.Category = &metaCategoryUsage{}
		}
		metaMergeCategory(dst.Category, src.Category)
	}
}

// applyMetaExtractionToUsageState overlays a parsed _meta extraction onto a
// UsageState (used for the usage_update event payload and cached state).
func applyMetaExtractionToUsageState(state *UsageState, ext *metaExtraction) {
	if ext == nil || state == nil {
		return
	}
	if u := ext.Usage; u != nil {
		if u.InputTokens != 0 {
			state.InputTokens = u.InputTokens
		}
		if u.OutputTokens != 0 {
			state.OutputTokens = u.OutputTokens
		}
		if u.TotalTokens != 0 {
			state.TotalTokens = u.TotalTokens
		}
		if u.CachedReadTokens != 0 {
			state.CachedReadTokens = u.CachedReadTokens
		}
		if u.CachedWriteTokens != 0 {
			state.CachedWriteTokens = u.CachedWriteTokens
		}
		if u.ThoughtTokens != 0 {
			state.ThoughtTokens = u.ThoughtTokens
		}
		if u.CacheCreationTokens != 0 {
			state.CacheCreationTokens = u.CacheCreationTokens
		}
		if u.CacheHitTokens != 0 {
			state.CacheHitTokens = u.CacheHitTokens
		}
		if u.CacheMissTokens != 0 {
			state.CacheMissTokens = u.CacheMissTokens
		}
		if u.Credit != 0 {
			state.Credit = u.Credit
		}
	}
	if cat := ext.Category; cat != nil && cat.Present {
		state.UsageByCategory = cat.Categories
	}
}

// applyMetaExtractionToMetadata overlays a parsed _meta extraction onto a
// message-level Metadata (used for the metadata event / DB persistence).
func applyMetaExtractionToMetadata(meta *Metadata, ext *metaExtraction) {
	if ext == nil || meta == nil {
		return
	}
	if u := ext.Usage; u != nil {
		if u.InputTokens != 0 {
			meta.InputTokens = u.InputTokens
		}
		if u.OutputTokens != 0 {
			meta.OutputTokens = u.OutputTokens
		}
		if u.TotalTokens != 0 {
			meta.TotalTokens = u.TotalTokens
		}
		if u.CachedReadTokens != 0 {
			meta.CachedReadTokens = u.CachedReadTokens
		}
		if u.CachedWriteTokens != 0 {
			meta.CachedWriteTokens = u.CachedWriteTokens
		}
		if u.ThoughtTokens != 0 {
			meta.ThoughtTokens = u.ThoughtTokens
		}
		if u.CacheCreationTokens != 0 {
			meta.CacheCreationTokens = u.CacheCreationTokens
		}
		if u.CacheHitTokens != 0 {
			meta.CacheHitTokens = u.CacheHitTokens
		}
		if u.CacheMissTokens != 0 {
			meta.CacheMissTokens = u.CacheMissTokens
		}
		if u.Credit != 0 {
			meta.Credit = u.Credit
		}
	}
	if cat := ext.Category; cat != nil && cat.Present {
		meta.UsageByCategory = cat.Categories
	}
	if tr := ext.Trace; tr != nil {
		if tr.RequestID != "" {
			meta.RequestID = tr.RequestID
		}
		if tr.TraceID != "" {
			meta.TraceID = tr.TraceID
		}
		if tr.MessageID != "" {
			meta.MessageID = tr.MessageID
		}
		if tr.RequestModelID != "" && meta.Model == "" {
			meta.Model = tr.RequestModelID
		}
		if tr.ResponseModelID != "" {
			meta.ResponseModelID = tr.ResponseModelID
		}
		if tr.FinishReason != "" {
			meta.FinishReason = tr.FinishReason
		}
		if tr.Outcome != "" {
			meta.Outcome = tr.Outcome
		}
		if tr.AgentPhase != "" {
			meta.AgentPhase = tr.AgentPhase
		}
	}
}

// mergeMetaExtractionToConn accumulates per-agent _meta extensions onto the
// connection so the turn-final metadata event can include everything observed.
// Safe to call from the ACP notification goroutine: it uses the dedicated
// metaMu lock, not c.mu (which would deadlock with RPCs holding c.mu).
func mergeMetaExtractionToConn(conn *ACPConn, backendID string, meta map[string]any) {
	if conn == nil || len(meta) == 0 {
		return
	}
	ext := extractMetaUsage(backendID, meta)
	if ext == nil {
		return
	}
	conn.mergeMetaExtraction(ext)
}
