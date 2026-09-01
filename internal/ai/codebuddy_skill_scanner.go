package ai

import (
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SkillInfo represents a discovered skill from ~/.codebuddy/skills/.
type SkillInfo struct {
	Name        string // skill name from YAML frontmatter
	Description string // description from YAML frontmatter
	Path        string // full path to the SKILL.md file
}

// ScanCodeBuddySkills scans ~/.codebuddy/skills/ for skill definitions.
// Each skill is a directory containing SKILL.md with YAML frontmatter.
// Returns nil if directory doesn't exist or no skills found.
func ScanCodeBuddySkills() []SkillInfo {
	home, err := os.UserHomeDir()
	if err != nil {
		slog.Debug("acp skill scan: cannot resolve home dir", "error", err)
		return nil
	}
	skillsDir := filepath.Join(home, ".codebuddy", "skills")
	return scanSkillsFromDir(skillsDir)
}

// scanSkillsFromDir scans the given directory for skill subdirectories containing SKILL.md.
// Separated for testability (injectable directory path).
func scanSkillsFromDir(skillsDir string) []SkillInfo {
	if _, err := os.Stat(skillsDir); os.IsNotExist(err) {
		slog.Debug("acp skill scan: skills directory does not exist", "path", skillsDir)
		return nil
	}

	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		slog.Debug("acp skill scan: cannot read skills directory", "path", skillsDir, "error", err)
		return nil
	}

	var skills []SkillInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillFile := filepath.Join(skillsDir, entry.Name(), "SKILL.md")
		info, err := os.Stat(skillFile)
		if err != nil || info.IsDir() {
			continue
		}

		data, err := os.ReadFile(skillFile) //nolint:gosec // G122: path is constructed from ReadDir entries; skills are trusted local files
		if err != nil {
			slog.Debug("acp skill scan: cannot read skill file", "path", skillFile, "error", err)
			continue
		}

		name, description, ok := parseSkillFrontmatter(data)
		if !ok {
			slog.Debug("acp skill scan: no valid frontmatter in skill file", "path", skillFile)
			continue
		}

		skills = append(skills, SkillInfo{
			Name:        name,
			Description: description,
			Path:        skillFile,
		})
	}

	if len(skills) == 0 {
		return nil
	}

	// Sort by name for deterministic output
	sort.Slice(skills, func(i, j int) bool {
		return skills[i].Name < skills[j].Name
	})

	slog.Info("acp skill scan: found CodeBuddy skills", "count", len(skills))
	return skills
}

// parseSkillFrontmatter parses YAML frontmatter from a SKILL.md file.
// Returns (name, description, true) on success, ("", "", false) on failure.
//
// Expected format:
//
//	---
//	name: skill-name
//	description: "Some description text"
//	---
//
// NOTE: This is a minimal frontmatter parser. It handles single-line
// name and description values (quoted or unquoted). Multi-line YAML scalars
// are not supported.
func parseSkillFrontmatter(data []byte) (string, string, bool) {
	content := string(data)

	// Opening --- must be at the start of the file (line 1, column 1).
	if !strings.HasPrefix(content, "---") {
		return "", "", false
	}
	afterOpen := content[3:]

	// Find closing --- (must be on its own line)
	closeIdx := strings.Index(afterOpen, "\n---")
	if closeIdx < 0 {
		return "", "", false
	}
	frontmatter := afterOpen[:closeIdx]

	var name, description string
	for _, line := range strings.Split(frontmatter, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "name:") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
			name = strings.Trim(name, "\"'")
		} else if strings.HasPrefix(line, "description:") {
			description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
			description = strings.Trim(description, "\"'")
		}
	}

	if name == "" || description == "" {
		return "", "", false
	}

	return name, description, true
}

// SkillsToCommands converts SkillInfo slices to AvailableCommandInfo so skills
// appear in the slash command menu (/) just like plugin commands. CodeBuddy
// TUI mode exposes skills this way; we mirror it in ACP mode.
func SkillsToCommands(skills []SkillInfo) []AvailableCommandInfo {
	if len(skills) == 0 {
		return nil
	}
	cmds := make([]AvailableCommandInfo, 0, len(skills))
	for _, s := range skills {
		name := s.Name
		if !strings.HasPrefix(name, "/") {
			name = "/" + name
		}
		cmds = append(cmds, AvailableCommandInfo{
			Name:        name,
			Description: s.Description,
		})
	}
	return cmds
}

// buildSkillsSystemPrompt generates a system prompt section that informs
// CodeBuddy about available skills. This is injected into the session
// system prompt so CodeBuddy can auto-load skills based on triggers.
func buildSkillsSystemPrompt(skills []SkillInfo) string {
	if len(skills) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("## Available Skills\n\n")
	b.WriteString("The following skills are available in your environment. ")
	b.WriteString("When a skill's description matches the current task, ")
	b.WriteString("load and follow its instructions automatically.\n\n")
	b.WriteString("| Skill | Description |\n")
	b.WriteString("|-------|-------------|\n")
	for _, s := range skills {
		b.WriteString("| ")
		b.WriteString(s.Name)
		b.WriteString(" | ")
		b.WriteString(s.Description)
		b.WriteString(" |\n")
	}

	return b.String()
}
