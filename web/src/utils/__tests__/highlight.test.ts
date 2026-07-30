import { describe, expect, it } from 'vitest'
import { hljs, highlightCode, registeredLangs } from '@/utils/highlight'

describe('highlightCode', () => {
    it('highlights JavaScript code', () => {
        const result = highlightCode('const x = 1;', 'javascript')
        expect(result).toContain('<span')
        expect(result).toContain('keyword')
    })

    it('highlights Python code', () => {
        const result = highlightCode('def foo(): pass', 'python')
        expect(result).toContain('<span')
    })

    it('highlights Go code', () => {
        const result = highlightCode('func main() {}', 'go')
        expect(result).toContain('<span')
    })

    it('highlights JSON code', () => {
        const result = highlightCode('{"key": "value"}', 'json')
        expect(result).toContain('<span')
    })

    it('highlights Bash code', () => {
        const result = highlightCode('echo hello', 'bash')
        expect(result).toContain('<span')
    })

    it('highlights SQL code', () => {
        const result = highlightCode('SELECT * FROM users;', 'sql')
        expect(result).toContain('<span')
    })

    it('returns escaped HTML for unregistered language', () => {
        const code = 'if (x < 5) { y = "hello" & x; }'
        const result = highlightCode(code, 'brainfuck')
        expect(result).not.toContain('<span')
        expect(result).toContain('&lt;')
        expect(result).toContain('&amp;')
        expect(result).toContain('&quot;')
    })

    it('returns escaped HTML for empty language', () => {
        const code = '<script>alert(1)</script>'
        const result = highlightCode(code, '')
        expect(result).toContain('&lt;script')
        expect(result).not.toContain('<span')
    })

    it('escapes HTML special characters for unknown languages', () => {
        const result = highlightCode('a < b & c > d', 'unknown_lang')
        expect(result).toContain('&lt;')
        expect(result).toContain('&amp;')
        expect(result).toContain('&gt;')
    })

    it('produces different output for known vs unknown languages', () => {
        const code = 'const x = 1;'
        const known = highlightCode(code, 'javascript')
        const unknown = highlightCode(code, 'nonexistent_lang')
        expect(known).toContain('<span')
        expect(unknown).not.toContain('<span class="hljs')
    })
})

describe('registeredLangs', () => {
    it('includes core languages', () => {
        expect(registeredLangs.has('javascript')).toBe(true)
        expect(registeredLangs.has('typescript')).toBe(true)
        expect(registeredLangs.has('python')).toBe(true)
        expect(registeredLangs.has('go')).toBe(true)
        expect(registeredLangs.has('rust')).toBe(true)
        expect(registeredLangs.has('java')).toBe(true)
        expect(registeredLangs.has('cpp')).toBe(true)
    })

    it('includes web languages', () => {
        expect(registeredLangs.has('html')).toBe(true)
        expect(registeredLangs.has('css')).toBe(true)
        expect(registeredLangs.has('json')).toBe(true)
        expect(registeredLangs.has('yaml')).toBe(true)
        expect(registeredLangs.has('xml')).toBe(true)
        expect(registeredLangs.has('markdown')).toBe(true)
    })

    it('includes scripting languages', () => {
        expect(registeredLangs.has('bash')).toBe(true)
        expect(registeredLangs.has('shell')).toBe(true)
        expect(registeredLangs.has('sql')).toBe(true)
        expect(registeredLangs.has('dockerfile')).toBe(true)
        expect(registeredLangs.has('diff')).toBe(true)
    })

    it('does not include obscure languages', () => {
        expect(registeredLangs.has('brainfuck')).toBe(false)
        expect(registeredLangs.has('abnf')).toBe(false)
    })

    it('has approximately 50+ languages registered', () => {
        expect(registeredLangs.size).toBeGreaterThanOrEqual(50)
    })
})

describe('hljs.getLanguage', () => {
    it('works for registered languages', () => {
        expect(hljs.getLanguage('javascript')).toBeTruthy()
        expect(hljs.getLanguage('python')).toBeTruthy()
        expect(hljs.getLanguage('go')).toBeTruthy()
    })

    it('returns undefined for unregistered languages', () => {
        expect(hljs.getLanguage('brainfuck')).toBeUndefined()
    })

    it('resolves language aliases via hljs.getLanguage', () => {
        expect(hljs.getLanguage('ts')).toBeTruthy()
        expect(hljs.getLanguage('js')).toBeTruthy()
        expect(hljs.getLanguage('py')).toBeTruthy()
        expect(hljs.getLanguage('sh')).toBeTruthy()
        expect(hljs.getLanguage('toml')).toBeTruthy()
        expect(hljs.getLanguage('ini')).toBeTruthy()
    })
})
