import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { configureMarkedRenderer } from '@/utils/markedConfig'
import { _setIsPCForTest } from '@/composables/usePlatformDetect'
import {
  buildMarkdownPreviewDom,
  createFixLocalImagePaths,
} from '@/composables/useMarkdownRenderPipeline'

configureMarkedRenderer()

describe('createFixLocalImagePaths', () => {
  it('resolves relative image srcs against the markdown file dir', () => {
    const fix = createFixLocalImagePaths({ baseDir: 'docs', imageTimestamp: 42, isPC: true })
    const html = '<p><img src="assets/a.png" alt="a"></p>'
    const out = fix(html)
    expect(out).toContain('src="/api/file/thumb?path=docs/assets/a.png&w=1200"')
    expect(out).toContain('data-full-src="/api/local-file/docs/assets/a.png?t=42"')
  })

  it('keeps external URLs untouched', () => {
    const fix = createFixLocalImagePaths({ baseDir: 'docs', imageTimestamp: 1, isPC: true })
    for (const src of ['https://x.com/a.png', '//cdn.x.com/a.png', '/abs/a.png', 'data:image/png;base64,abc']) {
      const out = fix(`<img src="${src}">`)
      expect(out).toContain(`src="${src}"`)
      expect(out).not.toContain('/api/')
    }
  })

  it('serves non-thumbnailable formats from the original full URL', () => {
    const fix = createFixLocalImagePaths({ baseDir: 'docs', imageTimestamp: 7, isPC: false })
    const out = fix('<img src="anim.gif">')
    expect(out).toContain('src="/api/local-file/docs/anim.gif?t=7"')
    expect(out).not.toContain('/api/file/thumb')
    // Mobile width 640 for non-PC
    const pc = createFixLocalImagePaths({ baseDir: 'docs', imageTimestamp: 7, isPC: true })
    expect(pc('<img src="p.png">')).toContain('w=1200')
  })

  it('normalizes dot/.. segments and encodes CJK/space segments', () => {
    const fix = createFixLocalImagePaths({ baseDir: 'a/b', imageTimestamp: 1, isPC: true })
    const out = fix('<img src="../c/图 d.png">')
    // ../ popped → a/c; CJK/space percent-encoded by segment.
    expect(out).toContain('path=a/c/%E5%9B%BE%20d.png')
    expect(out).not.toContain('../')
    expect(out).not.toContain('图')
  })

  it('wraps every image in a lightbox span', () => {
    const fix = createFixLocalImagePaths({ baseDir: '', imageTimestamp: 1, isPC: true })
    const out = fix('<img src="x.png"><img src="https://y.com/z.png">')
    expect(out).toContain('lightbox-img-wrap')
    expect(out.match(/lightbox-img-wrap/g)).toHaveLength(2)
  })
})

describe('buildMarkdownPreviewDom', () => {
  beforeEach(() => _setIsPCForTest(true))
  afterEach(() => vi.restoreAllMocks())

  it('renders headings with deduplicated ids (like markedConfig)', () => {
    const md = '# Intro\n\n# Intro\n\n## Setup'
    const { html } = buildMarkdownPreviewDom({ content: md, path: 'README.md' }, { isPC: true, imageTimestamp: 1 })
    expect(html).toContain('<h1 id="intro">')
    expect(html).toContain('<h1 id="intro-2">')
    expect(html).toContain('<h2 id="setup">')
  })

  it('wraps tables and injects row attributes', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |'
    const { html } = buildMarkdownPreviewDom({ content: md, path: 'README.md' }, { isPC: true, imageTimestamp: 1 })
    expect(html).toContain('class="table-wrap"')
    expect(html).toContain('data-table-idx="0"')
    expect(html).toContain('data-row-idx="0"')
  })

  it('annotates code blocks with headers (language + copy/wrap)', () => {
    const md = '```ts\nconst x: number = 1\n```'
    const { html } = buildMarkdownPreviewDom({ content: md, path: 'README.md' }, { isPC: true, imageTimestamp: 1 })
    expect(html).toContain('code-block-wrapper')
    expect(html).toContain('code-block-header')
    expect(html).toContain('code-block-lang')
    expect(html).toContain('code-block-copy-btn')
  })

  it('renders mermaid fenced blocks as pre.mermaid', () => {
    const md = '```mermaid\ngraph TD; A-->B\n```'
    const { html } = buildMarkdownPreviewDom({ content: md, path: 'README.md' }, { isPC: true, imageTimestamp: 1 })
    expect(html).toContain('<pre class="mermaid">')
  })

  it('resolves relative image paths through fixImagePaths + lightbox wrap', () => {
    const md = '![img](img/x.png)'
    const { html } = buildMarkdownPreviewDom({ content: md, path: 'README.md' }, { isPC: true, imageTimestamp: 5 })
    expect(html).toContain('lightbox-img-wrap')
    expect(html).toContain('/api/file/thumb?path=img/x.png&amp;w=1200')
  })

  it('reports detected file paths for later verification', () => {
    // A relative path in text that looks like a file gets annotated.
    const md = 'Open `src/main.ts:10` for details'
    const { detectedPaths } = buildMarkdownPreviewDom(
      { content: md, path: 'README.md', projectRoot: '', homeDir: '' },
      { isPC: true, imageTimestamp: 1 }
    )
    expect(detectedPaths.length).toBeGreaterThan(0)
  })
})
