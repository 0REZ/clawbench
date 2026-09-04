import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { createChatMessageStore } from '@/composables/useChatMessageStore'
import { chatMessageReducer, type ChatMessage, type ChatMessageAction } from '@/utils/chatStreamUtils.ts'

/** Build a ChatMessage with the minimal required fields. */
function msg(partial: Partial<ChatMessage> & { id: unknown }): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    blocks: [],
    createdAt: '',
    ...partial,
  } as ChatMessage
}

/** Apply an action via the real reducer (bypasses the store logging). */
function reducerApply(state: ChatMessage[], action: ChatMessageAction): ChatMessage[] {
  return chatMessageReducer(state, action)
}

describe('createChatMessageStore — logging discipline', () => {
  let messages: Ref<ChatMessage[]>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    messages = ref([])
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ws_content and ws_thinking are applied but produce ZERO log lines (per-token noise)', () => {
    const store = createChatMessageStore(messages)
    // Two streaming messages: one with an existing text block (mutated in
    // place), one freshly appended. The array reference never changes for
    // these in-place block mutations.
    const sm = msg({ id: 'drain-1', streaming: true, seq: 1, blocks: [{ type: 'text', text: 'hel' }] })
    messages.value = [sm]

    store.dispatch({ type: 'ws_content', text: 'lo' })
    store.dispatch({ type: 'ws_thinking', text: 'think', key: 'k1' })

    // State still mutated correctly by the real reducer path.
    expect(messages.value[0].blocks![0]).toMatchObject({ type: 'text', text: 'hello' })
    expect(messages.value[0].blocks!.some((b) => b.type === 'thinking' && b.text === 'think')).toBe(true)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('structural mutations still log the order snapshot diff', () => {
    const store = createChatMessageStore(messages)
    messages.value = [msg({ id: 'drain-1', streaming: true, seq: 1, pending: false, parentQueueId: 'q1' })]

    store.dispatch({ type: 'ws_stream_start', messageId: 43257 })

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('dispatch ws_stream_start')
    expect(logged).toContain('43257')
  })

  it('in-place discrete events (thinking_done / tool_use) log a short marker, no giant snapshot', () => {
    const store = createChatMessageStore(messages)
    messages.value = [
      msg({ id: 'u1', role: 'user', seq: 1 } as Partial<ChatMessage> & { id: unknown }),
      msg({ id: 'a1', streaming: true, seq: 2, blocks: [{ type: 'thinking', text: 'hi', done: false }] }),
    ]

    store.dispatch({ type: 'ws_thinking_done' })
    store.dispatch({ type: 'ws_tool_use', data: { id: 't1', name: 'Read', input: { path: '/a' } } })

    // Done flag applied.
    expect(messages.value[1].blocks!.find((b) => b.type === 'thinking')!.done).toBe(true)
    // Tool block pushed.
    expect(messages.value[1].blocks!.some((b) => b.type === 'tool_use' && b.id === 't1')).toBe(true)

    const lines = logSpy.mock.calls.map((c) => c.join(' '))
    // Exactly two short in-place markers — no order-snapshot payloads
    // (snapshots would contain "u:1 a:2..." for the two messages).
    expect(lines).toEqual([
      '[MsgStore] dispatch ws_thinking_done (in-place)',
      '[MsgStore] dispatch ws_tool_use (in-place)',
    ])
  })

  it('clear / optimistic events that change structure log the before => after diff', () => {
    const store = createChatMessageStore(messages)
    messages.value = [msg({ id: 'p1', role: 'user', pending: true, seq: 1 } as Partial<ChatMessage> & { id: unknown })]

    store.dispatch({ type: 'optimistic_remove', id: 'p1' })

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('dispatch optimistic_remove | u:p1P => ')
  })
})
