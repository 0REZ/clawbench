/**
 * KaTeX font embedding for exported standalone HTML.
 *
 * When an exported markdown document is opened from file:// (or served anywhere
 * without the app backend), the KaTeX @font-face rules that reference
 * `/KaTeX_*.woff2` cannot load — formulas fall back to system fonts and look
 * noticeably different from the in-app preview.
 *
 * This module rewrites those @font-face rules to inline data: URIs, so formula
 * typography in the exported file matches the preview. Only woff2 sources are
 * embedded (woff/ttf are ignored — every KaTeX family ships a woff2). Font
 * fetch failures degrade silently: the export proceeds and formulas render with
 * system fonts.
 *
 * NOTE: family sub-selection is not effective. KaTeX's renderToString output
 * does not carry inline `font-family` — families are assigned by katex.css
 * class rules (`.katex .mathit { font-family: KaTeX_Main }`), and the class set
 * of a formula does not map to families without a static table. So every KaTeX
 * family found in the CSSOM is embedded (≈20 woff2, ~300KB raw → ~400KB
 * base64 for a document containing any math). This is the correct-by-default
 * behavior; the unused-family filtering in usedKatexFamilies() is retained as a
 * safety net for future KaTeX versions that DO emit inline font-family.
 */

interface KatexFace {
    family: string
    /** Extra @font-face declarations beyond family/src (e.g. font-weight, font-style). */
    extra: string
    url: string
}

/**
 * Collect KaTeX @font-face rules from the live CSSOM.
 *
 * Walks every stylesheet's cssRules for CSSFontFaceRule whose font-family
 * contains "KaTeX" (or the "KaTeX_" family pattern) and extracts the first
 * `url(...)` (woff2) source. Same access pattern as serializeCss — works in
 * both dev (Vite <style> injection) and prod (hashed <link>).
 */
function collectKatexFaces(): KatexFace[] {
    const faces: KatexFace[] = []
    const seen = new Set<string>()
    for (const sheet of Array.from(document.styleSheets)) {
        let cssRules: CSSRuleList
        try {
            cssRules = sheet.cssRules
        } catch {
            continue // cross-origin stylesheet
        }
        for (const rule of Array.from(cssRules)) {
            if (!(rule instanceof CSSFontFaceRule)) continue
            const style = rule.style
            const family = (style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim()
            if (!/KaTeX/i.test(family)) continue
            const src = style.getPropertyValue('src')
            const urlMatch = src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)
            if (!urlMatch) continue
            // Prefer woff2 sources; the @font-face src lists multiple formats.
            const woff2 = src.match(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)\s*format\(["']?woff2/i)
            const url = (woff2 ? woff2[1] : urlMatch[1]).trim()
            if (seen.has(url)) continue
            seen.add(url)
            const extraProps = ['font-weight', 'font-style']
                .filter(p => style.getPropertyValue(p))
                .map(p => `${p}: ${style.getPropertyValue(p)}`)
                .join('; ')
            faces.push({
                family,
                extra: extraProps,
                url,
            })
        }
    }
    return faces
}

/** Font families referenced by a rendered KaTeX element's inline font-family. */
function usedKatexFamilies(container: HTMLElement): Set<string> {
    const used = new Set<string>()
    const els = container.querySelectorAll('.katex, .katex *')
    for (const el of Array.from(els)) {
        const ff = (el as HTMLElement).style?.fontFamily
        if (!ff) continue
        // The inline style lists families like `"KaTeX_Main","Times New Roman",serif`.
        const names = ff.split(',').map(s => s.trim().replace(/["']/g, ''))
        for (const name of names) {
            if (/KaTeX/.test(name)) used.add(name)
        }
    }
    return used
}

/** Normalize a family name from the CSSOM to the inline-style form (e.g. KaTeX_Main). */
function familyKey(family: string): string {
    return family.replace(/["']/g, '').trim()
}

/**
 * Build an @font-face data-URI CSS block embedding the KaTeX fonts used by the
 * exported document.
 *
 * @param container The exported markdown-content DOM (detached is fine).
 * @returns CSS text, or '' when the document has no KaTeX math (or fetching fails).
 */
export async function buildKatexFontCss(container: HTMLElement): Promise<string> {
    if (!container.querySelector('.katex')) return ''

    const faces = collectKatexFaces()
    if (faces.length === 0) return ''

    const used = usedKatexFamilies(container)
    // When family detection fails (no inline font-family on .katex spans), embed
    // every family found in the CSSOM — safer than emitting none.
    const wanted = used.size > 0
        ? faces.filter(f => used.has(familyKey(f.family)))
        : faces

    const blocks: string[] = []
    for (const face of wanted) {
        try {
            const resp = await fetch(face.url)
            if (!resp.ok) continue
            const buf = await resp.arrayBuffer()
            const b64 = arrayBufferToBase64(buf)
            const extraCss = face.extra ? `; ${face.extra}` : ''
            blocks.push(`@font-face { font-family: ${face.family}; src: url(data:font/woff2;base64,${b64}) format("woff2")${extraCss} }`)
        } catch {
            // Degrade silently — formulas use system fonts.
        }
    }

    return blocks.join('\n')
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}
