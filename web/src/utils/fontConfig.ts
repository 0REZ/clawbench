/**
 * Font configuration — pure system font-stack switching.
 *
 * Users pick from a set of well-known open-source font *names*. The chosen
 * font is inserted at the head of the CSS font stack; when the font is not
 * installed on the device, the browser falls back through the remaining
 * default stack. No font files are downloaded or bundled.
 *
 * The effective stacks are exposed to CSS through two custom properties on
 * <html>: --font-ui (interface / prose text) and --font-mono (code, terminal,
 * file viewer, path chips …).
 */

export const DEFAULT_FONT_CHOICE = 'default'

/**
 * Default UI (sans) font stack — must match the one hard-coded in
 * web/css/base.css before variable-ization.
 */
export const DEFAULT_UI_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif"

/**
 * Default monospace font stack — mirrors the historical code font stack used
 * across the app (code blocks / file viewer / search bar …).
 */
export const DEFAULT_MONO_STACK = "'SF Mono', Monaco, 'Cascadia Code', 'Segoe UI Mono', 'Roboto Mono', Consolas, 'Liberation Mono', monospace"

/**
 * Default terminal (xterm) font stack. xterm is canvas-rendered and reads a
 * concrete fontFamily — historically a JetBrains-first stack. Shared by
 * useTerminalTabs (new instances) and TerminalPanelContent (existing ones).
 */
export const DEFAULT_TERMINAL_MONO_STACK = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace"

export interface FontChoice {
  /** Stable storage value: 'default' or an installed font family name. */
  id: string
}

/** Well-known open-source monospace font candidates (OFL / libre). The UI
 *  renders each option's label from i18n key `settings.items.fonts.<id>`. */
export const MONO_FONT_CHOICES: FontChoice[] = [
  { id: DEFAULT_FONT_CHOICE },
  { id: 'JetBrains Mono' },
  { id: 'Fira Code' },
  { id: 'Cascadia Code' },
  { id: 'Source Code Pro' },
  { id: 'Hack' },
  { id: 'IBM Plex Mono' },
  { id: 'Iosevka' },
  { id: 'Sarasa Mono SC' },
  { id: 'Maple Mono' },
]

/** Well-known open-source UI (sans) font candidates. CJK options included so
 *  Chinese UI text also visibly changes when installed. */
export const UI_FONT_CHOICES: FontChoice[] = [
  { id: DEFAULT_FONT_CHOICE },
  { id: 'Inter' },
  { id: 'Source Sans 3' },
  { id: 'IBM Plex Sans' },
  { id: 'LXGW WenKai' },
  { id: 'Noto Sans SC' },
]

export const MONO_FONT_KEY = 'clawbench-settings-fontMono'
export const UI_FONT_KEY = 'clawbench-settings-fontUi'

function readChoice(key: string, storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    const raw = storage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string' && parsed) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_FONT_CHOICE
}

export function readMonoFont(storage: Pick<Storage, 'getItem'> = localStorage): string {
  return readChoice(MONO_FONT_KEY, storage)
}

export function readUiFont(storage: Pick<Storage, 'getItem'> = localStorage): string {
  return readChoice(UI_FONT_KEY, storage)
}

/**
 * Build a full CSS font stack for a selected font choice.
 * 'default' returns the given default stack untouched; otherwise the chosen
 * family is inserted at the head so an installed font takes effect while an
 * uninstalled one falls back to the default stack.
 */
export function buildFontStack(choice: string | undefined | null, defaultStack: string): string {
  if (!choice || choice === DEFAULT_FONT_CHOICE) return defaultStack
  // Quote family names with spaces; simple names pass through unquoted.
  const needsQuote = /\s/.test(choice) && !/^['"]/.test(choice)
  const family = needsQuote ? `'${choice}'` : choice
  return `${family}, ${defaultStack}`
}

/** Resolve a stored choice against the candidate list; returns null for unknown ids. */
export function resolveChoice(choice: string | undefined | null, candidates: FontChoice[]): FontChoice | null {
  if (!choice) return null
  return candidates.find(c => c.id === choice) ?? null
}

/** Set a --font-* custom property on <html> from a stored mono/ui choice. */
export function applyFontToDocument(doc: Pick<Document, 'documentElement'>, prop: string, choice: string, defaultStack: string): void {
  doc.documentElement.style.setProperty(prop, buildFontStack(choice, defaultStack))
}

/** Apply both font choices to <html> custom properties. Unknown ids (e.g.
 *  tampered localStorage) fall back to the default stack. */
export function applyFontConfig(
  doc: Pick<Document, 'documentElement'> = document,
  monoChoice: string = readMonoFont(),
  uiChoice: string = readUiFont(),
): void {
  const monoValid = resolveChoice(monoChoice, MONO_FONT_CHOICES) !== null
  const uiValid = resolveChoice(uiChoice, UI_FONT_CHOICES) !== null
  applyFontToDocument(doc, '--font-mono', monoValid ? monoChoice : DEFAULT_FONT_CHOICE, DEFAULT_MONO_STACK)
  applyFontToDocument(doc, '--font-ui', uiValid ? uiChoice : DEFAULT_FONT_CHOICE, DEFAULT_UI_STACK)
}
