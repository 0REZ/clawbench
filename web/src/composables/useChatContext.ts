import { ref } from 'vue'
import type { FileEntry } from '@/utils/fileAttachmentUtils'

export interface QuoteData {
  text: string
  filePath: string
  language: string
  startLine: number
  endLine: number
}

export interface StagedQuote extends QuoteData {
  id: string
  note: string
}

// ───────────────────────────────────────────────────────────
// Module-level singleton state — shared across the whole app.
// useChatContext unifies "context sent to chat" from any tab:
//   - attachedFiles: files to include as context
//   - quoteData: code selection referenced from file preview
// ───────────────────────────────────────────────────────────

const attachedFiles = ref<FileEntry[]>([])
const quoteData = ref<QuoteData | null>(null)
const stagedQuotes = ref<StagedQuote[]>([])
let quoteId = 0

// ── Per-session attachment draft ──
// Mirrors ChatInputBar's draftCache for text: when switching sessions, the
// current session's attached files + staged quotes are snapshotted here and
// restored when the user switches back. Without this, attachments vanish on
// session switch while the typed text survives (see ChatInputBar draftCache).
interface AttachmentSnapshot {
  files: FileEntry[]
  quotes: StagedQuote[]
  quote: QuoteData | null
}

const attachmentDrafts = new Map<string, AttachmentSnapshot>()

function addAttachedFile(path: string, isDir: boolean = false, startLine?: number, endLine?: number) {
  if (!path) return
  const existing = attachedFiles.value.find(f => f.path === path)
  if (existing) {
    // Upgrade with line info if the existing entry lacks it
    if (startLine !== undefined && existing.startLine === undefined) {
      existing.startLine = startLine
      existing.endLine = endLine
    }
    return
  }
  attachedFiles.value.push({ path, isDir, startLine, endLine })
}

function removeAttachedFile(index: number) {
  attachedFiles.value.splice(index, 1)
}

function removeAttachedFileByPath(path: string) {
  const idx = attachedFiles.value.findIndex(f => f.path === path)
  if (idx >= 0) attachedFiles.value.splice(idx, 1)
}

function toggleAttachedFile(path: string, isDir: boolean = false) {
  if (!path) return
  const idx = attachedFiles.value.findIndex(f => f.path === path)
  if (idx >= 0) {
    attachedFiles.value.splice(idx, 1)
  } else {
    attachedFiles.value.push({ path, isDir })
  }
}

function hasAttachedFile(path: string): boolean {
  return attachedFiles.value.some(f => f.path === path)
}

function setQuoteData(data: QuoteData | null) {
  quoteData.value = data
}

function sameQuote(a: QuoteData, b: QuoteData): boolean {
  return a.filePath === b.filePath
    && a.startLine === b.startLine
    && a.endLine === b.endLine
    && a.text === b.text
}

function addStagedQuote(data: QuoteData, note = ''): StagedQuote {
  const normalizedNote = note.trim()
  const existing = stagedQuotes.value.find(item => sameQuote(item, data))
  if (existing) {
    if (normalizedNote) existing.note = normalizedNote
    return existing
  }

  const item: StagedQuote = {
    ...data,
    id: `quote-${Date.now()}-${++quoteId}`,
    note: normalizedNote,
  }
  stagedQuotes.value.push(item)
  return item
}

function removeStagedQuote(id: string) {
  const index = stagedQuotes.value.findIndex(item => item.id === id)
  if (index >= 0) stagedQuotes.value.splice(index, 1)
}

function clearQuotes() {
  quoteData.value = null
  stagedQuotes.value = []
}

function clearAll() {
  attachedFiles.value = []
  clearQuotes()
}

/**
 * Snapshot the current input attachments + staged quotes under a session id.
 * Called before switching away — the snapshot is restored when the user
 * switches back to that session.
 */
function snapshotAttachments(sessionId: string) {
  if (!sessionId) return
  attachmentDrafts.set(sessionId, {
    files: attachedFiles.value.map(f => ({ ...f })),
    quotes: stagedQuotes.value.map(q => ({ ...q })),
    quote: quoteData.value ? { ...quoteData.value } : null,
  })
}

/**
 * Restore a previously snapshotted attachment draft for the given session.
 * Overwrites the current input state (call right after switching in).
 */
function restoreAttachments(sessionId: string) {
  if (!sessionId) return
  const snap = attachmentDrafts.get(sessionId)
  if (!snap) return
  attachedFiles.value = snap.files.map(f => ({ ...f }))
  stagedQuotes.value = snap.quotes.map(q => ({ ...q }))
  quoteData.value = snap.quote ? { ...snap.quote } : null
}

/** Drop the attachment draft for a session (e.g. when the session is destroyed). */
function discardAttachmentDraft(sessionId: string) {
  if (sessionId) attachmentDrafts.delete(sessionId)
}

export function useChatContext() {
  return {
    attachedFiles,
    quoteData,
    stagedQuotes,
    addAttachedFile,
    removeAttachedFile,
    removeAttachedFileByPath,
    toggleAttachedFile,
    hasAttachedFile,
    setQuoteData,
    addStagedQuote,
    removeStagedQuote,
    clearQuotes,
    clearAll,
    snapshotAttachments,
    restoreAttachments,
    discardAttachmentDraft,
  }
}
