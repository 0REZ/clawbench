import { ref } from 'vue'

// Module-level singleton — all consumers share the same state.
const appInForeground = ref(true)
let initialized = false

// Foreground-transition listeners. Consumers (e.g. useChatSession) use these
// to react to the moment the app re-enters the foreground — e.g. marking the
// currently-active session read when the user returns after a session
// completed in the background. Kept separate from the state ref because the
// listener must fire per actual transition, not just on value reads.
const foregroundListeners: Array<(fg: boolean) => void> = []

/**
 * Subscribe to foreground transitions. The callback fires with the new
 * foreground state on every actual change (entering or leaving the
 * foreground). Returns an unsubscribe function.
 */
export function onAppForeground(cb: (fg: boolean) => void): () => void {
  foregroundListeners.push(cb)
  return () => {
    const idx = foregroundListeners.indexOf(cb)
    if (idx !== -1) foregroundListeners.splice(idx, 1)
  }
}

/**
 * Reliable app foreground/background signal for the WebView frontend.
 *
 * Background signal sources (first match wins):
 * 1. Native host push: Android MainActivity.onPause/onResume calls the injected
 *    global `window.__setAppForeground(boolean)`. This is authoritative —
 *    document.visibilityState is unreliable in Android WebView (onPause() does
 *    not reliably flip it to 'hidden').
 * 2. Fallback: the Page Visibility API (works on desktop browsers/Electron).
 *
 * The completion paths in the chat UI use this to decide whether marking a
 * just-completed session read is a genuine user action (app is visible) or a
 * background auto-refresh that must NOT clear the unread badge — the floating
 * status window shows unread sessions only while the app is in the background.
 */
export function useAppForeground() {
  if (!initialized) {
    initialized = true
    const setForeground = (fg: boolean) => {
      if (appInForeground.value === fg) return
      appInForeground.value = fg
      for (const cb of foregroundListeners) {
        try {
          cb(fg)
        } catch {
          // A listener error must never break the foreground signal chain.
        }
      }
    }
    // Native host pushes the app lifecycle state (authoritative on Android).
    const w = window as unknown as { __setAppForeground?: (fg: boolean) => void }
    if (typeof w.__setAppForeground === 'function') {
      w.__setAppForeground = setForeground
    }
    // Fallback for non-native hosts: keep in sync with the Page Visibility API.
    document.addEventListener('visibilitychange', () => {
      setForeground(document.visibilityState === 'visible')
    })
  }
  return { appInForeground }
}
