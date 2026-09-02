import { describe, expect, it, beforeEach } from 'vitest'
import { getFileScroll, setFileScroll, _resetFileScrollCache } from '@/utils/fileScrollCache'

// MAX_ENTRIES is private; drive eviction by inserting more than the known cap.
const MAX_ENTRIES = 100

describe('fileScrollCache', () => {
  beforeEach(() => {
    _resetFileScrollCache()
  })

  it('returns undefined for a path with no saved position', () => {
    expect(getFileScroll('/src/nope.ts')).toBeUndefined()
  })

  it('returns the saved scrollTop for a path', () => {
    setFileScroll('/src/a.ts', 42)
    expect(getFileScroll('/src/a.ts')).toBe(42)
  })

  it('overwrites the previous value on re-set', () => {
    setFileScroll('/src/a.ts', 10)
    setFileScroll('/src/a.ts', 999)
    expect(getFileScroll('/src/a.ts')).toBe(999)
  })

  it('keeps entries independent per path', () => {
    setFileScroll('/src/a.ts', 10)
    setFileScroll('/src/b.ts', 20)
    expect(getFileScroll('/src/a.ts')).toBe(10)
    expect(getFileScroll('/src/b.ts')).toBe(20)
  })

  it('evicts the least-recently-set entry beyond the cap', () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      setFileScroll(`/src/f${i}.ts`, i)
    }
    // Re-touch f0 (moves it to the tail), then overflow the cap.
    setFileScroll('/src/f0.ts', 0)
    setFileScroll('/src/overflow.ts', 1)
    // The oldest untouched entry (f1) is evicted; f0 survives because it was re-set.
    expect(getFileScroll('/src/f1.ts')).toBeUndefined()
    expect(getFileScroll('/src/f0.ts')).toBe(0)
    expect(getFileScroll('/src/overflow.ts')).toBe(1)
  })

  it('_resetFileScrollCache clears all entries', () => {
    setFileScroll('/src/a.ts', 42)
    _resetFileScrollCache()
    expect(getFileScroll('/src/a.ts')).toBeUndefined()
  })
})
