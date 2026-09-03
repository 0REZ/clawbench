import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildFontStack,
  readMonoFont,
  readUiFont,
  resolveChoice,
  applyFontConfig,
  applyFontToDocument,
  DEFAULT_UI_STACK,
  DEFAULT_MONO_STACK,
  DEFAULT_TERMINAL_MONO_STACK,
  DEFAULT_FONT_CHOICE,
  MONO_FONT_KEY,
  UI_FONT_KEY,
  MONO_FONT_CHOICES,
  UI_FONT_CHOICES,
} from '@/utils/fontConfig'

function mockStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem'> {
  return { getItem: (k: string) => (k in initial ? initial[k] : null) }
}

describe('buildFontStack', () => {
  it('returns default stack for default choice', () => {
    expect(buildFontStack(DEFAULT_FONT_CHOICE, DEFAULT_MONO_STACK)).toBe(DEFAULT_MONO_STACK)
  })

  it('returns default stack for null/undefined/empty', () => {
    expect(buildFontStack(null, DEFAULT_MONO_STACK)).toBe(DEFAULT_MONO_STACK)
    expect(buildFontStack(undefined, DEFAULT_MONO_STACK)).toBe(DEFAULT_MONO_STACK)
    expect(buildFontStack('', DEFAULT_MONO_STACK)).toBe(DEFAULT_MONO_STACK)
  })

  it('prepends a simple font name without quotes', () => {
    expect(buildFontStack('Hack', DEFAULT_MONO_STACK)).toBe(`Hack, ${DEFAULT_MONO_STACK}`)
  })

  it('quotes font names containing spaces', () => {
    expect(buildFontStack('JetBrains Mono', DEFAULT_MONO_STACK)).toBe(`'JetBrains Mono', ${DEFAULT_MONO_STACK}`)
    expect(buildFontStack('Sarasa Mono SC', DEFAULT_MONO_STACK)).toBe(`'Sarasa Mono SC', ${DEFAULT_MONO_STACK}`)
  })

  it('keeps ui default stack for default ui choice', () => {
    expect(buildFontStack(DEFAULT_FONT_CHOICE, DEFAULT_UI_STACK)).toBe(DEFAULT_UI_STACK)
  })
})

describe('readMonoFont / readUiFont', () => {
  it('returns default when nothing stored', () => {
    expect(readMonoFont(mockStorage())).toBe(DEFAULT_FONT_CHOICE)
    expect(readUiFont(mockStorage())).toBe(DEFAULT_FONT_CHOICE)
  })

  it('reads a stored json-encoded value', () => {
    const store = mockStorage({ [MONO_FONT_KEY]: JSON.stringify('Fira Code') })
    expect(readMonoFont(store)).toBe('Fira Code')
  })

  it('returns default when stored value is not a string', () => {
    const store = mockStorage({ [MONO_FONT_KEY]: JSON.stringify(42) })
    expect(readMonoFont(store)).toBe(DEFAULT_FONT_CHOICE)
  })

  it('returns default when getItem throws', () => {
    const broken = { getItem: () => { throw new Error('denied') } }
    expect(readMonoFont(broken)).toBe(DEFAULT_FONT_CHOICE)
  })

  it('reads ui font from its own key', () => {
    const store = mockStorage({ [UI_FONT_KEY]: JSON.stringify('Inter') })
    expect(readUiFont(store)).toBe('Inter')
  })
})

describe('resolveChoice', () => {
  it('returns null for unknown id', () => {
    expect(resolveChoice('Comic Sans', MONO_FONT_CHOICES)).toBeNull()
    expect(resolveChoice(null, MONO_FONT_CHOICES)).toBeNull()
  })

  it('finds known mono font', () => {
    const c = resolveChoice('Fira Code', MONO_FONT_CHOICES)
    expect(c?.id).toBe('Fira Code')
  })

  it('finds the default sentinel', () => {
    const c = resolveChoice(DEFAULT_FONT_CHOICE, UI_FONT_CHOICES)
    expect(c?.id).toBe(DEFAULT_FONT_CHOICE)
  })
})

