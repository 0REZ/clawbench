import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { nextTick, ref, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import UpgradeDialog from '@/components/settings/UpgradeDialog.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      upgrade: {
        title: '升级',
        checking: '检查中',
        alreadyLatest: '已是最新',
        downloading: '下载中',
        extracting: '解压中',
        backingUp: '备份中',
        replacing: '替换中',
        restarting: '重启中',
        completed: '完成',
        failed: '失败',
        retry: '重试',
        start: '开始升级',
        cancel: '取消',
        close: '关闭',
        releaseNotes: '发行说明 {version}',
        backupPath: '备份路径: {path}',
      },
    },
  },
})

// Mock useUpgrade composable
const mockState = reactive({
  phase: '' as string,
  progress: 0,
  current_version: '1.0.0',
  latest_version: '1.1.0',
  message: '',
  error: '',
  backup_path: '',
})

const mockChecking = ref(false)
const mockHasUpgrade = ref(true)
const mockIsInProgress = ref(false)
const mockIsRestarting = ref(false)
const mockIsCompleted = ref(false)
const mockIsFailed = ref(false)
const mockReleaseNotesUrl = ref('https://example.com/releases')

const mockCheckUpgrade = vi.fn()
const mockStartUpgrade = vi.fn()

vi.mock('@/composables/useUpgrade', () => ({
  useUpgrade: () => ({
    state: mockState,
    checking: mockChecking,
    hasUpgrade: mockHasUpgrade,
    isInProgress: mockIsInProgress,
    isRestarting: mockIsRestarting,
    isCompleted: mockIsCompleted,
    isFailed: mockIsFailed,
    checkUpgrade: mockCheckUpgrade,
    startUpgrade: mockStartUpgrade,
    releaseNotesUrl: mockReleaseNotesUrl,
  }),
}))

vi.mock('@/composables/useBackHandler', () => ({
  registerBackHandler: vi.fn(() => vi.fn()),
  PRIORITY_OVERLAY: 1000,
}))

// UpgradeDialog Teleports its overlay to <body>, so DOM lookups must go
// through document.body — the dialog content is not part of the component's
// own wrapper tree.
function $(selector: string): HTMLElement | null {
  return document.body.querySelector(selector)
}

let wrapper: VueWrapper | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (wrapper) {
    wrapper.unmount()
    wrapper = null
  }
  if (host?.parentNode) host.parentNode.removeChild(host)
  host = null
  document.body.querySelectorAll('.ug-overlay').forEach((el) => el.remove())
})

function mountDialog() {
  host = document.createElement('div')
  document.body.appendChild(host)
  wrapper = mount(UpgradeDialog, {
    attachTo: host,
    global: { plugins: [i18n] },
  })
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset all mock state
  Object.assign(mockState, {
    phase: '',
    progress: 0,
    current_version: '1.0.0',
    latest_version: '1.1.0',
    message: '',
    error: '',
    backup_path: '',
  })
  mockChecking.value = false
  mockHasUpgrade.value = true
  mockIsInProgress.value = false
  mockIsRestarting.value = false
  mockIsCompleted.value = false
  mockIsFailed.value = false
  mockReleaseNotesUrl.value = 'https://example.com/releases'
})

