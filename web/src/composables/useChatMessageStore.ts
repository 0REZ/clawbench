/**
 * Thin dispatch wrapper around chatMessageReducer.
 *
 * All mutations of the chat messages array flow through this store's
 * dispatch(action); ChatPanelContent owns the messages ref, and composables
 * (useChatStream / useChatSession / useSessionManager) receive the dispatch
 * function instead of mutating messages.value directly. This is the single
 * write channel that eliminates the multi-writer ordering races.
 */
import type { Ref } from 'vue'
import { chatMessageReducer, type ChatMessage, type ChatMessageAction } from '@/utils/chatStreamUtils.ts'
import { appLog } from '@/utils/appLog'

export interface ChatMessageStore {
  /** Apply an action to the messages array (reducer is pure). */
  dispatch: (action: ChatMessageAction) => void
}

/** Compact order snapshot for diagnostics: role:id[pending/streaming/pq]. */
function orderSnapshot(msgs: ChatMessage[]): string {
  return msgs.map((m) => {
    const flags =
      (m.pending ? 'P' : '') + (m.streaming ? 'S' : '') + (m.parentQueueId ? `~${m.parentQueueId}` : '')
    const id = m.id === undefined || m.id === null ? '?' : String(m.id)
    return `${m.role[0]}:${id}${flags}`
  }).join(' ')
}

/** Create a message store bound to the given messages ref. */
export function createChatMessageStore(messages: Ref<ChatMessage[]>): ChatMessageStore {
  const tag = 'MsgStore'
  // Per-token content append actions mutate a block's text in place and never
  // change the message array — logging them (even a short line) floods the log
  // relay with one entry per token (~/api/client-log posts every ~2s while
  // streaming). They carry no structural signal, so they are dropped entirely.
  // The streaming text itself is always recoverable from the DB row.
  const DROP_ENTIRELY = new Set(['ws_content', 'ws_thinking'])
  // Discrete per-block / per-event actions are in-place (snapshot unchanged)
  // but semantically meaningful — log one short line each, no order snapshot.
  const LOG_SHORT = new Set(['ws_thinking_done', 'ws_content_reset', 'ws_tool_use', 'ws_tool_result', 'ws_metadata', 'ws_warning', 'ws_error'])
  return {
    dispatch(action: ChatMessageAction) {
      if (DROP_ENTIRELY.has(action.type)) {
        messages.value = chatMessageReducer(messages.value, action)
        return
      }
      const before = orderSnapshot(messages.value)
      messages.value = chatMessageReducer(messages.value, action)
      const after = orderSnapshot(messages.value)
      // Log every structural mutation (order + identities) so a repro can be
      // traced end-to-end via the log relay.
      if (before !== after || action.type === 'db_load') {
        appLog.d(tag, `dispatch ${action.type} | ${before} => ${after}`)
      } else if (LOG_SHORT.has(action.type)) {
        appLog.d(tag, `dispatch ${action.type} (in-place)`)
      }
    },
  }
}
