import 'katex/dist/katex.min.css'
import { marked } from 'marked'
import { hljs, highlightCode } from '@/utils/highlight.ts'
import katex from 'katex'
import DOMPurify from 'dompurify'

// Mermaid is loaded dynamically to reduce initial bundle size.
// Use getMermaid() to obtain the mermaid instance on demand.
let _mermaid: typeof import('mermaid').default | null = null

export async function getMermaid() {
    if (!_mermaid) {
        const mod = await import('mermaid')
        _mermaid = mod.default
    }
    return _mermaid
}

export { marked, hljs, highlightCode, katex, DOMPurify }
