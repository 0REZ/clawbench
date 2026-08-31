import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useCompletionPopover } from '@/composables/useCompletionPopover'

// Module-level singleton state persists between tests within the file.
// Reset it before each test so each case starts from a clean queue.
// Date.now 也纳入 fake timers，保证最小停留时长保护可被计时推进。
beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    useCompletionPopover().reset()
})
afterEach(() => {
    vi.useRealTimers()
})

function makeItem(overrides = {}) {
    return {
        sessionId: 's1',
        title: '会话标题',
        summary: '**加粗摘要**',
        kind: 'session',
        projectPath: '',
        ...overrides,
    }
}

describe('useCompletionPopover', () => {
    it('push() shows the item immediately when nothing is showing', () => {
        const p = useCompletionPopover()
        p.push(makeItem())

        expect(p.active.value).not.toBeNull()
        expect(p.active.value?.sessionId).toBe('s1')
        expect(p.active.value?.title).toBe('会话标题')
        expect(p.queue.value).toHaveLength(0)
    })

    it('push() queues subsequent items while one is showing', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.push(makeItem({ sessionId: 's2' }))
        p.push(makeItem({ sessionId: 's3' }))

        expect(p.active.value?.sessionId).toBe('s1')
        expect(p.queue.value.map((i) => i.sessionId)).toEqual(['s2', 's3'])
    })

    it('does NOT auto-hide or auto-advance over time — stays until dismissed', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.push(makeItem({ sessionId: 's2' }))

        // Far past any reasonable auto-dismiss duration
        vi.advanceTimersByTime(600000)
        expect(p.active.value?.sessionId).toBe('s1')
        expect(p.queue.value.map((i) => i.sessionId)).toEqual(['s2'])
    })

    it('dismiss() hides the active item and advances to the next one', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.push(makeItem({ sessionId: 's2' }))

        p.dismiss()

        expect(p.active.value?.sessionId).toBe('s2')
        expect(p.queue.value).toHaveLength(0)
    })

    it('dismiss() with an empty queue leaves active null', () => {
        const p = useCompletionPopover()
        p.push(makeItem())
        p.dismiss()
        p.dismiss()

        expect(p.active.value).toBeNull()
    })

    it('push() after everything was dismissed shows immediately again', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.dismiss()
        p.push(makeItem({ sessionId: 's2' }))

        expect(p.active.value?.sessionId).toBe('s2')
        expect(p.queue.value).toHaveLength(0)
    })

    it('push() while active replaces nothing and keeps queue order FIFO', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.push(makeItem({ sessionId: 's2' }))
        p.push(makeItem({ sessionId: 's3' }))

        expect(p.active.value?.sessionId).toBe('s1')
        expect(p.queue.value.map((i) => i.sessionId)).toEqual(['s2', 's3'])

        p.dismiss()
        expect(p.active.value?.sessionId).toBe('s2')
        expect(p.queue.value.map((i) => i.sessionId)).toEqual(['s3'])

        p.dismiss()
        expect(p.active.value?.sessionId).toBe('s3')
        expect(p.queue.value).toHaveLength(0)
    })

    it('dismissOnBackdrop() ignores clicks within the first second (误触保护)', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))

        // 弹出瞬间点击空白处：不关闭
        expect(p.dismissOnBackdrop()).toBe(false)
        expect(p.active.value?.sessionId).toBe('s1')

        // 499ms 仍不关闭
        vi.advanceTimersByTime(499)
        expect(p.dismissOnBackdrop()).toBe(false)
        expect(p.active.value?.sessionId).toBe('s1')

        // 到达 1s 边界（从弹出起已满 1s）后可关闭
        vi.advanceTimersByTime(501)
        expect(p.dismissOnBackdrop()).toBe(true)
        expect(p.active.value).toBeNull()
    })

    it('dismissOnBackdrop() advances to the next queued item after the guard window', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.push(makeItem({ sessionId: 's2' }))

        vi.advanceTimersByTime(1000)
        expect(p.dismissOnBackdrop()).toBe(true)
        expect(p.active.value?.sessionId).toBe('s2')
        expect(p.queue.value).toHaveLength(0)
    })

    it('dismissOnBackdrop() guard restarts for each newly shown item', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))
        p.push(makeItem({ sessionId: 's2' }))

        // s1 展示满 1s 后通过 backdrop 关闭，进入 s2
        vi.advanceTimersByTime(1000)
        expect(p.dismissOnBackdrop()).toBe(true)
        expect(p.active.value?.sessionId).toBe('s2')

        // s2 刚展示：同样的误触保护重新生效
        expect(p.dismissOnBackdrop()).toBe(false)
        expect(p.active.value?.sessionId).toBe('s2')

        vi.advanceTimersByTime(1000)
        expect(p.dismissOnBackdrop()).toBe(true)
        expect(p.active.value).toBeNull()
    })

    it('dismiss() (按钮/发送等关闭) 不受最小停留时长限制', () => {
        const p = useCompletionPopover()
        p.push(makeItem({ sessionId: 's1' }))

        // 刚展示就 dismiss：应直接关闭（与 backdrop 保护无关）
        p.dismiss()
        expect(p.active.value).toBeNull()
    })
})
