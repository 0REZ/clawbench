/**
 * Scroll ownership state machine + pure decision functions for the chat message list.
 *
 * Root-cause context: the chat list's auto-follow logic relied on scattered
 * `userTouching` / `isAtBottom` flags, a fixed 150ms post-touchend window, and
 * unconditional force pins. On touch devices (Android WebView) a fling keeps
 * emitting scroll events for hundreds of ms, and force pins (send message,
 * session switch) could yank the view back to the bottom while the user is
 * still scrolling — the "弹回" (snap-back) bug.
 *
 * Follow contract (what the user expects):
 * - The user has NOT deliberately scrolled away → always pin to the bottom,
 *   no matter how often or when content grows (streaming tokens, throttled
 *   render flush, lazy-loaded original text). "Did the user scroll away?"
 *   is the ONLY question that matters — no distance/grace-band heuristics.
 * - Once the user scrolls away past NEAR_BOTTOM_PX, follow stops entirely
 *   and never yanks them back — regardless of how much content arrives,
 *   until they scroll back into the near-bottom band (or switch session,
 *   or tap the bottom FAB).
 *
 * These functions are pure (no Vue/DOM) so the decision logic is unit-testable.
 */

export type ScrollOwner = 'user' | 'programmatic' | 'idle'

export interface ScrollStateInput {
  /** Who owns the scroll viewport right now. */
  owner: ScrollOwner
  /** True while a touch drag is active (touchstart … touchend). */
  userTouching: boolean
  /** Date.now() of the most recent scroll event. */
  lastScrollAt: number
  /** The current time (Date.now()) to compare against lastScrollAt. */
  now: number
  /**
   * True when the user has scrolled away from the bottom (past NEAR_BOTTOM_PX)
   * during a stream. While set, ALL follow is suppressed — a user reading
   * older content must never be yanked back to the bottom. Cleared when the
   * user scrolls back near the bottom, switches session, or taps the bottom
   * FAB. Force pins (send message, session switch) still override this so
   * intentional content-growth pins work.
   */
  userLeftBottom?: boolean
}

/** Silent window after the last scroll event before we consider scrolling "stopped". */
export const SCROLL_STOP_MS = 250
/**
 * Distance from the bottom (px) the user must scroll past before they count as
 * having "left the bottom" (deliberately scrolled away). Generous on purpose:
 * a finger twitch or half-fling must NOT flip the app out of follow mode.
 * Shared as the single source of truth by ChatMessageList (handleScroll latch,
 * scroll anchoring, array-replacement restore) and ChatPanelContent (load-more
 * anchoring).
 */
export const NEAR_BOTTOM_PX = 200

/**
 * Whether the user is currently scrolling or in a fling. True while the touch
 * is held, or while scroll events keep arriving (owner === 'user' and the last
 * event was within SCROLL_STOP_MS). A fling keeps firing scroll events, so the
 * window auto-extends for the whole fling duration.
 */
export function isUserScrolling(s: ScrollStateInput): boolean {
  if (s.userTouching) return true
  return s.owner === 'user' && s.now - s.lastScrollAt < SCROLL_STOP_MS
}

/**
 * Whether a "content grew, pin to bottom" request may execute right now.
 *
 * The only two things that stop the pin:
 * - The user is actively scrolling/flinging — never fight their hand.
 *   (Force pins are deferred, not applied.)
 * - The user has deliberately scrolled away from the bottom (userLeftBottom).
 *   They are reading older content and must never be yanked back. Only force
 *   pins (send message / session switch) still pin.
 *
 * Everything else — streaming, lazy render growth, distance from the bottom —
 * pins unconditionally. If the user never scrolled away, content growing at any
 * time must keep the view glued to the bottom.
 */
export function shouldFollowStream(s: ScrollStateInput, force: boolean): boolean {
  if (isUserScrolling(s)) return false
  if (s.userLeftBottom && !force) return false
  return true
}
