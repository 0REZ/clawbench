import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ChatMessageList.vue only has 1 changed line: importing handleTableBlockClick
// We verify the import exists and the function is callable
describe('ChatMessageList — handleTableBlockClick integration', () => {
  it('handleTableBlockClick is exported from useCodeBlockHeader', async () => {
    const mod = await import('@/composables/useCodeBlockHeader.ts')
    expect(mod.handleTableBlockClick).toBeDefined()
    expect(typeof mod.handleTableBlockClick).toBe('function')
  })

  it('handleCodeBlockClick is still exported (existing import)', async () => {
    const mod = await import('@/composables/useCodeBlockHeader.ts')
    expect(mod.handleCodeBlockClick).toBeDefined()
    expect(typeof mod.handleCodeBlockClick).toBe('function')
  })
})

/**
 * Test for the scroll sticky抖动 (snap-back jitter) fix.
 *
 * Root cause: scrollToBottom's requestAnimationFrame correction scrolled
 * unconditionally when gap > 0, even if the user had scrolled up
 * (isAtBottom = false). A prior rAF callback would override the user's
 * scroll position, creating a fight between auto-scroll and manual scroll.
 *
 * Fix (evolved): all scroll decisions now go through the pure scroll-state
 * guards (isUserScrolling / shouldFollowStream). Force pins never override an
 * active user scroll — they are deferred until the scroll stops.
 */
describe('ChatMessageList — scroll sticky抖动 fix', () => {
  it('rAF correction is guarded against an active user scroll', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The rAF correction must not scroll while the user is scrolling.
    expect(source).toContain('if (isUserScrolling(state2)) return')
    // …and must not follow once the user has scrolled away (non-force).
    expect(source).toContain('shouldFollowStream(state2, force)')
  })

  it('scrollToBottom returns early when the user is scrolling (touch drag)', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The guard is the unified isUserScrolling check, not a raw userTouching flag.
    expect(source).toContain('if (isUserScrolling(state()))')
    expect(source).not.toContain('if (userTouching && !force) return')
  })

  it('scrollToBottom with force=true defers the pin while the user is scrolling', async () => {
    // New semantic: force=true no longer overrides an active user scroll.
    // The pin is deferred (pendingFollow) and flushed only after the scroll
    // stops — never while the user's finger is on the screen.
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // scrollToBottom must consult isUserScrolling before pinning
    expect(source).toContain('isUserScrolling(state())')
    // A force pin during a user scroll is deferred, not applied
    expect(source).toMatch(/if \(isUserScrolling\(state\(\)\)\) \{\s*if \(force\) pendingFollow = true/)
    // The old "force overrides userTouching" check must be gone
    expect(source).not.toContain('if (userTouching && !force) return')
  })
})

describe('ChatMessageList — ensure-content event pass-through', () => {
  it('ChatMessageList source defines ensure-content emit', async () => {
    // Verify the emit is defined by reading the raw source
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toContain("'ensure-content'")
  })
})

/**
 * Tests for the unified scroll-state refactor.
 *
 * Old behavior: force=true pins unconditionally (rAF + setTimeout(300)
 * corrections had no user-scrolling guard) — on touch devices a force pin
 * during a fling yanked the view back to the bottom ("弹回" snap-back).
 *
 * New behavior:
 * - force=true means "content grew, pin to bottom", but NEVER overrides an
 *   active user scroll — the pin is deferred (pendingFollow) and flushed by
 *   onScrollStopped only if the user is still near the bottom.
 * - All decisions read live container geometry instead of the cached
 *   isAtBottom ref.
 * - The unconditional setTimeout(300) force pin is removed.
 * - Array replacement (loadHistory) anchors the viewport to the first visible
 *   message when the user is not at the bottom.
 */
describe('ChatMessageList — force pin is guarded by user scrolling', () => {
  it('scrollToBottom computes distance live and consults the scroll-state guards', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // Live geometry, not the cached isAtBottom ref
    expect(source).toContain('const dist = el.scrollHeight - el.scrollTop - el.clientHeight')
    // Guards imported from the pure module
    expect(source).toContain('isUserScrolling(state())')
    expect(source).toContain('shouldFollowStream(state(), force)')
  })
  it('force pin is deferred (pendingFollow) while the user is scrolling, not applied', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toMatch(/if \(isUserScrolling\(state\(\)\)\) \{\s*if \(force\) pendingFollow = true\s*return\s*\}/)
  })

  it('onScrollStopped clears pendingFollow unconditionally and flushes only near the bottom', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // onScrollStopped resets ownership and clears the deferred flag no matter what
    expect(source).toContain('function onScrollStopped()')
    // pendingFollow is always cleared here — stale pins never fire later
    expect(source).toMatch(/if \(pendingFollow\) \{\s*pendingFollow = false\s*if \(dist <= NEAR_EDGE_THRESHOLD\) \{\s*scrollToBottom\(true\)/)
    expect(source).toContain('setProgrammatic(false)')
  })

  it('the unconditional force setTimeout(300) pin is removed', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // No 300ms force pin timer anywhere (the old `}, 300)` was too loose)
    expect(source).not.toMatch(/setTimeout\([^)]*300\)/)
  })

  it('scroll-stop detection replaces the fixed 150ms touchend window', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toContain('setTimeout(onScrollStopped, SCROLL_STOP_MS)')
    expect(source).not.toContain('setTimeout(() => { userTouching = false }, 150)')
  })

  it('message array replacement anchors the viewport when not at the bottom', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toContain('captureAnchor(el)')
    expect(source).toContain('restoreAnchor(messagesRef.value, scrollAnchor)')
  })

  it('programmatic scrolling maps to the programmatic owner', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toContain("scrollOwner.value = val ? 'programmatic' : 'idle'")
  })
})

