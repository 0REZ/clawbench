/**
 * Shared import/export helpers for quick-send drawers.
 *
 * Both Chat Quick Send (QuickSendDrawer) and Terminal Quick Commands
 * (QuickCommandDrawer) need identical JSON export / import behavior.
 * This composable is the single source of truth:
 * - buildExportPayload() — portable format with version + kind
 * - downloadJson() — trigger a client-side JSON download (Web + Android)
 * - createJsonImporter() — hidden file input + FileReader → parse → validate → summarize
 */

import { downloadBlob } from '@/utils/download'

/** Export payload kinds — one per drawer type. */
export type QuickSendKind = 'chat_quick_send' | 'terminal_quick_command'

/** Portable export file format. */
export interface QuickSendExport {
  version: 1
  kind: QuickSendKind
  items: QuickSendExportItem[]
}

export interface QuickSendExportItem {
  label: string
  command: string
}

export interface ImportItem {
  label: string
  command: string
}

export interface ImportSummary {
  imported: number
  skipped: number
}

export interface QuickSendImporterOptions {
  kind: QuickSendKind
  /** Existing labels in the current list — duplicate labels are skipped. */
  existingLabels: () => Set<string>
  /** Called once per valid, non-duplicate item. Must return true on success. */
  addItem: (item: ImportItem) => Promise<boolean>
  /** Called when import fails outright (parse error / kind mismatch). */
  onError: (msg: string) => void
  /** Called after import finishes with a summary. */
  onSummary: (summary: ImportSummary) => void
}

/** Maximum lengths mirrored from backend validation (internal/handler/*.go). */
export const LABEL_MAX_LENGTH = 100
export const COMMAND_MAX_LENGTH = 4096

// ── Singleton hidden file input ──
// All importers share one hidden <input type="file"> so repeated drawer
// mounts don't accumulate orphaned DOM nodes. Only one import flow can be
// active at a time; the change handler dispatches to the latest importer.
let hiddenInput: HTMLInputElement | null = null
let activeOptions: QuickSendImporterOptions | null = null

function ensureInput(): HTMLInputElement {
  if (hiddenInput) return hiddenInput
  const el = document.createElement('input')
  el.type = 'file'
  el.accept = 'application/json,.json'
  el.style.display = 'none'
  el.addEventListener('change', () => {
    const opts = activeOptions
    const file = el.files?.[0]
    // Reset immediately to allow re-selecting the same file later.
    el.value = ''
    if (!opts || !file) return
    readFile(opts, file)
  })
  document.body.appendChild(el)
  hiddenInput = el
  return el
}

function readFile(opts: QuickSendImporterOptions, file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : ''
    importFromText(opts, text)
  }
  reader.onerror = () => {
    opts.onError('readError')
  }
  reader.readAsText(file)
}

/**
 * Build the portable export payload for a list of items.
 * Only label + command are exported for round-trip fidelity; the drawer decides
 * which source fields it wants to carry.
 */
export function buildExportPayload(kind: QuickSendKind, items: Pick<QuickSendExportItem, 'label' | 'command'>[]): QuickSendExport {
  return {
    version: 1,
    kind,
    items: items.map((it) => ({ label: it.label, command: it.command })),
  }
}

/** Download a JSON object as a client-side file (Web + Android via downloadBlob). */
export function downloadJson(payload: QuickSendExport, filename: string): void {
  downloadBlob(JSON.stringify(payload, null, 2), filename, 'application/json')
}

/**
 * Validate one imported item.
 * Returns an error message, or '' if valid.
 */
export function validateImportItem(item: unknown): string {
  if (typeof item !== 'object' || item === null) return 'invalid'
  const it = item as Record<string, unknown>
  const label = typeof it.label === 'string' ? it.label.trim() : ''
  const command = typeof it.command === 'string' ? it.command.trim() : ''
  if (!label || !command) return 'empty'
  if (label.length > LABEL_MAX_LENGTH || command.length > COMMAND_MAX_LENGTH) return 'tooLong'
  return ''
}

async function importFromText(opts: QuickSendImporterOptions, text: string): Promise<void> {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    opts.onError('parseError')
    return
  }

  if (typeof payload !== 'object' || payload === null) {
    opts.onError('invalidFile')
    return
  }
  const p = payload as Record<string, unknown>
  if (p.version !== 1 || p.kind !== opts.kind || !Array.isArray(p.items)) {
    opts.onError('kindMismatch')
    return
  }

  const existing = opts.existingLabels()
  let imported = 0
  let skipped = 0

  for (const raw of p.items as unknown[]) {
    const error = validateImportItem(raw)
    if (error) {
      skipped++
      continue
    }
    const it = raw as ImportItem
    const label = it.label.trim()
    const command = it.command.trim()
    if (existing.has(label)) {
      skipped++
      continue
    }
    const ok = await opts.addItem({ label, command })
    if (ok) {
      imported++
      existing.add(label)
    } else {
      skipped++
    }
  }

  opts.onSummary({ imported, skipped })
}

/**
 * Create an importer bound to a drawer.
 *
 * Returns:
 * - trigger(): programmatically opens the hidden file picker
 * - importFromText(text): parse + import raw JSON text (used by tests)
 */
export function createJsonImporter(opts: QuickSendImporterOptions) {
  return {
    trigger() {
      activeOptions = opts
      ensureInput().click()
    },
    importFromText: (text: string) => importFromText(opts, text),
  }
}
