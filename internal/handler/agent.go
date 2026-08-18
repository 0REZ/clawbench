//nolint:goconst // JSON response field names are domain strings, not config constants
package handler

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	acp "github.com/coder/acp-go-sdk"

	"clawbench/internal/ai"
	"clawbench/internal/middleware"
	"clawbench/internal/model"
	"clawbench/internal/platform"
	"clawbench/internal/service"
)

// IsChinaMainland exports the China detection result for use by other packages.
func IsChinaMainland() bool {
	return platform.IsChinaMainland()
}

const npmMirrorRegistry = "https://registry.npmmirror.com"

// agentIDRe validates agent IDs: alphanumeric, hyphens, underscores, dots only.
var agentIDRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// isValidAgentID checks that an agent ID is non-empty, within length limits,
// and contains only safe characters (no path traversal or injection vectors).
func isValidAgentID(id string) bool {
	if id == "" || utf8.RuneCountInString(id) > 128 {
		return false
	}
	// Must start with a letter or digit; only letters, digits, hyphens, underscores, dots allowed.
	// Reject pure dot sequences like ".." to prevent path traversal.
	if id == "." || id == ".." {
		return false
	}
	return agentIDRe.MatchString(id)
}

// prepareInstallCmd modifies an install command for display:
// Adds China npm mirror registry if in mainland China.
func prepareInstallCmd(installCmd string) string {
	if !strings.HasPrefix(installCmd, "npm install") {
		return installCmd
	}
	if platform.IsChinaMainland() && !strings.Contains(installCmd, "--registry") {
		return installCmd + " --registry=" + npmMirrorRegistry
	}
	return installCmd
}

// ServeAgentSubRoutes handles /api/agents/* sub-routes (e.g. /api/agents/{id}/refresh-models).
func ServeAgentSubRoutes(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasSuffix(path, "/common-prompt") && r.Method == http.MethodGet {
		ServeAgentCommonPrompt(w, r)
		return
	}
	if strings.HasSuffix(path, "/refresh-models") && r.Method == http.MethodPost {
		ServeAgentRefreshModels(w, r)
		return
	}
	if strings.HasSuffix(path, "/acp-sessions") && r.Method == http.MethodGet {
		ServeACPSessions(w, r)
		return
	}
	if strings.HasSuffix(path, "/rescan") && r.Method == http.MethodPost {
		serveAgentsRescan(w, r)
		return
	}
	writeLocalizedErrorf(w, r, http.StatusNotFound, "NotFound")
}

// ServeAgentCommonPrompt handles GET /api/agents/common-prompt — returns the
// built-in common prompt that is prepended to all agents' system prompts.
// The frontend uses this to strip the common prefix when displaying the
// user-editable custom system prompt in the settings panel.
func ServeAgentCommonPrompt(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"commonPrompt": model.BuildCommonPrompt(),
	})
}

// ServeAgents returns the list of configured AI agents.
func ServeAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		serveAgentsGet(w, r)
		return
	}
	if r.Method == http.MethodPatch {
		serveAgentsPatch(w, r)
		return
	}
	if r.Method == http.MethodPost {
		serveAgentsDuplicate(w, r)
		return
	}
	if r.Method == http.MethodDelete {
		serveAgentsDelete(w, r)
		return
	}
	writeLocalizedErrorf(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")
}

func serveAgentsGet(w http.ResponseWriter, _ *http.Request) {
	configMutex.RLock()
	agents := make([]*model.Agent, len(model.AgentList))
	copy(agents, model.AgentList)
	defaultAgent := model.GetDefaultAgentID()
	configMutex.RUnlock()

	// Attach cached ACP mode/thinking/commands state to each agent.
	// This lets the frontend populate mode chips and slash commands without
	// extra API calls. State comes from the AgentCapabilityRegistry (agent-level)
	// so it persists across connection lifecycle.
	type acpState struct {
		Mode         *ai.ModeState             `json:"modeState,omitempty"`
		Effort       *ai.ThinkingEffortState   `json:"thinkingEffortState,omitempty"`
		Commands     []ai.AvailableCommandInfo `json:"commands,omitempty"`
		ModelList    *ai.ModelListState        `json:"modelListState,omitempty"`
		Plan         *ai.PlanState             `json:"planState,omitempty"`
		LoadSession  bool                      `json:"loadSession"`
		ListSessions bool                      `json:"listSessions"`
	}
	states := make(map[string]*acpState, len(agents))
	reg := ai.GetAgentCapabilityRegistry()
	for _, a := range agents {
		if !a.SupportsACP() {
			continue
		}
		// Use BackendSpec.ACPLoadSession as the authoritative source —
		// some agents (e.g. CodeBuddy) report LoadSession in ACP Initialize
		// but don't actually support it.
		spec := model.FindSpecByBackend(a.Backend)
		loadSession := spec != nil && spec.ACPLoadSession
		s := &acpState{LoadSession: loadSession, ListSessions: reg.GetListSessions(a.ID)}

		agentCap := reg.Get(a.ID)
		if agentCap != nil && agentCap.HasData() {
			s.Mode = reg.GetModeState(a.ID, "")
			s.Effort = reg.GetThinkingEffortState(a.ID, "")
			s.Commands = reg.GetCommands(a.ID)
			s.ModelList = reg.GetModelListState(a.ID, "")

			if s.ModelList != nil && len(s.ModelList.Models) > 0 {
				// Copy the slice to avoid mutating the shared Agent object under RLock.
				models := make([]model.AgentModel, len(s.ModelList.Models))
				copy(models, s.ModelList.Models)
				a.Models = models
			}
		}
		states[a.ID] = s
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"agents":       agents,
		"defaultAgent": defaultAgent,
		"acpStates":    states,
	})
}

// serveAgentsDuplicate handles POST /api/agents — duplicates an existing agent.
// Expects: {"source_id": "claude", "name": "My Custom Claude"}
// Returns the newly created agent.
func serveAgentsDuplicate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SourceID string `json:"source_id"`
		Name     string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.SourceID == "" {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}
	if req.Name == "" || utf8.RuneCountInString(req.Name) > 64 {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidAgentName")
		return
	}

	configMutex.Lock()
	defer configMutex.Unlock()

	clone, err := service.DuplicateAgent(req.SourceID, req.Name)
	if err != nil {
		slog.Error("failed to duplicate agent", "source", req.SourceID, "error", err)
		if strings.Contains(err.Error(), "not found") {
			writeLocalizedErrorf(w, r, http.StatusNotFound, "AgentNotFound")
			return
		}
		writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
		return
	}

	// Add to in-memory maps for immediate reflection
	model.Agents[clone.ID] = clone
	model.AgentList = append(model.AgentList, clone)

	// Populate runtime-only fields
	if spec := model.FindSpecByBackend(clone.Backend); spec != nil {
		if model.CanDiscoverModels(*spec) {
			clone.CanRefreshModels = true
		}
		if len(clone.ThinkingEffortLevels) == 0 && len(spec.ThinkingEffortLevels) > 0 {
			clone.ThinkingEffortLevels = spec.ThinkingEffortLevels
		}
	}
	clone.SupportsCLI = model.BackendSupportsCLI(clone.Backend)

	writeJSON(w, http.StatusOK, clone)
}

// serveAgentsRescan handles POST /api/agents/rescan — re-runs the full agent
// discovery pipeline (detect CLIs → discover models → merge → reload memory).
// This brings back any auto-detected agents that were accidentally deleted.
func serveAgentsRescan(w http.ResponseWriter, _ *http.Request) {
	configMutex.Lock()
	defer configMutex.Unlock()

	model.SyncDiscoverAgentsDB(service.WriteDB())
	discoveredModels := model.SyncDiscoverModels()
	model.MergeDiscoveredDataDB(service.WriteDB(), discoveredModels)

	// Return the current agent list (same shape as GET /api/agents)
	agents := make([]*model.Agent, len(model.AgentList))
	copy(agents, model.AgentList)
	defaultAgent := model.GetDefaultAgentID()

	writeJSON(w, http.StatusOK, map[string]any{
		"agents":       agents,
		"defaultAgent": defaultAgent,
	})
}

func serveAgentsDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.ID == "" {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}

	configMutex.Lock()
	defer configMutex.Unlock()

	// Cannot delete the default agent
	if req.ID == model.GetDefaultAgentID() {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "CannotDeleteDefaultAgent")
		return
	}

	agent, ok := model.Agents[req.ID]
	if !ok {
		writeLocalizedErrorf(w, r, http.StatusNotFound, "AgentNotFound")
		return
	}

	// Close ACP connections for this agent before deleting
	if agent.SupportsACP() {
		mgr := ai.GetACPConnManager()
		mgr.CloseConnsByAgentID(req.ID)
		slog.Info("closed ACP connections before agent delete", "agent", req.ID)
	}

	if err := service.DeleteAgent(req.ID); err != nil {
		slog.Error("failed to delete agent", "agent", req.ID, "error", err)
		writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
		return
	}

	// Remove from in-memory maps
	delete(model.Agents, req.ID)
	newAgentList := make([]*model.Agent, 0, len(model.AgentList)-1)
	for _, a := range model.AgentList {
		if a.ID != req.ID {
			newAgentList = append(newAgentList, a)
		}
	}
	model.AgentList = newAgentList

	writeJSON(w, http.StatusOK, map[string]any{"deleted": req.ID})
}

// serveAgentsPatch handles PATCH /api/agents — updates an agent's configurable fields.
// isValidThinkingEffort checks if a thinking effort level is valid for an agent.
// It checks levels based on the agent's effective transport:
//   - ACP mode: only ACP-reported levels from AgentCapabilityRegistry
//   - CLI mode: only static ThinkingEffortLevels from BackendSpec
//   - Neither has levels: allow any value (backward compatible)
func isValidThinkingEffort(agent *model.Agent, level string) bool {
	transport := agent.Transport
	if transport == "" {
		if agent.AcpCommand != "" {
			transport = "acp-stdio"
		} else {
			transport = "cli"
		}
	}

	reg := ai.GetAgentCapabilityRegistry()

	if transport == "acp-stdio" {
		// ACP mode: only check ACP-reported levels
		if es := reg.GetThinkingEffortState(agent.ID, ""); es != nil && len(es.AvailableLevels) > 0 {
			for _, l := range es.AvailableLevels {
				if l.ID == level {
					return true
				}
			}
			return false
		}
		// No ACP levels yet (pool not initialized) — allow any value
		return true
	}

	// CLI mode: check static levels from BackendSpec
	if len(agent.ThinkingEffortLevels) > 0 {
		for _, l := range agent.ThinkingEffortLevels {
			if l == level {
				return true
			}
		}
		return false
	}

	// No static levels and not ACP — allow any value
	return true
}

// Expects: {"id": "claude", "preferred_model": "claude-opus-4-5", "preferred_thinking_effort": "high", ...}
// Patchable fields: preferred_model, preferred_thinking_effort, transport,
// name, specialty, custom_system_prompt, sort_order.
func serveAgentsPatch(w http.ResponseWriter, r *http.Request) { //nolint:gocognit,gocyclo // multi-field agent patch logic
	var patch map[string]any
	if !decodeJSON(w, r, &patch) {
		return
	}

	agentID, _ := patch["id"].(string)
	if agentID == "" {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}

	configMutex.Lock()
	defer configMutex.Unlock()

	agent, ok := model.Agents[agentID]
	if !ok {
		writeLocalizedErrorf(w, r, http.StatusNotFound, "AgentNotFound")
		return
	}

	ap := service.AgentPatch{}

	// Validate and apply preferred_mode
	if v, exists := patch["preferred_mode"]; exists {
		modeID, _ := v.(string)
		if modeID != "" {
			// Validate against ACP available modes for this agent
			reg := ai.GetAgentCapabilityRegistry()
			if !reg.IsModeAvailable(agentID, modeID) {
				writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidModeForAgent")
				return
			}
		}
		ap.PreferredMode = &modeID
	}

	// Validate and apply preferred_model
	if v, exists := patch["preferred_model"]; exists {
		modelID, _ := v.(string)
		if modelID != "" {
			found := false
			for _, m := range agent.Models {
				if m.ID == modelID {
					found = true
					break
				}
			}
			// Accept models reported by the ACP runtime even if they aren't in
			// the CLI-discovered agent.Models list (runtime union of both sources).
			if !found {
				reg := ai.GetAgentCapabilityRegistry()
				if mls := reg.GetModelListState(agentID, ""); mls != nil {
					for _, m := range mls.Models {
						if m.ID == modelID {
							found = true
							break
						}
					}
				}
			}
			if !found {
				writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidModelForAgent")
				return
			}
		}
		ap.PreferredModel = &modelID
	}

	// Validate and apply preferred_thinking_effort
	if v, exists := patch["preferred_thinking_effort"]; exists {
		level, _ := v.(string)
		if level != "" {
			found := isValidThinkingEffort(agent, level)
			if !found {
				writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidThinkingEffort")
				return
			}
		}
		ap.PreferredThinkingEffort = &level
	}

	// Validate and apply transport (only for agents that support ACP)
	if v, exists := patch["transport"]; exists {
		transport, _ := v.(string)
		spec := model.FindSpecByBackend(agent.Backend)
		hasACP := spec != nil && spec.AcpCommand != ""
		hasCLI := agent.SupportsCLI
		oldTransport := agent.Transport
		switch {
		case transport == "cli" && hasCLI:
			agent.Transport = "cli"
		case transport == "acp-stdio" && hasACP:
			agent.Transport = "acp-stdio"
		default:
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidTransport")
			return
		}
		ap.Transport = &agent.Transport
		// When switching from ACP to CLI, close all ACP connections for this agent
		if oldTransport == "acp-stdio" && agent.Transport == "cli" {
			mgr := ai.GetACPConnManager()
			mgr.CloseConnsByAgentID(agentID)
			slog.Info("closed ACP connections after transport switch to CLI", "agent", agentID)
		}
	}

	// Validate and apply name
	if v, exists := patch["name"]; exists {
		name, _ := v.(string)
		if name == "" || utf8.RuneCountInString(name) > 64 {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidAgentName")
			return
		}
		ap.Name = &name
	}

	// Validate and apply specialty
	if v, exists := patch["specialty"]; exists {
		specialty, _ := v.(string)
		if utf8.RuneCountInString(specialty) > 128 {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidAgentSpecialty")
			return
		}
		ap.Specialty = &specialty
	}

	// Validate and apply custom_system_prompt
	if v, exists := patch["custom_system_prompt"]; exists {
		customPrompt, _ := v.(string)
		if len(customPrompt) > 32*1024 {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidSystemPrompt")
			return
		}
		if containsPromptOverride(customPrompt) {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "SystemPromptOverride")
			return
		}
		ap.CustomSystemPrompt = &customPrompt
	}

	// Validate and apply sort_order
	if v, exists := patch["sort_order"]; exists {
		switch n := v.(type) {
		case float64:
			order := int(n)
			if order < 0 {
				writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidSortOrder")
				return
			}
			ap.SortOrder = &order
		case int:
			if n < 0 {
				writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidSortOrder")
				return
			}
			ap.SortOrder = &n
		default:
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidSortOrder")
			return
		}
	}

	// Persist to database
	if err := service.PatchAgentFields(agentID, ap); err != nil {
		writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
		return
	}

	// Update in-memory agent for immediate reflection
	if ap.PreferredMode != nil {
		agent.PreferredMode = *ap.PreferredMode
	}
	if ap.PreferredModel != nil {
		agent.PreferredModel = *ap.PreferredModel
	}
	if ap.PreferredThinkingEffort != nil {
		agent.PreferredThinkingEffort = *ap.PreferredThinkingEffort
	}
	if ap.Transport != nil {
		agent.Transport = *ap.Transport
	}
	if ap.Name != nil {
		agent.Name = *ap.Name
	}
	if ap.Specialty != nil {
		agent.Specialty = *ap.Specialty
	}
	if ap.CustomSystemPrompt != nil {
		agent.CustomSystemPrompt = *ap.CustomSystemPrompt
		// Recompose SystemPrompt
		commonPrompt := model.BuildCommonPrompt()
		if commonPrompt != "" && agent.CustomSystemPrompt != "" {
			agent.SystemPrompt = commonPrompt + "\n\n" + agent.CustomSystemPrompt
		} else if commonPrompt != "" {
			agent.SystemPrompt = commonPrompt
		} else {
			agent.SystemPrompt = agent.CustomSystemPrompt
		}
	}
	if ap.SortOrder != nil {
		agent.SortOrder = *ap.SortOrder
	}

	writeJSON(w, http.StatusOK, agent)
}

