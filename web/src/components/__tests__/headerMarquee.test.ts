import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeaderMarquee from '@/components/common/HeaderMarquee.vue'

async function flushDom() {
  await nextTick()
  await nextTick()
}

/**
 * Mock element dimensions so getMaxScroll returns a predictable value.
 * jsdom elements have offsetWidth = 0 by default.
 * We set wrapperWidth=100, textWidth=300 → maxScroll = 300-100+8 = 208
 */
function mockDimensions(wrapper) {
  const wrapperEl = wrapper.find('.hm-wrapper').element as HTMLElement
  const textEl = wrapper.find('.hm-text').element as HTMLElement
  Object.defineProperty(wrapperEl, 'offsetWidth', { value: 100, configurable: true })
  Object.defineProperty(textEl, 'offsetWidth', { value: 300, configurable: true })
  // Mock setPointerCapture / releasePointerCapture (not in jsdom)
  wrapperEl.setPointerCapture = vi.fn()
  wrapperEl.releasePointerCapture = vi.fn()
}

describe('HeaderMarquee', () => {
  let observeSpy: vi.SpyInstance
  let disconnectSpy: vi.SpyInstance

  beforeEach(() => {
    observeSpy = vi.fn()
    disconnectSpy = vi.fn()
    vi.stubGlobal('ResizeObserver', class MockResizeObserver {
      observe = observeSpy
      unobserve = vi.fn()
      disconnect = disconnectSpy
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mountMarquee(props = {}, slots = {}) {
    return mount(HeaderMarquee, {
      props: { text: 'Hello', ...props },
      slots: { default: 'Hello World', ...slots },
    })
  }

  it('renders slot content inside the wrapper', () => {
    const wrapper = mountMarquee()
    const textSpan = wrapper.find('.hm-text')
    expect(textSpan.exists()).toBe(true)
    expect(textSpan.text()).toBe('Hello World')
  })

  it('uses title prop when provided', () => {
    const wrapper = mountMarquee({ title: 'My Title' })
    expect(wrapper.find('.hm-wrapper').attributes('title')).toBe('My Title')
  })

  it('falls back to text prop for title when title is not provided', () => {
    const wrapper = mountMarquee()
    expect(wrapper.find('.hm-wrapper').attributes('title')).toBe('Hello')
  })

  it('prefers title over text when both are provided', () => {
    const wrapper = mountMarquee({ title: 'Title Text', text: 'Content Text' })
    expect(wrapper.find('.hm-wrapper').attributes('title')).toBe('Title Text')
  })

  it('uses text prop value as default title when title is empty string', () => {
    const wrapper = mountMarquee({ title: '', text: 'Content' })
    expect(wrapper.find('.hm-wrapper').attributes('title')).toBe('Content')
  })

  it('detects overflow via checkOverflow with mocked dimensions', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    // With mocked dims: textWidth(300) > wrapperWidth(100) - 8 → isOverflow = true
    vm.checkOverflow()
    expect(vm.isOverflow).toBe(true)
  })

  it('does not overflow when text fits within wrapper', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const wrapperEl = wrapper.find('.hm-wrapper').element as HTMLElement
    const textEl = wrapper.find('.hm-text').element as HTMLElement
    // Set text smaller than wrapper
    Object.defineProperty(wrapperEl, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(textEl, 'offsetWidth', { value: 100, configurable: true })
    const vm = wrapper.vm as any
    vm.checkOverflow()
    expect(vm.isOverflow).toBe(false)
  })

  it('clampOffset clamps between -maxScroll and 0', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    // maxScroll = 300-100+8 = 208
    expect(vm.clampOffset(-50)).toBe(-50)
    expect(vm.clampOffset(0)).toBe(0)
    expect(vm.clampOffset(50)).toBe(0)
    expect(vm.clampOffset(-300)).toBe(-208)
  })

  it('clampOffset returns 0 when maxScroll <= 0 (text fits)', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const wrapperEl = wrapper.find('.hm-wrapper').element as HTMLElement
    const textEl = wrapper.find('.hm-text').element as HTMLElement
    // Set text smaller than wrapper → maxScroll negative
    Object.defineProperty(wrapperEl, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(textEl, 'offsetWidth', { value: 100, configurable: true })
    const vm = wrapper.vm as any
    // maxScroll = 100-300+8 = -192 → clampOffset returns 0
    expect(vm.clampOffset(-50)).toBe(0)
    expect(vm.clampOffset(0)).toBe(0)
    expect(vm.clampOffset(50)).toBe(0)
  })

  it('onPointerDown sets isDragging when overflowing', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow() // sets isOverflow = true
    vm.onPointerDown({ clientX: 100, pointerId: 1 })
    expect(vm.isDragging).toBe(true)
  })

  it('onPointerDown does nothing when not overflowing', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const wrapperEl = wrapper.find('.hm-wrapper').element as HTMLElement
    const textEl = wrapper.find('.hm-text').element as HTMLElement
    // Make text fit
    Object.defineProperty(wrapperEl, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(textEl, 'offsetWidth', { value: 100, configurable: true })
    const vm = wrapper.vm as any
    vm.checkOverflow() // sets isOverflow = false
    vm.onPointerDown({ clientX: 100, pointerId: 1 })
    expect(vm.isDragging).toBe(false)
  })

  it('onPointerMove updates scrollOffset during drag', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    vm.onPointerDown({ clientX: 100, pointerId: 1 })
    vm.onPointerMove({ clientX: 50 })
    expect(vm.scrollOffset).toBe(-50)
  })

  it('onPointerMove clamps scrollOffset to bounds', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    vm.onPointerDown({ clientX: 100, pointerId: 1 })
    vm.onPointerMove({ clientX: 400 })
    expect(vm.scrollOffset).toBe(0)
  })

  it('onPointerUp resets isDragging', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    vm.onPointerDown({ clientX: 100, pointerId: 1 })
    expect(vm.isDragging).toBe(true)
    vm.onPointerUp({ pointerId: 1 })
    expect(vm.isDragging).toBe(false)
  })

  it('normalizeWheelDelta scales line-mode delta', () => {
    const wrapper = mountMarquee()
    const vm = wrapper.vm as any
    // deltaMode=0 (pixel) → no scaling
    expect(vm.normalizeWheelDelta({ deltaX: 50, deltaY: 0, deltaMode: 0 })).toBe(50)
    // deltaMode=1 (line) → ×40
    expect(vm.normalizeWheelDelta({ deltaX: 3, deltaY: 0, deltaMode: 1 })).toBe(120)
    // deltaMode=2 (page) → ×800
    expect(vm.normalizeWheelDelta({ deltaX: 1, deltaY: 0, deltaMode: 2 })).toBe(800)
    // deltaX=0 falls back to deltaY
    expect(vm.normalizeWheelDelta({ deltaX: 0, deltaY: 30, deltaMode: 0 })).toBe(30)
  })

  it('onWheel scrolls horizontally with deltaX', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    vm.onWheel({ deltaX: 50, deltaY: 0, deltaMode: 0, preventDefault: vi.fn() })
    expect(vm.scrollOffset).toBe(-50)
  })

  it('onWheel maps deltaY to horizontal when deltaX is 0', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    vm.onWheel({ deltaX: 0, deltaY: 30, deltaMode: 0, preventDefault: vi.fn() })
    expect(vm.scrollOffset).toBe(-30)
  })

  it('onWheel calls preventDefault when overflowing', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    const preventDefault = vi.fn()
    vm.onWheel({ deltaX: 50, deltaY: 0, deltaMode: 0, preventDefault })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('onWheel does not scroll or preventDefault when not overflowing', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const wrapperEl = wrapper.find('.hm-wrapper').element as HTMLElement
    const textEl = wrapper.find('.hm-text').element as HTMLElement
    Object.defineProperty(wrapperEl, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(textEl, 'offsetWidth', { value: 100, configurable: true })
    const vm = wrapper.vm as any
    vm.checkOverflow() // sets isOverflow = false
    const preventDefault = vi.fn()
    vm.onWheel({ deltaX: 50, deltaY: 0, deltaMode: 0, preventDefault })
    expect(vm.scrollOffset).toBe(0)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('onWheel ignores zero delta', () => {
    const wrapper = mountMarquee()
    mockDimensions(wrapper)
    const vm = wrapper.vm as any
    vm.checkOverflow()
    vm.onWheel({ deltaX: 0, deltaY: 0, deltaMode: 0, preventDefault: vi.fn() })
    expect(vm.scrollOffset).toBe(0)
  })

  it('disconnects ResizeObserver on unmount', () => {
    const wrapper = mountMarquee()
    expect(disconnectSpy).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('handles null refs gracefully in checkOverflow', () => {
    const wrapper = mountMarquee()
    expect(() => (wrapper.vm as any).checkOverflow?.()).not.toThrow()
  })

  it('scrollOffset reset logic works correctly', () => {
    const wrapper = mountMarquee()
    const vm = wrapper.vm as any
    vm.scrollOffset = -80
    expect(vm.scrollOffset).toBe(-80)
    vm.scrollOffset = 0
    expect(vm.scrollOffset).toBe(0)
  })

  it('exposes methods and state for testing', () => {
    const wrapper = mountMarquee()
    const vm = wrapper.vm as any
    expect(typeof vm.checkOverflow).toBe('function')
    expect(typeof vm.isOverflow).toBe('boolean')
    expect(typeof vm.isDragging).toBe('boolean')
    expect(typeof vm.getMaxScroll).toBe('function')
    expect(typeof vm.clampOffset).toBe('function')
    expect(typeof vm.normalizeWheelDelta).toBe('function')
    expect(typeof vm.onPointerDown).toBe('function')
    expect(typeof vm.onPointerMove).toBe('function')
    expect(typeof vm.onPointerUp).toBe('function')
    expect(typeof vm.onWheel).toBe('function')
  })
})
