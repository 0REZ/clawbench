/**
 * Module-level singleton share state for the current file being viewed.
 *
 * The FileHeader share-link button needs to show an "active" state when the
 * currently open file already has a public share link. Share state is
 * server-persisted and can change from a different component (ShareLinkDialog),
 * so it is kept in a module-level Set of shared paths that any component can
 * read (isFileShared) or mutate (markShared / markUnshared) without prop drilling.
 *
 * refreshFileShare queries the backend for a single path and seeds the Set from
 * the authoritative server state.
 */

import { reactive } from 'vue'
import { appLog } from '@/utils/appLog'

const TAG = 'FileShare'

// reactive(new Set()) so add/delete mutations trigger Vue reactivity in
// computed properties (isFileShared) across components.
const sharedPaths = reactive(new Set<string>())

async function refreshFileShare(path: string): Promise<boolean> {
    if (!path) return false
    try {
        const resp = await fetch(`/api/share?path=${encodeURIComponent(path)}`)
        if (!resp.ok) return false
        const data = await resp.json() as { path?: string }
        if (data.path) {
            sharedPaths.add(path)
            return true
        }
        sharedPaths.delete(path)
        return false
    } catch (err) {
        appLog.e(TAG, 'refresh share state failed:', err)
        return false
    }
}

function markShared(path: string): void {
    if (path) sharedPaths.add(path)
}

function markUnshared(path: string): void {
    if (path) sharedPaths.delete(path)
}

function isFileShared(path: string): boolean {
    return !!path && sharedPaths.has(path)
}

/** Clear all cached share state (used when the app project changes). */
function resetFileShareState(): void {
    sharedPaths.clear()
}

export function useFileShare() {
    return { refreshFileShare, markShared, markUnshared, isFileShared, resetFileShareState }
}
