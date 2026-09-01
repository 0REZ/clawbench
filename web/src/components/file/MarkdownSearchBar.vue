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
      <span class="cm-search-match-info">{{ countText }}</span>
      <button name="close" class="cm-button" :title="t('search.close')" aria-label="Close search" @click="close"></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { BLOCK_TAGS, shouldCorrectAfterSettle } from '@/utils/searchUtils.ts'

const { t } = useI18n()

const props = defineProps<{
    open: boolean
}>()
const emit = defineEmits(['close'])

const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// Active match index (0-based) within matches list.
const activeIndex = ref(0)

interface Match {
    textNode: Text
    offset: number
    length: number
}

const matches = ref<Match[]>([])

watch(() => props.open, async (val) => {
    if (val) {
        activeIndex.value = 0
        await nextTick()
        inputRef.value?.focus()
        inputRef.value?.select()
        if (query.value) onInput()
    }
})

watch(query, () => {
    activeIndex.value = 0
})

function findBlockAncestor(node: Node): Element {
    let el = node.parentElement
    while (el) {
        if (BLOCK_TAGS.has(el.tagName) && el.closest('.markdown-body')) return el
        el = el.parentElement
    }
    return node.parentElement || (document.body as HTMLElement)
}

function collectMatches(q: string): Match[] {
    const container = document.querySelector('.markdown-body')
    if (!container || !q.trim()) return []
    const lowerQ = q.toLowerCase()
    const out: Match[] = []
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
    while (walker.nextNode()) {
        const textNode = walker.currentNode as Text
        const text = textNode.textContent || ''
        if (!text.toLowerCase().includes(lowerQ)) continue
        findBlockAncestor(textNode) // keep block scoping consistent with the drawer
        const offset = text.toLowerCase().indexOf(lowerQ)
        out.push({ textNode, offset, length: q.length })
    }
    return out
}

function onInput() {
    matches.value = collectMatches(query.value)
    activeIndex.value = 0
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
})

function jumpTo(match: Match) {
    const { textNode, offset, length } = match
    if (!textNode || !textNode.parentElement) return
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
    emit('close')
}
</script>

<style scoped>
/* Full-width search bar pinned to the bottom of the markdown preview.
   Only a top separator line — no surrounding box — unlike the floating
   CodeMirror search panel. The inner controls reuse the .cm-search class
   names so their styling matches the CodeMirror search panel. */
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
  padding: 5px 8px;
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
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── Control styling (mirrors the CodeMirror search panel) ── */
.md-search-bar .cm-search .cm-textfield {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 0;
  color: var(--text-primary);
  padding: 3px 8px;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  min-height: var(--search-ctrl-h);
  box-sizing: border-box;
}
.md-search-bar .cm-search .cm-textfield:focus {
  border-color: var(--accent-color);
}

.md-search-bar .cm-search .cm-button {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 0;
  color: var(--text-primary);
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
  min-height: var(--search-ctrl-h);
  box-sizing: border-box;
  line-height: 1;
  white-space: nowrap;
}
.md-search-bar .cm-search .cm-button:hover:not(:disabled) {
  background: var(--bg-quaternary, var(--bg-tertiary));
  border-color: var(--accent-color);
}
.md-search-bar .cm-search .cm-button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* prev / next — arrow icons only (like the CodeMirror panel). */
.md-search-bar .cm-search .cm-button[name='next'],
.md-search-bar .cm-search .cm-button[name='prev'] {
  position: relative;
  width: var(--search-ctrl-h);
  height: var(--search-ctrl-h);
  padding: 0;
  font-size: 0;
  flex-shrink: 0;
}
.md-search-bar .cm-search .cm-button[name='next']::before,
.md-search-bar .cm-search .cm-button[name='prev']::before {
  content: '';
  display: inline-block;
  font-size: 12px;
  line-height: 1;
  border: solid var(--text-primary);
  border-width: 0 1.5px 1.5px 0;
  padding: 2.5px;
}
.md-search-bar .cm-search .cm-button[name='prev']::before {
  transform: rotate(135deg); /* ← */
  margin-right: -2px;
}
.md-search-bar .cm-search .cm-button[name='next']::before {
  transform: rotate(-45deg); /* → */
  margin-left: -2px;
}

/* close — borderless, muted, like the CodeMirror panel's corner close. */
.md-search-bar .cm-search button[name='close'] {
  background: transparent;
  border: none;
  width: var(--search-ctrl-h);
  height: var(--search-ctrl-h);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.15s, color 0.15s;
}
.md-search-bar .cm-search button[name='close']:hover {
  background: var(--bg-quaternary, var(--bg-tertiary));
  color: var(--text-primary);
}
</style>
