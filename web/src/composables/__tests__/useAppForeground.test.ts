import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAppForeground } from '../useAppForeground'

describe('useAppForeground', () => {
  const originalSetAppForeground = (window as unknown as { __setAppForeground?: unknown }).__setAppForeground
  const originalAddEventListener = document.addEventListener

  beforeEach(() => {
    // Fresh module state for each test by resetting the global signal and
    // listeners.
    vi.resetModules()
  })

  afterEach(() => {
    const w = window as unknown as { __setAppForeground?: unknown }
    if (originalSetAppForeground === undefined) {
      delete w.__setAppForeground
    } else {
      w.__setAppForeground = originalSetAppForeground
    }
    document.addEventListener = originalAddEventListener
    vi.restoreAllMocks()
  })

  it('starts with app in the foreground', async () => {
    const { useAppForeground: useFG } = await import('../useAppForeground')
    const { appInForeground } = useFG()
    expect(appInForeground.value).toBe(true)
  })

  it('picks up the native host foreground signal (Android onPause/onResume bridge)', async () => {
    ;(window as unknown as { __setAppForeground: (fg: boolean) => void }).__setAppForeground = () => {}
    const { useAppForeground: useFG } = await import('../useAppForeground')
    const { appInForeground } = useFG()

    // The composable installs itself as the global handler, so the injected
    // function IS the bridge that Android MainActivity.onPause/onResume calls.
    const bridge = (window as unknown as { __setAppForeground: (fg: boolean) => void }).__setAppForeground
    expect(bridge).toBeTypeOf('function')

    // Simulate Android MainActivity.onPause() pushing background state.
    bridge(false)
    expect(appInForeground.value).toBe(false)

    // onResume pushes foreground state.
    bridge(true)
    expect(appInForeground.value).toBe(true)
  })

  it('falls back to document.visibilityState when no native bridge exists', async () => {
    // No __setAppForeground injected.
    let visibilityHandler: (() => void) | null = null
    document.addEventListener = vi.fn((type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === 'visibilitychange') visibilityHandler = handler as () => void
    }) as typeof document.addEventListener

    const { useAppForeground: useFG } = await import('../useAppForeground')
    const { appInForeground } = useFG()

    expect(appInForeground.value).toBe(true)

    // Simulate the page going hidden (e.g. desktop browser tab backgrounded).
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    visibilityHandler?.()
    expect(appInForeground.value).toBe(false)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    visibilityHandler?.()
    expect(appInForeground.value).toBe(true)
  })
})
