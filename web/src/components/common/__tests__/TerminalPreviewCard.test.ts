import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalPreviewCard from '@/components/common/TerminalPreviewCard.vue'

function makeTheme(overrides: Record<string, string> = {}) {
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

describe('TerminalPreviewCard', () => {
  it('renders a mini terminal shell with title bar and two command lines', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: makeTheme(), auto: false },
    })
    expect(wrapper.find('.tpc-shell').exists()).toBe(true)
    expect(wrapper.find('.tpc-titlebar').exists()).toBe(true)
    expect(wrapper.findAll('.tpc-line').length).toBe(2)
  })

  it('applies theme background color to the shell', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: makeTheme({ background: 'rebeccapurple' }), auto: false },
    })
    expect(wrapper.find('.tpc-shell').attributes('style')).toContain('rebeccapurple')
  })

  it('renders placeholder skeleton when theme is undefined', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: undefined, auto: false },
    })
    expect(wrapper.find('.tpc-shell--placeholder').exists()).toBe(true)
  })

  it('renders split gradient shell for auto mode', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: undefined, auto: true },
    })
    expect(wrapper.find('.tpc-shell--auto').exists()).toBe(true)
  })

  it('uses theme green for prompt, blue for directory, cyan for filename', () => {
    const theme = makeTheme({ green: 'green', blue: 'blue', cyan: 'cyan' })
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme, auto: false },
    })
    expect(wrapper.find('.tpc-prompt').attributes('style')).toContain('green')
    expect(wrapper.find('.tpc-dir').attributes('style')).toContain('blue')
    expect(wrapper.find('.tpc-file').attributes('style')).toContain('cyan')
  })
})
