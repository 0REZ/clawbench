import { describe, expect, it } from 'vitest'
import { isUserScrolling, shouldPin, SCROLL_STOP_MS, RESUME_FOLLOW_PX, updateUserLeftBottom, type ScrollStateInput } from '../scrollState'

function baseInput(overrides: Partial<ScrollStateInput> = {}): ScrollStateInput {
  return {
    owner: 'idle',
    userTouching: false,
    lastScrollAt: 0,
    now: 0,
    ...overrides,
  }
}

describe('isUserScrolling', () => {
  it('returns true while the user is touching/dragging', () => {
    expect(isUserScrolling(baseInput({ userTouching: true }))).toBe(true)
  })

  it('returns true when owner=user and last scroll event was within the stop window', () => {
    const now = 10000
    expect(isUserScrolling(baseInput({ owner: 'user', lastScrollAt: now - 100, now }))).toBe(true)
    // Fling keeps firing scroll events — window auto-extends
    expect(isUserScrolling(baseInput({ owner: 'user', lastScrollAt: now - SCROLL_STOP_MS + 1, now }))).toBe(true)
  })

  it('returns false when the last scroll event is older than the stop window', () => {
    const now = 10000
    expect(isUserScrolling(baseInput({ owner: 'user', lastScrollAt: now - SCROLL_STOP_MS - 1, now }))).toBe(false)
  })

  it('returns false when owner is not user (idle/programmatic) and no touch', () => {
    const now = 10000
    expect(isUserScrolling(baseInput({ owner: 'idle', lastScrollAt: now - 10, now }))).toBe(false)
    expect(isUserScrolling(baseInput({ owner: 'programmatic', lastScrollAt: now - 10, now }))).toBe(false)
  })

  it('returns true for userTouching regardless of owner (touch takes priority)', () => {
    expect(isUserScrolling(baseInput({ owner: 'programmatic', userTouching: true }))).toBe(true)
    expect(isUserScrolling(baseInput({ owner: 'idle', userTouching: true }))).toBe(true)
  })

  it('boundary: exactly SCROLL_STOP_MS since the last scroll is NOT scrolling (strict <)', () => {
    const now = 10000
    expect(isUserScrolling(baseInput({ owner: 'user', lastScrollAt: now - SCROLL_STOP_MS, now }))).toBe(false)
  })
})

describe('shouldPin', () => {
  it('returns false while the user is scrolling even with force=true (force never overrides active scrolling)', () => {
    const now = 10000
    const input = baseInput({ owner: 'user', userTouching: false, lastScrollAt: now - 50, now })
    expect(shouldPin(input, true)).toBe(false)
    // Touch held — the root cause of the snap-back bug
    expect(shouldPin(baseInput({ userTouching: true }), true)).toBe(false)
  })

  it('returns true for any content growth when the user never scrolled away', () => {
    // No distance/grace-band heuristics: content growing at any time (streaming,
    // lazy render flush, async markdown) keeps the view pinned to the bottom as
    // long as the user has not deliberately left.
    expect(shouldPin(baseInput({}), false)).toBe(true)
    expect(shouldPin(baseInput({ owner: 'programmatic' }), false)).toBe(true)
    expect(shouldPin(baseInput({ owner: 'idle' }), false)).toBe(true)
  })

  it('returns false when the user scrolled away from the bottom (no force)', () => {
    expect(shouldPin(baseInput({ userLeftBottom: true }), false)).toBe(false)
  })

  it('returns true for force pins even when the user scrolled away (send message / session switch)', () => {
    expect(shouldPin(baseInput({ userLeftBottom: true }), true)).toBe(true)
  })

  it('follow resumes once the user scrolls back to the bottom (userLeftBottom cleared)', () => {
    expect(shouldPin(baseInput({ userLeftBottom: false }), false)).toBe(true)
  })

  it('force + userTouching never follows (hand always wins)', () => {
    expect(shouldPin(baseInput({ userTouching: true }), true)).toBe(false)
  })
})

describe('updateUserLeftBottom', () => {
  it('any upward drag latches the latch, regardless of distance from the bottom', () => {
    // The core of the snap-back fix: a user who stops mid-drag inside the
    // near-bottom band (dist <= NEAR_BOTTOM_PX) must still count as having
    // left, or the next streamed pin would yank them back to the bottom.
    expect(updateUserLeftBottom(false, { scrollingUp: true, distFromBottom: 0 })).toBe(true)
    expect(updateUserLeftBottom(false, { scrollingUp: true, distFromBottom: 100 })).toBe(true)
    expect(updateUserLeftBottom(false, { scrollingUp: true, distFromBottom: 500 })).toBe(true)
  })

  it('an upward drag keeps the latch locked when already locked', () => {
    expect(updateUserLeftBottom(true, { scrollingUp: true, distFromBottom: 800 })).toBe(true)
    expect(updateUserLeftBottom(true, { scrollingUp: true, distFromBottom: 10 })).toBe(true)
  })

  it('scrolling back within RESUME_FOLLOW_PX of the bottom unlocks follow', () => {
    // Returning to the bottom is an explicit gesture — the unlock band is the
    // tight RESUME_FOLLOW_PX, not the generous NEAR_BOTTOM_PX.
    expect(updateUserLeftBottom(true, { scrollingUp: false, distFromBottom: 0 })).toBe(false)
    expect(updateUserLeftBottom(true, { scrollingUp: false, distFromBottom: RESUME_FOLLOW_PX })).toBe(false)
  })

  it('resting inside the old NEAR_BOTTOM_PX band but outside RESUME_FOLLOW_PX stays locked', () => {
    // This is the exact case the old distance-only latch got wrong: dist=150 is
    // <= NEAR_BOTTOM_PX (200) but > RESUME_FOLLOW_PX (50). A non-upward scroll
    // there must NOT unlock, otherwise a streamed pin re-yanks the user.
    expect(updateUserLeftBottom(true, { scrollingUp: false, distFromBottom: 150 })).toBe(true)
    expect(updateUserLeftBottom(false, { scrollingUp: false, distFromBottom: 150 })).toBe(false)
  })

  it('downward scrolls elsewhere leave the latch unchanged', () => {
    expect(updateUserLeftBottom(false, { scrollingUp: false, distFromBottom: 500 })).toBe(false)
    expect(updateUserLeftBottom(true, { scrollingUp: false, distFromBottom: 500 })).toBe(true)
  })

  it('a custom resumePx overrides the default unlock band', () => {
    expect(updateUserLeftBottom(true, { scrollingUp: false, distFromBottom: 40, resumePx: 50 })).toBe(false)
    expect(updateUserLeftBottom(true, { scrollingUp: false, distFromBottom: 60, resumePx: 50 })).toBe(true)
  })
})
