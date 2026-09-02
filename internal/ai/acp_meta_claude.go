package ai

// ---------------------------------------------------------------------------
// Claude / Codex ACP _meta adapter
// ---------------------------------------------------------------------------
//
// Claude (`npx @agentclientprotocol/claude-agent-acp`) and Codex
// (`npx @agentclientprotocol/codex-acp`) share the same bridge protocol stack
// and report per-model token counts in the PromptResponse._meta:
//
//	_meta.quota.token_count = {
//	  cachedInputTokens, cachedWriteTokens, inputTokens, outputTokens,
//	  reasoningOutputTokens, totalTokens
//	}
//	_meta.quota.model_usage = [ { model: "...", token_count: {...} } ]
//
// The aggregate token_count is the same shape across both agents. They also
// both advertise capability extensions in initialize._meta (goal, steering,
// jetbrains.air, ...) which carry no per-turn data and are ignored here.

const (
	metaKeyQuota      = "quota"
	metaKeyTokenCount = "token_count"
)

// extractClaudeMeta parses a Claude/Codex _meta payload.
func extractClaudeMeta(meta map[string]any) *metaExtraction {
	if len(meta) == 0 {
		return nil
	}
	quota, ok := meta[metaKeyQuota].(map[string]any)
	if !ok {
		return nil
	}
	tc, ok := quota[metaKeyTokenCount].(map[string]any)
	if !ok {
		return nil
	}
	u := &metaTokenUsage{
		InputTokens:       metaInt(tc["inputTokens"]),
		OutputTokens:      metaInt(tc["outputTokens"]),
		TotalTokens:       metaInt(tc["totalTokens"]),
		CachedReadTokens:  metaInt(tc["cachedInputTokens"]),
		CachedWriteTokens: metaInt(tc["cachedWriteTokens"]),
		ThoughtTokens:     metaInt(tc["reasoningOutputTokens"]),
	}
	if u.InputTokens != 0 || u.OutputTokens != 0 || u.TotalTokens != 0 ||
		u.CachedReadTokens != 0 || u.CachedWriteTokens != 0 || u.ThoughtTokens != 0 {
		u.Present = true
	}
	if !u.Present {
		return nil
	}
	return &metaExtraction{Usage: u}
}
