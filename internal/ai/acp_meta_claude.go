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
		ext.Usage = u
	}

	// Per-model breakdown. _meta.quota.model_usage = [ { model: "...",
	// token_count: {...} } ]. The model name reveals which model actually ran
	// (Codex can route an alias to a concrete model, e.g. deepseek-v4-flash),
	// so surface it as the trace's ResponseModelID when no _meta trace provides
	// one. The per-model token_count is aggregated into the usage totals.
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
				perModel := &metaTokenUsage{
					InputTokens:       metaInt(tc["inputTokens"]),
					OutputTokens:      metaInt(tc["outputTokens"]),
					TotalTokens:       metaInt(tc["totalTokens"]),
					CachedReadTokens:  metaInt(tc["cachedInputTokens"]),
					CachedWriteTokens: metaInt(tc["cachedWriteTokens"]),
					ThoughtTokens:     metaInt(tc["reasoningOutputTokens"]),
				}
				if perModel.InputTokens != 0 || perModel.OutputTokens != 0 ||
					perModel.TotalTokens != 0 || perModel.CachedReadTokens != 0 ||
					perModel.CachedWriteTokens != 0 || perModel.ThoughtTokens != 0 {
					perModel.Present = true
				}
				metaMergeUsage(ext.Usage, perModel)
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
