import { watch, type Ref } from 'vue'
import { store } from '@/stores/app.ts'
import { appLog } from '@/utils/appLog'

const STORAGE_KEY_PREFIX = 'clawbench-recent-session:'
const TAG = 'RecentSession'

export interface RecentSessionEntry {
  sessionId: string
  accessedAt: number
}

// Holds the current session id ref registered by useSessionIdentity.
// Kept in this module so the watch lives here while the ref source
// stays in useSessionIdentity (avoids a circular import).
let _sessionIdRef: Ref<string> | null = null

// Guard flag so the storage watcher is only installed once.
let _watcherInstalled = false

function storageKey(): string {
  const root = store.state.projectRoot || ''
  return STORAGE_KEY_PREFIX + root
}

function loadFromStorage(): RecentSessionEntry | null {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as RecentSessionEntry
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId) {
      return parsed
    }
    return null
  } catch (e) {
    appLog.w(TAG, 'loadFromStorage failed:', e)
    return null
  }
}

function saveToStorage(entry: RecentSessionEntry | null) {
  try {
    if (entry) {
      localStorage.setItem(storageKey(), JSON.stringify(entry))
    } else {
      localStorage.removeItem(storageKey())
    }
  } catch (e) {
    appLog.w(TAG, 'saveToStorage failed:', e)
  }
}

/**
 * Register the reactive currentSessionId ref so the module can watch it
 * and persist every session that becomes current (per project).
 * Called once by useSessionIdentity at module init.
 */
export function registerSessionIdRef(ref: Ref<string>) {
  _sessionIdRef = ref
  installWatcher()
}

function installWatcher() {
  if (_watcherInstalled || !_sessionIdRef) return
  _watcherInstalled = true
  watch(
    _sessionIdRef,
    (id) => {
      // Skip empty values (resetIdentity / delete-session clears) so a
      // cleared session never overwrites the last remembered session.
      if (!id) return
      recordRecentSession(id)
    },
    { flush: 'post' },
  )
}

/** Get the last opened session id for the current project, or null. */
export function getRecentSession(): string | null {
  return loadFromStorage()?.sessionId ?? null
}

/**
 * Record a session as the last opened for the current project.
 * Overwrites the previous single value.
 */
export function recordRecentSession(sessionId: string) {
  if (!sessionId || !store.state.projectRoot) return
  saveToStorage({ sessionId, accessedAt: Date.now() })
}

/** Remove the stored recent session for the current project. */
export function clearRecentSession() {
  saveToStorage(null)
}

/** @internal Reset all state — for tests only */
export function _resetForTesting() {
  _sessionIdRef = null
  _watcherInstalled = false
}
