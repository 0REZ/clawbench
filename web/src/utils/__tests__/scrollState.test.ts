import { describe, expect, it } from 'vitest'
import { isUserScrolling, shouldFollowStream, SCROLL_STOP_MS, type ScrollStateInput } from '../scrollState'

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

describe('shouldFollowStream', () => {
  it('returns false while the user is scrolling even with force=true (force never overrides active scrolling)', () => {
    const now = 10000
    const input = baseInput({ owner: 'user', userTouching: false, lastScrollAt: now - 50, now })
    expect(shouldFollowStream(input, true)).toBe(false)
    // Touch held — the root cause of the snap-back bug
    expect(shouldFollowStream(baseInput({ userTouching: true }), true)).toBe(false)
  })

  it('returns true for any content growth when the user never scrolled away', () => {
    // No distance/grace-band heuristics: content growing at any time (streaming,
    // lazy render flush, async markdown) keeps the view pinned to the bottom as
    // long as the user has not deliberately left.
    expect(shouldFollowStream(baseInput({}), false)).toBe(true)
    expect(shouldFollowStream(baseInput({ owner: 'programmatic' }), false)).toBe(true)
    expect(shouldFollowStream(baseInput({ owner: 'idle' }), false)).toBe(true)
  })

  it('returns false when the user scrolled away from the bottom (no force)', () => {
    expect(shouldFollowStream(baseInput({ userLeftBottom: true }), false)).toBe(false)
  })

  it('returns true for force pins even when the user scrolled away (send message / session switch)', () => {
    expect(shouldFollowStream(baseInput({ userLeftBottom: true }), true)).toBe(true)
  })

  it('follow resumes once the user scrolls back to the bottom (userLeftBottom cleared)', () => {
    expect(shouldFollowStream(baseInput({ userLeftBottom: false }), false)).toBe(true)
  })

  it('force + userTouching never follows (hand always wins)', () => {
    expect(shouldFollowStream(baseInput({ userTouching: true }), true)).toBe(false)
  })
})
