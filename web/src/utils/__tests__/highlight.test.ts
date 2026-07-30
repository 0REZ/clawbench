import { describe, expect, it } from 'vitest'
import { hljs, highlightCode } from '@/utils/highlight'

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

describe('hljs.getLanguage', () => {
    it('includes core languages', () => {
        expect(hljs.getLanguage('javascript')).toBeTruthy()
        expect(hljs.getLanguage('typescript')).toBeTruthy()
        expect(hljs.getLanguage('python')).toBeTruthy()
        expect(hljs.getLanguage('go')).toBeTruthy()
        expect(hljs.getLanguage('rust')).toBeTruthy()
        expect(hljs.getLanguage('java')).toBeTruthy()
        expect(hljs.getLanguage('cpp')).toBeTruthy()
    })

    it('includes web languages', () => {
        expect(hljs.getLanguage('html')).toBeTruthy()
        expect(hljs.getLanguage('css')).toBeTruthy()
        expect(hljs.getLanguage('json')).toBeTruthy()
        expect(hljs.getLanguage('yaml')).toBeTruthy()
        expect(hljs.getLanguage('xml')).toBeTruthy()
        expect(hljs.getLanguage('markdown')).toBeTruthy()
    })

    it('includes scripting languages', () => {
        expect(hljs.getLanguage('bash')).toBeTruthy()
        expect(hljs.getLanguage('shell')).toBeTruthy()
        expect(hljs.getLanguage('sql')).toBeTruthy()
        expect(hljs.getLanguage('dockerfile')).toBeTruthy()
        expect(hljs.getLanguage('diff')).toBeTruthy()
    })

    it('returns undefined for unregistered languages', () => {
        expect(hljs.getLanguage('brainfuck')).toBeUndefined()
        expect(hljs.getLanguage('abnf')).toBeUndefined()
    })

    it('resolves language aliases', () => {
        expect(hljs.getLanguage('ts')).toBeTruthy()
        expect(hljs.getLanguage('js')).toBeTruthy()
        expect(hljs.getLanguage('py')).toBeTruthy()
        expect(hljs.getLanguage('sh')).toBeTruthy()
        expect(hljs.getLanguage('toml')).toBeTruthy()
        expect(hljs.getLanguage('ini')).toBeTruthy()
    })

    it('has approximately 50+ languages registered', () => {
        // Count registered languages by checking a representative sample
        const sampleLanguages = [
            'javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'cpp',
            'csharp', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'objectivec',
            'bash', 'shell', 'perl', 'lua', 'dart', 'r', 'elixir', 'erlang',
            'haskell', 'clojure', 'ocaml', 'fsharp', 'groovy',
            'html', 'css', 'scss', 'less', 'json', 'yaml', 'xml', 'markdown',
            'graphql', 'handlebars',
            'sql', 'diff', 'dockerfile', 'makefile', 'ini', 'nginx', 'protobuf',
            'cmake', 'gradle',
            'glsl', 'latex', 'matlab', 'powershell', 'vim', 'wasm', 'verilog', 'vhdl',
        ]
        const registered = sampleLanguages.filter(l => hljs.getLanguage(l))
        expect(registered.length).toBeGreaterThanOrEqual(50)
    })
})
