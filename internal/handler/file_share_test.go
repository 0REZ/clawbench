package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"clawbench/internal/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createShareTestFile writes a file and returns its absolute path.
func createShareTestFile(t *testing.T, env *testEnv, relPath, content string) string {
	t.Helper()
	createTestFile(t, env.ProjectDir, relPath, content)
	return filepath.Join(env.ProjectDir, relPath)
}

// createShareViaAPI creates a share through the auth endpoint and returns the token.
func createShareViaAPI(t *testing.T, absPath string) string {
	t.Helper()
	req := newRequest(t, http.MethodPost, "/api/share", map[string]string{"path": absPath})
	withProjectCookie(req, filepath.Dir(absPath))
	w := callHandler(ServeShareManage, req)
	assertOK(t, w)

	var resp shareResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.Token)
	assert.Equal(t, "/share/"+resp.Token, resp.Path)
	return resp.Token
}

// ─── Management endpoints ────────────────────────────────────────────────────

func TestShareManage_CreateStatusRevoke(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "docs/a.md", "# Hello\n\nbody")
	token := createShareViaAPI(t, absPath)

	// GET status → share exists
	req := newRequest(t, http.MethodGet, "/api/share?path="+absPath, nil)
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareManage, req)
	assertOK(t, w)
	var resp shareResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, token, resp.Token)

	// DELETE revoke
	req = newRequest(t, http.MethodDelete, "/api/share?path="+absPath, nil)
	withProjectCookie(req, env.ProjectDir)
	w = callHandler(ServeShareManage, req)
	assertOK(t, w)

	// GET status → empty
	req = newRequest(t, http.MethodGet, "/api/share?path="+absPath, nil)
	withProjectCookie(req, env.ProjectDir)
	w = callHandler(ServeShareManage, req)
	assertOK(t, w)
	resp = shareResponse{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Empty(t, resp.Token)
}

func TestShareManage_CreateRotatesToken(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "docs/rotate.md", "v1")
	token1 := createShareViaAPI(t, absPath)

	// Re-create (regenerate) → new token, old invalid.
	token2 := createShareViaAPI(t, absPath)
	assert.NotEqual(t, token1, token2)

	// Old token's public endpoint 404s.
	req := newRequest(t, http.MethodGet, "/api/share/"+token1+"/file", nil)
	w := callHandler(ServeSharePublic, req)
	assertStatus(t, w, http.StatusNotFound)
}

func TestShareManage_RejectsDirectory(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	dir := filepath.Join(env.ProjectDir, "docs")
	require.NoError(t, os.MkdirAll(dir, 0o755))

	req := newRequest(t, http.MethodPost, "/api/share", map[string]string{"path": dir})
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareManage, req)
	assertStatus(t, w, http.StatusBadRequest)
}

func TestShareManage_RejectsMissingPath(t *testing.T) {
	_, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodPost, "/api/share", map[string]string{})
	w := callHandler(ServeShareManage, req)
	assertStatus(t, w, http.StatusBadRequest)
}

func TestShareManage_RejectsNonExistentFile(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	missing := filepath.Join(env.ProjectDir, "nope.md")
	req := newRequest(t, http.MethodPost, "/api/share", map[string]string{"path": missing})
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareManage, req)
	assertStatus(t, w, http.StatusNotFound)
}

func TestShareManage_MethodNotAllowed(t *testing.T) {
	_, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodPut, "/api/share", map[string]string{"path": "/x"})
	w := callHandler(ServeShareManage, req)
	assertStatus(t, w, http.StatusMethodNotAllowed)
}

// ─── Public endpoints ────────────────────────────────────────────────────────