// containsPromptOverride checks for common prompt injection patterns that attempt
// to override built-in safety rules. This is a best-effort heuristic, not a
// comprehensive security boundary — the actual safety boundary is enforced by
// the AI model itself at inference time.
func containsPromptOverride(prompt string) bool {
	lower := strings.ToLower(prompt)
	overridePatterns := []string{
		"ignore previous instructions",
		"ignore all previous",
		"ignore above instructions",
		"disregard all previous",
		"disregard all above",
		"forget all previous instructions",
	}
	for _, pattern := range overridePatterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}

// ServeAgentRefreshModels handles POST /api/agents/{id}/refresh-models — triggers model re-discovery
// for the specified agent and returns the updated model list. The discovered models completely replace
// the agent's current model list (both in memory and in the cache file).
//
// Refresh strategy: CLI model discovery via BackendSpec (e.g., pi --list-models)
func ServeAgentRefreshModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeLocalizedErrorf(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")
		return
	}

	// Extract agent ID from path: /api/agents/{id}/refresh-models
	path := strings.TrimPrefix(r.URL.Path, "/api/agents/")
	agentID := strings.TrimSuffix(path, "/refresh-models")

	if !isValidAgentID(agentID) {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}

	configMutex.Lock()
	defer configMutex.Unlock()

	agent, ok := model.Agents[agentID]
	if !ok {
		writeLocalizedErrorf(w, r, http.StatusNotFound, "AgentNotFound")
		return
	}

	var models []model.AgentModel
	canDiscover := false // whether any discovery method is available

	// CLI model discovery via BackendSpec
	spec := model.FindSpecByBackend(agent.Backend)
	if spec != nil && model.CanDiscoverModels(*spec) {
		canDiscover = true
		models = model.DiscoverModels(*spec)
	}

	if len(models) == 0 {
		// No discovery method available at all
		if !canDiscover {
			writeLocalizedErrorf(w, r, http.StatusBadRequest, "ModelDiscoveryNotSupported")
			return
		}
		// Discovery method available but returned nothing — check for specific errors
		if spec != nil {
			if err := model.CheckCLIExistsErr(spec.DefaultCmd); err != nil {
				slog.Warn("model refresh failed: CLI not available", "agent", agentID, "backend", agent.Backend, "cmd", spec.DefaultCmd, "error", err)
				writeLocalizedErrorf(w, r, http.StatusNotFound, "CLINotFound")
				return
			}
		}
		slog.Warn("model refresh returned no models", "agent", agentID, "backend", agent.Backend)
		writeLocalizedErrorf(w, r, http.StatusInternalServerError, "ModelDiscoveryFailed")
		return
	}

	// Update in-memory agent (regardless of ModelsAutoDetected — manual refresh always overrides)
	agent.Models = models
	agent.ModelsAutoDetected = true

	// Update database
	if err := service.SaveAgent(service.WriteDB(), agent); err != nil {
		slog.Warn("failed to persist model refresh to DB", "agent", agentID, "error", err)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"models": models,
	})
}

