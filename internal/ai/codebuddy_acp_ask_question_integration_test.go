//go:build integration

package ai

import (
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ===========================================================================
// ACP 交互式提问 — AskUserQuestion 工具可用性实证（CodeBuddy ACP）
// ===========================================================================
//
// 背景：ClawBench 的提问卡片有两条来源：
//   1. `<ask-question>` XML 出现在 agent 的文本输出里 → 由 service 层
//      ConvertAskQuestionBlocks 转成 AskUserQuestion tool_use 卡片（交互模式的
//      正常工作路径，web/src 也有对应解析）。
//   2. 后端 agent 自己"调用 AskUserQuestion 工具"。
//
// 这两条测试分别实证第 2 条在 ACP 下是否成立，以及第 1 条（XML 通道）在 ACP 下
// 仍然成立：
//   - TestCodebuddyACP_AskUserQuestionTool_NotAvailable：命令 CodeBuddy 用它的
//     AskUserQuestion 工具提问。期望观测：ACP 模式暴露的工具列表里没有
//     AskUserQuestion，agent 会明说没有该工具（而不是真的发起一次工具调用）。
//     这是结论型测试 —— 它把 CodeBuddy 的真实回应 dump 出来，并断言"没有发出
//     AskUserQuestion tool_use/工具调用"，这样将来 CodeBuddy 若在 ACP 下新增该
//     工具，测试会立刻暴露变化（断言失败并打印实际输出）。
//   - TestCodebuddyACP_AskQuestionXML_OverACP：正向对照组 —— 走 ClawBench 自己
//     约定的 `<ask-question>` XML 通道，验证 XML 提问能原样流经 ACP（content 事件
//     携带 XML），即"ACP 下提问没问题，只是不叫 AskUserQuestion 工具"。
//
// 运行：
//
//	go test -v -run 'TestCodebuddyACP_Ask(Question|UserQuestion)' -tags integration \
//	    -timeout 300s ./internal/ai/
//
// 需要本机安装 codebuddy CLI 且已登录。

// requireCodebuddyACP verifies the codebuddy ACP subcommand is available.
func requireCodebuddyACP(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("codebuddy"); err != nil {
		t.Skip("codebuddy CLI not available, skipping CodeBuddy ACP ask-question integration test")
	}
}

// setupCodebuddyAskQuestionEnv starts a real CodeBuddy ACP backend with
// auto-approve enabled (so ordinary tool permissions never block the turn).
func setupCodebuddyAskQuestionEnv(t *testing.T) (*ACPBackend, *acpTestEnv, string) {
	t.Helper()
	agent := codebuddyACPAgent()
	env := setupACPTestEnvForAgent(t, agent)
	backend, err := NewACPBackend(agent)
	require.NoError(t, err, "NewACPBackend should succeed")

	// Auto-approve ordinary tool permissions so only the question flow itself
	// can block the turn.
	SetAutoApproveGetter(func(_ string) bool { return true })
	t.Cleanup(func() { SetAutoApproveGetter(func(_ string) bool { return false }) })

	sessionID := acpSessionID()
	t.Cleanup(func() { env.closeConn(t, sessionID) })
	return backend, env, sessionID
}

// TestCodebuddyACP_AskUserQuestionTool_NotAvailable asks CodeBuddy (real ACP
// process) to call its AskUserQuestion tool. It does NOT assert the tool
// exists — it empirically reports whether CodeBuddy ACP exposes it, asserting
// the observable facts that hold today:
//   - the turn completes (stream reaches done),
//   - no AskUserQuestion tool_use was emitted on the ACP wire.
//
// If a future CodeBuddy ACP starts exposing AskUserQuestion (e.g. mapped to an
// ACP permission/elicitation request), the second assertion fails and prints
// the full agent output so the new behavior is visible immediately.
func TestCodebuddyACP_AskUserQuestionTool_NotAvailable(t *testing.T) {
	requireCodebuddyACP(t)
	backend, _, sessionID := setupCodebuddyAskQuestionEnv(t)

	ctx, cancel := contextWithTimeout(t, 150*time.Second)
	defer cancel()

	ch, err := backend.ExecuteStream(ctx, ChatRequest{
		Prompt: "请使用你的 AskUserQuestion 工具问我一个问题：\"你更喜欢哪个颜色，红还是蓝？\"。" +
			"你必须真的调用 AskUserQuestion 这个工具，不要用 XML，不要直接把问题写在回复文字里。",
		SessionID:          sessionID,
		WorkDir:            acpTestWorkDir(),
		ScheduledExecution: true,
	})
	require.NoError(t, err, "ExecuteStream should not return error")

	events := collectACPEvents(t, ch, 150*time.Second)
	requireDoneEvent(t, events)

	// Dump what the agent actually did for debugging / future regression signal.
	toolUses := findACPEvents(events, "tool_use")
	content := concatACPContent(events)
	t.Logf("agent tool_use count=%d", len(toolUses))
	for _, e := range toolUses {
		t.Logf("  tool_use: name=%q id=%q", e.Tool.Name, e.Tool.ID)
	}
	t.Logf("agent reply text: %q", truncate(content, 800))

	// The turn must complete (no deadlock waiting on an unanswered tool).
	// CodeBuddy ACP does not expose AskUserQuestion today — the model says so
	// instead of calling it. Assert no such tool call appeared on the wire.
	askToolCalls := 0
	for _, e := range toolUses {
		if strings.EqualFold(e.Tool.Name, "AskUserQuestion") {
			askToolCalls++
		}
	}
	assert.Zerof(t, askToolCalls,
		"CodeBuddy ACP emitted AskUserQuestion tool_use (%d); tool availability changed — update this test",
		askToolCalls)

	// The model should have produced some text response (either a refusal note
	// explaining the tool is missing, or a fallback question).
	assert.NotEmpty(t, strings.TrimSpace(content), "expected an agent response")
}

// TestCodebuddyACP_AskQuestionXML_OverACP is the positive control for the
// question path ClawBench actually relies on over ACP: the agent emits an
// <ask-question> XML block as text content, which arrives intact in stream
// content events and is later converted to an AskUserQuestion card by the
// service layer (ConvertAskQuestionBlocks). This proves interactive questions
// DO work over the ACP transport — just via the XML contract, not a native
// AskUserQuestion tool call.
func TestCodebuddyACP_AskQuestionXML_OverACP(t *testing.T) {
	requireCodebuddyACP(t)
	backend, _, sessionID := setupCodebuddyAskQuestionEnv(t)

	ctx, cancel := contextWithTimeout(t, 150*time.Second)
	defer cancel()

	ch, err := backend.ExecuteStream(ctx, ChatRequest{
		Prompt: "问我一个选择题（你更喜欢哪个颜色，红还是蓝？）。" +
			"必须严格使用以下 XML 格式来提问，除了这段 XML 不要输出别的：\n" +
			"<ask-question>\n<item>\n<header>颜色</header>\n<multi-select>false</multi-select>\n" +
			"<question>你更喜欢哪个颜色？</question>\n" +
			"<option><label>红</label></option>\n<option><label>蓝</label></option>\n</item>\n</ask-question>",
		SessionID:          sessionID,
		WorkDir:            acpTestWorkDir(),
		ScheduledExecution: true,
	})
	require.NoError(t, err, "ExecuteStream should not return error")

	events := collectACPEvents(t, ch, 150*time.Second)
	requireDoneEvent(t, events)

	content := concatACPContent(events)
	t.Logf("agent reply text: %q", truncate(content, 800))

	// The <ask-question> XML must survive the ACP transport as text content.
	require.Contains(t, content, "<ask-question>",
		"agent should emit the <ask-question> XML block over ACP (ClawBench's question contract)")
	require.Contains(t, content, "</ask-question>",
		"agent should close the <ask-question> XML block over ACP")
}
