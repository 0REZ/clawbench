/**
 * Shared Markdown → rendered HTML pipeline for FILE PREVIEW context.
 *
 * Both MarkdownPreview.vue (the on-screen file preview) and the HTML exporter
 * (exportMarkdownHtml.ts) render a markdown *file* the same way, so a file
 * exported to standalone HTML looks pixel-identical to the in-app preview.
 *
 * This differs from the chat-render pipeline in `useMarkdownRenderer.ts`:
 * - file previews pass `sanitize: false` (the file is a trusted local artifact)
 * - file previews skip the chat enhancement block (skipEnhancements: true):
 *   no audio/video conversion, no worktree/commit/localhost annotations, no
 *   `chat-img` classes. Local images are rewritten by a caller-supplied
 *   `fixImagePaths` function that resolves relative paths against the markdown
 *   file's own directory (see createFixLocalImagePaths).
 * - file previews then run `annotateFilePaths` with `baseDir = dirName(path)`
 *   (component-level, in the caller) so relative links resolve to the file's dir.
 */

import { renderMarkdownHtml } from '@/composables/useMarkdownRenderer.ts'
import { annotateFilePaths } from '@/composables/useFilePathAnnotation.ts'
import { dirName, joinPath, splitPath } from '@/utils/path.ts'
import { isThumbExtension, buildThumbUrl, getThumbWidth } from '@/utils/chatRenderUtils.ts'
import { usePlatformDetect } from '@/composables/usePlatformDetect.ts'

/** Source markdown file to render (the file being previewed / exported). */
export interface MarkdownSource {
    /** Raw markdown content. */
    content: string
    /** File path (project-relative). Used to resolve relative image paths. */
    path: string
    /** Project root (project-relative prefix for file-path annotations). */
    projectRoot?: string
    /** User home directory (for ~/ path expansion). */
    homeDir?: string
}

/** Options controlling local-image URL rewriting. */
export interface FixLocalImagePathsOptions {
    /** Directory of the markdown file; relative image srcs resolve against it. */
    baseDir: string
    /** Cache-buster appended to /api/local-file/ URLs (?t=…). */
    imageTimestamp: number
    /** Desktop (true) uses a wider inline thumbnail. */
    isPC: boolean
}

/**
 * Build the `fixImagePaths` callback used by MarkdownPreview / the exporter.
 *
 * Resolves relative `<img src>` paths against the markdown file's directory:
 * - http(s)://, protocol-relative //, leading-/ and data: URIs are untouched;
 * - other relative paths are resolved against `baseDir`, normalized, and served
 *   as `/api/local-file/<rel>?t=<ts>` (cache-busted);
 * - raster formats the thumb endpoint can decode (png/jpg/jpeg) get a lightweight
 *   JPEG thumbnail inline src (`/api/file/thumb?path=…&w=…`) plus the original
 *   URL kept in `data-full-src` for the lightbox;
 * - every <img> is wrapped in a `.lightbox-img-wrap` span so the exported HTML
 *   gets the same hover-to-expand affordance as the preview.
 */
export function createFixLocalImagePaths(opts: FixLocalImagePathsOptions): (html: string) => string {
    const { baseDir, imageTimestamp, isPC } = opts
    return function fixLocalImagePaths(html: string): string {
        const currentDir = baseDir
        let result = html.replace(/<img\s+([^>]*src=[^>]*)>/gi, (match: string, attrs: string) => {
            const srcMatch = attrs.match(/src="([^"]*)"/)
            if (!srcMatch) return match
            const src = srcMatch[1]
            if (/^(https?:|\/\/|^\/|data:)/i.test(src)) return match
            let resolved = joinPath(currentDir, src)
            try {
                resolved = decodeURIComponent(resolved)
            } catch { /* malformed encoding, use as-is */ }
            const parts = splitPath(resolved)
            const normalized = []
            for (const part of parts) {
                if (part === '.' || part === '') continue
                if (part === '..') { normalized.pop(); continue }
                normalized.push(encodeURIComponent(part))
            }
            const rel = normalized.join('/')
            const fullSrc = `/api/local-file/${rel}?t=${imageTimestamp}`
            // Raster formats the thumb endpoint can decode → use a lightweight JPEG
            // thumbnail for the inline src (kept stable so ETag revalidation refreshes
            // it when the source file changes) and keep the full image for the lightbox.
            // Other formats (svg/webp/gif/… ) keep serving the original full-size file.
            const thumbSrc = isThumbExtension(src) ? buildThumbUrl(rel, getThumbWidth(isPC)) : null
            const replacement = thumbSrc
                ? `src="${thumbSrc}" data-full-src="${fullSrc}"`
                : `src="${fullSrc}"`
            return match.replace(`src="${src}"`, replacement)
        })
        // Add lightbox-img class to all <img> tags for lightbox activation
        result = result.replace(/<img(\s+[^>]*?)>/gi, (_match: string, attrs: string) => {
            const clean = attrs.replace(/\s*class="[^"]*"/i, '')
            return `<span class="lightbox-img-wrap"><img${clean} class="lightbox-img"><span class="lightbox-expand-icon"></span></span>`
        })
        return result
    }
}

/** Result of rendering markdown source. */
export interface BuildMarkdownPreviewDomResult {
    /** Rendered + file-path-annotated HTML (for .markdown-content innerHTML). */
    html: string
    /** Detected file paths — pass to verifyFilePaths for disk-based correction. */
    detectedPaths: string[]
}

/**
 * Render a markdown *file* exactly like MarkdownPreview.vue does.
 *
 * Pipeline (mirrors MarkdownPreview.doRender):
 *   renderMarkdownHtml(content, { sanitize: false, skipEnhancements: true,
 *                                 fixImagePaths })   → annotated string
 *   annotateFilePaths(html, { projectRoot, baseDir: dirName(path), homeDir })
 *
 * @param source The markdown file to render.
 * @param opts   Runtime knobs (thumbnail width / cache-buster). Omitted in tests.
 */
export function buildMarkdownPreviewDom(
    source: MarkdownSource,
    opts: { isPC?: boolean; imageTimestamp?: number } = {}
): BuildMarkdownPreviewDomResult {
    const { content, path, projectRoot = '', homeDir = '' } = source
    const currentDir = path ? dirName(path) : ''
    const { isPC } = usePlatformDetect()

    const effectiveIsPC = opts.isPC ?? isPC.value
    const imageTimestamp = opts.imageTimestamp ?? Date.now()

    const html = renderMarkdownHtml(content, {
        sanitize: false,
        skipEnhancements: true,
        fixImagePaths: createFixLocalImagePaths({
            baseDir: currentDir,
            imageTimestamp,
            isPC: effectiveIsPC,
        }),
    })

    const { html: annotatedHtml, detectedPaths } = annotateFilePaths(html, {
        projectRoot,
        baseDir: currentDir,
        homeDir,
    })

    return { html: annotatedHtml, detectedPaths }
}
