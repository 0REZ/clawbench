package handler

import (
	"fmt"
	"net/http"
	"testing"

	"clawbench/internal/model"
	"clawbench/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- UnimportSession ---

// TestUnimportSession_OK verifies the DB-only removal semantics: the session
// record is hard-deleted (so the session falls back to the external sessions
// list) while its chat history rows are also cleaned up. No ACP session/delete
// is sent from this handler — the transcript file is never touched.
// TestUnimportSession_OK 验证仅删除数据库记录的移除语义：会话记录被硬删
// （会话回落到外部会话列表），聊天历史一并清理；handler 不发送 ACP
// session/delete——转录文件绝不被触碰。
func TestUnimportSession_OK(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	sessionID, err := service.CreateSession(env.ProjectDir, "claude", "To Unimport", "claude", "", "default", "chat")
	require.NoError(t, err)

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID, nil)
	req = withProjectCookie(req, env.ProjectDir)

	w := callHandler(UnimportSession, req)
	assertOK(t, w)

	var n int
	require.NoError(t, service.UnsafeDBForTest().QueryRow("SELECT COUNT(*) FROM chat_sessions WHERE id = ?", sessionID).Scan(&n))
	assert.Equal(t, 0, n, "chat_sessions row should be hard-deleted / chat_sessions 行应被硬删")
}

func TestUnimportSession_NoSessionID(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport", nil)
	req = withProjectCookie(req, env.ProjectDir)

	w := callHandler(UnimportSession, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUnimportSession_BadMethod(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodPost, "/api/ai/session/unimport", nil)
	req = withProjectCookie(req, env.ProjectDir)

	w := callHandler(UnimportSession, req)
	assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
}

// TestUnimportSession_RecordGone verifies the hard-delete contract end to end:
// after unimport, neither chat_sessions nor chat_history keeps rows for the
// session — the former re-exposes it on the external list, the latter avoids
// orphaned data.
// TestUnimportSession_RecordGone 端到端验证硬删契约：移除后 chat_sessions 与
// chat_history 均无残留（前者让会话重回外部列表，后者避免孤儿数据）。
func TestUnimportSession_RecordGone(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	sessionID, err := service.CreateSession(env.ProjectDir, "claude", "To Unimport", "claude", "", "default", "chat")
	require.NoError(t, err)

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID, nil)
	req = withProjectCookie(req, env.ProjectDir)

	w := callHandler(UnimportSession, req)
	assertOK(t, w)

	var nSessions, nHistory int
	db := service.UnsafeDBForTest()
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM chat_sessions WHERE id = ?", sessionID).Scan(&nSessions))
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM chat_history WHERE session_id = ?", sessionID).Scan(&nHistory))
	assert.Equal(t, 0, nSessions, "chat_sessions rows / chat_sessions 行")
	assert.Equal(t, 0, nHistory, "chat_history rows / chat_history 行")
}

func TestUnimportSession_RunningACPAgent_CancelsAndCloses(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	// An ACP-capable agent registered in the registry, referenced by the
	// session row — exercises the CloseConn branch (best-effort, no conn
	// exists so it is a no-op, but the branch must be taken).
	// 注册表中的 ACP agent,会话行引用之——覆盖 CloseConn 分支(尽力而为,
	// 无连接时为空操作,但分支必须走到)。
	model.Agents["acp-agent-u"] = &model.Agent{ID: "acp-agent-u", Name: "ACP", AcpCommand: "fake --acp"}
	t.Cleanup(func() { delete(model.Agents, "acp-agent-u") })

	sessionID, err := service.CreateSession(env.ProjectDir, "claude", "Running", "acp-agent-u", "", "default", "chat")
	require.NoError(t, err)

	// Mark the session running so the cancel branch executes.
	// 标记运行中,覆盖取消分支。
	service.SetSessionRunning(sessionID, true, true)
	t.Cleanup(func() { service.SetSessionRunning(sessionID, false, true) })

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID, nil)
	req = withProjectCookie(req, env.ProjectDir)
	w := callHandler(UnimportSession, req)
	assertOK(t, w)

	var n int
	require.NoError(t, service.UnsafeDBForTest().QueryRow("SELECT COUNT(*) FROM chat_sessions WHERE id = ?", sessionID).Scan(&n))
	assert.Equal(t, 0, n)
	assert.False(t, service.IsSessionRunning(sessionID), "running state must be cleared / 运行态应被清除")
}

