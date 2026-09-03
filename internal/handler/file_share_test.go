package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

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
