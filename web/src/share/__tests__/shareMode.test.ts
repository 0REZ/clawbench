import { describe, expect, it, afterEach } from 'vitest'
import {
  isShareMode,
  setShareToken,
  setSharedFile,
  getShareToken,
  getSharedFilePath,
  getSharedFileName,
  shareApiUrl,
} from '@/share/shareMode'

describe('shareMode', () => {
  afterEach(() => {
    setShareToken(null)
    setSharedFile('', '')
  })

  it('is off by default and toggles with the token', () => {
    expect(isShareMode()).toBe(false)
    expect(getShareToken()).toBeNull()
    setShareToken('tok1')
    expect(isShareMode()).toBe(true)
    expect(getShareToken()).toBe('tok1')
    setShareToken('')
    expect(isShareMode()).toBe(false)
  })

  it('builds token-scoped API URLs without double slashes', () => {
    setShareToken('tok1')
    expect(shareApiUrl('file')).toBe('/api/share/tok1/file')
    expect(shareApiUrl('/file')).toBe('/api/share/tok1/file')
    expect(shareApiUrl('local/img/a.png')).toBe('/api/share/tok1/local/img/a.png')
    expect(shareApiUrl('download')).toBe('/api/share/tok1/download')
  })

  it('throws when building a URL outside share mode', () => {
    expect(() => shareApiUrl('file')).toThrow()
  })

  it('stores shared file metadata', () => {
    expect(getSharedFilePath()).toBe('')
    setSharedFile('/proj/a.md', 'a.md')
    expect(getSharedFilePath()).toBe('/proj/a.md')
    expect(getSharedFileName()).toBe('a.md')
  })
})
