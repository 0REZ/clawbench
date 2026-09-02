// Per-path file scroll cache — module-level singleton so it survives FileViewer
// unmount/remount (e.g. the file overlay closing and reopening). The cache was
// previously a component-instance Map inside FileViewer, which was destroyed
// whenever the overlay closed (v-if="overlayOpen"), losing each file's scroll
// position when the same file was reopened later from the recent-files list.

const MAX_ENTRIES = 100

/** Module-level singleton: path -> last scrollTop (px). */
const cache = new Map<string, number>()

export function getFileScroll(path: string): number | undefined {
  return cache.get(path)
}

export function setFileScroll(path: string, scrollTop: number): void {
  // Delete-then-set keeps the entry at the tail (LRU semantics).
  if (cache.has(path)) cache.delete(path)
  cache.set(path, scrollTop)
  // Bound the module-level Map so it can't grow without limit.
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** @internal Reset all cached positions — for tests only. */
export function _resetFileScrollCache(): void {
  cache.clear()
}