// ServeACPSessions handles GET /api/agents/{id}/acp-sessions — lists ACP sessions
// for an agent that supports LoadSession + ListSessions.
//
//nolint:gocyclo // ServeACPSessions has multiple sequential checks and branches for ACP capability validation; restructuring would reduce readability
func ServeACPSessions(w http.ResponseWriter, r *http.Request) {
	// Extract agent ID from path: /api/agents/{id}/acp-sessions
	path := strings.TrimPrefix(r.URL.Path, "/api/agents/")
	agentID := strings.TrimSuffix(path, "/acp-sessions")

	if !isValidAgentID(agentID) {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}

	configMutex.RLock()
	agent, ok := model.Agents[agentID]
	configMutex.RUnlock()

	if !ok {
		writeLocalizedErrorf(w, r, http.StatusNotFound, "AgentNotFound")
		return
	}

	if !agent.SupportsACP() {
		writeLocalizedErrorf(w, r, http.StatusBadRequest, "InvalidRequestBody")
		return
	}

	reg := ai.GetAgentCapabilityRegistry()

	// Try to get an existing alive connection first.
	mgr := ai.GetACPConnManager()
	conn := mgr.GetConnByAgentID(agentID)

	// If no alive connection exists, try to spawn one to discover capabilities.
	// This solves the chicken-and-egg problem: GetListSessions is only populated
	// after Initialize, which requires spawning a connection. We use EnsureAlive
	// which spawns without creating a session.
	if conn == nil {
		conn = mgr.GetOrCreateConnNoSession(r.Context(), agent)
	}

	// Check capabilities — use BackendSpec as authoritative source for LoadSession
	// (some agents like CodeBuddy report LoadSession=true in ACP Initialize but
	// don't actually support it). ListSessions still comes from registry.
	spec := model.FindSpecByBackend(agent.Backend)
	loadSession := spec != nil && spec.ACPLoadSession
	listSessions := reg.GetListSessions(agentID)

	// ListSessions can be served either by the ACP session/list RPC (when the
	// agent advertises the capability) or by an on-disk scanner fallback
	// (registered by backends that don't implement session/list, e.g. CodeBuddy).
	// Determine which path to take.
	diskListSessions := ai.HasListSessionsFromDisk(agent.Backend)

	// If none of LoadSession / session/list RPC / disk scanner is available,
	// return 501.
	if !loadSession && !listSessions && !diskListSessions {
		writeLocalizedErrorf(w, r, http.StatusNotImplemented, "NotImplemented")
		return
	}

	// If the agent supports LoadSession but has NO way to enumerate sessions
	// (neither session/list RPC nor an on-disk scanner), there is nothing to
	// list — return 501 so the drawer shows "not supported".
	if !listSessions && !diskListSessions {
		writeLocalizedErrorf(w, r, http.StatusNotImplemented, "NotImplemented")
		return
	}

	cursor := r.URL.Query().Get("cursor")

	var sessions []acp.SessionInfo
	var nextCursor *string
	var err error

	if listSessions {
		// session/list RPC path — needs an alive connection.
		if conn == nil {
			slog.Warn("handler: failed to spawn ACP connection for ListSessions", "agent", agentID)
			writeLocalizedErrorf(w, r, http.StatusServiceUnavailable, "ServiceUnavailable")
			return
		}
		var cursorPtr *string
		if cursor != "" {
			cursorPtr = &cursor
		}
		sessions, nextCursor, err = conn.ListSessions(r.Context(), cursorPtr)
		if err != nil {
			slog.Error("handler: ListSessions failed", "agent", agentID, "error", err)
			writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
			return
		}
	} else {
		// On-disk scanner fallback (e.g. CodeBuddy). No connection required.
		// Scope the scan to the current project root (from cookie) so the
		// scanner only walks the project's own session directory.
		cwd := middleware.GetProjectFromCookie(r)
		sessions, err = ai.ListSessionsFromDisk(agent, cwd)
		if err != nil {
			slog.Error("handler: on-disk ListSessions failed", "agent", agentID, "error", err)
			writeLocalizedErrorf(w, r, http.StatusInternalServerError, "InternalError")
			return
		}
	}

	// Filter out ACP sessions that already exist in ClawBench's session manager.
	// Each loaded ACP session has source_session_id = "acp:{acpSessionId}".
	// The @resume drawer shows only "native" ACP sessions — sessions the user has
	// not yet loaded into ClawBench. Sessions that already exist locally (active
	// or archived) are excluded so the user resumes them from the local session
	// list instead of re-loading from the agent.
	if len(sessions) > 0 {
		acpSessionIDs := make([]string, len(sessions))
		for i, s := range sessions {
			acpSessionIDs[i] = string(s.SessionId)
		}
		existingACP := findExistingACPSessions(acpSessionIDs)
		filtered := make([]acp.SessionInfo, 0, len(sessions))
		for _, s := range sessions {
			if !existingACP[string(s.SessionId)] {
				filtered = append(filtered, s)
			}
		}
		sessions = filtered
	}

	// Display-only title cleanup: agents title sessions after the last user
	// message, which for ClawBench-origin sessions begins with the injected
	// [System Instructions: ...] block (or a continuation summary). The
	// agent truncates the reported title inside that block, so the user's
	// actual text is not present in the title at all — recovery must
	// re-read the session transcript on disk (read-only; the transcript
	// itself is never modified) and re-derive the title from the first
	// user-typed message.
	//
	// Backend support: title detection (isMachineGeneratedTitle) and this
	// display-layer hook are backend-agnostic, but transcript recovery
	// needs a per-backend resolver — where the CLI stores sessions and how
	// to extract user messages from its format. Only the Claude CLI is
	// implemented (acpTranscriptPath + resolveTranscriptPath +
	// customTitleFromTranscript + firstRealQuestionFromTranscript, reading
	// ~/.claude/projects/<munged-cwd>/<sid>.jsonl). To support another
	// backend (e.g. opencode, codex): implement its transcript path
	// resolution and first-question extraction mirroring those four
	// functions, then widen the Backend == "claude" gate below to a
	// backend→resolver dispatch. The acp-load import path
	// (deriveSessionTitleForAgent in agent.go) uses the SAME resolver set
	// and must be widened in lockstep so the two lists stay consistent.
	//
	// 后端支持：新增后端请按 acpTranscriptPath 上方的 BACKEND EXTENSION GUIDE
	// （六步接入指南：定位存储→读真实格式→实现三解析器→追加机器前缀→两处门控
	// 改注册表→真实样本测试）执行。标题检测（isMachineGeneratedTitle）与本展示
	// 层钩子与后端无关，但转录恢复需要逐后端的解析器。
	// 目前仅实现 Claude CLI（acpTranscriptPath + resolveTranscriptPath +
	// customTitleFromTranscript + firstRealQuestionFromTranscript，读取
	// ~/.claude/projects/<munged-cwd>/<sid>.jsonl）。新增后端（如 opencode、codex）
	// 时：仿照这四个函数实现该后端的转录路径解析与首问提取，再把下方的
	// Backend == "claude" 门控改为后端→解析器分发。acp-load 导入路径
	// （agent.go 的 deriveSessionTitleForAgent）使用同一套解析器，必须同步放宽，
	// 以保证两个列表一致。
	cwd := middleware.GetProjectFromCookie(r)
	if transcriptResolverFor(agent.Backend) != nil {
		for i := range sessions {
			if sessions[i].Title == nil {
				continue
			}
			display := acpDisplayTitle(agent.Backend, cwd, string(sessions[i].SessionId), *sessions[i].Title)
			sessions[i].Title = &display
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"sessions":   sessions,
		"nextCursor": nextCursor,
	})
}

// findExistingACPSessions returns a set of ACP session IDs that already
// exist in ClawBench's session manager (active or archived). These are the
// ACP sessions the user has already loaded/used, so they are filtered out of
// the @resume drawer's "native" list.
//
// A session can be matched to an ACP session id in two ways:
//   - source_session_id = "acp:{acpSessionId}" — set when a session is created
//     via ACP load/resume.
//   - external_session_id = "{acpSessionId}" — the raw session id reported by
//     the backend (e.g. opencode's "ses_..."), captured on every run.
//
// Matching both covers sessions created through either path.
// acpDisplayTitle returns a human-readable display title for an ACP session
// in the external session list ("外部会话"). The agent reports a per-session
// title via the session/list RPC, but for claude that reported title is an
// inconsistent user message (often the LAST or a middle one, not the first),
// so it is NOT trusted as the "first question". The transcript on disk is the
// only reliable source of the first user question. The transcript is only
// ever read.
//
// Tier order (claude), highest first:
//  1. the CLI's persisted session title ("custom-title" transcript record —
//     the auto-generated topic title);
//  2. the transcript's first real user question (machine headers stripped);
//  3. fall back to the agent-reported title (only when the transcript is
//     unreadable or yields no question).
//
// acp-load (会话搜索) reuses this SAME function (with agentTitle=""), so a
// session keeps one title while cycled between the two lists.
//
// 为"外部会话"列表中的 ACP 会话返回可读标题。agent 经 session/list RPC 上报每
// 会话标题，但 claude 上报的是不一致的某条用户消息（常为末问或中间某条，非首问），
// 故不可作为"首问"信任。磁盘转录是首问的唯一可靠来源。转录只读不改。
// 层级（claude，从高到低）：1) CLI 持久化的会话标题（custom-title 记录，自动主题名）；
// 2) 转录首问（剥离机器前缀后）；3) 回退到 agent 上报标题（仅当转录不可读或无首问时）。
// acp-load（会话搜索）复用本函数（传 agentTitle=""），使会话在两列表间循环时标题一致。
func acpDisplayTitle(backend, cwd, sessionID, agentTitle string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return agentTitle
	}
	return sessionDisplayTitle(transcriptResolverFor(backend), home, cwd, sessionID, agentTitle)
}

