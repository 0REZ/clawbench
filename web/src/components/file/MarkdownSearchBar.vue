<template>
  <div class="md-search-bar" :class="{ 'is-open': open }">
    <div class="cm-search">
      <input
        ref="inputRef"
        v-model="query"
        name="search"
        class="cm-textfield"
        :placeholder="t('search.placeholder')"
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button name="prev" class="cm-button" :disabled="!canNav" :title="t('search.previous')" aria-label="Previous match" @click="goPrev"></button>
      <button name="next" class="cm-button" :disabled="!canNav" :title="t('search.next')" aria-label="Next match" @click="goNext"></button>
      <button name="select" class="cm-button" :disabled="!canNav" :title="t('search.all')" aria-label="Select all matches" @click="selectAll">{{ t('search.all') }}</button>
      <span class="cm-search-match-info">{{ countText }}</span>
      <button name="close" class="cm-button" :title="t('search.close')" aria-label="Close search" @click="close"></button>
    </div>
    <div class="cm-search-options">
      <label><input v-model="caseSensitive" name="case" type="checkbox" @change="onInput">{{ t('search.matchCase') }}</label>
      <label><input v-model="regexp" name="regexp" type="checkbox" @change="onInput">{{ t('search.regexp') }}</label>
      <label><input v-model="wholeWord" name="word" type="checkbox" @change="onInput">{{ t('search.byWord') }}</label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { shouldCorrectAfterSettle } from '@/utils/searchUtils.ts'

const { t } = useI18n()

const props = defineProps<{
    open: boolean
}>()
const emit = defineEmits(['close'])

const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
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
        inputRef.value?.focus()
        inputRef.value?.select()
        if (query.value) onInput()
    } else {
        clearHighlights()
    }
})

watch(query, () => {
    activeIndex.value = 0
})

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

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) goPrev()
        else goNext()
    } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
    } else if (e.key === 'ArrowDown') {
        if (matches.value.length) { e.preventDefault(); goNext() }
    } else if (e.key === 'ArrowUp') {
        if (matches.value.length) { e.preventDefault(); goPrev() }
    }
}

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
</script>

<style scoped>
/* Full-width search bar pinned to the bottom of the markdown preview.
   Only a top separator line — no surrounding box. The inner controls share
   the CodeMirror search-panel styles from the shared search-bar.css
   (imported globally below), so only the container/layout lives here. */
.md-search-bar {
  flex-shrink: 0;
  width: 100%;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  display: none;
}
.md-search-bar.is-open {
  display: block;
}

.md-search-bar .cm-search {
  --search-ctrl-h: 22px;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px 0;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Segoe UI Mono', 'Roboto Mono', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  color-scheme: light;
}
[data-theme-base="dark"] .md-search-bar .cm-search {
  color-scheme: dark;
}

.md-search-bar .cm-search input[name='search'] {
  flex: 1;
  min-width: 0;
}
.md-search-bar .cm-search .cm-search-match-info {
  margin: 0 4px;
}

/* Options row — layout only (label/checkbox visuals come from search-bar.css). */
.md-search-bar .cm-search-options {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 5px;
}
</style>

<style>
/* Shared search-panel control styles (`.cm-search` controls), single source
   of truth for both the CodeMirror panel and this markdown search bar. */
@import '@/assets/search-bar.css';

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
