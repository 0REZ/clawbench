import { describe, it, expect } from 'vitest'
import { buildRedocSrcdoc } from '@/utils/redocHtml.ts'

describe('buildRedocSrcdoc', () => {
  it('returns empty string for empty spec', async () => {
    expect(await buildRedocSrcdoc('')).toBe('')
  })

  it('produces valid HTML with DOCTYPE', async () => {
    const spec = '{"openapi":"3.0.0","info":{"title":"Test"},"paths":{}}'
    const result = await buildRedocSrcdoc(spec)
    expect(result).toContain('<!DOCTYPE html>')
    expect(result).toContain('<html>')
    expect(result).toContain('</html>')
  })

  it('includes inlined ReDoc script (no external CDN)', async () => {
    const spec = '{"openapi":"3.0.0"}'
    const result = await buildRedocSrcdoc(spec)
    expect(result).not.toContain('<script src="https://cdn.redoc.ly')
    expect(result).toContain('Redoc.init')
  })

  it('embeds spec data in Redoc.init call', async () => {
    const spec = '{"openapi":"3.0.0","info":{"title":"My API"}}'
    const result = await buildRedocSrcdoc(spec)
    expect(result).toContain('Redoc.init(' + spec)
  })

  it('includes error handling try/catch', async () => {
    const spec = '{"openapi":"3.0.0"}'
    const result = await buildRedocSrcdoc(spec)
    expect(result).toContain('try {')
    expect(result).toContain('catch(e)')
    expect(result).toContain('Failed to render OpenAPI spec')
  })

  it('includes scrollbar styles with default colors', async () => {
    const spec = '{"openapi":"3.0.0"}'
    const result = await buildRedocSrcdoc(spec)
    expect(result).toContain('::-webkit-scrollbar')
    expect(result).toContain('#c1c1c1')
    expect(result).toContain('scrollbar-color')
  })

  it('uses custom scrollbar colors', async () => {
    const spec = '{"openapi":"3.0.0"}'
    const result = await buildRedocSrcdoc(spec, '#484f58', '#21262d')
    expect(result).toContain('#484f58')
    expect(result).toContain('#21262d')
  })
})
