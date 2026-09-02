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
	metaKeyModelUsage = "model_usage"
)

// tokenUsageFromClaudeTokenCount builds a metaTokenUsage from a Claude/Codex
// _meta.quota.token_count map (shared aggregate and per-model breakdown shape).
func tokenUsageFromClaudeTokenCount(tc map[string]any) *metaTokenUsage {
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
	return u
}

// extractClaudeMeta parses a Claude/Codex _meta payload.
func extractClaudeMeta(meta map[string]any) *metaExtraction {
	if len(meta) == 0 {
		return nil
	}
	quota, ok := meta[metaKeyQuota].(map[string]any)
	if !ok {
		return nil
	}
	ext := &metaExtraction{}

	// Aggregate per-model token counts.
	// _meta.quota.token_count = { cachedInputTokens, cachedWriteTokens,
	// inputTokens, outputTokens, reasoningOutputTokens, totalTokens }
	if tc, ok := quota[metaKeyTokenCount].(map[string]any); ok {
		ext.Usage = tokenUsageFromClaudeTokenCount(tc)
	}

	// Per-model breakdown. _meta.quota.model_usage = [ { model: "...",
	// token_count: {...} } ]. The model name reveals which model actually ran
	// (Codex can route an alias to a concrete model, e.g. deepseek-v4-flash).
	// It maps to ResponseModelID — "the model that actually responded" — the
	// same semantic as CodeBuddy's codebuddy.ai/responseModelId (its actual
	// serving endpoint, ep-*), so the two agents populate one consistent field.
	if mus, ok := quota[metaKeyModelUsage].([]any); ok && len(mus) > 0 {
		trace := &metaTrace{}
		for _, m := range mus {
			entry, ok := m.(map[string]any)
			if !ok {
				continue
			}
			modelName := metaString(entry["model"])
			if modelName != "" && trace.ResponseModelID == "" {
				trace.ResponseModelID = modelName
			}
			if tc, ok := entry[metaKeyTokenCount].(map[string]any); ok {
				if ext.Usage == nil {
					ext.Usage = &metaTokenUsage{}
				}
				metaMergeUsage(ext.Usage, tokenUsageFromClaudeTokenCount(tc))
			}
		}
		if trace.HasData() {
			ext.Trace = trace
		}
	}

	if !ext.HasData() {
		return nil
	}
	return ext
}