describe('applyFontToDocument / applyFontConfig', () => {
  function fakeDocument() {
    const styles: Record<string, string> = {}
    return {
      documentElement: {
        style: { setProperty: (prop: string, value: string) => { styles[prop] = value } },
      },
      get styles() { return styles },
    }
  }

  it('sets --font-mono to default stack when choice is default', () => {
    const doc = fakeDocument() as unknown as Document
    applyFontToDocument(doc, '--font-mono', DEFAULT_FONT_CHOICE, DEFAULT_MONO_STACK)
    expect(doc.styles['--font-mono']).toBe(DEFAULT_MONO_STACK)
  })

  it('sets --font-mono with chosen font at head', () => {
    const doc = fakeDocument() as unknown as Document
    applyFontToDocument(doc, '--font-mono', 'Hack', DEFAULT_MONO_STACK)
    expect(doc.styles['--font-mono']).toBe(`Hack, ${DEFAULT_MONO_STACK}`)
  })

  it('applyFontConfig applies both variables from explicit choices', () => {
    const doc = fakeDocument() as unknown as Document
    applyFontConfig(doc, 'Cascadia Code', 'Inter')
    expect(doc.styles['--font-mono']).toBe(`'Cascadia Code', ${DEFAULT_MONO_STACK}`)
    expect(doc.styles['--font-ui']).toBe(`Inter, ${DEFAULT_UI_STACK}`)
  })

  it('applyFontConfig falls back to default stack for unknown ids', () => {
    const doc = fakeDocument() as unknown as Document
    applyFontConfig(doc, 'NotARealFont', 'AlsoFake')
    expect(doc.styles['--font-mono']).toBe(DEFAULT_MONO_STACK)
    expect(doc.styles['--font-ui']).toBe(DEFAULT_UI_STACK)
  })

  it('applyFontConfig accepts default sentinel for either dimension', () => {
    const doc = fakeDocument() as unknown as Document
    applyFontConfig(doc, DEFAULT_FONT_CHOICE, 'Inter')
    expect(doc.styles['--font-mono']).toBe(DEFAULT_MONO_STACK)
    expect(doc.styles['--font-ui']).toBe(`Inter, ${DEFAULT_UI_STACK}`)
  })
})

describe('candidate tables', () => {
  it('contains expected mono candidates including default sentinel', () => {
    expect(MONO_FONT_CHOICES[0].id).toBe(DEFAULT_FONT_CHOICE)
    const ids = MONO_FONT_CHOICES.map(c => c.id)
    for (const f of ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'Hack', 'IBM Plex Mono', 'Iosevka', 'Sarasa Mono SC', 'Maple Mono']) {
      expect(ids).toContain(f)
    }
  })

  it('contains expected ui candidates', () => {
    const ids = UI_FONT_CHOICES.map(c => c.id)
    for (const f of ['Inter', 'Source Sans 3', 'IBM Plex Sans', 'LXGW WenKai', 'Noto Sans SC']) {
      expect(ids).toContain(f)
    }
  })

  it('candidate ids are unique across each table', () => {
    expect(new Set(MONO_FONT_CHOICES.map(c => c.id)).size).toBe(MONO_FONT_CHOICES.length)
    expect(new Set(UI_FONT_CHOICES.map(c => c.id)).size).toBe(UI_FONT_CHOICES.length)
  })
})

describe('default-stack source consistency (drift guard)', () => {
  // The default stacks are defined in three places that cannot share code:
  //  1. fontConfig.ts constants (read by JS renderers / applyFontConfig)
  //  2. variables.css :root custom properties (read by the whole CSS layer)
  //  3. index.html inline pre-CSS injection script (runs before any module)
  // This spec reads the raw sources and asserts they stay identical, so a
  // future edit cannot silently drift one channel.
  const repoRoot = resolve(__dirname, '../../..')
  const norm = (s: string) => s.replace(/,\s+/g, ',').replace(/\s+/g, ' ').replace(/^var\([^,]*,/, '')
  const declValue = (source: string, name: string): string => {
    const m = source.match(new RegExp(`${name}:\\s*([^;]+);`))
    return m ? norm(m[1].trim()) : ''
  }

  it('variables.css :root matches DEFAULT_MONO_STACK / DEFAULT_UI_STACK', () => {
    const css = readFileSync(resolve(repoRoot, 'css/variables.css'), 'utf8')
    expect(declValue(css, '--font-mono')).toBe(norm(DEFAULT_MONO_STACK))
    expect(declValue(css, '--font-ui')).toBe(norm(DEFAULT_UI_STACK))
  })

  it('index.html inline injection mirrors both default stacks', () => {
    const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf8')
    // Both fontConfig.ts and index.html write families with single quotes;
    // index.html additionally wraps the JS string in double quotes.
    // Normalize whitespace then drop the surrounding double quotes so both
    // sides reduce to the same bare stack text.
    const stripWs = (s: string) => s.replace(/\s+/g, ' ')
    const htmlNorm = stripWs(html)
    const want = (varName: string, stack: string) =>
      `${varName} = ${JSON.stringify(stack)}`.replace(/\s+/g, ' ')
    expect(htmlNorm).toContain(want('var MONO_DEFAULT', DEFAULT_MONO_STACK))
    expect(htmlNorm).toContain(want('var UI_DEFAULT', DEFAULT_UI_STACK))
  })

  it('DEFAULT_TERMINAL_MONO_STACK is exported and non-empty', () => {
    expect(DEFAULT_TERMINAL_MONO_STACK.length).toBeGreaterThan(10)
  })
})
