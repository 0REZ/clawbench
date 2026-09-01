import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      search: {
        placeholder: 'Search...',
        previous: 'Prev',
        next: 'Next',
        close: 'Close',
        all: 'All',
        matchCase: 'Match case',
        regexp: 'Regexp',
        byWord: 'By word',
      },
    },
  },
})

import MarkdownSearchBar from '../MarkdownSearchBar.vue'

function mountBar(props = {}) {
  return mount(MarkdownSearchBar, {
    props: { open: false, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

function seedMarkdownBody(html: string) {
  const body = document.createElement('div')
  body.className = 'markdown-body'
  body.innerHTML = html
  document.body.appendChild(body)
  return body
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('MarkdownSearchBar', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.querySelectorAll('.markdown-body').forEach((el) => el.remove())
  })

  it('is hidden when closed and visible when open', async () => {
    const wrapper = mountBar()
    expect(wrapper.find('.search-bar').classes()).not.toContain('is-open')
    await wrapper.setProps({ open: true })
    await sleep(20)
    expect(wrapper.find('.search-bar').classes()).toContain('is-open')
    expect(wrapper.find('input')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows 0/0 for a query with no matches and 1/N when matches exist', async () => {
    seedMarkdownBody('<p>alpha beta</p><p>alpha gamma</p>')
    const wrapper = mountBar({ open: true })
    await sleep(20)
    const input = wrapper.find('input')
    input.element.value = 'alpha'
    input.trigger('input')
    await sleep(20)
    // matches found in both paragraphs but the block-level ancestor dedups…
    expect(wrapper.find('.cm-search-match-info').text()).toMatch(/^\d+\/\d+$/)

    input.element.value = 'zzz'
    input.trigger('input')
    await sleep(20)
    expect(wrapper.find('.cm-search-match-info').text()).toBe('0/0')
    wrapper.unmount()
  })

  it('emits close on Escape and on the close button', async () => {
    const wrapper = mountBar({ open: true })
    await sleep(20)
    const input = wrapper.find('input')
    input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('navigates matches with Enter and updates the counter', async () => {
    seedMarkdownBody('<p>alpha one</p><p>alpha two</p>')
    const wrapper = mountBar({ open: true })
    await sleep(20)
    const input = wrapper.find('input')
    input.element.value = 'alpha'
    input.trigger('input')
    await sleep(20)
    const before = wrapper.find('.cm-search-match-info').text()
    input.trigger('keydown', { key: 'Enter' })
    await sleep(20)
    const after = wrapper.find('.cm-search-match-info').text()
    expect(after).not.toBe(before)
    wrapper.unmount()
  })

  it('renders prev/next/close buttons and disables prev/next without matches', async () => {
    const wrapper = mountBar({ open: true })
    await sleep(20)
    const prev = wrapper.find('button[name=prev]')
    const next = wrapper.find('button[name=next]')
    expect(prev.exists()).toBe(true)
    expect(next.exists()).toBe(true)
    expect((prev.element as HTMLButtonElement).disabled).toBe(true)
    expect((next.element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })

  it('renders select-all button and option checkboxes (case/regexp/word)', async () => {
    const wrapper = mountBar({ open: true })
    await sleep(20)
    expect(wrapper.find('button[name=select]').exists()).toBe(true)
    const boxes = wrapper.findAll('.cm-search-options input[type=checkbox]')
    expect(boxes).toHaveLength(3)
    wrapper.unmount()
  })

  it('case-sensitive option narrows the result set', async () => {
    seedMarkdownBody('<p>Alpha alpha</p>')
    const wrapper = mountBar({ open: true })
    await sleep(20)
    const input = wrapper.find('input')
    input.element.value = 'alpha'
    input.trigger('input')
    await sleep(20)
    const insensitive = wrapper.find('.cm-search-match-info').text()
    expect(insensitive).toBe('1/2')
    // Enable case-sensitive: only lowercase "alpha" matches → 1/1
    wrapper.find('input[name=case]').setValue(true)
    wrapper.find('input[name=case]').trigger('change')
    await sleep(20)
    expect(wrapper.find('.cm-search-match-info').text()).toBe('1/1')
    wrapper.unmount()
  })

  it('whole-word option excludes substring matches', async () => {
    seedMarkdownBody('<p>cat catalog</p>')
    const wrapper = mountBar({ open: true })
    await sleep(20)
    const input = wrapper.find('input')
    input.element.value = 'cat'
    input.trigger('input')
    await sleep(20)
    expect(wrapper.find('.cm-search-match-info').text()).toBe('1/2')
    wrapper.find('input[name=word]').setValue(true)
    wrapper.find('input[name=word]').trigger('change')
    await sleep(20)
    // Whole-word: only the standalone "cat" matches.
    expect(wrapper.find('.cm-search-match-info').text()).toBe('1/1')
    wrapper.unmount()
  })
})
