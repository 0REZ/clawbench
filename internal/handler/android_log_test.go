package handler

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"clawbench/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// appendClientLog rotation: once the log file would exceed clientLogMaxBytes,
// the current file is renamed to .1 (previous .1 dropped) and a fresh file is
// started, so js.log/android.log never grow without bound.
func TestAppendClientLog_RotatesPastCap(t *testing.T) {
	origLogDir := model.ConfigInstance.LogDir
	defer func() { model.ConfigInstance.LogDir = origLogDir }()

	tmpDir := t.TempDir()
	model.ConfigInstance.LogDir = tmpDir
	path := filepath.Join(tmpDir, "js.log")

	// Fill the file to exactly the cap (a single batch that lands at the cap
	// must NOT rotate; rotation happens only when the NEXT batch would exceed it).
	big := strings.Repeat("x", int(clientLogMaxBytes))
	require.NoError(t, appendClientLog("js", []byte(big)))

	// The next append — even a tiny one — would exceed the cap, so it must
	// rotate the current file first.
	require.NoError(t, appendClientLog("js", []byte("tail")))

	// Old content now lives in .1; the live file starts fresh with just "tail".
	rotated, err := os.ReadFile(path + ".1")
	require.NoError(t, err)
	assert.Equal(t, big, string(rotated))

	live, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "tail", string(live))
}

func TestAppendClientLog_SecondRotationDropsPreviousGen(t *testing.T) {
	origLogDir := model.ConfigInstance.LogDir
	defer func() { model.ConfigInstance.LogDir = origLogDir }()

	tmpDir := t.TempDir()
	model.ConfigInstance.LogDir = tmpDir
	path := filepath.Join(tmpDir, "js.log")

	require.NoError(t, appendClientLog("js", []byte(strings.Repeat("a", int(clientLogMaxBytes)))))
	// Rotate again with different content.
	require.NoError(t, appendClientLog("js", []byte(strings.Repeat("b", int(clientLogMaxBytes)))))
	require.NoError(t, appendClientLog("js", []byte("c")))

	// .1 holds the "b" generation only — the "a" generation was dropped.
	rotated, err := os.ReadFile(path + ".1")
	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("b", int(clientLogMaxBytes)), string(rotated))
	assert.False(t, strings.Contains(string(rotated), "a"))
}
