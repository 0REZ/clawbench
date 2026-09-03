package service_test

import (
	"database/sql"
	"testing"

	"clawbench/internal/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

// setupTestDBForFileShares creates an in-memory SQLite with the file_shares table.
func setupTestDBForFileShares(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)

	_, err = db.Exec(service.FileSharesDDL)
	require.NoError(t, err)

	cleanup := service.SetDBForTest(db, db)
	t.Cleanup(cleanup)
	return db
}

func TestFileShares_UpsertCreatesNewToken(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	token, created, err := service.UpsertFileShare("/tmp/a.md", "a.md")
	require.NoError(t, err)
	assert.True(t, created)
	assert.Len(t, token, 32)

	path, name, ok, err := service.GetFileShareByToken(token)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "/tmp/a.md", path)
	assert.Equal(t, "a.md", name)
}

func TestFileShares_UpsertRotatesToken(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	token1, created, err := service.UpsertFileShare("/tmp/a.md", "a.md")
	require.NoError(t, err)
	assert.True(t, created)

	token2, created, err := service.UpsertFileShare("/tmp/a.md", "a.md")
	require.NoError(t, err)
	assert.False(t, created)
	assert.NotEqual(t, token1, token2, "rotating must issue a fresh token")

	// Old token revoked, new token live.
	_, _, ok, err := service.GetFileShareByToken(token1)
	require.NoError(t, err)
	assert.False(t, ok, "old token must be invalid after rotation")
	_, _, ok, err = service.GetFileShareByToken(token2)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestFileShares_GetFileShareByPath(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	// No share yet.
	_, _, ok, err := service.GetFileShareByPath("/tmp/none.md")
	require.NoError(t, err)
	assert.False(t, ok)

	token, _, err := service.UpsertFileShare("/tmp/b.md", "b.md")
	require.NoError(t, err)

	gotToken, name, ok, err := service.GetFileShareByPath("/tmp/b.md")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, token, gotToken)
	assert.Equal(t, "b.md", name)
}

func TestFileShares_GetByTokenUnknownReturnsFalse(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	_, _, ok, err := service.GetFileShareByToken("deadbeefdeadbeefdeadbeefdeadbeef")
	require.NoError(t, err)
	assert.False(t, ok)
	// Empty token also resolves false without error.
	_, _, ok, err = service.GetFileShareByToken("")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestFileShares_DeleteByToken(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	token, _, err := service.UpsertFileShare("/tmp/c.md", "c.md")
	require.NoError(t, err)

	require.NoError(t, service.DeleteFileShareByToken(token))
	_, _, ok, err := service.GetFileShareByToken(token)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestFileShares_DeleteByPath(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	token, _, err := service.UpsertFileShare("/tmp/d.md", "d.md")
	require.NoError(t, err)

	require.NoError(t, service.DeleteFileShareByPath("/tmp/d.md"))
	_, _, ok, err := service.GetFileShareByToken(token)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestFileShares_DeleteSharesUnderPath(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	// Shares at the dir itself, directly under it, and nested.
	_, _, err := service.UpsertFileShare("/tmp/docs", "docs")
	require.NoError(t, err)
	_, _, err = service.UpsertFileShare("/tmp/docs/readme.md", "readme.md")
	require.NoError(t, err)
	_, _, err = service.UpsertFileShare("/tmp/docs/sub/deep.txt", "deep.txt")
	require.NoError(t, err)
	// Unrelated path sharing a prefix must survive.
	unrelated, _, err := service.UpsertFileShare("/tmp/docs-other/x.md", "x.md")
	require.NoError(t, err)

	require.NoError(t, service.DeleteFileSharesUnderPath("/tmp/docs"))

	for _, p := range []string{"/tmp/docs", "/tmp/docs/readme.md", "/tmp/docs/sub/deep.txt"} {
		_, _, ok, err := service.GetFileShareByPath(p)
		require.NoError(t, err)
		assert.False(t, ok, "share for %s should be removed", p)
	}
	_, _, ok, err := service.GetFileShareByToken(unrelated)
	require.NoError(t, err)
	assert.True(t, ok, "unrelated prefix share must survive")
}

func TestFileShares_DeleteSharesUnderPath_EscapesLikeWildcards(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	// A directory containing SQL LIKE wildcards — must still be literal.
	dir := "/tmp/doc_100%/readme.md"
	token, _, err := service.UpsertFileShare(dir, "readme.md")
	require.NoError(t, err)

	// A share under a directory that would match if wildcards were not escaped.
	_, _, err = service.UpsertFileShare("/tmp/docX100Xreadme.md", "readme.md")
	require.NoError(t, err)

	require.NoError(t, service.DeleteFileSharesUnderPath("/tmp/doc_100%"))

	_, _, ok, err := service.GetFileShareByToken(token)
	require.NoError(t, err)
	assert.False(t, ok, "literal-prefix share should be removed")

	// Count remaining — only the non-matching row.
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM file_shares").Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}

func TestFileShares_DeleteByPaths(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	_, _, err := service.UpsertFileShare("/tmp/e1.md", "e1.md")
	require.NoError(t, err)
	_, _, err = service.UpsertFileShare("/tmp/e2.md", "e2.md")
	require.NoError(t, err)
	keepToken, _, err := service.UpsertFileShare("/tmp/keep.md", "keep.md")
	require.NoError(t, err)

	require.NoError(t, service.DeleteFileShareByPaths([]string{"/tmp/e1.md", "/tmp/e2.md", ""}))

	_, _, ok, err := service.GetFileShareByPath("/tmp/e1.md")
	require.NoError(t, err)
	assert.False(t, ok)
	_, _, ok, err = service.GetFileShareByPath("/tmp/e2.md")
	require.NoError(t, err)
	assert.False(t, ok)
	_, _, ok, err = service.GetFileShareByToken(keepToken)
	require.NoError(t, err)
	assert.True(t, ok)

	// Empty input is a no-op.
	require.NoError(t, service.DeleteFileShareByPaths(nil))
}

func TestGenerateShareToken_IsUniqueAndHex(t *testing.T) {
	db := setupTestDBForFileShares(t)
	defer func() { _ = db.Close() }()

	seen := map[string]bool{}
	for range 200 {
		token, err := service.GenerateShareToken()
		require.NoError(t, err)
		assert.Len(t, token, 32)
		seen[token] = true
	}
	assert.Len(t, seen, 200, "tokens must not collide")
}