// acpDisplayTitleFromHome decides the display title for ONE session in the
// external session list ("外部会话"). It runs per session on every list
// request. Walkthrough:
//
// INPUT  cwd        the project dir from the cookie, e.g. /Users/x/Desktop/myproject
//
//	sessionID  the CLI session id, e.g. a1b2c3d4-1234-...
//	agentTitle what the CLI reported via session/list, e.g. "再确认一下参数"
//	           (claude reports SOME user message — often the last or a
//	           middle one — NOT reliably the first question)
//
// STEP 1  locate the transcript file on disk:
//
//	  ~/.claude/projects/-Users-x-Desktop-myproject/<sessionID>.jsonl
//	(slashes in cwd become '-'; if missing, search all project dirs by
//	 sessionID — the session may have been created under another cwd)
//	no file found → path = "", skip to STEP 4.
//
// STEP 2  scan the file for the newest "custom-title" line:
//
//	  {"type":"custom-title","customTitle":"weekend-hiking-plan"}
//	found → return it (capped at 50 runes). DONE.
//	(newer claude-code auto-writes this topic title; it is the CLI's
//	 own authoritative name for the session)
//
// STEP 3  scan the file top-down for the first REAL user question:
//   - skip assistant lines
//   - user line → extract its text (content is either a plain string
//     or a list of text blocks; transcriptContentText handles both)
//   - text starting with a machine prefix (see
//     machineGeneratedUserPrefixes) → strip the prefix and keep going;
//     e.g. "[System Instructions: rules]\n\n如何配置自动备份"
//     → "如何配置自动备份"
//     a turn that is 100% machine text (e.g. a compaction header
//     "This session is being continued from a previous ...") → skip
//     to the next user line
//     found → return it (capped at 50 runes). DONE.
//
// STEP 4  nothing readable on disk — last resort, the agent-reported title:
//
//	human text → return it; machine text → return "" (better no
//	title than "[System Instructions:..." noise).
//
// acp-load (会话搜索) calls this SAME function with agentTitle="" so both
// lists share one code path and a session keeps one title while cycled.
//
// acpDisplayTitleFromHome 决定"外部会话"列表中单个会话显示什么标题,每次拉取
// 列表时对每个会话执行一次。操作步骤:
//
// 输入    cwd        cookie 里的项目目录,如 /Users/x/Desktop/myproject
//
//	sessionID  CLI 会话 ID,如 a1b2c3d4-1234-...
//	agentTitle CLI 经 session/list 上报的标题,如 "再确认一下参数"
//	           (claude 上报的是"某条"用户消息——常是末问或中间某条,
//	            不保证是首问,所以不能直接信)
//
// 第 1 步  定位磁盘上的转录文件:
//
//	  ~/.claude/projects/-Users-x-Desktop-myproject/<sessionID>.jsonl
//	(cwd 的斜杠转横杠;找不到再按 sessionID 在所有项目目录里全局搜,
//	 会话可能是在别的目录下创建的)
//	仍无 → path="",直接跳到第 4 步。
//
// 第 2 步  扫描文件里最新的 "custom-title" 行:
//
//	  {"type":"custom-title","customTitle":"weekend-hiking-plan"}
//	有 → 返回它(截到 50 字),结束。
//	(新版 claude-code 自动写入的会话主题名,是 CLI 自己的权威命名)
//
// 第 3 步  从文件顶部向下找第一条"真问题":
//   - 跳过 assistant 行
//   - user 行取出文本(content 可能是纯字符串或文本块列表,
//     由 transcriptContentText 统一处理)
//   - 文本以机器前缀开头(见 machineGeneratedUserPrefixes)→ 剥掉前缀
//     继续用剩余部分;例:
//     "[System Instructions: 规则]\n\n如何配置自动备份"
//     → "如何配置自动备份"
//     整轮都是机器文本(如压缩头 "This session is being continued
//     from a previous ...")→ 跳过,看下一条 user 行
//     找到 → 返回它(截到 50 字),结束。
//
// 第 4 步  磁盘上读不到任何可用信息——最后兜底用 CLI 上报标题:
//
//	是人话 → 返回;是机器文本 → 返回空(宁缺勿错,绝不显示噪声)。
//
// acp-load(会话搜索)以 agentTitle="" 调用本函数,两列表共用一条代码路径,
// 会话在两列表间循环时标题保持不变。
func acpDisplayTitleFromHome(home, cwd, sessionID, agentTitle string) string {
	return sessionDisplayTitle(claudeTranscriptResolver{}, home, cwd, sessionID, agentTitle)
}

// sessionDisplayTitle is the resolver-aware title core — the tier logic with
// every backend touchpoint injected through the standard input block. It is
// the ONE function both lists' derivation runs on; a backend participates by
// registering a sessionTranscriptResolver, nothing else changes.
//
//	r == nil (backend not registered) → tiers 1-3 are skipped; the human
//	reported title is the last resort, machine ones suppressed.
//
// 解析器感知的标题核心——层级逻辑的全部后端触点经标准输入块注入。两个列表
// 的派生都跑在这一个函数上;后端只要注册 sessionTranscriptResolver 即参与,
// 其余零改动。r == nil(未注册后端)时跳过第 1-3 层,人类上报标题兜底,机器
// 上报抑制为空。
func sessionDisplayTitle(r sessionTranscriptResolver, home, cwd, sessionID, agentTitle string) string {
	path := ""
	if r != nil {
		path = r.TranscriptPath(home, cwd, sessionID)
	}
	// Tier 1: the CLI's own persisted session title ("custom-title" records —
	// auto-generated topic title or manual rename) outranks every derived
	// candidate.
	// 第 1 层：CLI 自持久化的会话标题（custom-title 记录，自动主题名或手动改名），
	// 优先于一切派生候选。
	if r != nil && path != "" {
		if t := r.CustomTitle(path); t != "" {
			return capTitle(t)
		}
	}
	// Tier 2: the transcript's first real user question (machine headers
	// stripped). The agent-reported title is deliberately NOT used here:
	// claude reports an inconsistent user message (often the last or a middle
	// one), not a reliable first question.
	// 第 2 层：转录首问（剥离机器前缀后）。此处刻意不用 agent 上报标题：claude
	// 上报的是不一致的某条用户消息（常为末问或中间某条），并非可靠的首问。
	if r != nil && path != "" {
		if t := r.FirstQuestion(path); t != "" {
			return capTitle(t)
		}
	}
	// Tier 3: fall back to the agent-reported title only when the transcript
	// is unreadable or yields no question — but never display machine noise
	// (isMachineGeneratedTitle); return empty so the caller falls back further
	// (acp-load: to the replay; external list: empty field).
	// 第 3 层：仅当转录不可读或无首问时回退到 agent 上报标题，但绝不显示机器文本
	// （isMachineGeneratedTitle）；返回空，让调用方继续回退（acp-load：到重放；
	// 外部列表：空字段）。
	if agentTitle != "" && !isMachineGeneratedTitleFor(agentTitle, machinePrefixesFor(r)) {
		return agentTitle
	}
	return ""
}

// claudeNativeUserPrefixes are the machine headers the claude-code CLI
// itself prepends to user turns (its resolver's MachinePrefixes).
//
// claude-code CLI 自己拼在用户轮次前的机器头(即其解析器的 MachinePrefixes)。
var claudeNativeUserPrefixes = []string{
	"This session is being continued from a previous conversation",
	"<command-name>/",
	"<local-command",
	"Caveat: The messages below were generated by the user",
	"[Request interrupted",
}

// claudeTranscriptResolver adapts the claude-code CLI's storage to the
// standard input block (sessionTranscriptResolver). Thin delegation to the
// existing, individually-tested functions.
//
// 将 claude-code CLI 的存储适配到标准输入块(sessionTranscriptResolver)。
// 对既有且各自带测试的函数做薄委托。
type claudeTranscriptResolver struct{}

func (claudeTranscriptResolver) TranscriptPath(home, cwd, sessionID string) string {
	return resolveTranscriptPath(home, cwd, sessionID)
}

func (claudeTranscriptResolver) CustomTitle(path string) string {
	return customTitleFromTranscript(path)
}

func (claudeTranscriptResolver) FirstQuestion(path string) string {
	return firstRealQuestionFromTranscript(path)
}

func (claudeTranscriptResolver) StripRules() []stripRule {
	return claudeNativeStripRules
}

// capTitle truncates a title candidate to maxReplayTitleRunes.
// 将标题候选截断到 maxReplayTitleRunes（50 字符），超出部分以 "..." 结尾。
func capTitle(t string) string {
	if runes := []rune(t); len(runes) > maxReplayTitleRunes {
		return string(runes[:maxReplayTitleRunes]) + "..."
	}
	return t
}

