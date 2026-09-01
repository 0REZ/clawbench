import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SearchBar from '../SearchBar.vue'

const labels = {
  find: 'Find',
  replace: 'Replace',
  previous: 'Prev',
  next: 'Next',
  matchCase: 'Match case',
  regexp: 'Regexp',
  byWord: 'By word',
  replaceAction: 'Replace',
  replaceAll: 'Replace all',
  close: 'Close',
}

function mountBar(props = {}) {
  return mount(SearchBar, {
    props: { open: false, canNav: false, labels, ...props },
    attachTo: document.body,
  })
}

describe('SearchBar', () => {
  it('renders all controls: input, prev/next/close, inline option icons, replace row', () => {
    const wrapper = mountBar({ open: true, showReplace: true })
    expect(wrapper.find('input[name=search]').exists()).toBe(true)
    expect(wrapper.find('button[name=prev]').exists()).toBe(true)
    expect(wrapper.find('button[name=next]').exists()).toBe(true)
    expect(wrapper.find('button[name=close]').exists()).toBe(true)
    // The three options are inline icons inside the input, not a separate row.
    const icons = wrapper.findAll('.search-input-actions button.search-opt-btn')
    expect(icons).toHaveLength(3)
    expect(wrapper.find('button[name=case]').exists()).toBe(true)
    expect(wrapper.find('button[name=regexp]').exists()).toBe(true)
    expect(wrapper.find('button[name=word]').exists()).toBe(true)
    // No "select all" button and no checkbox row anymore.
    expect(wrapper.find('button[name=select]').exists()).toBe(false)
    expect(wrapper.find('.cm-search-options').exists()).toBe(false)
    expect(wrapper.find('input[name=replace]').exists()).toBe(true)
    expect(wrapper.find('button[name=replace]').exists()).toBe(true)
    expect(wrapper.find('button[name=replaceAll]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('hides the replace row when showReplace is false', () => {
    const wrapper = mountBar({ open: true, showReplace: false })
    expect(wrapper.find('input[name=replace]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('is hidden when closed, visible when open', async () => {
    const wrapper = mountBar()
    expect(wrapper.find('.search-bar').classes()).not.toContain('is-open')
    await wrapper.setProps({ open: true })
    expect(wrapper.find('.search-bar').classes()).toContain('is-open')
    wrapper.unmount()
  })

  it('disables prev/next when canNav is false', () => {
    const wrapper = mountBar({ open: true, canNav: false })
    expect((wrapper.find('button[name=prev]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.find('button[name=next]').element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('emits input on typing', async () => {
    const wrapper = mountBar({ open: true })
    const input = wrapper.find('input[name=search]')
    await input.setValue('alpha')
    expect(wrapper.emitted('input')).toBeTruthy()
    expect(wrapper.emitted('input')![0]).toEqual(['alpha'])
    wrapper.unmount()
  })

  it('emits prev/next/close on button clicks', async () => {
    const wrapper = mountBar({ open: true, canNav: true })
    await wrapper.find('button[name=prev]').trigger('click')
    await wrapper.find('button[name=next]').trigger('click')
    await wrapper.find('button[name=close]').trigger('click')
    expect(wrapper.emitted('prev')).toBeTruthy()
    expect(wrapper.emitted('next')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('emits enter (with shiftKey) and escape on keydown', async () => {
    const wrapper = mountBar({ open: true })
    const input = wrapper.find('input[name=search]')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('enter')).toBeTruthy()
    expect(wrapper.emitted('enter')![0]).toEqual([false])
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('enter')![1]).toEqual([true])
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('escape')).toBeTruthy()
    wrapper.unmount()
  })

  it('toggles option icons and emits case/regexp/word-change', async () => {
    const wrapper = mountBar({ open: true })
    await wrapper.find('button[name=case]').trigger('click')
    expect(wrapper.emitted('case-change')).toBeTruthy()
    expect(wrapper.emitted('case-change')![0]).toEqual([true])
    await wrapper.find('button[name=regexp]').trigger('click')
    expect(wrapper.emitted('regexp-change')).toBeTruthy()
    expect(wrapper.emitted('regexp-change')![0]).toEqual([true])
    await wrapper.find('button[name=word]').trigger('click')
    expect(wrapper.emitted('word-change')).toBeTruthy()
    expect(wrapper.emitted('word-change')![0]).toEqual([true])
    // Active prop drives the icon's active class + aria-pressed.
    await wrapper.setProps({ caseSensitive: true, regexp: true, wholeWord: true })
    expect(wrapper.find('button[name=case]').classes()).toContain('active')
    expect(wrapper.find('button[name=regexp]').classes()).toContain('active')
    expect(wrapper.find('button[name=word]').classes()).toContain('active')
    expect(wrapper.find('button[name=case]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('button[name=regexp]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('button[name=word]').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('emits false when toggling an option off (true → false)', async () => {
    const wrapper = mountBar({ open: true, caseSensitive: true, regexp: true, wholeWord: true })
    await wrapper.find('button[name=case]').trigger('click')
    expect(wrapper.emitted('case-change')![0]).toEqual([false])
    await wrapper.find('button[name=regexp]').trigger('click')
    expect(wrapper.emitted('regexp-change')![0]).toEqual([false])
    await wrapper.find('button[name=word]').trigger('click')
    expect(wrapper.emitted('word-change')![0]).toEqual([false])
    wrapper.unmount()
  })

  it('emits replace / replace-all from the replace row', async () => {
    const wrapper = mountBar({ open: true, showReplace: true })
    await wrapper.find('button[name=replace]').trigger('click')
    await wrapper.find('button[name=replaceAll]').trigger('click')
    expect(wrapper.emitted('replace')).toBeTruthy()
    expect(wrapper.emitted('replace-all')).toBeTruthy()
    wrapper.unmount()
  })

  it('renders matchText and falls back to default labels', () => {
    const wrapper = mountBar({ open: true, matchText: '1/3', labels: undefined })
    expect(wrapper.find('.cm-search-match-info').text()).toBe('1/3')
    expect(wrapper.find('input[name=search]').attributes('placeholder')).toBe('Find')
    wrapper.unmount()
  })
})
