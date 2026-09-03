import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  chatMessageReducer,
  rebuildFromDb,
  messageSortValue,
  type ChatMessage,
  type ChatMessageAction,
} from '@/utils/chatStreamUtils.ts'

/** Apply a sequence of actions, returning the final state. */
function run(state: ChatMessage[], actions: ChatMessageAction[]): ChatMessage[] {
  let s = state
  for (const a of actions) {
    s = chatMessageReducer(s, a)
  }
  return s
}

const u = (partial: Partial<ChatMessage> & { id: unknown }): ChatMessage => ({
  role: 'user',
  content: '',
  blocks: [],
  files: [],
  createdAt: '',
  ...partial,
} as ChatMessage)

const a = (partial: Partial<ChatMessage> & { id: unknown }): ChatMessage => ({
  role: 'assistant',
  content: '',
  blocks: [],
  createdAt: '',
  ...partial,
} as ChatMessage)

describe('chatMessageReducer — optimistic + structural', () => {
  it('optimistic_push then optimistic_remove', () => {
    const state = run([], [
      { type: 'optimistic_push', msg: u({ id: 'pending-1', content: '1', pending: true, seq: 1 }) },
    ])
    expect(state).toHaveLength(1)
    expect(state[0].pending).toBe(true)

    const after = run(state, [{ type: 'optimistic_remove', id: 'pending-1' }])
    expect(after).toHaveLength(0)
  })

  it('optimistic_remove_content removes only the matching pending message', () => {
    const state = run(
      [
        u({ id: 'a', content: 'earlier', pending: true, seq: 1 }),
        u({ id: 'b', content: 'hello', pending: true, seq: 2 }),
      ],
      [{ type: 'optimistic_remove_content', content: 'hello' }],
    )
    expect(state).toHaveLength(1)
    expect(state[0].content).toBe('earlier')
  })

  it('optimistic_adopt_id adopts DB id and sorts by id (not seq space)', () => {
    // A directly-sent bubble (sendMessageNow) learns its DB id from the
    // user_message self-echo. Its DB id IS its real conversational position
    // (send order = persist order), so it sorts by id alongside history —
    // NOT in seq space where it would interleave with queued/remote messages
    // by client receive order. Old id preserved as queueId for reply anchors.
    const state = run(
      [
        u({ id: 'pending-1', content: '1', seq: 1 }),
        u({ id: 'pending-2', content: '2', pending: true, seq: 2 }),
      ],
      [{ type: 'optimistic_adopt_id', id: 'pending-1', dbId: 10 }],
    )
    const msg1 = state.find((m) => m.role === 'user' && m.content === '1')
    expect(msg1?.id).toBe(10)
    expect(msg1?.queueId).toBe('pending-1')
    expect(msg1?.pending).toBeUndefined()
    expect(msg1?.seq).toBeUndefined()
    // Sorts by DB id, not by seq — the queued msg2 stays in seq space (huge).
    expect(messageSortValue(msg1!)).toBe(10)
    expect(messageSortValue(msg1!)).toBeLessThan(messageSortValue(state.find((m) => m.content === '2')!))
  })

  it('optimistic_adopt_id does NOT adopt a pending (queued) bubble', () => {
    // A queued message is still waiting for the drain loop; the drain event
    // carries its authoritative id and clears pending. Adopting early would
    // flip it to a normal message (losing the "queuing" UI state).
    const state = run(
      [{ id: 'pending-2', role: 'user', content: '2', pending: true, seq: 2 } as ChatMessage],
      [{ type: 'optimistic_adopt_id', id: 'pending-2', dbId: 10 }],
    )
    const msg2 = state.find((m) => m.content === '2')
    expect(msg2?.id).toBe('pending-2')
    expect(msg2?.pending).toBe(true)
  })

  it('clear_pending removes only pending messages', () => {
    const state = run([u({ id: 1, content: 'done' }), u({ id: 'p2', pending: true, seq: 1 })], [
      { type: 'clear_pending' },
    ])
    expect(state.map((m) => m.id)).toEqual([1])
  })

  it('clear empties the array', () => {
    const state = run([u({ id: 1 })], [{ type: 'clear' }])
    expect(state).toHaveLength(0)
  })

  it('prepend_older puts older messages first and re-sorts', () => {
    const state = run([u({ id: 3, content: 'newer' })], [
      { type: 'prepend_older', olderMsgs: [u({ id: 1, content: 'older' }), u({ id: 2, content: 'mid' })] },
    ])
    expect(state.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('prepend_older dedups rows already present — a raced full-history page cannot double the conversation', () => {
    // Reported AABBCC duplicate: a loadMore fired while the array was empty
    // sent an invalid before_id, so the backend returned the FULL already-loaded
    // history; prepend_older then prepended a copy of every message (AABBCC).
    // The reducer must drop any incoming row whose id already exists.
    const state = run(
      [
        u({ id: 38954, content: 'A' }),
        a({ id: 38955, content: 'A reply' }),
        u({ id: 38960, content: 'B' }),
        a({ id: 38961, content: 'B reply' }),
        u({ id: 38966, content: 'C' }),
        a({ id: 38967, content: 'C reply' }),
      ],
      [
        {
          type: 'prepend_older',
          olderMsgs: [
            u({ id: 38954, content: 'A' }),
            a({ id: 38955, content: 'A reply' }),
            u({ id: 38960, content: 'B' }),
            a({ id: 38961, content: 'B reply' }),
            u({ id: 38966, content: 'C' }),
            a({ id: 38967, content: 'C reply' }),
          ],
        },
      ],
    )
    expect(state.map((m) => m.id)).toEqual([38954, 38955, 38960, 38961, 38966, 38967])
    expect(state).toHaveLength(6)
  })

  it('prepend_older still prepends genuinely older rows when mixed with duplicates', () => {
    const state = run(
      [u({ id: 38954, content: 'loaded' }), a({ id: 38955, content: 'reply' })],
      [
        {
          type: 'prepend_older',
          olderMsgs: [
            u({ id: 38950, content: 'genuinely older' }),
            a({ id: 38951, content: 'older reply' }),
            u({ id: 38954, content: 'already loaded duplicate' }),
          ],
        },
      ],
    )
    // Only the genuinely older rows (38950, 38951) are prepended; 38954 skipped.
    expect(state.map((m) => m.id)).toEqual([38950, 38951, 38954, 38955])
  })
})

describe('chatMessageReducer — WS block-level events', () => {
  it('ws_content accumulates into the streaming message', () => {
    const sm = a({ id: 'drain-1', streaming: true, seq: 1 })
    const state = run([sm], [
      { type: 'ws_content', text: 'hel' },
      { type: 'ws_content', text: 'lo' },
    ])
    expect(sm.blocks![0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('ws_content ignores when no streaming message', () => {
    const state = run([u({ id: 1 })], [{ type: 'ws_content', text: 'x' }])
    expect(state).toHaveLength(1)
    expect(state[0].blocks).toEqual([])
  })

  it('ws_thinking accumulates and ws_thinking_done marks done', () => {
    const sm = a({ id: 'drain-1', streaming: true, seq: 1 })
    const state = run([sm], [
      { type: 'ws_thinking', text: 'think', key: 'k1' },
      { type: 'ws_thinking', text: 'ing', key: 'k1' },
      { type: 'ws_thinking_done' },
    ])
    const t = sm.blocks!.find((b) => b.type === 'thinking')!
    expect(t.text).toBe('thinking')
    expect(t.done).toBe(true)
  })

  it('ws_content_reset clears blocks', () => {
    const sm = a({ id: 'drain-1', streaming: true, blocks: [{ type: 'text', text: 'x' }], seq: 1 })
    run([sm], [{ type: 'ws_content_reset' }])
    expect(sm.blocks).toEqual([])
  })

  it('ws_tool_use + ws_tool_result mark tool blocks done', () => {
    const sm = a({ id: 'drain-1', streaming: true, seq: 1 })
    run([sm], [
      { type: 'ws_tool_use', data: { id: 't1', name: 'Read', input: { path: '/a' } } },
      { type: 'ws_tool_result', data: { id: 't1', name: 'Read', status: 'success' } },
    ])
    const tb = sm.blocks!.find((b) => b.type === 'tool_use')!
    expect(tb.done).toBe(true)
    expect(tb.status).toBe('success')
  })
})

describe('chatMessageReducer — ws_queue_cancel', () => {
  it('removes pending bubbles by id and by queueId field', () => {
    const state = run(
      [u({ id: 'p1', pending: true, seq: 1 }), u({ id: 5, queueId: 'p2', pending: true, seq: 2 }), u({ id: 9 })],
      [{ type: 'ws_queue_cancel', queueIds: ['p1', 'p2'] }],
    )
    expect(state.map((m) => m.id)).toEqual([9])
  })

  it('removes cross-device _remote bubbles by _remoteQueueId', () => {
    const state = run(
      [
        u({ id: 'p1', pending: true, seq: 1 }),
        u({ id: 'remote-123', _remote: true, _remoteQueueId: 'p2', content: 'from other device', seq: 2 }),
        u({ id: 9 }),
      ],
      [{ type: 'ws_queue_cancel', queueIds: ['p2'] }],
    )
    expect(state.map((m) => m.id)).toEqual(['p1', 9])
  })
})

describe('chatMessageReducer — remove_pending', () => {
  it('removes pending bubbles and cross-device _remote bubbles by queueId', () => {
    const state = run(
      [
        u({ id: 'p1', pending: true, queueId: 'p1', seq: 1 }),
        u({ id: 'remote-abc', _remote: true, _remoteQueueId: 'p2', content: 'other', seq: 2 }),
        u({ id: 9 }),
      ],
      [{ type: 'remove_pending', queueId: 'p2' }],
    )
    // Only the _remote bubble for p2 is removed; p1 (a different queueId) stays.
    expect(state.map((m) => m.id)).toEqual(['p1', 9])
  })
})

// ── Race 1: optimistic_push → db_load → ws_queue_drain ──
describe('chatMessageReducer — Race 1: optimistic bubble survives db_load and drains', () => {
  it('bubble is not wiped by db_load and drain matches by id', () => {
    let state: ChatMessage[] = []
    // 1. User sends message 2 while 1 is generating → optimistic bubble.
    state = run(state, [{ type: 'optimistic_push', msg: u({ id: 'pending-2', content: '2', pending: true, seq: 1 }) }])
    expect(state).toHaveLength(1)

    // 2. A loadHistory returns msg1 + reply1 + msg2 (DB row, queued) BEFORE drain.
    state = run(state, [{
      type: 'db_load',
      sessionRunning: false,
      dbMessages: [
        u({ id: 1, content: '1' }),
        a({ id: 2, content: 'reply1' }),
        u({ id: 3, content: '2', queueId: 'pending-2', queued: true }),
      ],
    }])
    // Bubble must survive (matched by queueId), still pending, id still string.
    expect(state.map((m) => m.id)).toEqual([1, 2, 'pending-2'])
    expect(state[2].pending).toBe(true)

    // 3. queue_drain arrives → matches the surviving bubble by id, no duplicate.
    state = run(state, [{ type: 'ws_queue_drain', queueId: 'pending-2', text: '2', files: [], dbMessageId: 3 }])
    const users = state.filter((m) => m.role === 'user' && m.content === '2')
    expect(users).toHaveLength(1)
  })

  it('drain matches a bubble that already adopted a numeric DB id (queueId field survives)', () => {
    let state: ChatMessage[] = []
    state = run(state, [
      { type: 'optimistic_push', msg: u({ id: 'pending-2', content: '2', pending: true, seq: 1 }) },
    ])
    // db_load replaces nothing but marks queued; then the bubble's id becomes numeric
    // (e.g. stream_start or a later merge) while queueId field survives.
    const bubble = state[0]
    bubble.queueId = 'pending-2'
    bubble.id = 3
    bubble.pending = true
    delete bubble.seq

    state = run(state, [{ type: 'ws_queue_drain', queueId: 'pending-2', text: '2', files: [], dbMessageId: 3 }])
    const users = state.filter((m) => m.role === 'user' && m.content === '2')
    expect(users).toHaveLength(1)
  })
})

// ── Race 2: done lost → stream_finalize + db_load ──
describe('chatMessageReducer — Race 2: stream_finalize + db_load do not truncate content', () => {
  it('keeps already-streamed content when the done event was missed', () => {
    let state: ChatMessage[] = []
    // Message 1 + reply1 (streaming, partial content already received).
    state = run(state, [
      { type: 'optimistic_push', msg: u({ id: 'pending-1', content: '1', seq: 1 }) },
    ])
    state = run(state, [
      { type: 'stream_placeholder', msg: a({ id: 'drain-1', streaming: true, seq: 2 }) },
      { type: 'ws_content', text: 'partial reply content' },
    ])
    const sm = state.find((m) => m.streaming)!
    expect(sm.content + (sm.blocks?.[0]?.text || '')).toContain('partial')

    // done event lost → session_update completed arrives → stream_finalize +
    // db_load. The rebuild keeps the authoritative DB rows — the finalized
    // reply row carries the streamed content, so nothing is truncated.
    state = run(state, [
      { type: 'stream_finalize' },
      { type: 'db_load', dbMessages: [u({ id: 1, content: '1' }), a({ id: 2, content: 'partial reply content' })] },
    ])
    const reply = state.find((m) => m.role === 'assistant')
    expect(reply).toBeDefined()
    const text = reply!.blocks?.map((b) => (b.text || '')).join('') || reply!.content
    expect(text).toContain('partial reply content')
  })
})

// ── Race 3: db_load → optimistic_push → stream_placeholder ──
describe('chatMessageReducer — Race 3: new stream coexists with background db_load', () => {
  it('stream placeholder survives a db_load merge that came before it', () => {
    let state: ChatMessage[] = []
    // db_load arrives first (stale snapshot).
    state = run(state, [{
      type: 'db_load',
      dbMessages: [u({ id: 1, content: '1' }), a({ id: 2, content: 'reply1' })],
    }])
    // Then the user sends message 2 and a new stream placeholder appears.
    state = run(state, [{ type: 'optimistic_push', msg: u({ id: 'pending-2', content: '2', pending: true, seq: 1 }) }])
    state = run(state, [{ type: 'stream_placeholder', msg: a({ id: 'drain-2', streaming: true, seq: 2, parentQueueId: 'pending-2' }) }])

    const streaming = state.find((m) => m.streaming)
    expect(streaming).toBeDefined()
    expect(state.map((m) => m.id)).toEqual([1, 2, 'pending-2', 'drain-2'])
  })
})

describe('rebuildFromDb (db_load)', () => {
  it('rebuild drops a finalized drain-* reply that has no DB row; DB row is the truth', () => {
    const state = [a({ id: 'drain-99', content: 'reply', createdAt: '2026-01-01T00:00:00Z', seq: 1 })]
    const merged = rebuildFromDb(state, [
      a({ id: 7, content: 'reply', createdAt: '2026-01-01T00:00:01Z' }),
    ])
    const reply = merged.find((m) => m.role === 'assistant')
    expect(reply?.id).toBe(7)
    expect(merged.some((m) => m.id === 'drain-99')).toBe(false)
  })

  // ── Bug regression: db_load must NOT keep a pending bubble whose DB row is
  //    already drained (queued=false). The rebuild drops the transient bubble
  //    and keeps the authoritative DB row — a reload fixes the stale "waiting"
  //    state permanently (same as a restart).
  it('drops a pending bubble whose DB row is already drained (queued=false)', () => {
    const state = [
      u({ id: 1, content: 'msg1' }),
      a({ id: 2, content: 'reply1' }),
      u({ id: 'pending-2', content: 'msg2', pending: true, queueId: 'pending-2', seq: 1 }),
    ]
    const merged = rebuildFromDb(state, [
      u({ id: 1, content: 'msg1' }),
      a({ id: 2, content: 'reply1' }),
      // msg2 is already drained: queued=false, has a DB id
      u({ id: 3, content: 'msg2', queueId: 'pending-2', queued: false }),
    ])
    const msg2 = merged.find((m) => m.role === 'user' && m.content === 'msg2')
    expect(msg2).toBeDefined()
    expect(msg2?.pending).toBeUndefined()
    // The transient string-id bubble is gone; the DB row id=3 is authoritative.
    expect(msg2?.id).toBe(3)
  })

  // ── Realistic streaming sequence: msg2 queued while reply1 streams, then a
  //    db_load arrives BEFORE queue_drain. The pending bubble must survive (its
  //    DB row is queued=1) and the streaming reply must not be duplicated.
  it('full queue flow: pending bubble survives db_load, drain clears it, new placeholder appears', () => {
    let state: ChatMessage[] = []
    // User sends msg1 → optimistic user row (no pending)
    state = run(state, [{ type: 'optimistic_push', msg: u({ id: 1, content: 'msg1', seq: 1 }) }])
    // stream_start → placeholder for reply1 anchored to msg1
    state = run(state, [{ type: 'stream_placeholder', msg: a({ id: 'drain-1', streaming: true, seq: 2, parentQueueId: '1' }) }])
    // While reply1 streams, user sends msg2 → optimistic pending bubble
    state = run(state, [{ type: 'optimistic_push', msg: u({ id: 'pending-2', content: 'msg2', pending: true, seq: 3 }) }])

    // db_load arrives: msg2 persisted as queued=1 (still waiting). The pending
    // bubble matches the queued row by queueId → kept.
    state = run(state, [{
      type: 'db_load',
      dbMessages: [
        u({ id: 1, content: 'msg1' }),
        u({ id: 3, content: 'msg2', queueId: 'pending-2', queued: true }),
      ],
    }])
    const bubble = state.find((m) => m.role === 'user' && m.content === 'msg2')
    expect(bubble?.pending).toBe(true)
    expect(state.filter((m) => m.role === 'assistant' && m.streaming)).toHaveLength(0)

    // queue_drain(msg2): msg2 becomes normal, new placeholder appears
    state = run(state, [{ type: 'ws_queue_drain', queueId: 'pending-2', text: 'msg2', files: [], dbMessageId: 3 }])
    const msg2 = state.find((m) => m.role === 'user' && m.content === 'msg2')
    expect(msg2?.pending).toBeUndefined()
    // streaming reply for msg2 exists
    const streaming = state.filter((m) => m.role === 'assistant' && m.streaming)
    expect(streaming).toHaveLength(1)
    // Conversational order preserved: msg1 < msg2 < reply2(streaming).
    const order = state.map((m) => (m.role === 'user' ? `u:${m.content}` : `a:${m.id}`))
    expect(order).toEqual(['u:msg1', 'u:msg2', `a:${streaming[0].id}`])
  })

  // ── Same as above but the db_load sees msg2 ALREADY drained (queued=false,
  //    DB id adopted). The transient pending bubble is dropped.
  it('full queue flow: db_load after drain drops the pending bubble, keeps DB row', () => {
    let state: ChatMessage[] = []
    state = run(state, [{ type: 'optimistic_push', msg: u({ id: 1, content: 'msg1', seq: 1 }) }])
    state = run(state, [{ type: 'stream_placeholder', msg: a({ id: 'drain-1', streaming: true, seq: 2, parentQueueId: '1' }) }])
    state = run(state, [{ type: 'optimistic_push', msg: u({ id: 'pending-2', content: 'msg2', pending: true, seq: 3 }) }])

    // db_load sees msg2 already drained (queued=false, id=3)
    state = run(state, [{
      type: 'db_load',
      dbMessages: [
        u({ id: 1, content: 'msg1' }),
        u({ id: 3, content: 'msg2', queueId: 'pending-2', queued: false }),
      ],
    }])
    const msg2 = state.find((m) => m.role === 'user' && m.content === 'msg2')
    expect(msg2).toBeDefined()
    expect(msg2?.pending).toBeUndefined()
    expect(msg2?.id).toBe(3)
  })
})

describe('ws_stream_start re-anchor (answeredQueueId)', () => {

  // ── Bug regression: recovery placeholder anchored to a STALE user message.
  //    When the question bubble is delayed (missed queue_drain/stream_start
  //    while unsubscribed, then rebuilt on the "running" session_update), the
  //    placeholder is anchored to the newest user visible at that moment — an
  //    older question. The stream_start event now carries the answered queue
  //    id, so the reducer must repoint the anchor to the true question and the
  //    reply must sort right after it (never above it).
  it('re-anchors a stale recovery placeholder to the answered question', () => {
    const state = run([
      // Older question Q1 and its finalized reply — newest non-pending user at
      // recovery time was Q1 (Q2's bubble had not arrived yet).
      u({ id: 100, content: 'Q1' }),
      a({ id: 101, content: 'A1', blocks: [{ type: 'text', text: 'A1' }] }),
      // Q2 arrived AFTER the recovery placeholder was built anchored to Q1.
      u({ id: 200, content: 'Q2', _remote: true, _remoteQueueId: 'pending-2', seq: 1 }),
      // Recovery placeholder: anchored to Q1 (stale), then ws_stream_start
      // assigns the DB id 202 and the answered queue id 'pending-2'.
      a({ id: 'drain-1', content: '', blocks: [], streaming: true, seq: 2, parentQueueId: '100' }),
    ], [
      { type: 'ws_stream_start', messageId: 202, answeredQueueId: 'pending-2' },
    ])

    const sm = state.find((m) => m.role === 'assistant' && m.streaming)!
    expect(sm.id).toBe(202)
    expect(String(sm.parentQueueId)).toBe('pending-2')
    // Q1 < A1 < Q2 < streaming reply — the reply sorts after its own question.
    const order = state.map((m) => (m.role === 'user' ? `u:${m.content}` : `a:${m.id}`))
    expect(order).toEqual(['u:Q1', 'a:101', 'u:Q2', 'a:202'])
  })

  it('does not re-anchor when the placeholder already points at the answered question', () => {
    const state = run([
      u({ id: 200, content: 'Q2', _remote: true, _remoteQueueId: 'pending-2', seq: 1 }),
      a({ id: 202, content: '', blocks: [], streaming: true, seq: 2, parentQueueId: 'pending-2' }),
    ], [
      { type: 'ws_stream_start', messageId: 202, answeredQueueId: 'pending-2' },
    ])
    const sm = state.find((m) => m.role === 'assistant' && m.streaming)!
    expect(String(sm.parentQueueId)).toBe('pending-2')
  })

  it('drops the anchor when ws_stream_start carries no answered queue id (scheduled run)', () => {
    const state = run([
      u({ id: 200, content: 'Q2', seq: 1 }),
      a({ id: 'drain-1', content: '', blocks: [], streaming: true, seq: 2, parentQueueId: '200' }),
    ], [
      { type: 'ws_stream_start', messageId: 202 },
    ])
    const sm = state.find((m) => m.role === 'assistant' && m.streaming)!
    expect(sm.id).toBe(202)
    // Anchor untouched — no answeredQueueId, keep whatever anchor exists.
    expect(String(sm.parentQueueId)).toBe('200')
  })

  it('re-anchor survives a following db_load rebuild (Channel 2 queue match)', () => {
    // After re-anchoring to the answered queue id, loadHistory's rebuildFromDb
    // matches the live placeholder to the DB streaming row by
    // (r.queueId === live.parentQueueId) and keeps the live object.
    const state = run([
      u({ id: 100, content: 'Q1' }),
      a({ id: 101, content: 'A1', blocks: [{ type: 'text', text: 'A1' }] }),
      u({ id: 200, content: 'Q2', queueId: 'pending-2' }),
      a({ id: 'drain-1', content: '', blocks: [], streaming: true, seq: 2, parentQueueId: '100' }),
    ], [
      { type: 'ws_stream_start', messageId: 202, answeredQueueId: 'pending-2' },
    ])
    const merged = rebuildFromDb(state, [
      u({ id: 100, content: 'Q1' }),
      a({ id: 101, content: 'A1', blocks: [{ type: 'text', text: 'A1' }] }),
      u({ id: 200, content: 'Q2', queueId: 'pending-2' }),
      a({ id: 202, streaming: true, queueId: 'pending-2', createdAt: '2026-01-01T00:00:00Z' }),
    ])
    const sm = merged.find((m) => m.role === 'assistant' && m.streaming)!
    expect(sm.id).toBe(202)
    expect(String(sm.parentQueueId)).toBe('pending-2')
    const order = merged.map((m) => (m.role === 'user' ? `u:${m.content}` : `a:${m.id}`))
    expect(order).toEqual(['u:Q1', 'a:101', 'u:Q2', 'a:202'])
  })
})

describe('rebuildFromDb (live placeholder)', () => {

  it('keeps the LIVE placeholder when a DB streaming row matches it (by id)', () => {
    // ws_stream_start assigned the DB id to the live placeholder; the rebuild
    // must keep the placeholder object (content preserved) and not append a
    // duplicate DB row.
    const state = [a({ id: 'drain-new', streaming: true, createdAt: '2026-01-01T00:00:02Z', seq: 1, parentQueueId: '2' })]
    const merged = rebuildFromDb(state, [
      a({ id: 7, streaming: true, createdAt: '2026-01-01T00:00:02Z' }),
    ])
    expect(merged).toHaveLength(1)
    // The live placeholder adopts the DB id (like ws_stream_start would) but
    // keeps streaming — its content/object identity is preserved.
    expect(merged[0].id).toBe(7)
    expect(merged[0].streaming).toBe(true)
  })

  it('keeps the LIVE placeholder by queue match when ws_stream_start has not arrived yet', () => {
    const state = [a({ id: 'drain-new', streaming: true, createdAt: '2026-01-01T00:00:02Z', seq: 1, parentQueueId: 'pending-B' })]
    const merged = rebuildFromDb(state, [
      a({ id: 7, streaming: true, queueId: 'pending-B', createdAt: '2026-01-01T00:00:02Z' }),
    ])
    expect(merged).toHaveLength(1)
    // Adopts the DB id via queue match; streaming preserved.
    expect(merged[0].id).toBe(7)
    expect(merged[0].streaming).toBe(true)
  })

  // ── Bug regression (issue #419): session switch resets the streaming elapsed
  //    timer. Switching back to a running session re-subscribes → the backend
  //    emits stream_start, which recreates the placeholder stamped with the
  //    SWITCH time (createdAt = now) while the REST db_load is still in flight.
  //    rebuildFromDb keeps that placeholder object — its createdAt (the switch
  //    moment) must be replaced by the DB streaming row's older created_at (the
  //    true stream start), otherwise the "⋯ 45s" counter restarts from 0 on
  //    every switch.
  it('adopts the DB row created_at as the elapsed anchor when the live placeholder is newer (session-switch reset)', () => {
    const state = [a({
      id: 7,
      streaming: true,
      // stream_start fired by the re-subscribe raced ahead of db_load → the
      // placeholder was stamped with the switch moment, well AFTER stream start.
      createdAt: '2026-01-01T00:01:00Z',
      seq: 1,
    })]
    const merged = rebuildFromDb(state, [
      a({ id: 7, streaming: true, createdAt: '2026-01-01T00:00:00Z' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(7)
    expect(merged[0].streaming).toBe(true)
    // The elapsed timer anchor must be the stream start, not the switch moment.
    expect(merged[0].createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('keeps the live placeholder createdAt when it is not newer than the DB row', () => {
    const state = [a({ id: 7, streaming: true, createdAt: '2026-01-01T00:00:00Z', seq: 1 })]
    const merged = rebuildFromDb(state, [
      // DB row flushed slightly later (content flush lag) — placeholder time is
      // already the true start, so it must NOT be bumped forward.
      a({ id: 7, streaming: true, createdAt: '2026-01-01T00:00:01Z' }),
    ])
    expect(merged[0].createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('adopts the DB created_at when the live placeholder has no usable createdAt', () => {
    const state = [a({ id: 7, streaming: true, createdAt: '', seq: 1 })]
    const merged = rebuildFromDb(state, [
      a({ id: 7, streaming: true, createdAt: '2026-01-01T00:00:00Z' }),
    ])
    expect(merged[0].createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('drops the streaming placeholder when the DB snapshot has no streaming row for it (done was missed)', () => {
    const state = [a({ id: 'drain-1', streaming: true, seq: 1 })]
    const merged = rebuildFromDb(state, [u({ id: 1, content: '1' })])
    // No streaming DB row → placeholder dropped; the DB row is authoritative.
    expect(merged.some((m) => m.streaming)).toBe(false)
    expect(merged).toHaveLength(1)
  })

  it('ws_error replaces live streaming blocks with the error block', () => {
    const state = run(
      [a({ id: 'drain-1', content: 'partial', blocks: [{ type: 'text', text: 'partial' }], streaming: true, seq: 1 })],
      [{ type: 'ws_error', text: 'backend crashed', reason: 'backend_exit' }],
    )
    const sm = state.find((m) => m.role === 'assistant')
    expect(sm?.blocks).toEqual([{ type: 'error', text: 'backend crashed', reason: 'backend_exit' }])
    expect(sm?.streaming).toBe(true) // flag cleared later by forceCleanup
  })

  it('ws_error with no streaming assistant appends to the last assistant (no reload needed)', () => {
    // Regression: after the stream ended (done), a backend crash emits an error
    // event but there is no live streaming placeholder — the error must still
    // surface immediately on the last assistant instead of only after reload.
    const state = run(
      [
        u({ id: 1, content: 'q1' }),
        a({ id: 2, content: 'reply1', blocks: [{ type: 'text', text: 'reply1' }] }),
      ],
      [{ type: 'ws_error', text: 'peer disconnected', reason: 'backend_exit' }],
    )
    const lastAssistant = state[state.length - 1]
    expect(lastAssistant.role).toBe('assistant')
    expect(lastAssistant.blocks).toContainEqual({ type: 'error', text: 'peer disconnected', reason: 'backend_exit' })
  })

  it('ws_error creates an assistant message when none exists', () => {
    const state = run(
      [u({ id: 1, content: 'q1' })],
      [{ type: 'ws_error', text: 'boom', reason: 'backend_exit' }],
    )
    expect(state.some((m) => m.role === 'assistant' && (m.blocks ?? []).some((b) => b.type === 'error'))).toBe(true)
  })
})
