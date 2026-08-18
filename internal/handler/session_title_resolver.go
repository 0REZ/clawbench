package handler

// ─────────────────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════
// MODULE 2 — BACKEND-SPECIFIC TITLE OPTIMIZATION (per-agent enhancement
// over Module 1's universal cleaning; see session_resume.go). Today this
// ships the claude-code resolver: transcript reading for exact first
// questions on compacted sessions, custom-title lookup, and claude-native
// strip rules. Other backends plug in the same way — implement the four
// methods, register, done. Unregistered backends simply keep Module 1's
// universal behavior.
//
// 模块二——后端专属标题优化(在模块一的通用清洗之上做逐后端增强,见
// session_resume.go)。当前内置 claude-code 解析器:读转录以在压缩会话上取
// 精确首问、custom-title 查询、claude 原生剥离规则。其他后端以同样方式接入
// ——实现四个方法、注册即完成。未注册后端保持模块一的通用行为。
// ═════════════════════════════════════════════════════════════════════════
//
// STANDARD INPUT BLOCK — decoupling contract between the session-title module
// and any agent backend's on-disk data structures.
//
// The title-fix module (tier order, capping, machine-title suppression) is
// backend-agnostic. Everything backend-specific is reduced to THIS interface:
// implement four methods, register under the backend name, and the whole
// module works for that backend — both the external session list display and
// the acp-load import path pick it up automatically.
//
// 标准输入块——会话标题模块与任意智能体后端磁盘数据结构的解耦契约。
// 标题模块本身（层级顺序、截断、机器标题抑制）与后端无关；所有后端相关的
// 部分被收敛为本接口：实现四个方法、按后端名注册，整个模块即对该后端生效
// ——外部会话列表展示与 acp-load 导入两条路径都会自动接入。
//
// To add a backend (e.g. codex, opencode):
//  1. Locate its transcript storage with REAL data (run the CLI, find where
//     session files appear; note the dir pattern and how cwd is encoded).
//  2. Implement the four methods below as a thin adapter over its path rules
//     and transcript schema, mirroring claudeTranscriptResolver.
//  3. Register it in sessionTranscriptResolvers.
// Only register backends verified against REAL transcripts — never ship a
// blind resolver (see the fuller guide above acpTranscriptPath in agent.go).
//
// 新增后端（如 codex、opencode）：
//  1. 用真实数据定位其转录存储（跑一次 CLI，找到会话文件位置；记下目录规律
//     与 cwd 编码方式）。
//  2. 按其路径规则与转录格式实现下方四方法的薄适配层，仿 claudeTranscriptResolver。
//  3. 在 sessionTranscriptResolvers 注册。
// 仅注册经真实转录验证过的后端——禁止提交未经验证的盲解析器（完整指南见
// agent.go 中 acpTranscriptPath 上方注释块）。
// ─────────────────────────────────────────────────────────────────────────────

// sessionTranscriptResolver is the standard input block: everything the
// title module needs to know about one backend's session storage.
//
// 会话转录解析器即标准输入块：标题模块需要知道的关于某后端会话存储的全部。
type sessionTranscriptResolver interface {
	// TranscriptPath locates the backend's transcript file for a session.
	// Return "" when no transcript exists. sessionID comes from the wire —
	// implementations MUST reject IDs carrying path separators, traversal
	// segments or glob metacharacters (see acpTranscriptPath).
	//
	// 定位该后端的会话转录文件；无则返回 ""。sessionID 来自网络输入——
	// 实现必须拒绝含路径分隔符、穿越段或 glob 元字符的 ID（见 acpTranscriptPath）。
	TranscriptPath(home, cwd, sessionID string) string

	// CustomTitle returns the title the backend itself persisted for the
	// session (a user rename or auto-generated topic name), "" when none.
	//
	// 返回后端自身为会话持久化的标题（用户改名或自动生成的主题名），无则 ""。
	CustomTitle(path string) string

	// FirstQuestion returns the first human-typed message from the
	// transcript, with machine-generated prefixes stripped, "" when none.
	//
	// 返回转录中第一条人类输入（剥离机器前缀后），无则 ""。
	FirstQuestion(path string) string

	// StripRules returns THIS backend's native machine-prefix strip rules
	// (compaction headers, slash-command wrappers, local-command caveats,
	// ...). They add to clientInjectedStripRules (which the client prepends
	// for every backend) and feed the data-driven stripper. Harmless no-ops
	// for other backends.
	//
	// 返回该后端原生的机器前缀剥离规则（压缩头、斜杠命令包装、本地命令警示
	// 等）。叠加在客户端对所有后端注入的 clientInjectedStripRules 之上，喂给
	// 数据驱动剥离器。对其他后端为无害空转。
	StripRules() []stripRule
}

// sessionTranscriptResolvers maps backend name → resolver. Backends absent
// from this map fall back to the backend-agnostic ACP-replay derivation.
//
// 后端名 → 解析器注册表。未注册的后端回退到与后端无关的 ACP 重放派生。
var sessionTranscriptResolvers = map[string]sessionTranscriptResolver{
	"claude": claudeTranscriptResolver{},
}

// transcriptResolverFor looks up the resolver for a backend; nil when the
// backend has none registered.
//
// 按后端名查解析器；未注册返回 nil。
func transcriptResolverFor(backend string) sessionTranscriptResolver {
	return sessionTranscriptResolvers[backend]
}

// machinePrefixesFor returns the full machine-prefix list used for title
// detection for a backend: the client-injected universal set plus the
// backend's native prefixes.
//
// 返回该后端标题判定所用的完整机器前缀列表：客户端注入的通用集 + 该后端
// 的原生前缀。
// stripRulesFor returns the full strip-rule set for a backend: the
// client-injected universal rules plus the backend's native rules. The
// detector (isMachineGeneratedTitleFor) derives its flat prefix list from
// these rules too.
//
// 返回某后端的完整剥离规则集:客户端通用注入规则 + 该后端原生规则。检测器
// (isMachineGeneratedTitleFor) 的扁平前缀列表也由此推导。
func stripRulesFor(r sessionTranscriptResolver) []stripRule {
	rules := append([]stripRule{}, clientInjectedStripRules...)
	if r != nil {
		rules = append(rules, r.StripRules()...)
	}
	return rules
}

// machinePrefixesFor returns the flat prefix list used for title
// machine-text DETECTION, derived from stripRulesFor (prefixes only).
//
// 返回标题机器文本"检测"用的扁平前缀列表,由 stripRulesFor 推导(仅取前缀)。
func machinePrefixesFor(r sessionTranscriptResolver) []string {
	rules := stripRulesFor(r)
	prefixes := make([]string, len(rules))
	for i, r := range rules {
		prefixes[i] = r.prefix
	}
	return prefixes
}
