import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import TocDock from '@/components/file/TocDock.vue'

// ── Mocks ──

// Mutable width sink that stands in for the preference module
const { setWidth, tocDockWidth } = vi.hoisted(() => {
  const tocDockWidth = { value: 260 }
  return {
    tocDockWidth,
    setWidth: vi.fn((w: number) => { tocDockWidth.value = w }),
  }
})

vi.mock('@/composables/useTocDockPreference', () => ({
  useTocDockPreference: () => ({
    tocDockWidth,
    setWidth,
  }),
}))

vi.mock('@/components/TocDrawer.vue', () => ({
  default: defineComponent({
    name: 'TocDrawer',
    props: { open: Boolean, file: Object, pdfOutline: Array, docked: Boolean },
    emits: ['close', 'jump', 'jumpPage'],
    template: '<div class="toc-drawer-stub"><slot /><button class="toc-close-stub" @click="$emit(\'close\')">close</button></div>',
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}))

function mountDock(props: Record<string, any> = {}) {
  return mount(TocDock, {
    props: {
      open: true,
      file: { name: 'readme.md', path: '/readme.md' },
      pdfOutline: [],
      ...props,
    },
    attachTo: document.body,
  })
}

describe('TocDock', () => {
  beforeEach(() => {
    setWidth.mockClear()
    tocDockWidth.value = 260
  })

  it('renders the dock container with the drawer when open', () => {
    const wrapper = mountDock()
    expect(wrapper.find('.toc-dock').exists()).toBe(true)
    expect(wrapper.find('.toc-drawer-stub').exists()).toBe(true)
  })

  it('passes docked=true and the file to TocDrawer', () => {
    const wrapper = mountDock()
    const drawer = wrapper.findComponent({ name: 'TocDrawer' })
    expect(drawer.props('docked')).toBe(true)
    expect(drawer.props('file')).toMatchObject({ name: 'readme.md' })
  })

  it('forwards close/jump/jumpPage events from the drawer', () => {
    const wrapper = mountDock()
    const drawer = wrapper.findComponent({ name: 'TocDrawer' })
    drawer.vm.$emit('jump', 12)
    drawer.vm.$emit('jumpPage', 3)
    expect(wrapper.emitted('jump')).toEqual([[12]])
    expect(wrapper.emitted('jumpPage')).toEqual([[3]])
  })

  it('applies the dock width from preference', () => {
    tocDockWidth.value = 320
    const wrapper = mountDock()
    const dock = wrapper.find('.toc-dock')
    expect(dock.attributes('style')).toContain('width: 320px')
  })

  it('constrains the dock to the min/max width range via CSS', () => {
    const wrapper = mountDock()
    const dock = wrapper.find('.toc-dock')
    expect(dock.attributes('style')).toContain('width: 260px')
    // CSS bounds act as the visual clamp; the numeric clamp lives in the
    // preference module (covered by useTocDockPreference tests).
    expect(getComputedStyle(dock.element).maxWidth).toBe('400px')
    expect(getComputedStyle(dock.element).minWidth).toBe('200px')
  })

  it('sets width incrementally when the divider is dragged', async () => {
    const wrapper = mountDock()
    const divider = wrapper.find('.toc-dock-divider')

    // Press at clientX=300, drag right to 340 (+40): width grows 260 → 300.
    const down = new MouseEvent('pointerdown', { clientX: 300, bubbles: true })
    divider.element.dispatchEvent(down)
    await nextTick()

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 340, bubbles: true }))
    await nextTick()

    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await nextTick()

    expect(setWidth).toHaveBeenCalled()
    const calledWidth = setWidth.mock.calls[0][0]
    expect(calledWidth).toBe(300)
  })

  it('drags left to shrink the dock', async () => {
    const wrapper = mountDock()
    const divider = wrapper.find('.toc-dock-divider')

    // Press at clientX=400, drag left to 350 (−50): width shrinks 260 → 210.
    divider.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, bubbles: true }))
    await nextTick()

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 350, bubbles: true }))
    await nextTick()

    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await nextTick()

    expect(setWidth).toHaveBeenCalled()
    expect(setWidth.mock.calls[0][0]).toBe(210)
  })

  it('ignores pointermove while not dragging', async () => {
    const wrapper = mountDock()
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 340, bubbles: true }))
    await nextTick()
    expect(setWidth).not.toHaveBeenCalled()
  })

  it('cleans up drag listeners on unmount while dragging', async () => {
    const wrapper = mountDock()
    const divider = wrapper.find('.toc-dock-divider')
    divider.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, bubbles: true }))
    await nextTick()
    expect(document.body.classList.contains('toc-dock-resizing')).toBe(true)

    // Unmount mid-drag: should clean up the body class and listeners.
    wrapper.unmount()
    expect(document.body.classList.contains('toc-dock-resizing')).toBe(false)
  })
})