func TestSharePublic_FileContent(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "docs/content.md", "# Doc\n\n**bold** text")
	token := createShareViaAPI(t, absPath)

	req := newRequest(t, http.MethodGet, "/api/share/"+token+"/file", nil)
	w := callHandler(ServeSharePublic, req)
	assertOK(t, w)

	var fc FileContent
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &fc))
	assert.Equal(t, "# Doc\n\n**bold** text", fc.Content)
	assert.Equal(t, "content.md", fc.Name)
	assert.Equal(t, absPath, fc.Path)
	assert.True(t, fc.Supported)
}

func TestSharePublic_InvalidToken_404(t *testing.T) {
	_, teardown := setupTestEnv(t)
	defer teardown()

	for _, p := range []string{
		"/api/share/ffffffffffffffffffffffffffffffff/file",
		"/api/share//file",
		"/api/share/nonexistent-token-here/file",
	} {
		req := newRequest(t, http.MethodGet, p, nil)
		w := callHandler(ServeSharePublic, req)
		assertStatus(t, w, http.StatusNotFound)
	}
}

func TestSharePublic_FileDeletedAfterShare_404(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "docs/tmp.md", "x")
	token := createShareViaAPI(t, absPath)

	require.NoError(t, os.Remove(absPath))

	req := newRequest(t, http.MethodGet, "/api/share/"+token+"/file", nil)
	w := callHandler(ServeSharePublic, req)
	assertStatus(t, w, http.StatusNotFound)
}

func TestSharePublic_Download(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "docs/dl.md", "# download me")
	token := createShareViaAPI(t, absPath)

	req := newRequest(t, http.MethodGet, "/api/share/"+token+"/download", nil)
	w := callHandler(ServeSharePublic, req)
	assertOK(t, w)
	assert.Equal(t, "# download me", w.Body.String())
	assert.Contains(t, w.Header().Get("Content-Disposition"), "attachment")
	assert.Contains(t, w.Header().Get("Content-Disposition"), "dl.md")
}

func TestSharePublic_LocalResolvesRelativeToSharedFileDir(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	// Shared markdown references ./img/pic.png in the same directory.
	createTestFile(t, env.ProjectDir, "docs/img/pic.png", "PNGDATA")
	absPath := createShareTestFile(t, env, "docs/readme.md", "![p](img/pic.png)")
	token := createShareViaAPI(t, absPath)

	req := newRequest(t, http.MethodGet, "/api/share/"+token+"/local/img/pic.png", nil)
	w := callHandler(ServeSharePublic, req)
	assertOK(t, w)
	assert.Equal(t, "PNGDATA", w.Body.String())
}

func TestSharePublic_LocalTraversalRejected(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	createTestFile(t, env.ProjectDir, "secret.txt", "SECRET")
	absPath := createShareTestFile(t, env, "docs/readme.md", "hi")
	token := createShareViaAPI(t, absPath)

	// ../secret.txt must NOT escape the shared file's dir.
	for _, p := range []string{
		"/api/share/" + token + "/local/../secret.txt",
		"/api/share/" + token + "/local/..%2Fsecret.txt",
		"/api/share/" + token + "/local/../../secret.txt",
	} {
		req := newRequest(t, http.MethodGet, p, nil)
		w := callHandler(ServeSharePublic, req)
		assert.NotEqual(t, http.StatusOK, w.Code, "path %s must be rejected", p)
		assert.NotContains(t, w.Body.String(), "SECRET", "path %s leaked content", p)
	}
}

func TestSharePublic_LocalAbsolutePath(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	// A file in the project root, referenced absolutely by the shared markdown.
	absTarget := filepath.Join(env.ProjectDir, "images", "abs.png")
	createTestFile(t, env.ProjectDir, "images/abs.png", "ABSDATA")
	absPath := createShareTestFile(t, env, "docs/m.md", "hi")
	token := createShareViaAPI(t, absPath)

	req := newRequest(t, http.MethodGet, "/api/share/"+token+"/local?path="+absTarget, nil)
	w := callHandler(ServeSharePublic, req)
	assertOK(t, w)
	assert.Equal(t, "ABSDATA", w.Body.String())
}

