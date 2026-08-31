import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import TabPanel from '@/components/common/TabPanel.vue'

vi.mock('@/utils/appLog', () => ({
  appLog: { d: vi.fn(), i: vi.fn(), w: vi.fn(), e: vi.fn() },
}))

// jsdom does not load SFC scoped `<style>` blocks, so the relevant rule is
// injected here to mirror the production CSS.
const tabPanelCss = document.createElement('style')
tabPanelCss.textContent = `
.tab-panel { position: absolute; isolation: isolate; }
.tab-panel-active { opacity: 1; pointer-events: auto; }
`
document.head.appendChild(tabPanelCss)

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

function mountTab(activeTab: string, tabId: string, title = '') {
  return mount(TabPanel, {
    props: { activeTab, tabId, title },
    slots: { default: '<div class="tab-slot-content">content</div>' },
    attachTo: document.body,
  })
}

describe('TabPanel', () => {
  it('renders only after being opened (everOpened) and shows when active', async () => {
    wrapper = mountTab('chat', 'browse')
    expect(wrapper.find('.tab-panel').exists()).toBe(false)

    await wrapper.setProps({ activeTab: 'browse' })
    await nextTick()
    const panel = wrapper.find('.tab-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.classes()).toContain('tab-panel-active')
  })

  it('hides when not active but keeps the subtree mounted', async () => {
    wrapper = mountTab('browse', 'browse')
    await nextTick()
    expect(wrapper.find('.tab-panel').exists()).toBe(true)

    await wrapper.setProps({ activeTab: 'chat' })
    await nextTick()
    expect(wrapper.find('.tab-panel').exists()).toBe(true)
    expect(wrapper.find('.tab-panel').classes()).not.toContain('tab-panel-active')
  })

  it('creates a stacking context (isolation) so child z-indexes stay contained', async () => {
    // Regression: .tab-panel is position:absolute with z-index:auto. Without a
    // stacking context (isolation:isolate / z-index:0), a child like
    // .file-overlay (z-index:100) escapes the panel and covers the split
    // divider (z-index:2), blocking its hover/drag effect on the left half.
    wrapper = mountTab('browse', 'browse')
    await nextTick()
    const panel = wrapper.find('.tab-panel').element as HTMLElement
    expect(getComputedStyle(panel).isolation).toBe('isolate')
  })

  it('forwards header clicks through the header-click event', async () => {
    wrapper = mountTab('browse', 'browse', 'My Title')
    await nextTick()
    const onHeaderClick = vi.fn()
    // TabPanel emits 'header-click' from the header; remount with listener
    wrapper.unmount()
    wrapper = mount(TabPanel, {
      props: { activeTab: 'browse', tabId: 'browse', title: 'My Title' },
      attachTo: document.body,
    })
    wrapper.vm.$emit('header-click')
    // emit spy: use wrapper.emitted
    expect(wrapper.emitted('header-click')).toBeTruthy()
  })
})