// resolveTranscriptPath locates the CLI transcript for a session: first the
// munged project dir for cwd, then a global lookup by session ID (the
// transcript may live under a different project directory). Returns "" when
// no transcript exists.
//
// 定位会话的 CLI 转录文件：先按 cwd 映射的项目目录找（~/.claude/projects/
// <cwd斜杠转横线>/<sid>.jsonl），找不到再按会话 ID 全局兜底（转录可能挂在别的
// 项目目录下）。找不到返回 ""。
func resolveTranscriptPath(home, cwd, sessionID string) string {
	path := acpTranscriptPath(home, cwd, sessionID)
	if path == "" {
		return ""
	}
	if _, err := os.Stat(path); err != nil {
		matches, _ := filepath.Glob(filepath.Join(home, ".claude", "projects", "*", sessionID+".jsonl"))
		if len(matches) == 0 {
			return ""
		}
		path = matches[0]
	}
	return path
}

// customTitleFromTranscript scans a transcript top-down and returns the
// NEWEST "custom-title" line, e.g. for
//
//	{"type":"custom-title","sessionId":"...","customTitle":"weekend-hiking-plan"}
//
// it returns "weekend-hiking-plan". The CLI may write the line many
// times (re-writes on activity); the last one wins. This is the CLI's own
// authoritative name for the session and outranks every derived candidate.
// No such line ever written → "".
//
// 返回 CLI 自己持久化的最新会话标题（"custom-title" 记录——新版 claude-code 会
// 自动生成 kebab-case 主题标题写入转录；手动改名也落同一记录）。这是 CLI 对该
// 会话的权威标题，优先级高于一切派生候选。CLI 从未写过则返回 ""。
func customTitleFromTranscript(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	last := ""
	for scanner.Scan() {
		var d struct {
			Type        string `json:"type"`
			CustomTitle string `json:"customTitle"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &d); err != nil || d.Type != "custom-title" {
			continue
		}
		if s := strings.TrimSpace(d.CustomTitle); s != "" {
			last = s
		}
	}
	return last
}

// deriveSessionTitleForAgent picks the title for an acp-load (import) session,
// i.e. what gets written into chat_sessions.title when the user imports a
// session from the external list into "会话搜索". Operationally it just
// re-runs the external list's derivation on the same transcript:
//
//	user clicks "下载/导入"
//	  → acp-load replays the session via ACP (replay = CLI's CURRENT context)
//	  → replay finishes → this function decides the title:
//
//	      claude backend?
//	        YES → call acpDisplayTitleFromHome(home, projectPath, sid, "")
//	              (the EXACT function the external list uses; agentTitle=""
//	              because acp-load has no session/list RPC to ask the CLI)
//	              → STEP 1-3 of that function run on the transcript
//	                (custom-title → first real question)
//	              → non-empty → write it to DB. DONE.
//	        transcript unreadable / claude not the backend?
//	          → deriveSessionTitleFromReplay(replay): first human message of
//	            the replay, machine prefixes stripped, capped at 50 runes.
//
// Why the transcript instead of the replay: a session compacted N times has
// its original first question already summarized away in the CLI's context,
// so the replay starts with a compaction header and a LATER message — the
// title would drift and disagree with the external list (which reads the
// transcript from the top). Reading the same transcript in both paths keeps
// the two lists byte-identical while the session is cycled between them.
//
// Adding a backend: follow the six-step BACKEND EXTENSION GUIDE above
// acpTranscriptPath in this file (locate storage → read the real schema →
// implement the three resolvers → append machine prefixes → widen both gates
// to a registry → test with real anonymized fixtures).
//
// deriveSessionTitleForAgent 决定 acp-load(导入)会话的标题——即用户把外部会话
// "下载"进"会话搜索"时写进 chat_sessions.title 的值。操作上就是把外部列表的
// 派生函数在同一份转录上重跑一遍:
//
//	用户点"下载/导入"
//	  → acp-load 经 ACP 重放会话(重放 = CLI 当前上下文)
//	  → 重放完成 → 本函数决定标题:
//
//	      是 claude 后端?
//	        是 → 调 acpDisplayTitleFromHome(home, projectPath, sid, "")
//	            (与外部列表完全同一个函数;agentTitle="" 是因为 acp-load 手头
//	             没有 session/list RPC 可向 CLI 要上报标题)
//	            → 在转录上执行该函数的第 1-3 步(custom-title → 首问)
//	            → 非空 → 写入 DB,结束。
//	        转录读不到 / 不是 claude 后端?
//	          → deriveSessionTitleFromReplay(重放):取重放里第一条人类消息,
//	            剥机器前缀,截 50 字。
//
// 为何用转录而非重放:压缩过 N 次的会话,其原始首问早被 CLI 摘要替换,重放以
// 压缩头开头、后面是较晚的消息——标题会漂移,与从顶部读转录的外部列表不一致。
// 两条路径读同一份转录,会话在两列表间循环时标题逐字节一致。
//
// 新增后端:实现该后端的转录路径解析与首问提取(仿照 acpTranscriptPath /
// firstRealQuestionFromTranscript / customTitleFromTranscript),把下方的
// Backend == "claude" 门控改为后端→解析器分发;acpDisplayTitleFromHome 的调用
// 方无须改动。
func deriveSessionTitleForAgent(agent *model.Agent, projectPath, acpSessionID string, replay []replayMessage) string {
	var r sessionTranscriptResolver
	if agent != nil {
		r = transcriptResolverFor(agent.Backend)
		if r != nil {
			if home, err := os.UserHomeDir(); err == nil {
				// Reuse the resolver-aware core so both lists share ONE code
				// path. acp-load has no agent-reported title (no session/list
				// RPC), so pass "" — tiers 1-2 drive the result, and "" makes
				// the agent-title fallback tier a no-op, falling through to
				// the replay below when nothing is found.
				// 复用解析器感知核心，使两列表共用一条代码路径。acp-load 无
				// agent 上报标题（无 session/list RPC），故传 ""：第 1-2 层决定
				// 结果，"" 使上报标题兜底层为空操作，未命中时回退到重放。
				if title := sessionDisplayTitle(r, home, projectPath, acpSessionID, ""); title != "" {
					return title
				}
			}
		}
	}
	// Replay fallback: strip with this backend's rule set (universal +
	// its native rules; unregistered backends get universal only).
	// 重放兜底:按该后端的规则集剥离(通用+其原生规则;未注册后端仅通用)。
	return deriveSessionTitleFromReplay(replay, r)
}

// isMachineGeneratedTitle reports whether an agent-reported session title was
// derived from a machine-generated user turn (injected system prompt block or
// continuation summary) rather than from user-typed text. Agents truncate
// titles, so a title that is a prefix of a marker (truncation cut inside the
// marker itself) also counts.
// isMachineGeneratedTitle reports whether an agent-reported session title was
// derived from a machine-generated user turn (injected system prompt block,
// CLI continuation/compaction header, slash command, local-command caveat,
// attachment header, interruption marker) rather than from user-typed text.
// Agents truncate the reported title (~200 chars), so the check is
// truncation-tolerant: a title that is a prefix of a known marker also counts.
//
// Uses machineGeneratedUserPrefixes (the same list stripMachineGeneratedUserText
// strips on), so detection stays in lockstep with stripping.
//
// 判断 agent 上报的会话标题是否来自机器生成的用户轮次（注入系统提示块、CLI
// 续接/压缩头、斜杠命令、本地命令警示、附件头、中断标记）而非人类输入。
// agent 会把标题截断（约 200 字符），故匹配容忍截断：标题是某已知标记的前缀
// 时同样判定为机器文本。复用 machineGeneratedUserPrefixes（与
// stripMachineGeneratedUserText 剥离所用同一份列表），保证判定与剥离同步。
// isMachineGeneratedTitleFor checks against an explicit prefix list
// (client-injected + the backend's native prefixes — machinePrefixesFor).
// isMachineGeneratedTitleFor 按显式前缀列表判定(客户端注入+该后端原生前缀,
// 见 machinePrefixesFor)。
func isMachineGeneratedTitleFor(title string, prefixes []string) bool {
	if title == "" {
		return false
	}
	for _, marker := range prefixes {
		if strings.HasPrefix(title, marker) ||
			(len(title) < len(marker) && strings.HasPrefix(marker, title)) {
			return true
		}
	}
	return false
}

// isMachineGeneratedTitle is the claude-flavoured default (combined list);
// the resolver-aware core uses isMachineGeneratedTitleFor.
//
// claude 口味的默认版(合并列表);解析器感知的核心用 isMachineGeneratedTitleFor。
func isMachineGeneratedTitle(title string) bool {
	return isMachineGeneratedTitleFor(title, machineGeneratedUserPrefixes)
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKEND EXTENSION GUIDE — how to bring session-title derivation to another
// CLI backend (codex, opencode, gemini, ...). Start here, then follow the
// six steps. Everything above this block (tier order, capping, machine-title
// detection) is backend-agnostic and needs NO changes.
//
// 后端扩展指南——如何把会话标题派生接入另一个 CLI 后端（codex、opencode、
// gemini 等）。从这里开始，按六步执行。本块之上的所有内容（层级顺序、截断、
// 机器标题判定）均与后端无关，无须改动。
//
// WHAT EACH BACKEND MUST PROVIDE — the standard input block is now a real
// compile-time contract: sessionTranscriptResolver (session_title_resolver.go)
// with FOUR methods (path / custom title / first question / native machine
// prefixes). Implement it, register in sessionTranscriptResolvers, done.
// 后端需要提供的——标准输入块已是编译期契约：sessionTranscriptResolver
// （见 session_title_resolver.go）四个方法（路径/自定义标题/首问/原生机
// 器前缀）。实现并注册即完成接入；本指南下方是 claude 的参考实现。
//
// STEP 1 — Locate the CLI's transcript storage with REAL data.
//
//	Run the CLI once in some project dir, create a session, then find
//	where a session file appeared (e.g. `ls -lt ~ | head`, or the
//	CLI's docs). Note: (a) the directory pattern, (b) how the project
//	path is encoded in it, (c) the file naming.
//	claude example: ~/.claude/projects/-Users-x-Desktop-myproject/<uuid>.jsonl
//	                (project path with '/'→'-')
//
// 第1步——用真实数据定位该 CLI 的转录存储。在某项目目录里跑一次该 CLI、
//
//	建一个会话，找到会话文件出现在哪（如 `ls -lt ~ | head` 或官方文档）。
//	记下：(a) 目录规律 (b) 项目路径如何编码进去 (c) 文件命名。
//	claude 例: ~/.claude/projects/-Users-x-Desktop-myproject/<uuid>.jsonl
//	           （项目路径 '/'→'-'）
//
// STEP 2 — Read 5-10 REAL transcript lines and note the schema:
//
//	how is a user turn shaped? (claude: {"type":"user","message":
//	{"content": <string | [{type:"text",text:...}]>}}). Which fields
//	mark the role? Does the CLI persist its own title record
//	(claude: {"type":"custom-title","customTitle":...})? Which
//	machine texts does IT prepend (the equivalent of claude's
//	"This session is being continued..." compaction header)?
//
// 第2步——读 5-10 行真实转录，记下格式：用户轮次长什么样（claude:
//
//	{"type":"user","message":{"content":<字符串|[{type,text}块列表]>}}）；
//	哪些字段标记角色；该 CLI 是否持久化自己的标题记录（claude:
//	{"type":"custom-title",...}）；它自己会预置哪些机器文本（相当于
//	claude 压缩头 "This session is being continued..." 的等价物）。
//
// STEP 3 — Implement the backend's three resolvers, mirroring the claude
//
//	ones directly below (same signatures, same "" semantics):
//
// 第3步——仿照正下方的 claude 版实现该后端的三个解析器（签名一致、空值
//
//	         语义一致）：
//
//		func xTranscriptPath(home, cwd, sessionID string) string        // STEP 1 findings
//		func xCustomTitleFromTranscript(path string) string             // STEP 2 finding, or return ""
//		func xFirstRealQuestionFromTranscript(path string) string       // STEP 2 schema
//
//		  Security copy acpTranscriptPath's rejection of session IDs carrying
//		  '/', '\', '..', glob metacharacters — sessionID comes from the wire.
//		  安全性：照抄 acpTranscriptPath 对含 '/', '\', '..', glob 元字符的
//		  sessionID 的拒绝——sessionID 来自网络输入。
//
// STEP 4 — Append the backend's own machine prefixes to
//
//	machineGeneratedUserPrefixes (session_resume.go). NOTE which
//	prefixes are whose:
//	  clawbench-injected (ALL backends see them):
//	    "[System Instructions:", "[Below is the conversation history",
//	    "[Current file: ", "[Current directory: ", "[User uploaded "
//	  claude-native (harmless no-ops for other backends):
//	    "This session is being continued...", "<command-name>/",
//	    "<local-command", "Caveat: The messages below...", "[Request interrupted"
//	Everything downstream (stripper + title detector) updates
//	automatically — they share this one list.
//
// 第4步——把该后端自己的机器前缀追加进 machineGeneratedUserPrefixes
//
//	（session_resume.go）。注意归属：clawbench 注入的（所有后端都会
//	遇到）如 [System Instructions: 等；claude 原生的（对其他后端是无害
//	空转）如压缩头、斜杠命令、Caveat 等。下游（剥离器+标题判定器）
//	自动同步——它们共用这一份列表。
//
// STEP 5 — Widen BOTH gates from `Backend == "claude"` to a registry. Two
//
//	call sites, both marked with "Backend support" comments:
//	  a) ServeACPSessions (external list display titles)
//	  b) deriveSessionTitleForAgent (acp-load import titles)
//	Suggested shape:
//
// 第5步——把两处 `Backend == "claude"` 门控改为注册表分发。两个调用点都有
//
//	         "Backend support" 注释标记：(a) ServeACPSessions 外部列表展示标题
//	         (b) deriveSessionTitleForAgent 导入标题。建议形态：
//
//		type transcriptResolver struct {
//		    path        func(home, cwd, sessionID string) string
//		    customTitle func(path string) string
//		    firstAsk    func(path string) string
//		}
//		var transcriptResolvers = map[string]transcriptResolver{
//		    "claude": {acpTranscriptPath, customTitleFromTranscript, firstRealQuestionFromTranscript},
//		    "codex":  {codexTranscriptPath, codexCustomTitle, codexFirstRealQuestion},
//		}
//		// then in both gates:  if r, ok := transcriptResolvers[agent.Backend]; ok { ... }
//
// STEP 6 — Tests with REAL fixtures. Copy 3-5 lines from a REAL session,
//
//	anonymise any personal content (paths → /Users/x/..., questions →
//	neutral text), and put them in the test the way
//	acp_session_title_test.go builds claude fixtures (writeTranscript
//	+ userTurnJSON). Cover: path resolution, first-question extraction,
//	each machine prefix of that backend, and traversal rejection.
//
// 第6步——用真实样本写测试。从真实会话拷 3-5 行，个人内容全部匿名化
//
//	（路径→/Users/x/...，提问→中性文本），按 acp_session_title_test.go
//	构造 claude 样本的方式（writeTranscript + userTurnJSON）放进测试。
//	覆盖：路径解析、首问提取、该后端每个机器前缀、穿越拒绝。
//
// 已验证 vs 未验证：仅当本机存在该后端的真实转录并按上面六步做过测试，才把
// 它加进注册表——不要提交未经验证的解析器（blind resolver）。
// Verified-only rule: add a backend to the registry only after its REAL
// transcripts exist locally and the six steps were followed — never ship a
// blind, unverified resolver.
// ═══════════════════════════════════════════════════════════════════════════
// acpTranscriptPath returns the expected CLI transcript path for a session,
// e.g. ~/.claude/projects/-Users-luo/<sessionId>.jsonl, or "" when the
// inputs are insufficient or unsafe. sessionID comes from the ACP agent's
// session/list response, so anything carrying path separators, traversal
// segments or glob metacharacters is rejected outright.
//
// 返回会话 CLI 转录的预期路径，如 ~/.claude/projects/-Users-luo/<sessionId>.jsonl；
// 输入不足或不安全时返回 ""。sessionID 来自 ACP agent 的 session/list 响应，
// 故凡携带路径分隔符、穿越段（..）或 glob 元字符的一律直接拒绝（防路径穿越）。
func acpTranscriptPath(home, cwd, sessionID string) string {
	if home == "" || cwd == "" || sessionID == "" {
		return ""
	}
	if strings.ContainsAny(sessionID, `/\`) || strings.Contains(sessionID, "..") ||
		strings.ContainsAny(sessionID, "*?[]") {
		return ""
	}
	munged := strings.ReplaceAll(cwd, "/", "-")
	return filepath.Join(home, ".claude", "projects", munged, sessionID+".jsonl")
}

// transcriptContentText extracts the plain text from a claude-cli transcript
// user-message "content" field, which claude-code writes in either of two
// shapes:
//   - a plain string: "content": "the question"
//   - a list of blocks: "content": [{"type":"text","text":"..."}, ...]
//
// RawMessage is used so both shapes decode without error; this returns "" for
// any other shape.
//
// 从 claude-cli 转录用户消息的 content 字段提取纯文本。claude-code 的 content
// 有两种形式：纯字符串 "content":"问题"；或块列表 "content":[{type:text,text:...}]。
// 用 RawMessage 解码使两种形式都不报错；其他形式返回 ""。
func transcriptContentText(content json.RawMessage) string {
	if len(content) == 0 {
		return ""
	}
	// String form: starts with '"'.
	if content[0] == '"' {
		var s string
		if err := json.Unmarshal(content, &s); err == nil {
			return s
		}
		return ""
	}
	// List-of-blocks form.
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(content, &blocks); err != nil {
		return ""
	}
	raw := ""
	for _, b := range blocks {
		if b.Type == "text" {
			raw += b.Text
		}
	}
	return raw
}

// firstRealQuestionFromTranscript reads a transcript top-down, line by
// line (each line = one JSON record), and returns the FIRST human input:
//
//	line 1  {"type":"summary",...}                    → skipped (not user)
//	line 2  {"type":"user", content:"查看当前目录..."}  → candidate!
//	        strip machine prefixes → "查看当前目录..." stays
//	        → return it (capped by caller)
//	line 3+ never reached
//
// A user line that is 100% machine text (compaction header, slash command)
// is skipped and the scan continues. The content field appears as either a
// plain string or a list of text blocks — transcriptContentText handles
// both shapes, so neither form is missed.
//
// 只读扫描 CLI 转录，返回剥离机器前缀后的第一条人类输入（剥离规则见
// stripMachineGeneratedUserText）。转录的 content 字段有两种形式（纯字符串 /
// 文本块列表），由 transcriptContentText 统一处理。
func firstRealQuestionFromTranscript(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var d struct {
			Type    string `json:"type"`
			Message *struct {
				// Content is either a plain string ("the question") or a
				// list of blocks [{type:"text",text:"..."},...]. claude-code
				// uses both forms across versions/contexts, so decode as
				// RawMessage and handle each shape.
				// content 可能是纯字符串（"问题"），也可能是块列表
				// [{type:"text",text:"..."}]。claude-code 在不同版本/场景
				// 下两种形式都有，故用 RawMessage 解码后分别处理。
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &d); err != nil || d.Type != "user" {
			continue
		}
		if d.Message == nil {
			continue
		}
		raw := transcriptContentText(d.Message.Content)
		// Claude transcript first-question extraction strips with the claude
		// rule set (universal + claude-native) — this whole function is the
		// claude resolver's FirstQuestion implementation.
		// claude 转录首问提取按 claude 规则集剥离(通用+claude 原生)——本函数
		// 即 claude resolver 的 FirstQuestion 实现。
		text, ok := stripMachineText(raw, stripRulesFor(claudeTranscriptResolver{}))
		if !ok {
			continue
		}
		if t := strings.TrimSpace(text); t != "" {
			return t
		}
	}
	return ""
}

func findExistingACPSessions(acpSessionIDs []string) map[string]bool {
	if len(acpSessionIDs) == 0 {
		return nil
	}
	// Build IN clause placeholders (each id appears twice: prefixed and raw).
	ph := ""
	vals := make([]any, 0, len(acpSessionIDs)*2)
	for _, sid := range acpSessionIDs {
		if ph != "" {
			ph += ","
		}
		ph += "?,?"
		vals = append(vals, "acp:"+sid, sid)
	}

	result := make(map[string]bool)

	// Four placeholders per id total (2 per IN clause). Build the arg slice
	// with explicit capacity to avoid overlapping-append aliasing.
	args := make([]any, 0, len(vals)*2)
	args = append(args, vals...)
	args = append(args, vals...)

	rows, err := service.ReadDB().Query( // background DB query, no request context available in this helper
		"SELECT source_session_id, external_session_id FROM chat_sessions WHERE source_session_id IN ("+ph+") OR external_session_id IN ("+ph+")",
		args...,
	)
	if err != nil {
		slog.Warn("handler: failed to query existing ACP sessions for filtering", "error", err)
		return result
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var sourceID, extID sql.NullString
		if err := rows.Scan(&sourceID, &extID); err == nil {
			// Mark each returned ACP id as existing if its "acp:"-prefixed
			// source id or its raw external id matches.
			for _, sid := range acpSessionIDs {
				if sourceID.Valid && sourceID.String == "acp:"+sid {
					result[sid] = true
				}
				if extID.Valid && extID.String == sid {
					result[sid] = true
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		slog.Warn("handler: error iterating ACP session rows", "error", err)
	}
	return result
}

// ServeBackends returns the list of AI backends supported by ClawBench.
// Used by the welcome overlay to show users what CLI agents can be auto-detected.
func ServeBackends(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeLocalizedErrorf(w, r, http.StatusMethodNotAllowed, "MethodNotAllowed")
		return
	}

	type backendInfo struct {
		ID                   string   `json:"id"`
		Name                 string   `json:"name"`
		Specialty            string   `json:"specialty"`
		DefaultCmd           string   `json:"default_cmd"`
		ThinkingEffortLevels []string `json:"thinking_effort_levels,omitempty"`
		InstallCmd           string   `json:"install_cmd,omitempty"`
	}

	backends := make([]backendInfo, 0, len(model.GetBackendRegistry()))
	for _, spec := range model.GetBackendRegistry() {
		if spec.NoCLI {
			continue // skip non-CLI backends (e.g. mock)
		}
		backends = append(backends, backendInfo{
			ID:                   spec.ID,
			Name:                 spec.Name,
			Specialty:            spec.Specialty,
			DefaultCmd:           spec.DefaultCmd,
			ThinkingEffortLevels: spec.ThinkingEffortLevels,
			InstallCmd:           prepareInstallCmd(spec.InstallCmd),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"backends": backends,
	})
}