describe('UpgradeDialog', () => {
  describe('show method', () => {
    it('shows dialog when show() is called', async () => {
      const wrapper = mountDialog()
      // Initially hidden
      expect($('.ug-overlay')).toBeFalsy()

      // Call show
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-overlay')).toBeTruthy()
    })

    it('calls checkUpgrade when phase is empty', async () => {
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(mockCheckUpgrade).toHaveBeenCalled()
    })

    it('does not call checkUpgrade when phase is already set', async () => {
      mockState.phase = 'downloading'
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(mockCheckUpgrade).not.toHaveBeenCalled()
    })
  })

  describe('close method', () => {
    it('hides dialog when close is called', async () => {
      vi.useFakeTimers()
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-overlay')).toBeTruthy()

      // Click cancel button
      $('.ug-cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      // The leave transition keeps the overlay mounted until it finishes
      vi.advanceTimersByTime(300)
      await nextTick()
      expect($('.ug-overlay')).toBeFalsy()
      vi.useRealTimers()
    })

    it('clicking close button hides dialog', async () => {
      vi.useFakeTimers()
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()

      // Click the X close button
      const closeBtn = $('.ug-close')!
      expect(closeBtn).toBeTruthy()
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      // The leave transition keeps the overlay mounted until it finishes
      vi.advanceTimersByTime(300)
      await nextTick()
      expect($('.ug-overlay')).toBeFalsy()
      vi.useRealTimers()
    })
  })

  describe('checking state', () => {
    it('shows loading indicator when checking', async () => {
      mockChecking.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-progress-area')).toBeTruthy()
    })
  })

  describe('version display', () => {
    it('shows version info when upgrade available', async () => {
      mockChecking.value = false
      mockHasUpgrade.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-versions')).toBeTruthy()
      expect($('.ug-ver-current')!.textContent).toBe('1.0.0')
      expect($('.ug-ver-latest')!.textContent).toBe('1.1.0')
    })

    it('shows no-upgrade message when no upgrade available', async () => {
      mockChecking.value = false
      mockHasUpgrade.value = false
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-no-upgrade')).toBeTruthy()
    })

    it('shows release notes link when available', async () => {
      mockChecking.value = false
      mockHasUpgrade.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-release-link')).toBeTruthy()
    })

    it('does not show release notes link when not available', async () => {
      mockChecking.value = false
      mockHasUpgrade.value = true
      mockReleaseNotesUrl.value = ''
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-release-link')).toBeFalsy()
    })
  })

  describe('phaseMessage computed', () => {
    it('shows checking message', async () => {
      mockState.phase = 'checking'
      mockChecking.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('检查中')
    })

    it('shows downloading message', async () => {
      mockState.phase = 'downloading'
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('下载中')
    })

    it('shows extracting message', async () => {
      mockState.phase = 'extracting'
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('解压中')
    })

    it('shows backing_up message', async () => {
      mockState.phase = 'backing_up'
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('备份中')
    })

    it('shows replacing message', async () => {
      mockState.phase = 'replacing'
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('替换中')
    })

    it('shows restarting message', async () => {
      mockState.phase = 'restarting'
      mockIsRestarting.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('重启中')
    })

    it('shows state.message for unknown phase', async () => {
      mockState.phase = 'unknown'
      mockState.message = 'Custom message'
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect(document.body.textContent).toContain('Custom message')
    })
  })

  describe('progress bar', () => {
    it('shows progress bar during downloading phase', async () => {
      mockState.phase = 'downloading'
      mockState.progress = 60
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-progress-bar')).toBeTruthy()
      expect($('.ug-progress-fill')).toBeTruthy()
    })
  })

  describe('completed state', () => {
    it('shows completed message', async () => {
      mockIsCompleted.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-completed')).toBeTruthy()
      expect(document.body.textContent).toContain('完成')
    })

    it('shows backup path when available', async () => {
      mockIsCompleted.value = true
      mockState.backup_path = '/tmp/backup'
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-backup-path')).toBeTruthy()
      expect(document.body.textContent).toContain('/tmp/backup')
    })
  })

  describe('failed state', () => {
    it('shows failed message', async () => {
      mockIsFailed.value = true
      mockState.error = 'Network error'
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-failed')).toBeTruthy()
      expect(document.body.textContent).toContain('失败')
      expect(document.body.textContent).toContain('Network error')
    })
  })

  describe('canClose computed', () => {
    it('can close when completed', async () => {
      mockIsCompleted.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-close')).toBeTruthy()
      expect($('.ug-cancel')).toBeTruthy()
    })

    it('can close when failed', async () => {
      mockIsFailed.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-close')).toBeTruthy()
    })

    it('can close when not in progress', async () => {
      mockIsInProgress.value = false
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-close')).toBeTruthy()
    })

    it('cannot close when in progress', async () => {
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-close')).toBeFalsy()
    })
  })

  describe('start upgrade button', () => {
    it('shows start button when upgrade available', async () => {
      mockHasUpgrade.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-start')).toBeTruthy()
    })

    it('shows retry text when failed', async () => {
      mockHasUpgrade.value = true
      mockIsFailed.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-start')!.textContent).toBe('重试')
    })

    it('calls startUpgrade on click', async () => {
      mockHasUpgrade.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      $('.ug-start')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(mockStartUpgrade).toHaveBeenCalled()
    })

    it('does not show start button when no upgrade available', async () => {
      mockHasUpgrade.value = false
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-start')).toBeFalsy()
    })

    it('does not show start button when in progress', async () => {
      mockHasUpgrade.value = true
      mockIsInProgress.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-start')).toBeFalsy()
    })

    it('does not show start button when completed', async () => {
      mockHasUpgrade.value = true
      mockIsCompleted.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-start')).toBeFalsy()
    })
  })

  describe('cancel button text', () => {
    it('shows close text when completed', async () => {
      mockIsCompleted.value = true
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-cancel')!.textContent).toBe('关闭')
    })

    it('shows cancel text when not completed', async () => {
      const wrapper = mountDialog()
      ;(wrapper!.vm as any).show()
      await nextTick()
      expect($('.ug-cancel')!.textContent).toBe('取消')
    })
  })
})
