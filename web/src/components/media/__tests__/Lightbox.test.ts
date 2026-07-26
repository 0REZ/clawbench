import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Lightbox from '@/components/media/Lightbox.vue'

// ── Mocks ──

const mockStoreState = {
  currentDir: '/project',
  currentFile: { path: '/project/image.png', name: 'image.png' },
}

let _dirEntries = [
  { name: 'image.png', type: 'file' },
  { name: 'photo.jpg', type: 'file' },
]

const mockSelectFile = vi.fn()

vi.mock('@/stores/app.ts', () => ({
  store: {
    get state() {
      return {
        currentDir: mockStoreState.currentDir,
        currentFile: mockStoreState.currentFile,
        get dirEntries() { return _dirEntries },
      }
    },
    selectFile: (...args: any[]) => mockSelectFile(...args),
  },
}))

vi.mock('@/utils/path.ts', () => ({
  baseName: (path: string) => {
    const parts = path.split('/')
    return parts[parts.length - 1]
  },
  joinPath: (...parts: string[]) => parts.filter(Boolean).join('/'),
}))

vi.mock('@/utils/fileType.ts', () => ({
  getFileType: (name: string) => ({
    isMarkdown: name.endsWith('.md'),
    isHtml: false,
    isImage: /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name),
    isAudio: false,
    isVideo: false,
    isPdf: false,
    color: '#000',
  }),
}))

vi.mock('@/utils/download.ts', () => ({
  downloadBlob: vi.fn(),
  buildLocalFileUrl: (path: string, opts?: any) => {
    const base = `/api/local-file/${path}`
    return opts?.timestamp ? `${base}?t=1234567890` : base
  },
  downloadFileByPath: vi.fn(),
}))

vi.mock('@/utils/lightbox.ts', () => ({
  extractImageName: (src: string) => {
    try {
      const url = new URL(src, 'http://localhost')
      const path = decodeURIComponent(url.pathname)
      const prefix = '/api/local-file/'
      if (path.startsWith(prefix)) {
        return path.slice(prefix.length).split('/').pop() || ''
      }
      return path.split('/').pop() || ''
    } catch { return '' }
  },
}))

const mockUnregister = vi.fn()
const mockRegisterBackHandler = vi.fn(() => mockUnregister)

vi.mock('@/composables/useBackHandler', () => ({
  registerBackHandler: (...args: any[]) => mockRegisterBackHandler(...args),
  PRIORITY_OVERLAY: 1000,
}))

