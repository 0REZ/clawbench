<template>
  <SearchBar
    ref="sbRef"
    :open="open"
    :can-nav="canNav"
    :match-text="countText"
    :model-value="query"
    :case-sensitive="caseSensitive"
    :regexp="regexp"
    :whole-word="wholeWord"
    @input="onQueryInput"
    @prev="goPrev"
    @next="goNext"
    @select="selectAll"
    @close="close"
    @enter="onEnter"
    @escape="close"
    @case-change="(v) => setOption('caseSensitive', v)"
    @regexp-change="(v) => setOption('regexp', v)"
    @word-change="(v) => setOption('wholeWord', v)"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import SearchBar from '@/components/common/SearchBar.vue'
import { shouldCorrectAfterSettle } from '@/utils/searchUtils.ts'

const props = defineProps<{
    open: boolean
}>()
const emit = defineEmits(['close'])

const sbRef = ref<InstanceType<typeof SearchBar> | null>(null)
const query = ref('')
const caseSensitive = ref(false)
const regexp = ref(false)
const wholeWord = ref(false)

// Active match index (0-based) within matches list.
const activeIndex = ref(0)

interface Match {
    textNode: Text
    offset: number
    length: number
}

const matches = ref<Match[]>([])

// The highlight name for CSS Custom Highlight API (all matches + active one).
const HIGHLIGHT_NAME = 'md-search-bar-matches'
const ACTIVE_HIGHLIGHT_NAME = 'md-search-bar-active'

watch(() => props.open, async (val) => {
    if (val) {
        activeIndex.value = 0
        await nextTick()
        sbRef.value?.focus()
        if (query.value) onInput()
    } else {
        clearHighlights()
    }
})

function setOption(key: 'caseSensitive' | 'regexp' | 'wholeWord', value: boolean) {
    if (key === 'caseSensitive') caseSensitive.value = value
    else if (key === 'regexp') regexp.value = value
    else wholeWord.value = value
    onInput()
}

function onEnter(shiftKey: boolean) {
    if (shiftKey) goPrev()
    else goNext()
}

function onQueryInput(value: string) {
    query.value = value
    activeIndex.value = 0
    onInput()
}

function buildRegex(q: string): RegExp {
    let source = regexp.value ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (wholeWord.value) source = `\\b${source}\\b`
    try {
        return new RegExp(source, caseSensitive.value ? 'g' : 'gi')
    } catch {
        // Invalid regexp — fall back to a literal that can never match.
        return /(?!)/g
    }
}

function collectMatches(q: string): Match[] {
    const container = document.querySelector('.markdown-body')
    if (!container || !q.trim()) return []
    let re: RegExp
    try {
        re = buildRegex(q)
    } catch {
        return []
    }
    const out: Match[] = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
    while (walker.nextNode()) {
        const textNode = walker.currentNode as Text
        const text = textNode.textContent || ''
        re.lastIndex = 0
        let m
        while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) { re.lastIndex++; continue }
            out.push({ textNode, offset: m.index, length: m[0].length })
        }
    }
    return out
}

function onInput() {
    matches.value = collectMatches(query.value)
    activeIndex.value = 0
    highlightMatches()
}

function highlightMatches() {
    if (typeof CSS === 'undefined' || !CSS.highlights) {
        // Highlight API unsupported — no persistent match highlighting.
        return
    }
    const ranges: Range[] = []
    for (const m of matches.value) {
        try {
            const r = document.createRange()
            const end = Math.min(m.offset + m.length, m.textNode.textContent?.length || 0)
            r.setStart(m.textNode, m.offset)
            r.setEnd(m.textNode, end)
            ranges.push(r)
        } catch { /* skip broken ranges */ }
    }
    try {
        CSS.highlights.delete(HIGHLIGHT_NAME)
        if (ranges.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
    } catch { /* ignore */ }
}

function highlightActive(m: Match | null) {
    if (typeof CSS === 'undefined' || !CSS.highlights) return
    try {
        CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME)
        if (!m) return
        const r = document.createRange()
        const end = Math.min(m.offset + m.length, m.textNode.textContent?.length || 0)
        r.setStart(m.textNode, m.offset)
        r.setEnd(m.textNode, end)
        CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(r))
    } catch { /* ignore */ }
}

function clearHighlights() {
    if (typeof CSS === 'undefined' || !CSS.highlights) return
    try {
        CSS.highlights.delete(HIGHLIGHT_NAME)
        CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME)
    } catch { /* ignore */ }
}

const canNav = computed(() => matches.value.length > 0)

const countText = computed(() => {
    if (!query.value.trim()) return ''
    if (matches.value.length === 0) return '0/0'
    return `${activeIndex.value + 1}/${matches.value.length}`
})