func TestSharePublic_NoAuthNeeded(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "pub.md", "public")
	token := createShareViaAPI(t, absPath)

	// Bypass Auth middleware entirely — direct call without cookie must work.
	req := newRequest(t, http.MethodGet, "/api/share/"+token+"/file", nil)
	w := callHandler(ServeSharePublic, req)
	assertOK(t, w)
}

func TestSharePage_ServesShareHtml(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()
	_ = env

	// In test env there is no built share.html; handler falls back to
	// web/share.html which may not exist in test CWD — both outcomes must not
	// panic, and non-GET methods are rejected with 405.
	req := newRequest(t, http.MethodPost, "/share/abc", nil)
	w := callHandler(ServeSharePage, req)
	assertStatus(t, w, http.StatusMethodNotAllowed)
}

// ─── Route registration (ServeMux precedence) ────────────────────────────────

func TestShareRoutes_Precedence(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "prec.md", "prec")
	token := createShareViaAPI(t, absPath)

	mux := http.NewServeMux()
	RegisterRoutes(mux)

	// Admin route /api/share (no trailing slash) is matched by Auth-wrapped handler.
	req := newRequest(t, http.MethodGet, "/api/share?path="+absPath, nil)
	withProjectCookie(req, env.ProjectDir)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Public data route /api/share/{token}/file works unauthenticated.
	req = newRequest(t, http.MethodGet, "/api/share/"+token+"/file", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

// TestShareManage_RouteDoesNotShadowShareIn ensures /api/share (admin) does not
// swallow /api/share-in/recent.
func TestShareManage_RouteDoesNotShadowShareIn(t *testing.T) {
	_, teardown := setupTestEnv(t)
	defer teardown()

	mux := http.NewServeMux()
	RegisterRoutes(mux)

	// /api/share-in/recent has its own handler (ShareInRecent). A GET should
	// reach it (method GET → 405/400 depending on handler) rather than 404 from
	// falling through. We just assert it is NOT routed to ServeShareManage's
	// method-switch (which would 405 too) — the real guarantee is that the
	// ServeMux does not conflict; any response other than a mux 404 is fine.
	req := newRequest(t, http.MethodGet, "/api/share-in/recent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	assert.NotEqual(t, http.StatusNotFound, rec.Code, "share-in route must not 404")
}

// ─── List endpoints ──────────────────────────────────────────────────────────

func TestShareList_EmptyReturnsArray(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodGet, "/api/share/list", nil)
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareList, req)
	assertOK(t, w)

	var resp struct {
		Shares []shareListItem `json:"shares"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.NotNil(t, resp.Shares, "empty list must encode as [] not null")
	assert.Empty(t, resp.Shares)
}

func TestShareList_ListsAllSharesWithDisplayPath(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	// File inside the project → display path should be project-relative.
	inProject := createShareTestFile(t, env, "docs/inside.md", "x")
	createShareViaAPI(t, inProject)

	// File outside the project but under a root → display path stays absolute.
	outsideDir := filepath.Join(env.WatchDir, "other")
	require.NoError(t, os.MkdirAll(outsideDir, 0o755))
	outside := filepath.Join(outsideDir, "outside.md")
	createTestFile(t, outsideDir, "outside.md", "y")
	createShareViaAPI(t, outside)

	req := newRequest(t, http.MethodGet, "/api/share/list", nil)
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareList, req)
	assertOK(t, w)

	var resp struct {
		Shares []shareListItem `json:"shares"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.Len(t, resp.Shares, 2)

	byPath := map[string]shareListItem{}
	for _, s := range resp.Shares {
		byPath[s.Path] = s
	}
	// Project file relativized.
	assert.Contains(t, byPath, "docs/inside.md")
	assert.True(t, byPath["docs/inside.md"].Exists)
	assert.Equal(t, "inside.md", byPath["docs/inside.md"].Name)
	assert.NotEmpty(t, byPath["docs/inside.md"].Token)
	assert.NotEmpty(t, byPath["docs/inside.md"].CreatedAt)
	// Out-of-project file stays absolute.
	assert.Contains(t, byPath, outside)
	assert.True(t, byPath[outside].Exists)
}

func TestShareList_MarksDeletedFileAsNotExists(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "docs/doomed.md", "x")
	createShareViaAPI(t, absPath)
	require.NoError(t, os.Remove(absPath))

	req := newRequest(t, http.MethodGet, "/api/share/list", nil)
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareList, req)
	assertOK(t, w)

	var resp struct {
		Shares []shareListItem `json:"shares"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.Len(t, resp.Shares, 1)
	assert.Equal(t, "docs/doomed.md", resp.Shares[0].Path)
	assert.False(t, resp.Shares[0].Exists)
}

func TestShareList_RevokeByToken(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	// Share a file then delete it — stale share must still be revocable by token.
	absPath := createShareTestFile(t, env, "docs/stale.md", "x")
	token := createShareViaAPI(t, absPath)
	require.NoError(t, os.Remove(absPath))

	req := newRequest(t, http.MethodDelete, "/api/share/list", map[string]string{"token": token})
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareList, req)
	assertOK(t, w)

	_, _, ok, err := service.GetFileShareByToken(token)
	require.NoError(t, err)
	assert.False(t, ok, "share must be revoked")
}

func TestShareList_RevokeByTokenMissingToken_400(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodDelete, "/api/share/list", map[string]string{})
	withProjectCookie(req, env.ProjectDir)
	w := callHandler(ServeShareList, req)
	assertStatus(t, w, http.StatusBadRequest)
}

func TestShareList_MethodNotAllowed(t *testing.T) {
	_, teardown := setupTestEnv(t)
	defer teardown()

	req := newRequest(t, http.MethodPost, "/api/share/list", map[string]string{})
	w := callHandler(ServeShareList, req)
	assertStatus(t, w, http.StatusMethodNotAllowed)
}

// TestShareList_RoutePrecedence ensures /api/share/list is NOT swallowed by the
// public /api/share/{token}/... handler (ServeSharePublic).
func TestShareList_RoutePrecedence(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	absPath := createShareTestFile(t, env, "prec2.md", "x")
	createShareViaAPI(t, absPath)

	mux := http.NewServeMux()
	RegisterRoutes(mux)

	// A request to the literal list path must reach the authed list handler.
	req := newRequest(t, http.MethodGet, "/api/share/list", nil)
	withProjectCookie(req, env.ProjectDir)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	// ... and be a JSON list (not a public "file content" response).
	assert.Contains(t, rec.Body.String(), `"shares"`)
}

// TestShareList_DeleteAll revokes every share via DELETE with {"all":true}.
func TestShareList_DeleteAll(t *testing.T) {
	env, teardown := setupTestEnv(t)
	defer teardown()

	abs1 := createShareTestFile(t, env, "docs/one.md", "x")
	createShareViaAPI(t, abs1)
	abs2 := createShareTestFile(t, env, "docs/two.md", "y")
	createShareViaAPI(t, abs2)

	// Sanity: two shares exist.
	list := newRequest(t, http.MethodGet, "/api/share/list", nil)
	withProjectCookie(list, env.ProjectDir)
	w := callHandler(ServeShareList, list)
	assertOK(t, w)
	var resp struct {
		Shares []shareListItem `json:"shares"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.Len(t, resp.Shares, 2)

	// One-click clear.
	clearReq := newRequest(t, http.MethodDelete, "/api/share/list", map[string]any{"all": true})
	withProjectCookie(clearReq, env.ProjectDir)
	w = callHandler(ServeShareList, clearReq)
	assertOK(t, w)

	after := newRequest(t, http.MethodGet, "/api/share/list", nil)
	withProjectCookie(after, env.ProjectDir)
	w = callHandler(ServeShareList, after)
	assertOK(t, w)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Empty(t, resp.Shares)
}
