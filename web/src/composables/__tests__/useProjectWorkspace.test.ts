import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { restoreProjectWorkspace } from '@/composables/useProjectWorkspace'
import { store } from '@/stores/app'

vi.mock('@/utils/appLog', () => ({
  appLog: { d: vi.fn(), i: vi.fn(), w: vi.fn(), e: vi.fn() },
}))

const mockToastShow = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ show: mockToastShow }),
}))

vi.mock('@/composables/useLocale', () => ({
  gt: (key: string) => key,
}))

const openFileMock = vi.fn()
vi.mock('@/composables/useFileNavStack', () => ({
  useFileNavStack: () => ({ openFile: openFileMock }),
}))

const OPEN_FILE_PREFIX = 'clawbench-open-file:'
const BROWSE_DIR_PREFIX = 'clawbench-browse-dir:'

describe('restoreProjectWorkspace', () => {
  const PROJECT = '/project/a'

  beforeEach(() => {
    localStorage.clear()
    store.state.projectRoot = PROJECT
    store.state.currentFile = null
    openFileMock.mockClear()
    mockToastShow.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores the saved file and re-activates the view tab (switchTab("view"))', async () => {
    localStorage.setItem(OPEN_FILE_PREFIX + PROJECT, 'web/src/App.vue')
    vi.spyOn(store, 'loadFiles').mockResolvedValue(undefined)
    vi.spyOn(store, 'selectFile').mockResolvedValue(true)
    const switchTab = vi.fn()

    await restoreProjectWorkspace({ switchTab, activateView: true })

    expect(store.selectFile).toHaveBeenCalledWith('web/src/App.vue')
    expect(openFileMock).toHaveBeenCalledWith('web/src/App.vue')
    // Project switch: the restored file must bring the file-view tab back
    // (regression: after a project switch the file was restored to state but
    // the viewer was not shown).
    expect(switchTab).toHaveBeenCalledWith('view')
  })

  it('restores the saved file but stays on chat on cold start (no switchTab)', async () => {
    localStorage.setItem(OPEN_FILE_PREFIX + PROJECT, 'web/src/App.vue')
    vi.spyOn(store, 'loadFiles').mockResolvedValue(undefined)
    vi.spyOn(store, 'selectFile').mockResolvedValue(true)
    const switchTab = vi.fn()

    // Cold start: activateView defaults to false — the app must land on the
    // chat tab even though a file was previously open (regression: startup
    // jumped to the file-view tab).
    await restoreProjectWorkspace({ switchTab })

    expect(store.selectFile).toHaveBeenCalledWith('web/src/App.vue')
    expect(openFileMock).toHaveBeenCalledWith('web/src/App.vue')
    expect(switchTab).not.toHaveBeenCalled()
  })

  it('does not activate the view tab when no saved file exists', async () => {
    vi.spyOn(store, 'loadFiles').mockResolvedValue(undefined)
    const switchTab = vi.fn()

    await restoreProjectWorkspace({ switchTab })

    expect(openFileMock).not.toHaveBeenCalled()
    expect(switchTab).not.toHaveBeenCalled()
  })

  it('clears a stale open-file record when the saved file can no longer be opened', async () => {
    localStorage.setItem(OPEN_FILE_PREFIX + PROJECT, 'web/src/App.vue')
    vi.spyOn(store, 'loadFiles').mockResolvedValue(undefined)
    vi.spyOn(store, 'selectFile').mockResolvedValue(false)
    const switchTab = vi.fn()

    await restoreProjectWorkspace({ switchTab })

    expect(openFileMock).not.toHaveBeenCalled()
    expect(switchTab).not.toHaveBeenCalled()
    expect(localStorage.getItem(OPEN_FILE_PREFIX + PROJECT)).toBeNull()
  })

  it('does not switch to view when the saved file is stale even with activateView', async () => {
    localStorage.setItem(OPEN_FILE_PREFIX + PROJECT, 'web/src/App.vue')
    vi.spyOn(store, 'loadFiles').mockResolvedValue(undefined)
    vi.spyOn(store, 'selectFile').mockResolvedValue(false)
    const switchTab = vi.fn()

    // Project switch with activateView: the stale-file branch must still not
    // call switchTab — only a successfully restored file may re-activate view.
    await restoreProjectWorkspace({ switchTab, activateView: true })

    expect(switchTab).not.toHaveBeenCalled()
    expect(localStorage.getItem(OPEN_FILE_PREFIX + PROJECT)).toBeNull()
  })

  it('loads the saved browse directory, falling back to the project root', async () => {
    localStorage.setItem(BROWSE_DIR_PREFIX + PROJECT, 'web/src')
    const loadFiles = vi.spyOn(store, 'loadFiles').mockResolvedValue(undefined)

    await restoreProjectWorkspace({ switchTab: vi.fn() })

    expect(loadFiles).toHaveBeenCalledWith('web/src', true)
  })
})
