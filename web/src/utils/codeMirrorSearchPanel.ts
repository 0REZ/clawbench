/**
 * Custom search panel for the CodeMirror code viewer.
 *
 * Replaces the built-in @codemirror/search panel (whose flat flex DOM makes a
 * clean two-row layout impossible) with our own DOM, while still driving the
 * editor with @codemirror/search's state + commands (searchState, SearchQuery,
 * findNext/..., setSearchQuery). The panel renders into `view.dom` below the
 * scroller, mirroring where CodeMirror's own bottom panels live.
 *
 * The DOM intentionally keeps the same class names the built-in panel uses
 * (`.cm-panels`, `.cm-search`, `.cm-button`, `input[name=search]`, ...) so
 * tests and existing CSS selectors keep working, but the structure is ours.
 */
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import {
    SearchQuery,
    setSearchQuery,
    getSearchQuery,
    findNext,
    findPrevious,
    replaceNext,
    replaceAll,
    selectMatches,
} from '@codemirror/search'

/** Toggle the custom search panel open/closed. */
export const searchPanelToggle = StateEffect.define<boolean>()

/** Whether the custom search panel is currently open. */
export const searchPanelField = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
        for (const e of tr.effects) {
            if (e.is(searchPanelToggle)) return e.value
        }
        return value
    },
})

/** Open the custom search panel programmatically (toolbar button / Mod-f). */
export function openSearchPanelCommand(view: EditorView): boolean {
    view.dispatch({ effects: searchPanelToggle.of(true) })
    return true
}

export interface SearchPanelPhrases {
    find: string
    replace: string
    next: string
    previous: string
    all: string
    matchCase: string
    regexp: string
    byWord: string
    replaceAction: string
    replaceAllAction: string
    close: string
}

