// Mermaid diagram utilities
import { getMermaid } from './globals.ts'

// Initialize Mermaid (called once on app startup)
export async function initMermaid(): Promise<void> {
    const mermaid = await getMermaid()
    mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    })
}

// Re-render all rendered mermaid diagrams on the page (called after theme switch)
export async function reRenderMermaid(): Promise<void> {
    const mermaid = await getMermaid()
    document.querySelectorAll<HTMLDivElement>('div.mermaid[data-mermaid]').forEach(container => {
        const source = container.dataset.mermaid
        if (!source) return
        const id = container.id || `mermaid-${Date.now()}`
        container.removeAttribute('id')
        mermaid.render(id, source).then(result => {
            container.innerHTML = result.svg
            container.id = id
        }).catch(() => {})
    })
}
