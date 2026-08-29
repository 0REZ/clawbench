import { describe, expect, it, beforeEach } from 'vitest'
import {
  saveChatScrollPosition,
  clearChatScrollPosition,
  hasChatScrollPosition,
  getChatScrollPosition,
} from '../chatScrollMemory'

describe('chatScrollMemory', () => {
  beforeEach(() => {
    // Reset module state between tests
    // (memory is module-scoped; each test starts clean)
    clearChatScrollPosition('s1')
    clearChatScrollPosition('s2')
  })

  it('hasChatScrollPosition returns false for an unknown session', () => {
    expect(hasChatScrollPosition('s1')).toBe(false)
    expect(getChatScrollPosition('s1')).toBeUndefined()
  })

  it('saveChatScrollPosition remembers a scrollTop per session', () => {
    saveChatScrollPosition('s1', 500)
    expect(hasChatScrollPosition('s1')).toBe(true)
    expect(getChatScrollPosition('s1')).toBe(500)
  })

  it('positions are independent per session', () => {
    saveChatScrollPosition('s1', 100)
    saveChatScrollPosition('s2', 800)
    expect(getChatScrollPosition('s1')).toBe(100)
    expect(getChatScrollPosition('s2')).toBe(800)
  })

  it('clearChatScrollPosition forgets a session', () => {
    saveChatScrollPosition('s1', 500)
    clearChatScrollPosition('s1')
    expect(hasChatScrollPosition('s1')).toBe(false)
    expect(getChatScrollPosition('s1')).toBeUndefined()
  })

  it('saveChatScrollPosition overwrites the previous position', () => {
    saveChatScrollPosition('s1', 100)
    saveChatScrollPosition('s1', 900)
    expect(getChatScrollPosition('s1')).toBe(900)
  })
})
