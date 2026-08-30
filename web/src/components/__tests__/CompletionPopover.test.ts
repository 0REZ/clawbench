import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import CompletionPopover from '@/components/common/CompletionPopover.vue'

// Mock the singleton composable so each test controls state directly.
// Hoisted vi.mock factories cannot reference outer variables, so the mock
// exposes mutable refs via a getter.
const mockState = {
    active: ref(null),
    queue: ref([]),
    dismiss: vi.fn(),
    dismissOnBackdrop: vi.fn(),
}

const { mockGetAgentBackend } = vi.hoisted(() => ({
    mockGetAgentBackend: vi.fn(() => ''),
}))

vi.mock('@/composables/useCompletionPopover', () => ({
    useCompletionPopover: () => mockState,
}))

vi.mock('@/composables/useAgents', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/composables/useAgents')>()
    return {
        ...actual,
        useAgents: () => ({ ...actual.useAgents(), getAgentBackend: mockGetAgentBackend }),
    }
})

function makeItem(overrides = {}) {
    return {
        sessionId: 's1',
        title: '这是一个很长的会话标题用于测试溢出省略号的显示效果',
        summary: '**加粗的摘要内容** 以及普通文本',
        kind: 'session',
        projectPath: '',
        ...overrides,
    }
}

describe('CompletionPopover', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        vi.clearAllMocks()
        mockState.active = ref(null)
        mockState.queue = ref([])
        mockGetAgentBackend.mockReturnValue('')
    })
    function mountPopover() {
        return mount(CompletionPopover, { attachTo: document.body })
    }

    it('renders nothing when no item is active', () => {
        mountPopover()
        expect(document.querySelector('.completion-popover')).toBeFalsy()
    })

    it('renders the session title', () => {
        mockState.active = ref(makeItem({ title: '修复登录 bug' }))
        mountPopover()

        const el = document.querySelector('.completion-popover-title')!
        expect(el.textContent).toContain('修复登录 bug')
    })

    it('renders the last user message as a single line quote block', () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        const el = document.querySelector('.completion-popover-user-quote')!
        const text = el.querySelector('.completion-popover-user-quote-text')!
        // 左侧消息图标（lucide 组件直接渲染为 svg，class 即元素本身）
        const icon = el.querySelector('.completion-popover-user-quote-icon')
        expect(icon).toBeTruthy()
        expect(icon!.tagName.toLowerCase()).toBe('svg')
        expect(text.textContent).toContain('请帮我修复登录 bug')
        // 折叠态单行省略逻辑在内层文本 span（flex 容器内 text-overflow 不生效）
        const styles = window.getComputedStyle(text)
        expect(styles.textOverflow).toBe('ellipsis')
        expect(styles.overflow).toBe('hidden')
        expect(styles.whiteSpace).toBe('nowrap')
    })

    it('styles the user message as a quote block (left accent border, no radius, tinted bg)', () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        const row = document.querySelector('.completion-popover-meta-user')!
        const el = document.querySelector('.completion-popover-user-quote')!
        const rowStyles = window.getComputedStyle(row)
        // 行容器靠左对齐
        expect(rowStyles.justifyContent).toBe('flex-start')
        // 引用块：inline-flex 布局容纳图标 + 文本，宽度随内容自适应（max-width: 100% 仅作上限）
        const styles = window.getComputedStyle(el)
        expect(styles.display).toBe('inline-flex')
        expect(styles.maxWidth).toBe('100%')
        expect(styles.fontSize).toBe('12px')

        // 元信息行无负 margin（引用块不铺满卡片宽度）
        const cssRow = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const metaRule = cssRow.split('\n').filter((line) => line.includes('.completion-popover-meta-user')).join('\n')
        expect(metaRule).not.toContain('margin-left: -10px')
        expect(metaRule).not.toContain('margin-right: -10px')

        // jsdom 无法解析 color-mix()/var() 与 border-radius 计算值，
        // 这些改为断言组件注入的 CSS 规则文本（其余走计算值）
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const quoteRule = cssText.split('\n').filter((line) => line.includes('.completion-popover-user-quote')).join('\n')
        // 左侧 accent 竖线描边、无圆角、淡色底
        expect(quoteRule).toContain('border-left: 2px solid var(--accent-color)')
        expect(quoteRule).toContain('border-radius: 0')
        expect(quoteRule).toContain('background: color-mix(in srgb, var(--accent-color) 10%')
        // 折叠态不应保留胶囊气泡样式
        expect(quoteRule).not.toContain('999px')
        expect(quoteRule).not.toContain('var(--user-msg-color)')
    })

    it('expands the user message quote block on click and collapses on second click', async () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        const el = document.querySelector('.completion-popover-user-quote')!
        const text = el.querySelector('.completion-popover-user-quote-text')!

        // 初始折叠：单行省略、未展开态
        expect(el.classList.contains('is-expanded')).toBe(false)
        expect(el.getAttribute('aria-expanded')).toBe('false')
        expect(window.getComputedStyle(text).whiteSpace).toBe('nowrap')

        // 无展开提示图标（用户点击即可展开，不展示额外提示）
        expect(el.querySelector('.completion-popover-user-quote-chevron')).toBeFalsy()

        // 点击展开：文本换行显示完整内容
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await nextTick()
        expect(el.classList.contains('is-expanded')).toBe(true)
        expect(el.getAttribute('aria-expanded')).toBe('true')
        expect(window.getComputedStyle(text).whiteSpace).toBe('pre-wrap')

        // 再次点击收起
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await nextTick()
        expect(el.classList.contains('is-expanded')).toBe(false)
        expect(el.getAttribute('aria-expanded')).toBe('false')
        expect(window.getComputedStyle(text).whiteSpace).toBe('nowrap')
    })

    it('removes the divider between the user message quote block and the assistant summary', () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        // 用户消息行自身不应有 border（引用块自身已带左侧描边分层）
        const metaRow = document.querySelector('.completion-popover-meta-user')!
        const rowStyles = window.getComputedStyle(metaRow)
        expect(rowStyles.borderTopStyle).toBe('none')
        expect(rowStyles.borderBottomStyle).toBe('none')

        // 分隔线规则存在，但被限定为"非用户消息行"的元信息——
        // 用户消息行紧跟摘要时选择器不匹配，即用户消息与助手消息之间无分隔线
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const dividerRule = cssText.split('\n').filter((line) => line.includes('.completion-popover-summary')).join('\n')
        expect(dividerRule).toContain('.completion-popover-meta:not(.completion-popover-meta-user) + .completion-popover-summary')
        expect(dividerRule).toContain('border-top')
    })

    it('keeps the divider between the project row and the assistant summary', () => {
        mockState.active = ref(makeItem({ projectName: 'my-app', userMessage: '' }))
        mountPopover()

        // jsdom 不解析 color-mix()，border 计算值不可靠；
        // 改为断言分隔线规则仍存在于样式表中且选择器覆盖项目行
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const dividerRule = cssText.split('\n').filter((line) => line.includes('.completion-popover-meta:not(.completion-popover-meta-user)')).join('\n')
        expect(dividerRule).toContain('border-top: 1px solid color-mix(in srgb, var(--text-primary) 16%, transparent)')
    })

    it('hides the user message row when empty', () => {
        mockState.active = ref(makeItem({ userMessage: '' }))
        mountPopover()

        expect(document.querySelector('.completion-popover-user-quote')).toBeFalsy()
    })

    it('keeps a long user message on a single line and expands to full content on click', async () => {
        const longMessage = '这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的用户消息，用来验证引用块内的文本超出宽度时保持单行并显示省略号'
        mockState.active = ref(makeItem({ userMessage: longMessage }))
        mountPopover()

        const el = document.querySelector('.completion-popover-user-quote')!
        const text = el.querySelector('.completion-popover-user-quote-text')!
        // 完整文本仍在 DOM（省略号只是视觉裁剪，点击可展开查看完整内容）
        expect(text.textContent).toBe(longMessage)
        // 折叠态：单行不换行 + 溢出隐藏 + 省略号
        const styles = window.getComputedStyle(text)
        expect(styles.whiteSpace).toBe('nowrap')
        expect(styles.overflow).toBe('hidden')
        expect(styles.textOverflow).toBe('ellipsis')
        // 文本 span 可收缩（min-width: 0），否则长文本会撑破引用块容器
        expect(styles.minWidth).toBe('0px')
        // 点击后展开为完整可读内容
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await nextTick()
        expect(window.getComputedStyle(text).whiteSpace).toBe('pre-wrap')
    })

    it('renders the project name and path when provided', () => {
        mockState.active = ref(makeItem({ projectName: 'my-app', projectPath: '/home/user' }))
        mountPopover()

        const nameEl = document.querySelector('.completion-popover-project-name')!
        expect(nameEl.textContent).toBe('my-app')
        const pathEl = document.querySelector('.completion-popover-project-path')!
        expect(pathEl.textContent).toBe('/home/user')
        // 项目行位于底部 footer：无外边距、横向铺满卡片的独立区隔带
        const footer = document.querySelector('.completion-popover-footer')!
        expect(footer).toBeTruthy()
        expect(footer.querySelector('.completion-popover-project')).toBeTruthy()
        // jsdom 不解析 color-mix()，改断言 CSS 规则文本
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const footerRule = cssText.split('\n').filter((line) => line.includes('.completion-popover-footer')).join('\n')
        expect(footerRule).toContain('background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-primary')
        // 贴边区隔：负 margin 铺满卡片宽度、顶部描边、无圆角
        expect(footerRule).toContain('margin: 8px -10px -8px')
        expect(footerRule).toContain('border-top: 1px solid color-mix(in srgb, var(--accent-color) 30%, transparent)')
        expect(footerRule).not.toContain('border-radius')
        // "外部"徽章：图标 + 文字，提示这是其他项目的会话
        const badge = document.querySelector('.completion-popover-project-badge')!
        expect(badge).toBeTruthy()
        expect(badge.querySelector('svg')).toBeTruthy()
        expect(badge.textContent!.trim().length).toBeGreaterThan(0)
        // 路径 span 承担单行省略（flex 容器内 text-overflow 不生效，
        // 省略逻辑须落在路径上，保证图标/项目名不被截断）
        const pathStyles = window.getComputedStyle(pathEl)
        expect(pathStyles.whiteSpace).toBe('nowrap')
        expect(pathStyles.overflow).toBe('hidden')
        expect(pathStyles.textOverflow).toBe('ellipsis')
        // 徽章与项目名不收缩，保持完整
        const nameStyles = window.getComputedStyle(nameEl)
        expect(nameStyles.flexShrink).toBe('0')
        const badgeStyles = window.getComputedStyle(badge)
        expect(badgeStyles.flexShrink).toBe('0')
    })

    it('hides the project path span when projectPath is empty', () => {
        mockState.active = ref(makeItem({ projectName: 'my-app', projectPath: '' }))
        mountPopover()

        expect(document.querySelector('.completion-popover-project-name')).toBeTruthy()
        expect(document.querySelector('.completion-popover-project-path')).toBeFalsy()
    })

    it('hides the project row when projectName is empty (same project)', () => {
        mockState.active = ref(makeItem({ projectName: '', projectPath: '' }))
        mountPopover()

        expect(document.querySelector('.completion-popover-project')).toBeFalsy()
    })

    it('animates with Android-notification style slide-down enter transition', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        // jsdom cannot observe <Transition> class lifecycle, so assert the
        // injected stylesheet contains the Android-notification style slide-down.
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        expect(cssText).toContain('.completion-popover-card-enter-from')
        expect(cssText).toContain('translateY(-120%)')
        expect(cssText).toContain('cubic-bezier(0.4, 0, 0.2, 1)')
    })

    it('wraps the card in a Transition inside the static backdrop (animation layer guard)', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        // The card must be a direct child of a <Transition> that sits inside the
        // backdrop — this layer structure is what makes enter/leave animations
        // actually play. Regression guard for the animation-layer fix.
        const backdrop = document.querySelector('.completion-popover-backdrop')!
        const card = document.querySelector('.completion-popover')!
        const transitionEl = card.parentElement!
        // Card's direct parent is the Transition's rendered slot root
        expect(transitionEl.parentElement).toBe(backdrop)
        // The Transition wraps exactly one conditional element (the card)
        expect(transitionEl.querySelectorAll('.completion-popover')).toHaveLength(1)
    })

    it('renders the agent backend icon when agentId resolves', () => {
        mockGetAgentBackend.mockReturnValue('codebuddy')
        mockState.active = ref(makeItem({ agentId: 'cb-1' }))
        mountPopover()

        expect(mockGetAgentBackend).toHaveBeenCalledWith('cb-1')
        expect(document.querySelector('.agent-icon-svg')).toBeTruthy()
    })

    it('skips the agent icon when agentId is unknown or missing', () => {
        mockGetAgentBackend.mockReturnValue('')
        mockState.active = ref(makeItem({ agentId: 'unknown-agent' }))
        mountPopover()

        expect(document.querySelector('.agent-icon-svg')).toBeFalsy()
    })

    it('renders the summary as markdown HTML', () => {
        mockState.active = ref(makeItem({ summary: '**加粗摘要**' }))
        mountPopover()

        const el = document.querySelector('.completion-popover-summary')!
        expect(el.querySelector('strong')).toBeTruthy()
        expect(el.querySelector('strong')!.textContent).toBe('加粗摘要')
    })

    it('shows the full summary without line clamping, scrolling when overflow', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        const el = document.querySelector('.completion-popover-summary')!
        const styles = window.getComputedStyle(el)
        // Full content visible — no -webkit-box line clamp
        expect(styles.webkitLineClamp).not.toBe('10')
        // Internal scroll for overflow
        expect(styles.overflowY).toBe('auto')
    })

    it('truncates the title with ellipsis via CSS', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        const el = document.querySelector('.completion-popover-title')!
        const styles = window.getComputedStyle(el)
        expect(styles.textOverflow).toBe('ellipsis')
        expect(styles.overflow).toBe('hidden')
        expect(styles.whiteSpace).toBe('nowrap')
    })

    it('renders an open-session icon button and no close button', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        expect(document.querySelector('.completion-popover-open')).toBeTruthy()
        expect(document.querySelector('.completion-popover-close')).toBeFalsy()
    })

    it('clicking the open button dispatches clawbench-open-session for session kind', () => {
        mockState.active = ref(makeItem({ sessionId: 's42', projectPath: '/proj' }))
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const openBtn = document.querySelector('.completion-popover-open')!
        openBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).toHaveBeenCalledTimes(1)
        const ev = dispatchSpy.mock.calls[0][0] as CustomEvent
        expect(ev.type).toBe('clawbench-open-session')
        expect(ev.detail).toEqual({ sessionId: 's42', projectPath: '/proj' })
        expect(mockState.dismiss).toHaveBeenCalledTimes(1)
    })

    it('clicking the open button dispatches clawbench-open-task for task kind', () => {
        mockState.active = ref(makeItem({ kind: 'task', taskId: '7', executionId: 'e9' }))
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const openBtn = document.querySelector('.completion-popover-open')!
        openBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).toHaveBeenCalledTimes(1)
        const ev = dispatchSpy.mock.calls[0][0] as CustomEvent
        expect(ev.type).toBe('clawbench-open-task')
        expect(ev.detail).toEqual({ taskId: '7', executionId: 'e9', projectPath: '' })
        expect(mockState.dismiss).toHaveBeenCalledTimes(1)
    })

    it('clicking the card body does NOT navigate (only the open button does)', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const card = document.querySelector('.completion-popover')!
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).not.toHaveBeenCalled()
        expect(mockState.dismiss).not.toHaveBeenCalled()
    })

    it('clicking outside the card (on the backdrop) goes through the guarded dismiss', () => {
        mockState.active = ref(makeItem())
        mockState.dismissOnBackdrop.mockReturnValue(true)
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const backdrop = document.querySelector('.completion-popover-backdrop')!

        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).not.toHaveBeenCalled()
        // backdrop 关闭走带防误触保护的 dismissOnBackdrop（最小停留时长在 composable 层拦截）
        expect(mockState.dismissOnBackdrop).toHaveBeenCalledTimes(1)
        expect(mockState.dismiss).not.toHaveBeenCalled()
    })

    it('clicking a code-block copy button inside the summary does not navigate', () => {
        mockState.active = ref(makeItem({ summary: '```js\nconst a = 1\n```' }))
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const copyBtn = document.querySelector('.completion-popover-summary .code-block-copy-btn')!
        copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).not.toHaveBeenCalled()
        expect(mockState.dismiss).not.toHaveBeenCalled()
    })

    it('clicking a code-block wrap button inside the summary does not navigate', () => {
        mockState.active = ref(makeItem({ summary: '```js\nconst a = 1\n```' }))
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const wrapBtn = document.querySelector('.completion-popover-summary .code-block-wrap-btn')!
        wrapBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).not.toHaveBeenCalled()
        expect(mockState.dismiss).not.toHaveBeenCalled()
    })

    it('renders a quick-reply input box', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        expect(document.querySelector('.completion-popover-textarea')).toBeTruthy()
        // 空输入时：发送按钮存在但 disabled；标记已读按钮在 header 中始终存在
        const sendBtn = document.querySelector('.completion-popover-send')!
        expect(sendBtn.classList.contains('disabled')).toBe(true)
        expect(document.querySelector('.completion-popover-mark-read')).toBeTruthy()
    })

    it('keeps the mark-as-read button in the header (left of open) independent of input', async () => {
        mockState.active = ref(makeItem())
        mountPopover()

        const header = document.querySelector('.completion-popover-header')!
        // mark-read 和 open 都在 header 中
        const markRead = document.querySelector('.completion-popover-mark-read')!
        const open = document.querySelector('.completion-popover-open')!
        expect(markRead).toBeTruthy()
        expect(open).toBeTruthy()
        // mark-read 位于 open 左边
        expect(header.compareDocumentPosition(markRead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(markRead.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

        // 输入内容后 mark-read 依然存在（不随输入联动）
        const textarea = document.querySelector('.completion-popover-textarea') as HTMLTextAreaElement
        textarea.value = '回复内容'
        textarea.dispatchEvent(new Event('input'))
        await nextTick()

        expect(document.querySelector('.completion-popover-mark-read')).toBeTruthy()
        expect(document.querySelector('.completion-popover-send')!.classList.contains('disabled')).toBe(false)
    })

    it('aligns the input box with the chat input bar (radius 20px, 16px textarea, 28px send button)', async () => {
        mockState.active = ref(makeItem())
        mountPopover()

        // 输入文本使发送按钮变为可点状态
        const textareaEl = document.querySelector('.completion-popover-textarea') as HTMLTextAreaElement
        textareaEl.value = '测试'
        textareaEl.dispatchEvent(new Event('input'))
        await nextTick()

        expect(document.querySelector('.completion-popover-input')).toBeTruthy()
        // textarea 与聊天输入框对齐：16px 字号、行高 20px、上下 padding 4px
        const ta = document.querySelector('.completion-popover-textarea')!
        const taStyles = window.getComputedStyle(ta)
        expect(taStyles.fontSize).toBe('16px')
        expect(taStyles.lineHeight).toBe('20px')
        expect(taStyles.paddingTop).toBe('4px')
        expect(taStyles.paddingBottom).toBe('4px')
        expect(taStyles.minHeight).toBe('28px')
        // 发送按钮与聊天输入框对齐：28px 圆形
        const btn = document.querySelector('.completion-popover-send')!
        const btnStyles = window.getComputedStyle(btn)
        expect(btnStyles.width).toBe('28px')
        expect(btnStyles.height).toBe('28px')
        // jsdom 不解析 border-radius 简写计算值，改为断言 CSS 规则
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const inputRule = cssText.split('\n').filter((line) => line.includes('.completion-popover-input')).join('\n')
        expect(inputRule).toContain('border-radius: 20px')
        // 背景用 --bg-primary，与卡片 tertiary 底色区分（避免融合）
        expect(inputRule).toContain('background: var(--bg-primary')
        // 不再使用胶囊圆角 999px
        expect(inputRule).not.toContain('999px')
    })

    it('sends the message to the session and dismisses on send click', async () => {
        mockState.active = ref(makeItem({ sessionId: 's42' }))
        mountPopover()

        const fetchMock = vi.fn().mockResolvedValue({ ok: true })
        globalThis.fetch = fetchMock

        const textarea = document.querySelector('.completion-popover-textarea') as HTMLTextAreaElement
        textarea.value = '继续说说'
        textarea.dispatchEvent(new Event('input'))
        // 等待 v-model 更新，canSend 变为 true 后发送按钮出现
        await nextTick()

        const sendBtn = document.querySelector('.completion-popover-send')!
        sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        await vi.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/ai/chat?session_id=s42'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('继续说说'),
                })
            )
            expect(mockState.dismiss).toHaveBeenCalledTimes(1)
        })
        // 发送成功后清空该会话未读（独立 /read 调用）
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/ai/chat/read?session_id=s42'),
            expect.objectContaining({ method: 'POST' })
        )
    })

    it('does not send when input is empty', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        const fetchMock = vi.fn()
        globalThis.fetch = fetchMock

        // 空输入时发送按钮是 disabled 态，点击不发送
        const sendBtn = document.querySelector('.completion-popover-send')!
        expect(sendBtn.classList.contains('disabled')).toBe(true)
        sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(fetchMock).not.toHaveBeenCalledWith(
            expect.stringContaining('/api/ai/chat?'),
            expect.objectContaining({ method: 'POST' })
        )
    })

    it('marks the session as read via the mark-read button and dismisses', async () => {
        mockState.active = ref(makeItem({ sessionId: 's99' }))
        mountPopover()

        const fetchMock = vi.fn().mockResolvedValue({ ok: true })
        globalThis.fetch = fetchMock

        const markReadBtn = document.querySelector('.completion-popover-mark-read')!
        markReadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        await vi.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/ai/chat/read?session_id=s99',
                expect.objectContaining({ method: 'POST' })
            )
            expect(mockState.dismiss).toHaveBeenCalledTimes(1)
        })
    })
})
