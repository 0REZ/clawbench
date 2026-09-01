import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildExportPayload,
  downloadJson,
  validateImportItem,
  createJsonImporter,
  type ImportItem,
} from '@/composables/useQuickSendIO'

// ── downloadBlob mock ──
const mockDownloadBlob = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: any[]) => mockDownloadBlob(...args),
}))

// Import after mock
const { downloadJson: actualDownloadJson } = await import('@/composables/useQuickSendIO')

function makeImporter(overrides: Partial<Parameters<typeof createJsonImporter>[0]> = {}) {
  const existing = new Set<string>()
  const addItem = vi.fn(async (item: ImportItem) => {
    existing.add(item.label)
    return true
  })
  const onError = vi.fn()
  const onSummary = vi.fn()
  const importer = createJsonImporter({
    kind: 'chat_quick_send',
    existingLabels: () => existing,
    addItem,
    onError,
    onSummary,
    ...overrides,
  })
  return { importer, addItem, onError, onSummary, existing }
}

function payloadJson(kind = 'chat_quick_send', items: unknown[] = [{ label: '继续', command: '继续' }]) {
  return JSON.stringify({ version: 1, kind, items })
}

beforeEach(() => {
  mockDownloadBlob.mockReset()
})

describe('buildExportPayload', () => {
  it('builds a versioned payload with the given kind', () => {
    const payload = buildExportPayload('chat_quick_send', [{ label: 'a', command: 'cmd' }])
    expect(payload).toEqual({ version: 1, kind: 'chat_quick_send', items: [{ label: 'a', command: 'cmd' }] })
  })

  it('drops non-label/command fields from items', () => {
    const payload = buildExportPayload('terminal_quick_command', [
      { label: 'a', command: 'cmd', hidden: true, auto_execute: true } as any,
    ])
    expect(payload.items[0]).toEqual({ label: 'a', command: 'cmd' })
  })
})

describe('downloadJson', () => {
  it('calls downloadBlob with formatted JSON, filename and mime', () => {
    actualDownloadJson({ version: 1, kind: 'chat_quick_send', items: [{ label: 'a', command: 'b' }] }, 'chat_quick_send.json')
    expect(mockDownloadBlob).toHaveBeenCalledTimes(1)
    const [content, filename, mime] = mockDownloadBlob.mock.calls[0]
    expect(filename).toBe('chat_quick_send.json')
    expect(mime).toBe('application/json')
    expect(JSON.parse(content)).toEqual({ version: 1, kind: 'chat_quick_send', items: [{ label: 'a', command: 'b' }] })
  })
})

describe('validateImportItem', () => {
  it('accepts valid items', () => {
    expect(validateImportItem({ label: '继续', command: '继续' })).toBe('')
  })

  it('trims whitespace before validating', () => {
    expect(validateImportItem({ label: '  继续  ', command: '  go  ' })).toBe('')
  })

  it('rejects empty label or command', () => {
    expect(validateImportItem({ label: '', command: 'x' })).toBe('empty')
    expect(validateImportItem({ label: 'x', command: '   ' })).toBe('empty')
  })

  it('rejects non-string fields', () => {
    expect(validateImportItem({ label: 123, command: 'x' })).toBe('empty')
    expect(validateImportItem({ label: 'x', command: null })).toBe('empty')
  })

  it('rejects non-object input', () => {
    expect(validateImportItem(null)).toBe('invalid')
    expect(validateImportItem('str')).toBe('invalid')
    expect(validateImportItem(undefined)).toBe('invalid')
  })

  it('rejects over-long label or command', () => {
    expect(validateImportItem({ label: 'x'.repeat(101), command: 'y' })).toBe('tooLong')
    expect(validateImportItem({ label: 'x', command: 'y'.repeat(4097) })).toBe('tooLong')
  })
})

