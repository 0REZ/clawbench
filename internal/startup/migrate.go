package startup

import (
	"fmt"
	"os"
	"path/filepath"
)

// CheckLegacyLayout checks if the legacy BinDir data layout exists and prints
// a prominent warning asking the user to manually migrate to the new DataDir layout.
func CheckLegacyLayout(binDir, dataDir string) {
	oldDataDir := filepath.Join(binDir, ".clawbench")

	// If the binary lives in the home directory (or anywhere binDir/.clawbench
	// resolves to the current data dir), old and new are the same directory —
	// nothing to migrate, don't warn.
	if samePath(oldDataDir, dataDir) {
		return
	}

	oldInfo, err := os.Stat(oldDataDir)
	if err != nil || !oldInfo.IsDir() {
		return // no legacy data, nothing to warn about
	}

	// Also check for legacy config directory
	oldConfigDir := filepath.Join(binDir, "config")
	hasLegacyConfig := false
	if configInfo, err := os.Stat(oldConfigDir); err == nil && configInfo.IsDir() {
		hasLegacyConfig = true
	}

	fmt.Println()
	fmt.Println("========================================")
	fmt.Println("  WARNING: Legacy data layout detected!")
	fmt.Println("========================================")
	fmt.Println()
	fmt.Printf("  Old data directory: %s\n", oldDataDir)
	if hasLegacyConfig {
		fmt.Printf("  Old config directory: %s\n", oldConfigDir)
	}
	fmt.Printf("  New data directory:  %s\n", dataDir)
	fmt.Println()
	fmt.Println("  Please migrate manually:")
	fmt.Printf("    mv %s/* %s/\n", oldDataDir, dataDir)
	if hasLegacyConfig {
		fmt.Printf("    mv %s %s/config\n", oldConfigDir, dataDir)
	}
	fmt.Println()
	fmt.Println("  See documentation for details.")
	fmt.Println("========================================")
	fmt.Println()
}

// samePath reports whether two paths resolve to the same directory,
// following symlinks and cleaning relative/absolute differences.
func samePath(a, b string) bool {
	ra, errA := filepath.EvalSymlinks(a)
	rb, errB := filepath.EvalSymlinks(b)
	if errA != nil || errB != nil {
		// Fall back to absolute cleaned paths if symlink resolution fails.
		pa, errA := filepath.Abs(a)
		pb, errB := filepath.Abs(b)
		if errA != nil || errB != nil {
			return false
		}
		ra, rb = filepath.Clean(pa), filepath.Clean(pb)
	}
	return filepath.Clean(ra) == filepath.Clean(rb)
}