function goNext() {
    if (!matches.value.length) return
    activeIndex.value = (activeIndex.value + 1) % matches.value.length
    jumpTo(matches.value[activeIndex.value])
}

function goPrev() {
    if (!matches.value.length) return
    activeIndex.value = (activeIndex.value - 1 + matches.value.length) % matches.value.length
    jumpTo(matches.value[activeIndex.value])
}

// Select all matches (mirrors CodeMirror's selectMatches). The rendered DOM
// cannot hold a multi-range selection, so this selects the first match's text
// while all matches stay highlighted via the CSS Highlight API.
function selectAll() {
    if (!matches.value.length) return
    activeIndex.value = 0
    const first = matches.value[0]
    try {
        const range = document.createRange()
        const end = Math.min(first.offset + first.length, first.textNode.textContent?.length || 0)
        range.setStart(first.textNode, first.offset)
        range.setEnd(first.textNode, end)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
    } catch { /* ignore */ }
    highlightMatches()
    jumpTo(first)
}

// ── Jump: temporary anchor + center scroll + line-flash ─────────────────────
function getScrollParent(node: Node): HTMLElement | null {
    let el = node.parentElement
    while (el) {
        const s = getComputedStyle(el)
        if (/(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el
        el = el.parentElement
    }
    return null
}

function unwrapAnchor(anchor: HTMLElement) {
    const parent = anchor.parentNode
    if (!parent) return
    while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor)
    parent.removeChild(anchor)
}

function centerDelta(anchor: HTMLElement, scroller: HTMLElement): number {
    const a = anchor.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    return a.top + a.height / 2 - (s.top + scroller.clientHeight / 2)
}

const correctionTimers = new Set<ReturnType<typeof setInterval>>()

function correctAfterSettle(anchor: HTMLElement, scroller: HTMLElement | null, onDone: () => void) {
    if (!anchor || !scroller) { onDone(); return }
    const deltas: number[] = []
    let attempts = 0
    let centeredStreak = 0
    const MAX_ATTEMPTS = 25
    const CENTERED_TICKS = 8
    const timer = setInterval(() => {
        if (!anchor.isConnected || attempts++ >= MAX_ATTEMPTS) {
            clearInterval(timer)
            correctionTimers.delete(timer)
            onDone()
            return
        }
        const delta = centerDelta(anchor, scroller)
        deltas.push(delta)
        const decision = shouldCorrectAfterSettle(deltas)
        if (decision.index !== -1) {
            if (decision.corrected) {
                scroller.scrollTop += delta
                deltas.length = 0
                centeredStreak = 0
            } else if (++centeredStreak >= CENTERED_TICKS) {
                clearInterval(timer)
                correctionTimers.delete(timer)
                onDone()
            }
        } else {
            centeredStreak = 0
        }
    }, 80)
    correctionTimers.add(timer)
}

onBeforeUnmount(() => {
    correctionTimers.forEach((t) => clearInterval(t))
    correctionTimers.clear()
    clearHighlights()
})

function jumpTo(match: Match) {
    const { textNode, offset, length } = match
    if (!textNode || !textNode.parentElement) return
    highlightActive(match)
    try {
        const range = document.createRange()
        const endOffset = Math.min(offset + length, textNode.textContent?.length || 0)
        range.setStart(textNode, offset)
        range.setEnd(textNode, endOffset)

        const anchor = document.createElement('span')
        anchor.className = 'search-match-anchor'
        range.surroundContents(anchor)

        const scroller = getScrollParent(anchor)
        anchor.scrollIntoView({ behavior: 'auto', block: 'center' })
        anchor.classList.add('line-flash')

        correctAfterSettle(anchor, scroller, () => {
            anchor.classList.remove('line-flash')
            unwrapAnchor(anchor)
        })
    } catch {
        const el = textNode.parentElement
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('line-flash')
        el.addEventListener('animationend', () => el.classList.remove('line-flash'), { once: true })
    }
}

function close() {
    clearHighlights()
    emit('close')
}

defineExpose({
    focus() {
        sbRef.value?.focus()
    },
})
</script>

<style>
/* Match highlighting via the CSS Custom Highlight API. These selectors must
   be global because ::highlight() pseudo-elements apply to the whole document
   (the .markdown-body content lives outside this component's scoped styles). */
::highlight(md-search-bar-matches) {
  background: color-mix(in srgb, var(--accent-color, #4a90d9) 30%, transparent);
  color: inherit;
}
::highlight(md-search-bar-active) {
  background: color-mix(in srgb, var(--accent-color, #4a90d9) 60%, transparent);
  color: inherit;
}
</style>