describe('createJsonImporter.importFromText', () => {
  it('imports valid items and reports summary', async () => {
    const { importer, addItem, onSummary } = makeImporter()
    await importer.importFromText(payloadJson('chat_quick_send', [
      { label: '继续', command: '继续' },
      { label: '提交', command: '提交' },
    ]))
    expect(addItem).toHaveBeenCalledTimes(2)
    expect(addItem).toHaveBeenCalledWith({ label: '继续', command: '继续' })
    expect(onSummary).toHaveBeenCalledWith({ imported: 2, skipped: 0 })
  })

  it('skips duplicate labels', async () => {
    const { importer, existing, addItem, onSummary } = makeImporter()
    existing.add('继续')
    await importer.importFromText(payloadJson('chat_quick_send', [
      { label: '继续', command: '继续' },
      { label: '新条目', command: 'cmd' },
    ]))
    expect(addItem).toHaveBeenCalledTimes(1)
    expect(addItem).toHaveBeenCalledWith({ label: '新条目', command: 'cmd' })
    expect(onSummary).toHaveBeenCalledWith({ imported: 1, skipped: 1 })
  })

  it('skips invalid items (empty / too long)', async () => {
    const { importer, addItem, onSummary } = makeImporter()
    await importer.importFromText(payloadJson('chat_quick_send', [
      { label: '', command: 'x' },
      { label: '有效', command: 'cmd' },
      { label: 'x'.repeat(101), command: 'y' },
    ]))
    expect(addItem).toHaveBeenCalledTimes(1)
    expect(onSummary).toHaveBeenCalledWith({ imported: 1, skipped: 2 })
  })

  it('reports parse error for invalid JSON', async () => {
    const { importer, onError, onSummary } = makeImporter()
    await importer.importFromText('not json{')
    expect(onError).toHaveBeenCalledWith('parseError')
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('reports kind mismatch when kind differs', async () => {
    const { importer, onError } = makeImporter()
    await importer.importFromText(payloadJson('terminal_quick_command'))
    expect(onError).toHaveBeenCalledWith('kindMismatch')
  })

  it('reports invalidFile for a non-object payload', async () => {
    const { importer, onError, onSummary } = makeImporter()
    await importer.importFromText(JSON.stringify('plain string'))
    expect(onError).toHaveBeenCalledWith('invalidFile')
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('reports kind mismatch for an array payload (no version/kind meta)', async () => {
    const { importer, onError } = makeImporter()
    await importer.importFromText(JSON.stringify([{ label: 'a', command: 'b' }]))
    expect(onError).toHaveBeenCalledWith('kindMismatch')
  })

  it('skips items whose addItem call fails', async () => {
    const { importer, addItem, onSummary } = makeImporter()
    addItem.mockResolvedValueOnce(false)
    await importer.importFromText(payloadJson('chat_quick_send', [
      { label: '失败', command: 'x' },
      { label: '成功', command: 'y' },
    ]))
    expect(onSummary).toHaveBeenCalledWith({ imported: 1, skipped: 1 })
  })

  it('adds imported labels to the existing set to dedupe within the file', async () => {
    const { importer, addItem, onSummary } = makeImporter()
    await importer.importFromText(payloadJson('chat_quick_send', [
      { label: '重复', command: 'x' },
      { label: '重复', command: 'y' },
    ]))
    expect(addItem).toHaveBeenCalledTimes(1)
    expect(onSummary).toHaveBeenCalledWith({ imported: 1, skipped: 1 })
  })
})

// ── DOM interaction paths (trigger → hidden input → FileReader) ──

function simulateFileSelected(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input).toBeTruthy()
  // Simulate the browser picking a file: dispatch the change event with
  // files set, like the real <input type="file"> does.
  Object.defineProperty(input!, 'files', { value: [file], configurable: true })
  input!.dispatchEvent(new Event('change'))
}

describe('createJsonImporter DOM interaction', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    // The module keeps a singleton hidden input across tests; re-attach it to
    // the DOM if a previous test left it detached, so querySelector finds it.
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (input && !input.isConnected) document.body.appendChild(input)
  })

  afterEach(() => {
    clickSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('trigger opens the hidden file picker and records the active importer', () => {
    const { importer } = makeImporter()
    importer.trigger()
    expect(clickSpy).toHaveBeenCalledTimes(1)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()
    expect(input!.accept).toBe('application/json,.json')
    expect(input!.style.display).toBe('none')
  })

  it('reuses the singleton hidden input instead of creating duplicates', () => {
    const { importer: a } = makeImporter()
    const { importer: b } = makeImporter()
    a.trigger()
    b.trigger()
    const inputs = document.querySelectorAll('input[type="file"]')
    expect(inputs.length).toBe(1)
  })

  it('reads a selected file and imports its contents', async () => {
    const { importer, addItem, onSummary } = makeImporter()
    importer.trigger()

    // Replace FileReader with a stub that fires onload with the file text.
    class FakeFileReader {
      static instances: FakeFileReader[] = []
      result = payloadJson('chat_quick_send', [{ label: '从文件导入', command: 'cmd' }])
      onload: any = null
      onerror: any = null
      readAsText = vi.fn()
      constructor() {
        FakeFileReader.instances.push(this)
        // jsdom fires the read asynchronously; simulate onload on next tick.
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader)

    simulateFileSelected(new File(['ignored'], 'config.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(addItem).toHaveBeenCalled())

    expect(FakeFileReader.instances[0].readAsText).toHaveBeenCalled()
    expect(onSummary).toHaveBeenCalledWith({ imported: 1, skipped: 0 })
  })

  it('reports readError when FileReader fails', async () => {
    const { importer, onError } = makeImporter()
    importer.trigger()

    class FakeFileReader {
      static instances: FakeFileReader[] = []
      result = ''
      onload: any = null
      onerror: any = null
      readAsText = vi.fn()
      constructor() {
        FakeFileReader.instances.push(this)
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader)

    simulateFileSelected(new File(['x'], 'bad.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(FakeFileReader.instances.length).toBeGreaterThan(0))
    FakeFileReader.instances[0].onerror()

    expect(onError).toHaveBeenCalledWith('readError')
  })

  it('ignores change events when no file was picked', () => {
    const { importer, addItem, onError, onSummary } = makeImporter()
    importer.trigger()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    input.dispatchEvent(new Event('change'))

    expect(addItem).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onSummary).not.toHaveBeenCalled()
  })
})
