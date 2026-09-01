import { getUIScale } from '@/composables/useSettingsConfig'

/**
 * Patch an xterm Terminal instance so mouse-driven selection and mouse-report
 * coordinates stay correct under the settings panel's UI zoom.
 *
 * Root cause: xterm converts a mouse event to a buffer cell via
 * `clientX - element.getBoundingClientRect().left` divided by
 * `dimensions.css.cell.width`. Under CSS zoom on <html> the rect and the
 * event coordinates are zoom-scaled (physical) while `css.cell.width` stays
 * in the pre-zoom layout space — two mismatched coordinate systems. The
 * cursor then lands in the wrong cell and the highlighted selection range is
 * visually offset from the drag rectangle.
 *
 * Fix: while converting, temporarily scale `dimensions.css.cell` (and the
 * canvas clamp bounds) by the zoom factor so all three terms agree. The
 * scaling is applied synchronously inside the call and restored immediately
 * afterwards, so rendering never observes it. zoom=1 is a no-op fast path.
 *
 * Call AFTER `term.open()` — xterm instantiates `_mouseService` lazily inside
 * `open()`, so patching earlier is a silent no-op.
 */
export function patchTerminalZoomCoords(term: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- xterm internals are not typed
  const core = (term as any)?._core
  const mouseService = core?._mouseService
  const renderService = core?._renderService
  if (!mouseService || !renderService) return

  const origGetCoords = mouseService.getCoords.bind(mouseService)
  const origGetMouseReportCoords = mouseService.getMouseReportCoords.bind(mouseService)

  function withZoomedDimensions<T>(fn: () => T): T {
    const z = getUIScale()
    if (z === 1) return fn()
    const css = renderService.dimensions.css
    const cellW = css.cell.width
    const cellH = css.cell.height
    const canvasW = css.canvas.width
    const canvasH = css.canvas.height
    css.cell.width = cellW * z
    css.cell.height = cellH * z
    css.canvas.width = canvasW * z
    css.canvas.height = canvasH * z
    try {
      return fn()
    } finally {
      css.cell.width = cellW
      css.cell.height = cellH
      css.canvas.width = canvasW
      css.canvas.height = canvasH
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapped method keeps the original signature
  mouseService.getCoords = (event: any, screenEl: any, cols: number, rows: number, hasValidSize: boolean) =>
    withZoomedDimensions(() => origGetCoords(event, screenEl, cols, rows, hasValidSize))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapped method keeps the original signature
  mouseService.getMouseReportCoords = (event: any, screenEl: any) =>
    withZoomedDimensions(() => origGetMouseReportCoords(event, screenEl))
}
