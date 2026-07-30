import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock mermaid module
const mockMermaidDefault = { initialize: vi.fn(), render: vi.fn() }
vi.mock('mermaid', () => ({
    default: mockMermaidDefault,
}))

import { getMermaid } from '../lazyMermaid.ts'

describe('lazyMermaid', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return mermaid default export', async () => {
        const result = await getMermaid()
        expect(result).toBe(mockMermaidDefault)
    })

    it('should return the same instance on multiple calls (singleton)', async () => {
        const first = await getMermaid()
        const second = await getMermaid()
        expect(first).toBe(second)
    })

    it('should not re-import mermaid after first call', async () => {
        // getMermaid is already called in previous tests (module-level singleton).
        // Calling it again should return the cached instance without any new import.
        const spy = vi.spyOn(await import('mermaid'), 'default', 'get')
        const result = await getMermaid()
        expect(result).toBeDefined()
        // The spy should not have been called because _mermaid is already cached
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })
})
