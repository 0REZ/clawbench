/**
 * Lazy-loaded mermaid singleton.
 *
 * mermaid.core (608KB) is split into a separate chunk via dynamic import().
 * It is only loaded when getMermaid() is called at runtime — i.e., when a
 * chat message contains a mermaid diagram.
 */

let _mermaid: typeof import('mermaid').default | null = null
let _mermaidPending: Promise<typeof import('mermaid').default> | null = null

export async function getMermaid() {
    if (_mermaid) return _mermaid
    if (_mermaidPending) return _mermaidPending
    _mermaidPending = import('mermaid').then(mod => {
        _mermaid = mod.default
        _mermaidPending = null
        return _mermaid
    }).catch(err => {
        _mermaidPending = null
        throw err
    })
    return _mermaidPending
}
