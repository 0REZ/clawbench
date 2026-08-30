/**
 * Scroll ownership state machine + pure decision functions for the chat message list.
 *
 * Contract (what the user expects):
 * - The user has NOT deliberately scrolled away → always pin to the bottom,
 *   no matter how often or when content grows (streaming tokens, throttled
 *   render flush, lazy-loaded original text).
 * - Any upward drag latches "left the bottom" immediately (direction-driven,
 *   distance-independent). While latched, streamed pins never yank the user
 *   back — no matter how much content arrives — until they scroll back to
 *   within RESUME_FOLLOW_PX of the bottom (an explicit return).
 * - Force pins (send message, session switch) override the "left the bottom"
 *   latch — those are explicit user actions expecting to see the bottom — but
 *   never override an actively-scrolling hand.
 *
 * All decision logic is pure (no Vue/DOM) so it is unit-testable.
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
   * True when the user has deliberately scrolled away from the bottom during a
   * stream. While set, non-force pins are suppressed — a user reading older
   * content must never be yanked back to the bottom. Cleared when the user
   * scrolls back to within RESUME_FOLLOW_PX of the bottom, switches session,
   * or taps the bottom FAB.
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
 * Distance from the bottom (px) the user must scroll BACK to before stream
 * follow resumes after they deliberately scrolled away. Deliberately small:
 * while "leaving the bottom" is a one-way latch (any upward drag locks follow
 * off immediately — see updateUserLeftBottom), "returning to the bottom" is an
 * explicit gesture, so the unlock band is only as wide as a natural
 * swipe-back-to-bottom lands in (≈2–3 text lines). A wide band here would
 * re-introduce the snap-back jitter: the user resting anywhere inside it during
 * a stream would get yanked to the bottom again.
 */
export const RESUME_FOLLOW_PX = 50

/**
 * User intent latched from a scroll event: decides whether the user has
 * "left the bottom" of the chat.
 *
 * Two ways to flip the latch:
 * - Any upward drag (scrollingUp) IMMEDIATELY sets it — the user is trying to
 *   read older content, and a streamed pin must never fight them. Unlike the
 *   old behavior (latch only past NEAR_BOTTOM_PX), distance is irrelevant here:
 *   a user who stops mid-drag inside the near-bottom band stays locked, so the
 *   streamed pin can't yank them (the "很难拖上去、抽搐" snap-back bug).
 * - Scrolling back to within RESUME_FOLLOW_PX of the bottom clears it — the
 *   user has explicitly returned and expects follow to resume.
 *
 * Anything else (downward drag mid-list, content-growth scroll, programmatic
 * jumps) leaves the latch unchanged.
 */
export function updateUserLeftBottom(
  current: boolean,
  args: {
    /** True when the scroll event moved toward the top (scrollTop decreased). */
    scrollingUp: boolean
    /** Distance from the bottom at the moment of the scroll event. */
    distFromBottom: number
    /** Unlock band width; defaults to RESUME_FOLLOW_PX. */
    resumePx?: number
  },
): boolean {
  if (args.scrollingUp) return true
  if (args.distFromBottom <= (args.resumePx ?? RESUME_FOLLOW_PX)) return false
  return current
}

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
 * Whether a "pin to bottom" request may execute right now.
 *
 * Two things stop a pin:
 * - The user is actively scrolling/flinging — never fight their hand. This
 *   applies to BOTH force and non-force pins; a force pin is deferred until the
 *   scroll stops rather than applied over the user's finger.
 * - The user has deliberately scrolled away from the bottom (userLeftBottom).
 *   They are reading older content and must never be yanked back — unless this
 *   is a force pin (send message / session switch), which is an explicit user
 *   action that expects to see the bottom.
 *
 * Everything else — streaming, lazy render growth, distance from the bottom —
 * pins unconditionally. If the user never scrolled away, content growing at any
 * time must keep the view glued to the bottom.
 */
export function shouldPin(s: ScrollStateInput, force: boolean): boolean {
  if (isUserScrolling(s)) return false
  if (s.userLeftBottom && !force) return false
  return true
}
