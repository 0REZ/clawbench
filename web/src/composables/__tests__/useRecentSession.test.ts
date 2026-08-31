import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { _resetForTesting, getRecentSession, recordRecentSession, clearRecentSession, registerSessionIdRef } from '@/composables/useRecentSession'
import { store } from '@/stores/app.ts'

// Mock store — reactive so projectRoot switching is observable.
vi.mock('@/stores/app.ts', async () => {
  const { reactive } = await import('vue')
  return {
    store: {
      state: reactive({ projectRoot: '/test/project' }),
    },
  }
})

// Mock localStorage
const localStorageStore: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { localStorageStore[key] = val }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
  clear: vi.fn(() => Object.keys(localStorageStore).forEach(k => delete localStorageStore[k])),
}
vi.stubGlobal('localStorage', mockLocalStorage)

beforeEach(() => {
  _resetForTesting()
  Object.keys(localStorageStore).forEach(k => delete localStorageStore[k])
  mockLocalStorage.getItem.mockClear()
  mockLocalStorage.setItem.mockClear()
  mockLocalStorage.removeItem.mockClear()
  store.state.projectRoot = '/test/project'
})

describe('useRecentSession storage functions', () => {
  it('recordRecentSession persists a single value', () => {
    recordRecentSession('session-1')
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1)
    const key = mockLocalStorage.setItem.mock.calls[0][0]
    expect(key).toContain('clawbench-recent-session:')
    const val = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1])
    expect(val.sessionId).toBe('session-1')
    expect(typeof val.accessedAt).toBe('number')
  })

  it('recordRecentSession overwrites the previous value', () => {
    recordRecentSession('session-1')
    recordRecentSession('session-2')
    expect(getRecentSession()).toBe('session-2')
    const entries = Object.values(localStorageStore)
    expect(entries).toHaveLength(1)
  })

  it('getRecentSession returns null when nothing stored', () => {
    expect(getRecentSession()).toBeNull()
  })

  it('getRecentSession returns null for corrupt JSON', () => {
    localStorageStore['clawbench-recent-session:/test/project'] = '{not-json'
    expect(getRecentSession()).toBeNull()
  })

  it('getRecentSession returns null for entry with empty sessionId', () => {
    localStorageStore['clawbench-recent-session:/test/project'] = JSON.stringify({ sessionId: '', accessedAt: 1 })
    expect(getRecentSession()).toBeNull()
  })

  it('clearRecentSession removes the stored value', () => {
    recordRecentSession('session-1')
    clearRecentSession()
    expect(getRecentSession()).toBeNull()
    expect(mockLocalStorage.removeItem).toHaveBeenCalled()
  })

  it('recordRecentSession ignores empty sessionId', () => {
    recordRecentSession('')
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
  })

  it('recordRecentSession ignores when projectRoot is empty', () => {
    store.state.projectRoot = ''
    recordRecentSession('session-1')
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
  })
})

describe('useRecentSession project isolation', () => {
  it('keys by projectRoot — projects do not leak', () => {
    store.state.projectRoot = '/proj-a'
    recordRecentSession('session-a')

    store.state.projectRoot = '/proj-b'
    recordRecentSession('session-b')

    store.state.projectRoot = '/proj-a'
    expect(getRecentSession()).toBe('session-a')

    store.state.projectRoot = '/proj-b'
    expect(getRecentSession()).toBe('session-b')
  })
})

describe('useRecentSession watcher', () => {
  it('writes on currentSessionId change after registration', async () => {
    const sessionId = ref('')
    registerSessionIdRef(sessionId)
    sessionId.value = 'session-watched'
    await nextTick()
    expect(getRecentSession()).toBe('session-watched')
  })

  it('skips empty currentSessionId (reset/delete clears)', async () => {
    const sessionId = ref('')
    registerSessionIdRef(sessionId)
    sessionId.value = 'session-watched'
    await nextTick()
    expect(getRecentSession()).toBe('session-watched')

    // Reset to empty — must NOT overwrite the stored value.
    sessionId.value = ''
    await nextTick()
    expect(getRecentSession()).toBe('session-watched')
  })

  it('does not duplicate writes for same value', async () => {
    const sessionId = ref('')
    registerSessionIdRef(sessionId)
    sessionId.value = 'session-1'
    await nextTick()
    sessionId.value = 'session-1'
    await nextTick()
    const writes = mockLocalStorage.setItem.mock.calls.filter(([k]) => String(k).includes('clawbench-recent-session:'))
    expect(writes).toHaveLength(1)
  })
})
