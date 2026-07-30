/**
 * Lazy-loaded mermaid singleton.
 *
 * mermaid.core (608KB) is split into a separate chunk via dynamic import().
 * It is only loaded when getMermaid() is called at runtime — i.e., when a
 * chat message contains a mermaid diagram.
 */

let _mermaid: typeof import('mermaid').default | null = null

export async function getMermaid() {
    if (!_mermaid) {
        const mod = await import('mermaid')
        _mermaid = mod.default
    }
    return _mermaid
}