export interface SearchPanelSpec {
    phrases: SearchPanelPhrases
    /** Hide the replace row for read-only editors. */
    readonly: boolean
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/**
 * Build the custom search panel extension.
 */
export function searchPanel(spec: SearchPanelSpec) {
    return [
        searchPanelField,
        ViewPlugin.fromClass(
            class {
                dom: HTMLElement
                private input: HTMLInputElement
                private replaceInput: HTMLInputElement | null = null
                private caseField: HTMLInputElement
                private regexpField: HTMLInputElement
                private wordField: HTMLInputElement
                private matchInfo: HTMLElement
                private wasOpen = false

                constructor(readonly view: EditorView) {
                    this.dom = document.createElement('div')
                    this.dom.className = 'cm-panels'
                    this.dom.style.display = 'none'
                    view.dom.appendChild(this.dom)

                    const panel = document.createElement('div')
                    panel.className = 'cm-search'
                    const p = spec.phrases
                    panel.innerHTML =
                        `<input name="search" class="cm-textfield" placeholder="${escapeHtml(p.find)}" ` +
                        `aria-label="${escapeHtml(p.find)}" autocomplete="off">` +
                        `<button name="prev" class="cm-button" title="${escapeHtml(p.previous)}" aria-label="${escapeHtml(p.previous)}">${escapeHtml(p.previous)}</button>` +
                        `<button name="next" class="cm-button" title="${escapeHtml(p.next)}" aria-label="${escapeHtml(p.next)}">${escapeHtml(p.next)}</button>` +
                        `<button name="select" class="cm-button" title="${escapeHtml(p.all)}">${escapeHtml(p.all)}</button>` +
                        `<span class="cm-search-match-info"></span>` +
                        `<button name="close" class="cm-button" title="${escapeHtml(p.close)}" aria-label="${escapeHtml(p.close)}">×</button>` +
                        `<span class="cm-search-options">` +
                        `<label><input name="case" type="checkbox">${escapeHtml(p.matchCase)}</label>` +
                        `<label><input name="regexp" type="checkbox">${escapeHtml(p.regexp)}</label>` +
                        `<label><input name="word" type="checkbox">${escapeHtml(p.byWord)}</label>` +
                        `</span>` +
                        (spec.readonly
                            ? ''
                            : `<span class="cm-search-replace">` +
                              `<input name="replace" class="cm-textfield" placeholder="${escapeHtml(p.replace)}" ` +
                              `aria-label="${escapeHtml(p.replace)}" autocomplete="off">` +
                              `<button name="replace" class="cm-button">${escapeHtml(p.replaceAction)}</button>` +
                              `<button name="replaceAll" class="cm-button">${escapeHtml(p.replaceAllAction)}</button>` +
                              `</span>`)
                    this.dom.appendChild(panel)

                    this.input = this.dom.querySelector<HTMLInputElement>('input[name=search]')!
                    this.replaceInput = this.dom.querySelector<HTMLInputElement>('input[name=replace]')
                    this.caseField = this.dom.querySelector<HTMLInputElement>('input[name=case]')!
                    this.regexpField = this.dom.querySelector<HTMLInputElement>('input[name=regexp]')!
                    this.wordField = this.dom.querySelector<HTMLInputElement>('input[name=word]')!
                    this.matchInfo = this.dom.querySelector<HTMLElement>('.cm-search-match-info')!

                    this.bindEvents()
                    this.updateMatchInfo()
                }

                private bindEvents() {
                    this.input.addEventListener('input', () => this.commit())
                    this.input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            if (e.shiftKey) findPrevious(this.view)
                            else findNext(this.view)
                        } else if (e.key === 'Escape') {
                            this.close()
                        }
                    })
                    this.replaceInput?.addEventListener('input', () => this.commit())
                    this.replaceInput?.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            replaceNext(this.view)
                        }
                    })
                    for (const cb of [this.caseField, this.regexpField, this.wordField]) {
                        cb.addEventListener('change', () => this.commit())
                    }
                    this.dom.querySelector<HTMLElement>('[name=prev]')!.addEventListener('click', () => findPrevious(this.view))
                    this.dom.querySelector<HTMLElement>('[name=next]')!.addEventListener('click', () => findNext(this.view))
                    this.dom.querySelector<HTMLElement>('[name=select]')!.addEventListener('click', () => selectMatches(this.view))
                    this.dom.querySelector<HTMLElement>('[name=replace]')?.addEventListener('click', () => replaceNext(this.view))
                    this.dom.querySelector<HTMLElement>('[name=replaceAll]')?.addEventListener('click', () => replaceAll(this.view))
                    this.dom.querySelector<HTMLElement>('[name=close]')!.addEventListener('click', () => this.close())
                }

                private commit() {
                    const query = new SearchQuery({
                        search: this.input.value,
                        replace: this.replaceInput?.value ?? '',
                        caseSensitive: this.caseField.checked,
                        regexp: this.regexpField.checked,
                        wholeWord: this.wordField.checked,
                    })
                    this.view.dispatch({ effects: setSearchQuery.of(query) })
                }

                private close() {
                    this.view.dispatch({ effects: searchPanelToggle.of(false) })
                }

                update(update: ViewUpdate) {
                    const open = update.state.field(searchPanelField)
                    const wasOpen = this.wasOpen
                    this.wasOpen = open
                    if (open !== wasOpen) {
                        this.dom.style.display = open ? '' : 'none'
                        if (open) {
                            const q = getSearchQuery(update.state)
                            if (q) {
                                this.input.value = q.search
                                if (this.replaceInput) this.replaceInput.value = q.replace ?? ''
                                this.caseField.checked = q.caseSensitive
                                this.regexpField.checked = q.regexp
                                this.wordField.checked = q.wholeWord
                            }
                            // Focus the search box; select its text so typing replaces it.
                            this.input.focus()
                            this.input.select()
                        }
                    }
                    if (
                        update.docChanged ||
                        update.selectionSet ||
                        update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))
                    ) {
                        try {
                            this.updateMatchInfo()
                        } catch {
                            // Match counting must never break the editor.
                        }
                    }
                }

                private updateMatchInfo() {
                    const spec = getSearchQuery(this.view.state)
                    this.matchInfo.textContent = ''
                    if (!spec || !spec.valid || !spec.search) return
                    // getSearchQuery returns the plain query *spec*; build a
                    // SearchQuery instance to count matches via its cursor.
                    const query = new SearchQuery(spec)
                    const state = this.view.state
                    const sel = state.selection.main
                    let matches = 0
                    let current = 0
                    const cursor = query.getCursor(state)
                    let step = cursor.next()
                    while (!step.done) {
                        matches++
                        if (step.value.from <= sel.from) current++
                        if (matches > 100000) break
                        step = cursor.next()
                    }
                    this.matchInfo.textContent = matches ? `${current}/${matches}` : ''
                }

                destroy() {
                    this.dom.remove()
                }
            }
        ),
    ]
}