/**
 * Tests for the DOM reconciliation key fix (listKey).
 *
 * Root cause: when a transient message's id changes from string (pending-xxx)
 * to numeric (DB id) — e.g. after loadHistory or queue_drain — the v-for key
 * changes but Vue's patch may leave a stale DOM node behind in certain WebView
 * /GPU compositor states. This produces the "duplicate message" visual artifact
 * that survives refresh (because the data layer is clean) and only clears on
 * app restart (because restart recreates the DOM from scratch).
 *
 * Fix: the .chat-messages-list container now uses a structural key
 * (listKey) that changes whenever the message array is replaced or reshuffled
 * by rebuildFromDb, forcing Vue to unmount and remount the entire list.
 */
describe('ChatMessageList — DOM reconciliation key (listKey)', () => {
  it('uses a structural listKey instead of bare session id', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The container key must reference listKey, not the raw session id
    expect(source).toContain(':key="listKey"')
    expect(source).not.toContain(":key=\"currentSessionId || 'no-session'\"")
  })

  it('listKey includes session id, message count, and first/last message id', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // listKey must be a computed that concatenates these segments
    expect(source).toContain('const listKey = computed')
    expect(source).toContain('props.currentSessionId')
    expect(source).toContain('msgs.length')
    expect(source).toContain('msgs[0]?.id')
    expect(source).toContain('msgs[msgs.length - 1]?.id')
  })
})

/**
 * Tests for the stream-follow persistence fix.
 *
 * Root cause: a single throttled render flush (ContentBlocks.vue, 300ms) can
 * grow scrollHeight far beyond STREAM_FOLLOW_GRACE_PX in one frame when a burst
 * of tokens arrives at once. scrollToBottom's static distance check then rejects
 * the follow (gap > grace band) and the viewport is never pulled down again —
 * every later flush re-reads an even larger gap, so follow is lost permanently.
 *
 * Fix: follow is decided by live geometry + a "user left the bottom" latch.
 * - While the viewport is at the bottom, streamed content follows (with a
 *   grace band that absorbs render-flush height jumps).
 * - The moment the user scrolls away from the bottom (past NEAR_EDGE_THRESHOLD),
 *   userLeftBottom latches on and ALL follow is suppressed — a user reading
 *   older content is never yanked back, regardless of how much arrives.
 * - userLeftBottom clears only when the user scrolls back to the bottom.
 */
describe('ChatMessageList — stream-follow persistence', () => {
  it('scrollToBottom consults the geometry + userLeftBottom state', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The follow decision feeds the latched "user left" flag
    expect(source).toContain('userLeftBottom,')
  })

  it('a user who scrolls away from the bottom is never yanked back (userLeftBottom)', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // Leaving the bottom past the near-edge threshold latches the "left" flag
    expect(source).toContain('if (distFromBottom > NEAR_EDGE_THRESHOLD) {')
    expect(source).toContain('userLeftBottom = true')
    // Returning to the bottom clears it
    expect(source).toContain('userLeftBottom = false')
  })

  it('session switch resets the follow latch', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toContain('userLeftBottom = false')
  })
})

/**
 * Tests for the per-session scroll position memory.
 *
 * Root cause: switching sessions always force-scrolled to the bottom
 * (loadHistory(true)), discarding the user's reading position in the previous
 * session. The message list DOM is rebuilt on session switch (listKey contains
 * the session id), so the browser's scrollTop is lost.
 *
 * Fix:
 * - The currentSessionId watcher remembers the old session's scrollTop when
 *   the user left it scrolled away from the bottom; a session left at the
 *   bottom is forgotten so switching back uses the default scroll-to-bottom.
 * - The listKey watcher restores the remembered position (nextTick + rAF, so
 *   scrollHeight is settled) when switching back to a remembered session.
 */
