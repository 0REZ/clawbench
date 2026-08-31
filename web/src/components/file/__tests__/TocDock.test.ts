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

vi.mock('@/components/TocPanel.vue', () => ({
  default: defineComponent({
    name: 'TocPanel',
    props: { file: Object, pdfOutline: Array },
    emits: ['jump', 'jumpPage'],
    template: '<div class="toc-panel-stub"><button class="toc-jump-stub" @click="$emit(\'jump\', 12)">jump</button></div>',
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

  it('renders the dock container with the inline TocPanel when open', () => {
    const wrapper = mountDock()
    expect(wrapper.find('.toc-dock').exists()).toBe(true)
    expect(wrapper.find('.toc-panel-stub').exists()).toBe(true)
  })

  it('does NOT render the BottomSheet-backed TocDrawer (inline + popup bug)', () => {
    const wrapper = mountDock()
    // Regression: the dock must use the pure-content TocPanel, never the
    // BottomSheet-backed TocDrawer — otherwise the bottom-sheet popup would
    // appear alongside the inline dock.
    expect(wrapper.findComponent({ name: 'TocDrawer' }).exists()).toBe(false)
    expect(wrapper.find('.bottom-sheet').exists()).toBe(false)
    expect(wrapper.find('.toc-panel-stub').exists()).toBe(true)
  })

  it('passes the file and pdfOutline to TocPanel', () => {
    const wrapper = mountDock({ pdfOutline: [{ id: 'p1', text: 'Page 1', level: 1, line: 1 }] })
    const panel = wrapper.findComponent({ name: 'TocPanel' })
    expect(panel.props('file')).toMatchObject({ name: 'readme.md' })
    expect(panel.props('pdfOutline')).toEqual([{ id: 'p1', text: 'Page 1', level: 1, line: 1 }])
  })

  it('forwards jump/jumpPage events from TocPanel without closing (docked stays open)', () => {
    const wrapper = mountDock()
    const panel = wrapper.findComponent({ name: 'TocPanel' })
    panel.vm.$emit('jump', 12)
    panel.vm.$emit('jumpPage', 3)
    expect(wrapper.emitted('jump')).toEqual([[12]])
    expect(wrapper.emitted('jumpPage')).toEqual([[3]])
    // Docked mode keeps the panel open after jumping to an item.
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('emits close when the dock close button is clicked', async () => {
    const wrapper = mountDock()
    await wrapper.find('.toc-dock-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
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

  it('drags RIGHT to narrow the dock (divider follows pointer on left edge)', async () => {
    const wrapper = mountDock()
    const divider = wrapper.find('.toc-dock-divider')
    pressDivider(divider, 300)

    // Press at clientX=300, drag right to 340 (+40): the dock's left edge
    // follows the pointer rightward, narrowing the dock 260 → 220.
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 340 }))
    await nextTick()

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await nextTick()

    expect(setWidth).toHaveBeenCalled()
    const calledWidth = setWidth.mock.calls[0][0]
    expect(calledWidth).toBe(220)
  })

  it('drags LEFT to widen the dock', async () => {
    const wrapper = mountDock()
    const divider = wrapper.find('.toc-dock-divider')
    pressDivider(divider, 400)

    // Press at clientX=400, drag left to 350 (−50): the dock's left edge moves
    // left, widening the dock 260 → 310.
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 350 }))
    await nextTick()

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    await nextTick()

    expect(setWidth).toHaveBeenCalled()
    expect(setWidth.mock.calls[0][0]).toBe(310)
  })

  it('ignores pointermove while not dragging', async () => {
    const wrapper = mountDock()
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true, clientX: 340 }))
    await nextTick()
    expect(setWidth).not.toHaveBeenCalled()
  })

  it('cleans up drag listeners on unmount while dragging', async () => {
    const wrapper = mountDock()
    const divider = wrapper.find('.toc-dock-divider')
    pressDivider(divider, 300)
    await nextTick()
    expect(document.body.classList.contains('toc-dock-resizing')).toBe(true)

    // Unmount mid-drag: should clean up the body class and listeners.
    wrapper.unmount()
    expect(document.body.classList.contains('toc-dock-resizing')).toBe(false)
  })
})

/** Dispatch pointerdown on the divider with pointer-capture mocked (jsdom lacks it). */
function pressDivider(divider: { element: Element | null }, clientX: number) {
  const el = divider.element as HTMLElement
  el.setPointerCapture = vi.fn()
  el.releasePointerCapture = vi.fn()
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true, clientX }))
}
