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

    it('renders the last user message as a single line', () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        const el = document.querySelector('.completion-popover-user-msg')!
        const text = el.querySelector('.completion-popover-user-msg-text')!
        expect(text.textContent).toContain('请帮我修复登录 bug')
        // 省略逻辑在内层文本 span（flex 容器内 text-overflow 不生效）
        const styles = window.getComputedStyle(text)
        expect(styles.textOverflow).toBe('ellipsis')
        expect(styles.overflow).toBe('hidden')
        expect(styles.whiteSpace).toBe('nowrap')
    })

    it('styles the user message as a mini chat bubble (left-aligned, solid color, capsule, leading icon)', () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        const row = document.querySelector('.completion-popover-meta-user')!
        const el = document.querySelector('.completion-popover-user-msg')!
        const rowStyles = window.getComputedStyle(row)
        // 行容器靠左对齐
        expect(rowStyles.justifyContent).toBe('flex-start')
        // 气泡：袖珍尺寸、白字（jsdom 可解析字面量计算值，
        // 能证明专属块胜出公共块的 11px 灰字）
        const styles = window.getComputedStyle(el)
        expect(styles.fontSize).toBe('12px')
        expect(styles.padding).toBe('3px 10px')
        expect(styles.color).toBe('rgb(255, 255, 255)')
        // 气泡 inline-flex 布局容纳图标+文本，宽度不超过容器
        expect(styles.display).toBe('inline-flex')
        expect(styles.maxWidth).toBe('100%')
        // 左侧消息图标
        const icon = el.querySelector('svg')
        expect(icon).toBeTruthy()
        expect(el.querySelector('.completion-popover-user-msg-text')).toBeTruthy()

        // jsdom 无法解析 var() 引用与 border-radius 计算值，
        // 这两项改为断言组件注入的 CSS 规则文本（其余走计算值）
        const cssText = Array.from(document.styleSheets)
            .map((s) => {
                try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
                catch { return '' }
            })
            .join('\n')
        const bubbleRule = cssText.split('\n').filter((line) => line.includes('.completion-popover-user-msg')).join('\n')
        expect(bubbleRule).toContain('background: var(--user-msg-color)')
        expect(bubbleRule).toContain('border-radius: 999px')
    })

    it('removes the divider between the user message bubble and the assistant summary', () => {
        mockState.active = ref(makeItem({ userMessage: '请帮我修复登录 bug' }))
        mountPopover()

        // 用户消息行自身不应有 border（气泡靠实底底色分层）
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

        expect(document.querySelector('.completion-popover-user-msg')).toBeFalsy()
    })

    it('keeps a long user message on a single line and preserves the full text via title', () => {
        const longMessage = '这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的用户消息，用来验证气泡内的文本超出宽度时保持单行并显示省略号'
        mockState.active = ref(makeItem({ userMessage: longMessage }))
        mountPopover()

        const el = document.querySelector('.completion-popover-user-msg')!
        const text = el.querySelector('.completion-popover-user-msg-text')!
        // 完整文本仍在 DOM（省略号只是视觉裁剪，title 兜底完整内容）
        expect(text.textContent).toBe(longMessage)
        expect(el.getAttribute('title')).toBe(longMessage)
        const styles = window.getComputedStyle(text)
        // 单行不换行 + 溢出隐藏 + 省略号
        expect(styles.whiteSpace).toBe('nowrap')
        expect(styles.overflow).toBe('hidden')
        expect(styles.textOverflow).toBe('ellipsis')
        // 文本 span 可收缩（min-width: 0），否则长文本会撑破气泡容器
        expect(styles.minWidth).toBe('0px')
    })

    it('renders the project name and path when provided', () => {
        mockState.active = ref(makeItem({ projectName: 'my-app', projectPath: '/home/user' }))
        mountPopover()

        const nameEl = document.querySelector('.completion-popover-project-name')!
        expect(nameEl.textContent).toBe('my-app')
        const pathEl = document.querySelector('.completion-popover-project-path')!
        expect(pathEl.textContent).toBe('/home/user')
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

    it('clicking outside the card (on the backdrop) hides without navigating', () => {
        mockState.active = ref(makeItem())
        mountPopover()

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

        const backdrop = document.querySelector('.completion-popover-backdrop')!
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(dispatchSpy).not.toHaveBeenCalled()
        expect(mockState.dismiss).toHaveBeenCalledTimes(1)
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
        // 空输入时：发送按钮存在但 disabled，显示"标记已读"按钮
        const sendBtn = document.querySelector('.completion-popover-send')!
        expect(sendBtn.classList.contains('disabled')).toBe(true)
        expect(document.querySelector('.completion-popover-mark-read')).toBeTruthy()
    })

    it('shows the mark-as-read button when input is empty and hides it once typed', async () => {
        mockState.active = ref(makeItem())
        mountPopover()

        // 空输入：mark-read 可见
        expect(document.querySelector('.completion-popover-mark-read')).toBeTruthy()

        // 输入内容后：mark-read 隐藏，发送按钮可点
        const textarea = document.querySelector('.completion-popover-textarea') as HTMLTextAreaElement
        textarea.value = '回复内容'
        textarea.dispatchEvent(new Event('input'))
        await nextTick()

        expect(document.querySelector('.completion-popover-mark-read')).toBeFalsy()
        expect(document.querySelector('.completion-popover-send')!.classList.contains('disabled')).toBe(false)
    })

    it('aligns the input box with the chat input bar (radius 20px, 16px textarea, 28px send button)', async () => {
        mockState.active = ref(makeItem())
        mountPopover()

        // 输入文本使发送按钮出现（空输入时显示标记已读按钮）
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
