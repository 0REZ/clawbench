import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { OptionPreview } from '@/components/settings/SettingsItem.vue'
import SettingsItem from '@/components/settings/SettingsItem.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      common: { ok: '确定' },
      settings: { needsRestart: '需重启', items: { resetToDefault: '重置' } },
    },
  },
})

// Mock lucide-vue-next icons used by SettingsItem / BottomSheet header
vi.mock('lucide-vue-next', () => ({
  Eye: { name: 'Eye', template: '<span class="icon-eye" />' },
  EyeOff: { name: 'EyeOff', template: '<span class="icon-eyeoff" />' },
  RefreshCw: { name: 'RefreshCw', template: '<span class="icon-refresh" />' },
  RotateCcw: { name: 'RotateCcw', template: '<span class="icon-rebuild" />' },
  ChevronsUpDown: { name: 'ChevronsUpDown', template: '<span class="icon-chevron" />' },
  Palette: { name: 'Palette', template: '<span class="icon-palette" />' },
}))

// Mock useTabDrawer so the theme picker drawer state is test-controllable
vi.mock('@/composables/useTabDrawer', () => ({
  useTabDrawer: () => ({
    isOpen: { value: false },
    effectiveOpen: { value: false },
    open: vi.fn(function (this: any) { this.isOpen.value = true; this.effectiveOpen.value = true }),
    close: vi.fn(function (this: any) { this.isOpen.value = false; this.effectiveOpen.value = false }),
    toggle: vi.fn(),
  }),
}))

// BottomSheet teleports to <body>; stub it as a simple slot container so the
// theme grid content stays inside the wrapper and is queryable in tests.
const globalStubs = {
  BottomSheet: {
    template: '<div class="bs-stub"><slot name="header" /><slot /></div>',
    props: ['open'],
  },
}

function makeTheme(overrides: Record<string, unknown> = {}) {
  return {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    ...overrides,
  }
}

function mountThemeGrid(props: Record<string, any> = {}) {
  return mount(SettingsItem, {
    props: {
      label: 'Terminal Theme',
      type: 'select',
      modelValue: 'dark',
      options: [
        { label: 'Dark', value: 'dark' },
        { label: 'Light', value: 'light' },
        { label: 'Auto', value: 'auto' },
      ],
      ...props,
    },
    global: { stubs: globalStubs, plugins: [i18n] },
  })
}

async function openGrid(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.settings-item').trigger('click')
  await wrapper.vm.$nextTick()
}

describe('SettingsItem theme grid picker', () => {
  it('renders color swatches (no --terminal modifier) when optionPreviews are color-typed', async () => {
    const previews: Record<string, OptionPreview> = {
      dark: { type: 'color', bg: '#1e1e2e', text: '#cdd6f4', accent: '#89b4fa', themeId: 'dark' },
      light: { type: 'color', bg: '#f8f9fa', text: '#212529', accent: '#4a90d9', themeId: 'light' },
      auto: { type: 'color', bg: '#ffffff', text: '#1a1a2e', accent: '#888888', themeId: 'auto' },
    }
    const wrapper = mountThemeGrid({ optionPreviews: previews })
    await openGrid(wrapper)

    const swatches = wrapper.findAll('.theme-picker-swatch')
    expect(swatches.length).toBe(3)
    // No terminal card should render for color-only previews
    expect(wrapper.find('.tpc-shell').exists()).toBe(false)
    // Every swatch is a plain color swatch (no --terminal modifier)
    swatches.forEach(s => {
      expect(s.classes()).not.toContain('theme-picker-swatch--terminal')
    })
    // Grid must not be in wide mode
    expect(wrapper.find('.theme-picker-grid').classes()).not.toContain('theme-picker-grid--wide')
  })

  it('renders TerminalPreviewCard with --terminal swatches and --wide grid for terminal previews', async () => {
    const previews: Record<string, OptionPreview> = {
      dark: { type: 'terminal', themeId: 'dark', theme: makeTheme() },
      light: { type: 'terminal', themeId: 'light', theme: makeTheme({ background: '#ffffff' }) },
      auto: { type: 'terminal', themeId: 'auto' },
    }
    const wrapper = mountThemeGrid({ optionPreviews: previews })
    await openGrid(wrapper)

    const terminalSwatches = wrapper.findAll('.theme-picker-swatch--terminal')
    expect(terminalSwatches.length).toBe(3)
    // Each terminal cell renders the mini terminal shell
    const shells = wrapper.findAll('.tpc-shell')
    expect(shells.length).toBe(3)
    // Auto card renders the light/dark split gradient variant
    expect(wrapper.find('.tpc-shell--auto').exists()).toBe(true)
    // Grid uses the wider layout for terminal cards
    expect(wrapper.find('.theme-picker-grid').classes()).toContain('theme-picker-grid--wide')
  })

  it('applies the terminal theme colors to the preview card', async () => {
    const previews: Record<string, OptionPreview> = {
      dark: { type: 'terminal', themeId: 'dark', theme: makeTheme({ background: 'rebeccapurple', green: 'green', blue: 'blue', cyan: 'cyan' }) },
      light: { type: 'terminal', themeId: 'light', theme: makeTheme() },
      auto: { type: 'terminal', themeId: 'auto' },
    }
    const wrapper = mountThemeGrid({ optionPreviews: previews })
    await openGrid(wrapper)

    const shell = wrapper.find('.tpc-shell')
    expect(shell.attributes('style')).toContain('rebeccapurple')
    expect(wrapper.find('.tpc-prompt').attributes('style')).toContain('green')
    expect(wrapper.find('.tpc-dir').attributes('style')).toContain('blue')
    expect(wrapper.find('.tpc-file').attributes('style')).toContain('cyan')
  })
})
