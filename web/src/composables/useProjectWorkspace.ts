// Workspace restore shared by app startup and project switch.
//
// restoreProjectWorkspace() restores the current project's last browsed
// directory and last opened file. It is the single source of truth used by
// both initializeApp (cold start) and hotSwitchProject (SPA project switch),
// keeping the two paths from diverging.
//
// When a saved file is restored and the caller passes activateView: true,
// switchTab('view') re-activates the file-view tab. This was originally used on
// project switch to bring the restored file's viewer back into view.
//
// Both cold start AND project switch now pass activateView: false (or omit it):
// the file is restored to state (the header badge shows it) but the app stays
// on the chat tab, keeping the landing tab consistent across both paths. The
// user opens the restored file explicitly (header badge / file manager), just
// like on cold start.
import { useFileNavStack } from '@/composables/useFileNavStack'
import { useToast } from '@/composables/useToast'
import { gt } from '@/composables/useLocale'
import { store, loadBrowseDir, loadOpenFile, clearStaleOpenFile } from '@/stores/app'

export interface RestoreWorkspaceOptions {
  /**
   * Activate a tab, e.g. 'view'. Injected by the caller (App.vue) so the logic is testable.
   * Only called when `activateView` is true.
   */
  switchTab: (tab: string) => void
  /**
   * Whether restoring the last opened file should also activate the file-view
   * tab. Defaults to false. Both cold start and project switch keep this false
   * so the app always lands on the chat tab — the file is restored to state
   * (header badge) but the view tab is not auto-activated.
   */
  activateView?: boolean
}

export async function restoreProjectWorkspace(opts: RestoreWorkspaceOptions): Promise<void> {
  const fileNav = useFileNavStack()
  const toast = useToast()
  const { switchTab, activateView = false } = opts

  // Restore last browsed directory, falling back to the project root if the
  // saved directory no longer exists.
  const savedDir = loadBrowseDir()
  if (savedDir) {
    try {
      await store.loadFiles(savedDir, true)
    } catch {
      try { await store.loadFiles('') } catch { /* ignore */ }
    }
  } else {
    try { await store.loadFiles('') } catch {
      toast.show(gt('toast.fileListLoadFailed'), { icon: '⚠️', type: 'error', duration: 6000 })
    }
  }

  // Restore last opened file (per-project).
  const savedFile = loadOpenFile()
  if (savedFile) {
    const ok = await store.selectFile(savedFile)
    if (ok) {
      fileNav.openFile(savedFile)
      // On cold start the app must land on the chat tab; only re-activate the
      // file-view tab when the user is switching projects explicitly.
      if (activateView) switchTab('view')
    } else {
      // File no longer exists — clear the stale record to avoid repeated failures.
      clearStaleOpenFile()
    }
  }
}
