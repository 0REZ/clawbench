// Workspace restore shared by app startup and project switch.
//
// restoreProjectWorkspace() restores the current project's last browsed
// directory and last opened file. It is the single source of truth used by
// both initializeApp (cold start) and hotSwitchProject (SPA project switch),
// keeping the two paths from diverging.
//
// When a saved file is restored, the caller's switchTab('view') re-activates
// the file-view tab. This is required on project switch: resetProjectState()
// nulls currentFile, and the currentFile watcher falls back to the browse tab,
// so without this the restored file stays in state (the header badge shows it)
// but the viewer is never brought back to view. Mirroring handleSelectFile,
// which calls switchTab('view') after opening.
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
   * tab. True on project switch (the user explicitly chose that project and
   * expects its file context), false on cold app start — where the app should
   * land on the chat tab by default even if a file was previously open.
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
