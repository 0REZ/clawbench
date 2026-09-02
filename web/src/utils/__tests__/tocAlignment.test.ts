import { describe, expect, it, afterAll } from 'vitest'
import { marked } from '@/utils/globals.ts'
import { extractToc } from '@/utils/toc.ts'
import { protectMarkdown, MATH_PH_RE } from '@/utils/markdownProtect.ts'
import { resetHeadingIds } from '@/utils/markedConfig.ts'
import { configureMarkedRenderer } from '@/utils/markedConfig.ts'

// Configure the REAL renderer (same as main.ts) so ids match production.
configureMarkedRenderer()

// Mimic the production pipeline: protect → marked.parse → katex restore.
// We only need the heading DOM ids; katex rendering replaces placeholders in
// CONTENT but NOT in the id attribute — matching what the real code produces.
function renderDomIds(content: string): string[] {
  resetHeadingIds()
  const result = protectMarkdown(content)
  const html = marked.parse(result.protected) as string
  // Restore math placeholders in content only (katex render path keeps ids as-is).
  // We don't have katex here; ids are what matter.
  return [...html.matchAll(/<h[1-6][^>]*id="([^"]+)"/g)].map(m => m[1])
}

describe('TOC ids align with real marked DOM ids (math headings)', () => {
  const cases: [string, string][] = [
    ['## 能量公式 $E=mc^2$', 'simple inline math'],
    ['# Intro\nbody $x_1$\n## 能量公式 $E=mc^2$', 'math heading after body math'],
    ['## 能量公式 $E=mc^2$\n## 能量公式 $E=mc^2$', 'duplicate math headings'],
    ['# B $\\alpha$', 'alpha math'],
    ['## 只有公式 $$x$$ 的标题', 'display math in heading'],
    ['# 正常标题\n## 公式 $a_{i}^{2}$ 结尾', 'math with subscripts'],
    ['# Hello `world()`\n## Use $a_i$ formula', 'code + math headings'],
  ]

  for (const [content, label] of cases) {
    it(label, () => {
      const toc = extractToc(content, 'markdown')
      const domIds = renderDomIds(content)
      expect(toc.map(t => t.id)).toEqual(domIds)
      expect(toc.length).toBe(domIds.length)
    })
  }

  it('placeholder code does not leak into visible TOC text', () => {
    const toc = extractToc('## 能量公式 $E=mc^2$', 'markdown')
    expect(toc[0].text).toBe('能量公式 $E=mc^2$')
    expect(toc[0].text).not.toContain('MATH')
  })

  it('MATH_PH_RE still matches placeholders produced by protectMarkdown', () => {
    const res = protectMarkdown('$a$ $b$')
    const matches = res.protected.match(MATH_PH_RE) || []
    expect(matches).toHaveLength(2)
    expect(matches[0]).toBe('\u0000MATHI0\u0000')
    expect(matches[1]).toBe('\u0000MATHI1\u0000')
  })
})

afterAll(() => {
  // restore clean state for other suites
  resetHeadingIds()
})
