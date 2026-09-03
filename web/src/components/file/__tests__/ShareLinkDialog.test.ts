import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import ShareLinkDialog from '../ShareLinkDialog.vue'

// Mock ModalDialog — simple passthrough (slot rendering issues in VTU).
vi.mock('@/components/common/ModalDialog.vue', () => ({
  default: {
    name: 'ModalDialog',
    props: ['open', 'title', 'zIndex'],
    emits: ['close'],
    template: '<div v-if="open" class="modal-dialog"><slot /><slot name="footer" /></div>',
  },
}))

vi.mock('@/composables/useToast.ts', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

// Mock clipboard copy.
const mockCopyText = vi.fn()
vi.mock('@/utils/clipboard.ts', () => ({
  copyText: (text: string, onSuccess?: () => void) => {
    mockCopyText(text)
    onSuccess?.()
  },
}))

const messages = {
  en: {
    common: { copy: 'Copy', copied: 'Copied', close: 'Close', loading: 'Loading...' },
    shareDialog: {
      title: 'Share link',
      noFile: 'No file open',
      explain: 'Explain',
      active: 'Active',
      generate: 'Generate link',
      regenerate: 'Regenerate',
      revoke: 'Revoke',
      revoked: 'Revoked',
    },
  },
}

const i18n = createI18n({ legacy: false, locale: 'en', messages, missingWarn: false, fallbackWarn: false })

function mountDialog(props = {}) {
  return mount(ShareLinkDialog, {
    props: {
      open: true,
      file: { name: 'a.md', path: '/proj/a.md' },
      ...props,
    },
    global: { plugins: [i18n] },
  })
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('ShareLinkDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Default origin used by the dialog to build the absolute URL.
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://host.example', pathname: '/' },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows the generate button when the file has no active share', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const wrapper = mountDialog()
    await flushPromises()
    await nextTick()
    expect(wrapper.text()).toContain('Generate link')
  })

  it('shows the existing link when the file is already shared', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: 'tok1', path: '/share/tok1' }))
    const wrapper = mountDialog()
    await flushPromises()
    await nextTick()
    const input = wrapper.find('input')
    expect((input.element as HTMLInputElement).value).toBe('https://host.example/share/tok1')
  })

  it('creates a link via POST and copies it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ token: 'newtok', path: '/share/newtok' }))
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.share-dialog-primary').trigger('click')
    await flushPromises()
    await nextTick()

    const input = wrapper.find('input')
    expect((input.element as HTMLInputElement).value).toBe('https://host.example/share/newtok')
    // POST body carries the file path.
    const postCall = fetchMock.mock.calls.find((c: unknown[]) => c[1]?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(JSON.parse(postCall![1].body)).toEqual({ path: '/proj/a.md' })
    expect(mockCopyText).toHaveBeenCalledWith('https://host.example/share/newtok')
  })

  it('revokes an active share via DELETE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: 'tok1', path: '/share/tok1' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.share-dialog-secondary.danger').trigger('click')
    await flushPromises()
    await nextTick()

    const delCall = fetchMock.mock.calls.find((c: unknown[]) => c[1]?.method === 'DELETE')
    expect(delCall).toBeTruthy()
    // Back to the generate state.
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('Generate link')
  })
})
