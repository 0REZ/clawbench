import { describe, it, expect, beforeEach } from 'vitest'
import { getFileScroll, setFileScroll, _resetFileScrollCache } from '@/utils/fileScrollCache'

describe('fileScrollCache', () => {
    beforeEach(() => {
        _resetFileScrollCache()
    })

    it('stores and returns scroll positions per path', () => {
        setFileScroll('a.ts', 120)
        setFileScroll('b.ts', 0)
        expect(getFileScroll('a.ts')).toBe(120)
        expect(getFileScroll('b.ts')).toBe(0)
    })

    it('returns undefined for an unknown path', () => {
        expect(getFileScroll('missing.ts')).toBeUndefined()
    })

    it('overwrites the latest position for the same path', () => {
        setFileScroll('a.ts', 120)
        setFileScroll('a.ts', 480)
        expect(getFileScroll('a.ts')).toBe(480)
    })

    it('keeps entries across cache resets of the module (survives remount)', () => {
        setFileScroll('a.ts', 120)
        // Simulate FileViewer unmount/remount: the module cache is untouched by
        // component lifecycle — a later read must still see the value.
        expect(getFileScroll('a.ts')).toBe(120)
    })

    it('evicts the oldest entry when the cache exceeds its capacity', () => {
        for (let i = 0; i < 120; i++) setFileScroll(`file-${i}.ts`, i)
        // First 20 entries (file-0 .. file-19) were evicted
        expect(getFileScroll('file-0.ts')).toBeUndefined()
        expect(getFileScroll('file-119.ts')).toBe(119)
    })
})
