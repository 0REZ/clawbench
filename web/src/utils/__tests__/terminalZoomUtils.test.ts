import { describe, expect, it, afterEach } from 'vitest'
import { patchTerminalZoomCoords } from '@/utils/terminalZoomUtils'

function makeTermMock() {
  // 模拟 xterm 内部：renderService.dimensions.css 与 mouseService
  const css = { cell: { width: 8.43, height: 16 }, canvas: { width: 759, height: 368 } }
  const calls: Array<{ name: string; cellW: number; cellH: number; canvasW: number; canvasH: number }> = []

  const mouseService = {
    getCoords: (
      _event: unknown,
      _screenEl: unknown,
      _cols: number,
      _rows: number,
      _hasValidSize: boolean,
    ) => {
      calls.push({ name: 'getCoords', cellW: css.cell.width, cellH: css.cell.height, canvasW: css.canvas.width, canvasH: css.canvas.height })
      return [1, 1]
    },
    getMouseReportCoords: (_event: unknown, _screenEl: unknown) => {
      calls.push({ name: 'getMouseReportCoords', cellW: css.cell.width, cellH: css.cell.height, canvasW: css.canvas.width, canvasH: css.canvas.height })
      return { col: 0, row: 0, x: 0, y: 0 }
    },
  }

  const term = { _core: { _mouseService: mouseService, _renderService: { dimensions: { css } } } }
  return { term, css, calls }
}

afterEach(() => {
  document.documentElement.style.zoom = ''
})

describe('patchTerminalZoomCoords', () => {
  it('does not patch when the mouse service is missing', () => {
    const term = { _core: { _mouseService: undefined, _renderService: {} } }
    expect(() => patchTerminalZoomCoords(term)).not.toThrow()
    expect(() => patchTerminalZoomCoords(null)).not.toThrow()
  })

  it('leaves cell dimensions unchanged at zoom=1', () => {
    const { term, css, calls } = makeTermMock()
    patchTerminalZoomCoords(term)
    const { getCoords } = term._core._mouseService
    getCoords({}, null, 80, 24, true)
    expect(calls).toHaveLength(1)
    expect(calls[0].cellW).toBe(8.43)
    expect(calls[0].cellH).toBe(16)
    expect(css.cell.width).toBe(8.43) // restored
  })

  it('scales cell/canvas dimensions by the zoom factor during getCoords, then restores them', () => {
    document.documentElement.style.zoom = '1.5'
    const { term, css, calls } = makeTermMock()
    patchTerminalZoomCoords(term)
    term._core._mouseService.getCoords({}, null, 80, 24, true)
    expect(calls).toHaveLength(1)
    // 内部调用时 cell 被 ×1.5
    expect(calls[0].cellW).toBeCloseTo(8.43 * 1.5, 5)
    expect(calls[0].cellH).toBeCloseTo(16 * 1.5, 5)
    expect(calls[0].canvasW).toBeCloseTo(759 * 1.5, 5)
    // 调用后还原
    expect(css.cell.width).toBe(8.43)
    expect(css.cell.height).toBe(16)
    expect(css.canvas.width).toBe(759)
  })

  it('scales dimensions for getMouseReportCoords and restores them', () => {
    document.documentElement.style.zoom = '1.25'
    const { term, css, calls } = makeTermMock()
    patchTerminalZoomCoords(term)
    term._core._mouseService.getMouseReportCoords({}, null)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('getMouseReportCoords')
    expect(calls[0].cellW).toBeCloseTo(8.43 * 1.25, 5)
    expect(css.cell.width).toBe(8.43) // restored
  })

  it('restores dimensions even when the original method throws', () => {
    document.documentElement.style.zoom = '2'
    const { term, css } = makeTermMock()
    term._core._mouseService.getCoords = () => { throw new Error('boom') }
    patchTerminalZoomCoords(term)
    expect(() => term._core._mouseService.getCoords({}, null, 80, 24, true)).toThrow('boom')
    expect(css.cell.width).toBe(8.43) // finally 还原
    expect(css.canvas.width).toBe(759)
  })
})