func TestUnimportSession_CLIAgent_NoACPBranch(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	// CLI-transport agent (no AcpCommand): the CloseConn branch must be
	// skipped without error.
	// CLI 传输 agent(无 AcpCommand):应跳过 CloseConn 分支且不报错。
	model.Agents["cli-agent-u"] = &model.Agent{ID: "cli-agent-u", Name: "CLI"}
	t.Cleanup(func() { delete(model.Agents, "cli-agent-u") })

	sessionID, err := service.CreateSession(env.ProjectDir, "claude", "CLI", "cli-agent-u", "", "default", "chat")
	require.NoError(t, err)

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID, nil)
	req = withProjectCookie(req, env.ProjectDir)
	w := callHandler(UnimportSession, req)
	assertOK(t, w)

	var n int
	require.NoError(t, service.UnsafeDBForTest().QueryRow("SELECT COUNT(*) FROM chat_sessions WHERE id = ?", sessionID).Scan(&n))
	assert.Equal(t, 0, n)
}

func TestUnimportSession_NoProjectCookie(t *testing.T) {
	_, teardown := setupTestEnv(t)
	defer teardown()

	// No project cookie → requireProject rejects (403 empty-project) and the
	// handler returns before anything else. 无项目 cookie → requireProject
	// 拒绝(空项目 403),处理器提前返回。
	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id=whatever", nil)
	w := callHandler(UnimportSession, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestUnimportSession_RAGPurgeBranches(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	sessionID, err := service.CreateSession(env.ProjectDir, "claude", "RAG", "claude", "", "default", "chat")
	require.NoError(t, err)

	// Inject the RAG purge seam: first call deletes chunks (covers the
	// deleted>0 log branch), second call errors (covers the warn branch).
	// 注入 RAG 清理缝:第一次调用返回已删块数(覆盖 deleted>0 日志分支),
	// 第二次返回错误(覆盖 warn 分支)。
	calls := 0
	service.SetPurgeRAGChunksFn(func(ids []string) (int64, error) {
		calls++
		if calls == 1 {
			return 3, nil
		}
		return 0, fmt.Errorf("rag down")
	})
	t.Cleanup(func() { service.SetPurgeRAGChunksFn(nil) })

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID, nil)
	req = withProjectCookie(req, env.ProjectDir)
	w := callHandler(UnimportSession, req)
	assertOK(t, w) // RAG purge is best-effort; success path unaffected

	// Second session exercises the error branch — still OK overall.
	sessionID2, err := service.CreateSession(env.ProjectDir, "claude", "RAG2", "claude", "", "default", "chat")
	require.NoError(t, err)
	req2 := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID2, nil)
	req2 = withProjectCookie(req2, env.ProjectDir)
	w2 := callHandler(UnimportSession, req2)
	assertOK(t, w2)
	assert.Equal(t, 2, calls)
}

func TestUnimportSession_HardDeleteFails(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	sessionID, err := service.CreateSession(env.ProjectDir, "claude", "HD", "claude", "", "default", "chat")
	require.NoError(t, err)

	// Close the underlying DB so HardDeleteSession's transaction fails →
	// the 500 error branch. teardown restores the env DB.
	// 关闭底层数据库使 HardDeleteSession 事务失败 → 500 错误分支。
	// teardown 会恢复测试环境。
	service.UnsafeDBForTest().Close()

	req := newRequest(t, http.MethodDelete, "/api/ai/session/unimport?session_id="+sessionID, nil)
	req = withProjectCookie(req, env.ProjectDir)
	w := callHandler(UnimportSession, req)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
