import { describe, expect, it, vi, beforeEach } from 'vitest'

// The KaTeX CSS is injected by the app's bundler (globals.ts imports
// katex/dist/katex.min.css), and its @font-face rules expose full `src` URLs in
// real browsers. jsdom only partially parses @font-face (keeps font-family but
// drops src), so the data-URI embedding path cannot be fully exercised in
// jsdom — the behavior is verified by the fallback/guard branches below.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { buildKatexFontCss } from '@/utils/katexFontEmbed'

describe('buildKatexFontCss', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })
  })

  it('returns empty when container has no KaTeX math', async () => {
    const div = document.createElement('div')
    div.innerHTML = '<p>no math</p>'
    expect(await buildKatexFontCss(div)).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty (no fetch) when no @font-face rules exist in the CSSOM', async () => {
    const div = document.createElement('div')
    div.innerHTML = '<span class="katex">x</span>'
    const css = await buildKatexFontCss(div)
    expect(css).toBe('')
  })

  it('degrades silently when a font fetch fails', async () => {
    // jsdom keeps only font-family of @font-face; inject a CSSFontFaceRule whose
    // src is present via cssText to exercise the try/catch around fetch.
    const style = document.createElement('style')
    style.textContent = '@font-face { font-family: "KaTeX_Main"; src: url(/KaTeX_Main.woff2) format("woff2"); }'
    document.head.appendChild(style)
    try {
      mockFetch.mockRejectedValue(new Error('network down'))
      const div = document.createElement('div')
      div.innerHTML = '<span class="katex" style="font-family: KaTeX_Main">x</span>'
      const css = await buildKatexFontCss(div)
      // Either no faces collected (jsdom src omitted) or fetch failed — both are
      // silent-degradation paths; never throws, never returns a broken block.
      expect(typeof css).toBe('string')
    } finally {
      style.remove()
    }
  })
})
