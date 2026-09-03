import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useFileShare } from '@/composables/useFileShare'

describe('useFileShare', () => {
  const { refreshFileShare, markShared, markUnshared, isFileShared, resetFileShareState } = useFileShare()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetFileShareState()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetFileShareState()
  })

  it('is not shared by default', () => {
    expect(isFileShared('/proj/a.md')).toBe(false)
  })

  it('markShared / markUnshared toggle state synchronously', () => {
    markShared('/proj/a.md')
    expect(isFileShared('/proj/a.md')).toBe(true)
    markUnshared('/proj/a.md')
    expect(isFileShared('/proj/a.md')).toBe(false)
  })

  it('refreshFileShare seeds shared state when the server reports a link', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ path: '/share/tok1' }) })
    const shared = await refreshFileShare('/proj/a.md')
    expect(shared).toBe(true)
    expect(isFileShared('/proj/a.md')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/share?path=%2Fproj%2Fa.md')
  })

  it('refreshFileShare clears shared state when no link exists', async () => {
    markShared('/proj/b.md')
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const shared = await refreshFileShare('/proj/b.md')
    expect(shared).toBe(false)
    expect(isFileShared('/proj/b.md')).toBe(false)
  })

  it('refreshFileShare handles failed responses gracefully', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const shared = await refreshFileShare('/proj/c.md')
    expect(shared).toBe(false)
    expect(isFileShared('/proj/c.md')).toBe(false)
  })

  it('refreshFileShare returns false for an empty path without fetching', async () => {
    const shared = await refreshFileShare('')
    expect(shared).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
