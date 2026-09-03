//nolint:noctx // DB operations, request context not applicable
package service

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// FileSharesDDL creates the file_shares table.
// Exported so handler tests and other external packages can create this table
// in their test databases.
const FileSharesDDL = `
CREATE TABLE IF NOT EXISTS file_shares (
	token TEXT PRIMARY KEY,
	path TEXT NOT NULL,
	name TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_file_shares_path ON file_shares(path);
`

// GenerateShareToken returns a cryptographically random 32-hex-char token
// (128 bits of entropy), unguessable for capability-URL protection.
func GenerateShareToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate share token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// UpsertFileShare creates a new share for path (returns created=true) or, when a
// share already exists for path, rotates it to a fresh token (created=false).
// Rotating invalidates the previous link immediately — only the returned token
// is valid afterwards.
func UpsertFileShare(path, name string) (token string, created bool, err error) {
	_, _, existing, getErr := GetFileShareByPath(path)
	if getErr != nil {
		return "", false, getErr
	}

	token, err = GenerateShareToken()
	if err != nil {
		return "", false, err
	}

	if existing {
		// Rotate: delete the old row first so the previous token stops working.
		if _, err := WriteExec("DELETE FROM file_shares WHERE path = ?", path); err != nil {
			return "", false, fmt.Errorf("delete stale share: %w", err)
		}
	}
	if _, err := WriteExec("INSERT INTO file_shares (token, path, name) VALUES (?, ?, ?)", token, path, name); err != nil {
		return "", false, fmt.Errorf("insert share: %w", err)
	}
	return token, !existing, nil
}

// GetFileShareByToken looks up a share by its capability token. Returns ok=false
// when no share matches (link is unknown or has been revoked).
func GetFileShareByToken(token string) (path, name string, ok bool, err error) {
	if token == "" {
		return "", "", false, nil
	}
	row := ReadDB().QueryRow("SELECT path, name FROM file_shares WHERE token = ?", token)
	if err := row.Scan(&path, &name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", false, nil
		}
		return "", "", false, fmt.Errorf("query share by token: %w", err)
	}
	return path, name, true, nil
}

// GetFileShareByPath returns the active token (and stored name) for a file path.
// Returns ok=false when the file has no share.
func GetFileShareByPath(path string) (token, name string, ok bool, err error) {
	if path == "" {
		return "", "", false, nil
	}
	row := ReadDB().QueryRow("SELECT token, name FROM file_shares WHERE path = ?", path)
	if err := row.Scan(&token, &name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", false, nil
		}
		return "", "", false, fmt.Errorf("query share by path: %w", err)
	}
	return token, name, true, nil
}

// DeleteFileShareByToken revokes a single share link by token.
func DeleteFileShareByToken(token string) error {
	if token == "" {
		return nil
	}
	if _, err := WriteExec("DELETE FROM file_shares WHERE token = ?", token); err != nil {
		return fmt.Errorf("delete share by token: %w", err)
	}
	return nil
}

// DeleteFileShareByPath revokes the share for a single file path.
func DeleteFileShareByPath(path string) error {
	if path == "" {
		return nil
	}
	if _, err := WriteExec("DELETE FROM file_shares WHERE path = ?", path); err != nil {
		return fmt.Errorf("delete share by path: %w", err)
	}
	return nil
}

// DeleteFileSharesUnderPath revokes shares for the given path plus every file
// inside it (used when a directory is deleted or renamed away).
func DeleteFileSharesUnderPath(path string) error {
	if path == "" {
		return nil
	}
	if _, err := WriteExec(
		"DELETE FROM file_shares WHERE path = ? OR path LIKE ? ESCAPE '\\'",
		path, escapeLikePrefix(path)+"\\/%",
	); err != nil {
		return fmt.Errorf("delete shares under path: %w", err)
	}
	return nil
}

// escapeLikePrefix escapes SQL LIKE wildcard characters so a literal path
// prefix can be matched safely (no partial-wildcard surprises).
func escapeLikePrefix(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return r.Replace(s)
}

// DeleteFileShareByPaths revokes shares for multiple file paths in one statement.
func DeleteFileShareByPaths(paths []string) error {
	clean := make([]string, 0, len(paths))
	for _, p := range paths {
		if p != "" {
			clean = append(clean, p)
		}
	}
	if len(clean) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(clean)), ",")
	args := make([]any, 0, len(clean))
	for _, p := range clean {
		args = append(args, p)
	}
	if _, err := WriteExec("DELETE FROM file_shares WHERE path IN ("+placeholders+")", args...); err != nil {
		return fmt.Errorf("delete shares by paths: %w", err)
	}
	return nil
}

// DeleteAllFileShares revokes every active share link.
func DeleteAllFileShares() error {
	if _, err := WriteExec("DELETE FROM file_shares"); err != nil {
		return fmt.Errorf("delete all file shares: %w", err)
	}
	return nil
}

// FileShare describes one active share link (list view item).
type FileShare struct {
	Token     string `json:"token"`
	Path      string `json:"path"` // absolute path of the shared file
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// ListFileShares returns every active share, newest first.
// Returns an empty (non-nil) slice when there are no shares so JSON encodes as [].
func ListFileShares() ([]FileShare, error) {
	rows, err := ReadDB().Query("SELECT token, path, name, created_at FROM file_shares ORDER BY rowid DESC")
	if err != nil {
		return nil, fmt.Errorf("list file shares: %w", err)
	}
	defer func() { _ = rows.Close() }()

	shares := make([]FileShare, 0)
	for rows.Next() {
		var s FileShare
		if err := rows.Scan(&s.Token, &s.Path, &s.Name, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan file share: %w", err)
		}
		shares = append(shares, s)
	}
	return shares, rows.Err()
}
