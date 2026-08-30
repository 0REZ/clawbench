package handler

import (
	"net/http"
	"testing"

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