describe('ChatMessageList — per-session scroll position memory', () => {
  it('saves the old session position when the user left it away from the bottom', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The session-switch watcher reads the old DOM's live distance before teardown
    expect(source).toContain('saveChatScrollPosition(oldSid, el.scrollTop)')
    expect(source).toContain('dist > NEAR_EDGE_THRESHOLD')
  })

  it('forgets a session left at the bottom (default scroll-to-bottom on return)', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toContain('clearChatScrollPosition(oldSid)')
  })

  it('flags the target session for restore on switch, executed by the messages watcher', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The session-switch watcher flags the target when it has a remembered
    // position (explicit state, not oldKey segment comparison — Vue's watcher
    // oldValue is "previous flush value", so a listKey-segment check silently
    // suppresses the restore).
    expect(source).toContain('pendingRestoreSessionId')
    expect(source).toContain('getChatScrollPosition(newSid) != null')
    // The restore executes in the messages watcher once history landed and
    // only for the flagged session (same-session growth never flags it).
    expect(source).toContain('pendingRestoreSessionId === props.currentSessionId')
    expect(source).toContain('requestAnimationFrame')
    expect(source).toContain('Math.min(savedPos, maxTop)')
    // Ultra-fast B→C switch: the rAF restore must not apply B's position to
    // C's DOM — it bails when the session changed before the rAF fired.
    expect(source).toContain('props.currentSessionId !== restoredSid')
  })

  it('does NOT restore on same-session message growth (send/stream must scroll to bottom)', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // Sending a message grows the array but currentSessionId never changes, so
    // the restore flag is not set — the restore bails and the intended
    // force-scroll-to-bottom after send is never overridden.
    expect(source).toMatch(/pendingRestoreSessionId = newSid && getChatScrollPosition\(newSid\) != null \? newSid : null/)
  })
})

/**
 * Lazy-load hint floating overlay.
 *
 * The "还有 N 条更早消息 / 加载中 / 已加载全部" pill must float above the top of
 * the message area, not live inside the scrolling message flow. It was moved
 * out of .chat-messages (the scroll container) into .chat-messages-wrapper and
 * positioned absolutely, so it:
 *   - never scrolls with the message flow,
 *   - takes no layout space (does not push messages down),
 *   - renders with a backdrop background so it reads as a floating pill.
 */
describe('ChatMessageList — floating lazy-load hint overlay', () => {
  it('chat-load-area lives outside the scroll container (absolute overlay)', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // .chat-load-area must be a sibling of .chat-messages, not its child.
    expect(source).toContain('class="chat-messages-wrapper">')
    expect(source).toContain('class="chat-load-area"')
    // The scroll container must open after the load area closes.
    const loadAreaIdx = source.indexOf('class="chat-load-area"')
    const messagesIdx = source.indexOf('class="chat-messages"')
    expect(loadAreaIdx).toBeGreaterThan(-1)
    expect(messagesIdx).toBeGreaterThan(loadAreaIdx)
    // The load area must be absolutely positioned (no layout footprint).
    expect(source).toMatch(/\.chat-load-area \{[^}]*position: absolute/s)
  })

  it('the pill states carry a backdrop background so they read as floating', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    expect(source).toMatch(/\.chat-load-more,\s*\.chat-load-hint,\s*\.chat-load-done \{/)
    expect(source).toContain('border-radius: 999px')
    // backdrop background: the pill is not transparent text in the flow anymore
    expect(source).toContain('background: color-mix')
  })
})

/**
 * Transient "more older messages" hint.
 *
 * The "还有 N 条更早消息" pill must NOT be a persistent resident of the message
 * area. Whenever older messages remain it briefly appears (including on first
 * render of a session that still has history to load) then auto-hides after a
 * timeout. Once all history is loaded it hides immediately so the "all loaded"
 * hint can take over.
 */
describe('ChatMessageList — transient more-messages hint', () => {
  it('the more-messages hint is gated by a showMoreHint state, not hasMore alone', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The hint branch must be driven by the transient showMoreHint flag —
    // hasMore must no longer be the standalone gate that keeps it resident.
    expect(source).toMatch(/v-else-if="showMoreHint"/)
    expect(source).not.toMatch(/v-else-if="hasMore && remainingCount > 0"/)
  })

  it('showMoreHint is armed whenever older messages remain and auto-hides on a timer', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // Armed from a watch over (hasMore && remainingCount > 0), so it announces
    // remaining history on first render too — not just after an explicit load.
    expect(source).toMatch(/watch\(\(\) => props\.hasMore && remainingCount\.value > 0/)
    expect(source).toContain("{ immediate: true }")
    // Auto-hide via a timeout (2.5s); re-arming clears the in-flight timer.
    expect(source).toContain('moreHintTimer = setTimeout')
    expect(source).toMatch(/clearTimeout\(moreHintTimer\)/)
    expect(source).toMatch(/showMoreHint\.value = false/)
  })

  it('hides immediately when all history is loaded (lets the all-loaded hint show)', async () => {
    const mod = await import('@/components/chat/ChatMessageList.vue?raw')
    const source = typeof mod.default === 'string' ? mod.default : ''
    // The watch else-branch hides the hint once remaining count drops to zero.
    expect(source).toMatch(/if \(hasRemaining\) \{[\s\S]*?showMoreHint\.value = true/)
    expect(source).toMatch(/else \{[\s\S]*?showMoreHint\.value = false/)
  })
})
