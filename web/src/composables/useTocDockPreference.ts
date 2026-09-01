import { ref, computed, watch } from 'vue'
import { appLog } from '@/utils/appLog'
import { getWideScreenState } from './useWideScreenLayout'
import { useFileEditor } from './useFileEditor'

export const TOC_DOCK_OPEN_KEY = 'clawbench.tocDock.open'
export const TOC_DOCK_WIDTH_KEY = 'clawbench.tocDock.width'
export const TOC_DOCK_SIDE_KEY = 'clawbench.tocDock.side'
export const TOC_DOCK_MIN_WIDTH = 200
export const TOC_DOCK_MAX_WIDTH = 400
export const TOC_DOCK_DEFAULT_WIDTH = 260
export const TOC_DOCK_DEFAULT_SIDE = 'right'
export type TocDockSide = 'left' | 'right'

const TAG = 'TocDockPref'

const { isWideScreen } = getWideScreenState()
const { editing } = useFileEditor()

/**
 * PC-wide-screen TOC dock preference. The dock is the inline right-side TOC
 * panel inside the file overlay (VS Code outline-style), as opposed to the
 * narrow-screen bottom drawer.
 *
 * - Open/close state is remembered globally (localStorage) across reloads.
 * - Width (draggable) is remembered globally, clamped to [200, 400].
 * - Side (left/right) is remembered globally (localStorage).
 * - While the file editor is active the dock is hidden (it is a read-navigation
 *   tool); exiting edit mode restores the previous open state.
 * - effectiveOpen is only ever true on wide screens; on narrow screens the
 *   TOC keeps using the bottom drawer and this module is inert.
 */

const tocDockOpen = ref(false)
const tocDockWidth = ref(TOC_DOCK_DEFAULT_WIDTH)
const tocDockSide = ref<TocDockSide>(TOC_DOCK_DEFAULT_SIDE)

/** Pre-edit open state, restored on exit. In-memory only (not persisted). */
let wasOpenBeforeEdit = false
let initialized = false

// Editing hides the dock; restore the pre-edit state on exit.
// Registered exactly once at module load — re-registering per init() would
// accumulate duplicate watchers that share `wasOpenBeforeEdit` and overwrite
// each other.
watch(editing, (isEditing) => {
    if (isEditing) {
        wasOpenBeforeEdit = tocDockOpen.value
        tocDockOpen.value = false
    } else {
        tocDockOpen.value = wasOpenBeforeEdit
        wasOpenBeforeEdit = false
    }
})

function readStoredOpen(): boolean {
    try {
        const v = localStorage.getItem(TOC_DOCK_OPEN_KEY)
        if (v !== null) return v === '1'
    } catch {
        // localStorage may throw in restricted environments — fall through
    }
    return false
}

function readStoredWidth(): number {
    try {
        const stored = localStorage.getItem(TOC_DOCK_WIDTH_KEY)
        if (stored !== null) {
            const raw = Number(stored)
            if (Number.isFinite(raw)) return clampWidth(raw)
        }
    } catch {
        // ignore
    }
    return TOC_DOCK_DEFAULT_WIDTH
}

function clampWidth(w: number): number {
    return Math.min(TOC_DOCK_MAX_WIDTH, Math.max(TOC_DOCK_MIN_WIDTH, w))
}

function clampSide(value: string): TocDockSide {
    return value === 'left' ? 'left' : 'right'
}

function readStoredSide(): TocDockSide {
    try {
        const stored = localStorage.getItem(TOC_DOCK_SIDE_KEY)
        if (stored !== null) return clampSide(stored)
    } catch {
        // ignore
    }
    return TOC_DOCK_DEFAULT_SIDE
}

function init() {
    if (initialized) return
    initialized = true
    tocDockOpen.value = readStoredOpen()
    tocDockWidth.value = readStoredWidth()
    tocDockSide.value = readStoredSide()
}

function persistOpen() {
    try {
        localStorage.setItem(TOC_DOCK_OPEN_KEY, tocDockOpen.value ? '1' : '0')
    } catch (e) {
        appLog.w(TAG, 'persist open failed', e)
    }
}

export function useTocDockPreference() {
    init()

    function toggle() {
        // Editing hard-hides the dock (read-navigation tool): accept no toggle
        // while editing, otherwise the open state and its persistence get
        // corrupted by a click that the UI can't even reflect.
        if (editing.value) return
        tocDockOpen.value = !tocDockOpen.value
        persistOpen()
    }

    function close() {
        tocDockOpen.value = false
        persistOpen()
    }

    function setWidth(w: number) {
        tocDockWidth.value = clampWidth(w)
        try {
            localStorage.setItem(TOC_DOCK_WIDTH_KEY, String(tocDockWidth.value))
        } catch (e) {
            appLog.w(TAG, 'persist width failed', e)
        }
    }

    /** Toggle the dock between the left and right edges. */
    function toggleSide() {
        tocDockSide.value = tocDockSide.value === 'left' ? 'right' : 'left'
        try {
            localStorage.setItem(TOC_DOCK_SIDE_KEY, tocDockSide.value)
        } catch (e) {
            appLog.w(TAG, 'persist side failed', e)
        }
    }

    const effectiveOpen = computed(() => isWideScreen.value && tocDockOpen.value && !editing.value)

    return { tocDockOpen, tocDockWidth, tocDockSide, effectiveOpen, toggle, close, setWidth, toggleSide }
}

/** @internal Reset all state — for tests only */
export function _resetForTest() {
    initialized = false
    tocDockOpen.value = false
    tocDockWidth.value = TOC_DOCK_DEFAULT_WIDTH
    tocDockSide.value = TOC_DOCK_DEFAULT_SIDE
    wasOpenBeforeEdit = false
}