describe('Lightbox', () => {
  beforeEach(() => {
    mockSelectFile.mockClear()
    mockRegisterBackHandler.mockClear()
    mockUnregister.mockClear()
    mockStoreState.currentDir = '/project'
    mockStoreState.currentFile = { path: '/project/image.png', name: 'image.png' }
    _dirEntries = [
      { name: 'image.png', type: 'file' },
      { name: 'photo.jpg', type: 'file' },
    ]
  })

  function mountLightbox() {
    return mount(Lightbox, {
      attachTo: document.body,
    })
  }

  // ── calcFitScale ──

  describe('calcFitScale', () => {
    it('returns 1 when image fits in viewport', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      // Mock contentRef with a large viewport
      vm.contentRef = { clientWidth: 1920, clientHeight: 1080 }
      const s = vm.calcFitScale(800, 600)
      expect(s).toBe(1)
    })

    it('scales down when image is wider than viewport', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.contentRef = { clientWidth: 400, clientHeight: 800 }
      // 400/2000 = 0.2, (800-112)/1500 = 0.458, min = 0.2
      const s = vm.calcFitScale(2000, 1500)
      expect(s).toBeCloseTo(0.2, 1)
    })

    it('scales down when image is taller than viewport', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.contentRef = { clientWidth: 800, clientHeight: 400 }
      // 800/1000 = 0.8, (400-112)/2000 = 0.144, min = 0.144
      const s = vm.calcFitScale(1000, 2000)
      expect(s).toBeCloseTo(0.144, 2)
    })

    it('returns 1 when dimensions are zero or negative', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.contentRef = { clientWidth: 800, clientHeight: 600 }
      expect(vm.calcFitScale(0, 100)).toBe(1)
      expect(vm.calcFitScale(100, 0)).toBe(1)
      expect(vm.calcFitScale(-10, -10)).toBe(1)
    })

    it('returns 1 when contentRef is null', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.contentRef = null
      expect(vm.calcFitScale(800, 600)).toBe(1)
    })

    it('considers both width and height constraints', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.contentRef = { clientWidth: 500, clientHeight: 500 }
      // 500/1000 = 0.5, (500-112)/1000 = 0.388, min = 0.388
      const s = vm.calcFitScale(1000, 1000)
      expect(s).toBeCloseTo(0.388, 2)
    })
  })

  // ── Drag at scale=1 ──

  describe('drag at scale=1', () => {
    it('enables mouse drag even when scale=1', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      // Open the lightbox
      vm.open('http://localhost/test.png')
      await nextTick()

      // scale starts at 1
      expect(vm.scale).toBe(1)

      // Simulate mousedown directly
      vm.handleMouseDown({ button: 0, clientX: 100, clientY: 100, preventDefault: vi.fn() })

      expect(vm.isDragging).toBe(true)
    })

    it('enables touch drag even when scale=1', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.open('http://localhost/test.png')
      await nextTick()

      expect(vm.scale).toBe(1)

      // Simulate touchstart via direct call since test-utils doesn't support TouchList
      vm.handleTouchStart({
        touches: [{ clientX: 100, clientY: 100, clientX: 100, clientY: 100 }],
        length: 1,
      })

      expect(vm.isDragging).toBe(true)
    })
  })

  // ── fitScale and onImageLoad ──

  describe('onImageLoad', () => {
    it('sets fitScale < 1 for large images', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      // Mock contentRef with a small viewport
      vm.contentRef = { clientWidth: 400, clientHeight: 300 }
      vm.imgRef = { naturalWidth: 2000, naturalHeight: 1500 }

      vm.onImageLoad()

      expect(vm.naturalW).toBe(2000)
      expect(vm.naturalH).toBe(1500)
      expect(vm.fitScale).toBeLessThan(1)
      expect(vm.scale).toBe(vm.fitScale)
      expect(vm.dimensionsReady).toBe(true)
    })

    it('keeps fitScale=1 for images that fit', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.contentRef = { clientWidth: 1920, clientHeight: 1080 }
      vm.imgRef = { naturalWidth: 800, naturalHeight: 600 }

      vm.onImageLoad()

      expect(vm.fitScale).toBe(1)
      expect(vm.scale).toBe(1)
      expect(vm.dimensionsReady).toBe(true)
    })
  })

  // ── resetAndRefresh ──

  describe('resetAndRefresh', () => {
    it('resets scale and dimensions', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.fitScale = 0.5
      vm.scale = 2
      vm.naturalW = 2000
      vm.naturalH = 1500
      vm.dimensionsReady = true
      vm.tx = 100
      vm.ty = 50
      vm.lastTx = 100
      vm.lastTy = 50

      vm.resetAndRefresh()

      expect(vm.scale).toBe(1)
      expect(vm.fitScale).toBe(1)
      expect(vm.naturalW).toBe(0)
      expect(vm.naturalH).toBe(0)
      expect(vm.dimensionsReady).toBe(false)
      expect(vm.tx).toBe(0)
      expect(vm.ty).toBe(0)
      expect(vm.lastTx).toBe(0)
      expect(vm.lastTy).toBe(0)
    })
  })

  // ── Wheel zoom respects fitScale ──

  describe('handleWheel', () => {
    it('resets pan when zooming below fitScale', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.fitScale = 0.5
      vm.scale = 0.5
      vm.tx = 100
      vm.ty = 50
      vm.lastTx = 100
      vm.lastTy = 50

      // Zoom out further (deltaY > 0 → 0.85 multiplier)
      vm.handleWheel({ deltaY: 100 })
      // 0.5 * 0.85 = 0.425, which is < fitScale (0.5)
      expect(vm.scale).toBeLessThan(vm.fitScale)
      expect(vm.tx).toBe(0)
      expect(vm.ty).toBe(0)
    })

    it('does not reset pan when zooming above fitScale', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.fitScale = 0.5
      vm.scale = 1.0
      vm.tx = 100
      vm.ty = 50
      vm.lastTx = 100
      vm.lastTy = 50

      // Zoom in (deltaY < 0 → 1.2 multiplier)
      vm.handleWheel({ deltaY: -100 })
      expect(vm.scale).toBeGreaterThan(1)
      expect(vm.tx).toBe(100)
      expect(vm.ty).toBe(50)
    })
  })

  // ── Touch end snaps back to fitScale ──

  describe('handleTouchEnd snap back', () => {
    it('snaps back to fitScale when zoomed below it', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.fitScale = 0.5
      vm.scale = 0.3
      vm.tx = 50
      vm.ty = 30

      vm.handleTouchEnd(new TouchEvent('touchend'))

      expect(vm.scale).toBe(0.5)
      expect(vm.tx).toBe(0)
      expect(vm.ty).toBe(0)
    })

    it('preserves position when at or above fitScale', () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any

      vm.fitScale = 0.5
      vm.scale = 1.0
      vm.tx = 50
      vm.ty = 30

      vm.handleTouchEnd(new TouchEvent('touchend'))

      expect(vm.scale).toBe(1.0)
      expect(vm.lastTx).toBe(50)
      expect(vm.lastTy).toBe(30)
    })
  })

  // ── Basic rendering ──

  it('renders lightbox container (teleported to body)', () => {
    mountLightbox()
    expect(document.querySelector('.lightbox')).toBeTruthy()
  })

  it('is hidden by default', () => {
    mountLightbox()
    const el = document.querySelector('.lightbox') as HTMLElement
    expect(el?.style.display).toBe('none')
  })

  it('shows lightbox when open is called', async () => {
    const wrapper = mountLightbox()
    const vm = wrapper.vm as any
    vm.open('http://localhost/test.png')
    await nextTick()
    // Check via the reactive state, not DOM (Teleport makes DOM assertions unreliable)
    expect(vm.lightboxVisible).toBe(true)
  })

  // ── Back handler registration (edge swipe / Android back) ──

  describe('back handler', () => {
    it('registers back handler when opened', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.open('http://localhost/test.png')
      await nextTick()

      expect(mockRegisterBackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'lightbox',
          priority: 1000,
        }),
      )
    })

    it('back handler goBack closes the lightbox', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.open('http://localhost/test.png')
      await nextTick()

      const handler = mockRegisterBackHandler.mock.calls[0][0]
      expect(handler.canGoBack()).toBe(true)
      handler.goBack()
      expect(vm.lightboxVisible).toBe(false)
    })

    it('unregisters back handler when closed', async () => {
      const wrapper = mountLightbox()
      const vm = wrapper.vm as any
      vm.open('http://localhost/test.png')
      await nextTick()

      expect(mockRegisterBackHandler).toHaveBeenCalled()

      vm.close()
      await nextTick()

      expect(mockUnregister).toHaveBeenCalled()
    })
  })
})
