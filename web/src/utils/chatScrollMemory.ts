/**
 * Per-session chat scroll position memory.
 *
 * When the user switches away from a session, the message list DOM is rebuilt
 * (listKey contains the session id), so the browser's scrollTop is lost. This
 * module remembers the scroll position of every session the user left while
 * NOT at the bottom, so switching back can restore the reading position.
 *
 * Contract (what the user expects):
 * - A session left while at the bottom is NOT remembered — switching back
 *   falls back to the default scroll-to-bottom behavior (new content view).
 * - A session left while scrolled away from the bottom IS remembered, and
 *   switching back restores that exact position.
 * - Memory is in-memory only (session lifetime); no persistence across app
 *   restarts, matching the existing scroll behavior.
 */
const memory = new Map<string, number>()

/** Remember a session's scrollTop (only call when the user is NOT at the bottom). */
export function saveChatScrollPosition(sessionId: string, scrollTop: number): void {
  memory.set(sessionId, scrollTop)
}

/** Forget a session's remembered position (user left it at the bottom). */
export function clearChatScrollPosition(sessionId: string): void {
  memory.delete(sessionId)
}

/** Whether the session has a remembered scroll position. */
export function hasChatScrollPosition(sessionId: string): boolean {
  return memory.has(sessionId)
}

/** The remembered scrollTop for a session, or undefined. */
export function getChatScrollPosition(sessionId: string): number | undefined {
  return memory.get(sessionId)
}
