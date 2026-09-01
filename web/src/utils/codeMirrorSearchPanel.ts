/**
 * Custom search panel for the CodeMirror code viewer.
 *
 * Replaces the built-in @codemirror/search panel (whose flat flex DOM makes a
 * clean two-row layout impossible) with our own DOM, while still driving the
 * editor with @codemirror/search's state + commands (searchState, SearchQuery,
 * findNext/..., setSearchQuery). The panel renders into `view.dom` below the
 * scroller, mirroring where CodeMirror's own bottom panels live.
 *
 * The panel is rendered by mounting the shared SearchBar component (see
 * components/common/SearchBar.vue) — the exact same control the markdown
 * preview uses, so both search UIs are visually identical.
 *
 * The SearchBar is mounted imperatively with Vue's `h()` + `render()`. Each
 * update re-creates the vnode with fresh props (Vue patches in place, so the
 * input element and its focus survive); `onXxx` props receive the component's
 * emits (input / prev / next / close / …).
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
import { h, render, type VNode } from 'vue'
import SearchBar, { type SearchBarLabels } from '@/components/common/SearchBar.vue'

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

/**
 * Build the custom search panel extension.
 */
export function searchPanel(spec: SearchPanelSpec) {
    return [
        searchPanelField,
        ViewPlugin.fromClass(
            class {
                private panel: HTMLElement
                private host: HTMLElement
                private vnode: VNode | null = null
                private wasOpen = false

                // Panel state, pushed into SearchBar props on each render.
                private open = false
                private canNav = false
                private matchText = ''
                private modelValue = ''
                private replaceValue = ''
                private caseChecked = false
                private regexpChecked = false
                private wordChecked = false

                constructor(readonly view: EditorView) {
                    this.panel = document.createElement('div')
                    this.panel.className = 'cm-panels'
                    this.panel.style.display = 'none'
                    view.dom.appendChild(this.panel)

                    // Mount point for the shared SearchBar component.
                    this.host = document.createElement('div')
                    this.host.style.display = 'contents'
                    this.panel.appendChild(this.host)

                    // Mount eagerly (hidden) so the DOM is always present;
                    // the SearchBar's open prop controls visibility.
                    this.renderBar()
                }

                private renderBar() {
                    const labels = toSearchBarLabels(spec.phrases)
                    this.vnode = h(SearchBar as never, {
                        open: this.open,
                        canNav: this.canNav,
                        matchText: this.matchText,
                        modelValue: this.modelValue,
                        replaceText: this.replaceValue,
                        caseSensitive: this.caseChecked,
                        regexp: this.regexpChecked,
                        wholeWord: this.wordChecked,
                        showReplace: !spec.readonly,
                        labels,
                        onInput: (value: string) => {
                            this.modelValue = value
                            this.commit()
                        },
                        'onReplace-input': (value: string) => {
                            this.replaceValue = value
                            this.commit()
                        },
                        onPrev: () => findPrevious(this.view),
                        onNext: () => findNext(this.view),
                        onSelect: () => selectMatches(this.view),
                        onClose: () => this.close(),
                        onEnter: (shift: boolean) => {
                            if (shift) findPrevious(this.view)
                            else findNext(this.view)
                        },
                        onEscape: () => this.close(),
                        'onCase-change': (checked: boolean) => {
                            this.caseChecked = checked
                            this.commit()
                        },
                        'onRegexp-change': (checked: boolean) => {
                            this.regexpChecked = checked
                            this.commit()
                        },
                        'onWord-change': (checked: boolean) => {
                            this.wordChecked = checked
                            this.commit()
                        },
                        onReplace: () => replaceNext(this.view),
                        'onReplace-all': () => replaceAll(this.view),
                    })
                    render(this.vnode, this.host)
                }

                private commit() {
                    const query = new SearchQuery({
                        search: this.modelValue,
                        replace: this.replaceValue,
                        caseSensitive: this.caseChecked,
                        regexp: this.regexpChecked,
                        wholeWord: this.wordChecked,
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
                        this.panel.style.display = open ? '' : 'none'
                        if (open) {
                            const q = getSearchQuery(update.state)
                            if (q) {
                                this.modelValue = q.search
                                this.replaceValue = q.replace ?? ''
                                this.caseChecked = q.caseSensitive
                                this.regexpChecked = q.regexp
                                this.wordChecked = q.wholeWord
                            }
                            this.open = true
                            this.renderBar()
                        } else {
                            this.open = false
                            this.renderBar()
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
                    let text = ''
                    let canNav = false
                    if (spec && spec.valid && spec.search) {
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
                        if (matches) {
                            text = `${current}/${matches}`
                            canNav = true
                        }
                    }
                    this.matchText = text
                    this.canNav = canNav
                    if (this.open) this.renderBar()
                }

                destroy() {
                    if (this.vnode) {
                        render(null, this.host)
                        this.vnode = null
                    }
                    this.panel.remove()
                }
            }
        ),
    ]
}

function toSearchBarLabels(p: SearchPanelPhrases): SearchBarLabels {
    return {
        find: p.find,
        replace: p.replace,
        previous: p.previous,
        next: p.next,
        all: p.all,
        matchCase: p.matchCase,
        regexp: p.regexp,
        byWord: p.byWord,
        replaceAction: p.replaceAction,
        replaceAll: p.replaceAllAction,
        close: p.close,
    }
}
