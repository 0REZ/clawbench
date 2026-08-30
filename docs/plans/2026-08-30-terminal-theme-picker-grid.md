# Terminal Theme Picker Grid Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把终端主题配置从普通 select 列表改成与 App 主题一致的小卡片网格（BottomSheet），每张卡片渲染一个迷你终端预览（标题栏 + `$ ls` prompt + 彩色输出 2 行），App 主题卡片同步改造为主题名做样式样例。

**Architecture:** 复用 `SettingsItem.vue` 现成的 theme-picker-grid/BottomSheet/选中态基础设施，把 `optionPreviews` prop 的类型扩成判别联合（`color` | `terminal`），新增独立的 `TerminalPreviewCard.vue` 组件渲染迷你终端。终端主题完整配色从 `loadThemesModule()` 懒加载，加载完成前渲染灰色骨架占位。App 主题卡片通过传入 `themeId` 用主题名做样例文字。

**Tech Stack:** Vue 3 (script setup), TypeScript, Vitest + @vue/test-utils, vue-i18n, lucide-vue-next

---

## 术语

- **color preview**：现有 App 主题预览 `{ type:'color', bg, text, accent }`（或简写结构）
- **terminal preview**：新终端主题预览 `{ type:'terminal', themeId, theme?: ITheme }`
- **迷你终端（mini terminal）**：TerminalPreviewCard 渲染的模拟终端：标题栏 + 2 行命令

---

## Task 1: 扩展 SettingsItem.vue 的 optionPreviews 类型

**Files:**
- Modify: `web/src/components/settings/SettingsItem.vue`
- Test: `web/src/components/settings/__tests__/SettingsItemThemeGrid.test.ts` (新建)

### 背景

`SettingsItem.vue` 目前（第 213-216 行）声明：
```ts
optionPreviews?: Record<string, { bg: string; text: string; accent: string }>
```
`isThemeSelect`（第 278 行）只检查 `!!props.optionPreviews`。`previewStyleFor`（第 281-295 行）直接读 `p.bg/p.text/p.accent`。

终端主题需要传完整 ITheme 给卡片渲染，因此类型要扩展为判别联合，同时**保持现有 color 路径完全兼容**（App 主题仍传 color 结构）。

### Step 1: 定义判别联合类型

在 `SettingsItem.vue` 的 `<script setup>` 中新增类型定义（放在 Props 接口上方）：

```ts
/** App 主题卡片预览（现有三色块）。 */
export interface ColorPreview { type: 'color'; bg: string; text: string; accent: string }
/** 终端主题卡片预览（迷你终端）。theme 懒加载完成前可为 undefined（渲染骨架占位）。 */
export interface TerminalPreview { type: 'terminal'; themeId: string; theme?: import('@xterm/xterm').ITheme }
export type OptionPreview = ColorPreview | TerminalPreview
```

### Step 2: 更新 Props 接口

把第 216 行改为：

```ts
optionPreviews?: Record<string, OptionPreview>
```

同时更新注释（第 214-215 行）说明现在支持两种预览。

### Step 3: 拆分 previewStyleFor 逻辑

现有 `previewStyleFor` 对 `opt.value === 'auto'` 返回半亮半暗渐变，否则读 `p.bg/text/accent`。现在只有 color 类型走这条路径：

```ts
/** Build the inline style for a color swatch. Auto option gets a light/dark split. */
function previewStyleFor(opt: { label: string; value: unknown }): Record<string, string> {
  if (opt.value === 'auto') {
    return {
      background:
        'linear-gradient(135deg, #ffffff 0%, #ffffff 48%, #1a1a2e 52%, #1a1a2e 100%)',
    }
  }
  const p = props.optionPreviews?.[String(opt.value)]
  if (!p || p.type !== 'color') return {}
  return {
    background: p.bg,
    color: p.text,
    '--swatch-accent': p.accent,
  }
}
```

**注意**：`auto` 的渐变处理被 color 路径复用，但终端主题的 `auto` 走 TerminalPreviewCard 内部处理（见 Task 2）。

### Step 4: 模板加终端预览分支

在 Theme picker BottomSheet 的 `.theme-picker-cell` 内（第 184-190 行），把 swatch 部分改成条件渲染：

```vue
<div
  v-if="previewFor(opt)?.type === 'terminal'"
  class="theme-picker-swatch theme-picker-swatch--terminal"
>
  <TerminalPreviewCard
    :theme="(previewFor(opt) as TerminalPreview).theme"
    :auto="opt.value === 'auto'"
  />
</div>
<div
  v-else
  class="theme-picker-swatch"
  :class="{ 'theme-picker-swatch--auto': opt.value === 'auto' }"
  :style="previewStyleFor(opt)"
>
  <span class="theme-picker-swatch-accent"></span>
</div>
```

新增 helper（放在 previewStyleFor 下方）：

```ts
function previewFor(opt: { label: string; value: unknown }): OptionPreview | undefined {
  return props.optionPreviews?.[String(opt.value)]
}
```

在 import 区添加（第 203 行附近）：

```ts
import TerminalPreviewCard from '@/components/common/TerminalPreviewCard.vue'
```

### Step 5: 调整终端卡片网格布局

在 `<style>` 里给 `.theme-picker-grid` 增加一个 modifier class（终端网格更宽更矮）：

```css
.theme-picker-grid--wide {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}
```

模板里网格 div（第 176 行）改成：

```vue
<div class="theme-picker-grid" :class="{ 'theme-picker-grid--wide': isTerminalThemeSelect }">
```

新增 computed：

```ts
const isTerminalThemeSelect = computed(() =>
  !!props.optionPreviews &&
  Object.values(props.optionPreviews).some(p => p.type === 'terminal')
)
```

终端 swatch 高度（`.theme-picker-swatch--terminal`）设为 88px（比 App 卡片的 52px 高，容纳标题栏+2行）：

```css
.theme-picker-swatch--terminal {
  height: 88px;
}
```

### Step 6: 跑现有测试确认不回归

Run: `npx vitest run src/components/settings/__tests__/ 2>&1 | tail -20`
Expected: 现有 settings 测试全部 PASS（无 SettingsItem 现有测试则通过即可）。

### Step 7: Commit

```bash
git add web/src/components/settings/SettingsItem.vue
git commit -m "feat(settings): extend optionPreviews to discriminated union for terminal theme picker"
```

---

## Task 2: 新建 TerminalPreviewCard.vue

**Files:**
- Create: `web/src/components/common/TerminalPreviewCard.vue`
- Test: `web/src/components/common/__tests__/TerminalPreviewCard.test.ts` (新建)

### 背景

这个组件接收一个可选的 `ITheme` 和 `auto` 标志，渲染 88px 高的迷你终端：顶部标题栏（三个 macOS 风格圆点）+ 两行模拟命令。`theme` 未加载时用中性灰骨架占位。

### Step 1: 先写测试（TDD）

创建 `web/src/components/common/__tests__/TerminalPreviewCard.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalPreviewCard from '@/components/common/TerminalPreviewCard.vue'

function makeTheme(overrides: Record<string, string> = {}) {
  return {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    ...overrides,
  }
}

describe('TerminalPreviewCard', () => {
  it('renders a mini terminal shell with title bar and command lines', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: makeTheme(), auto: false },
    })
    expect(wrapper.find('.tpc-shell').exists()).toBe(true)
    expect(wrapper.find('.tpc-titlebar').exists()).toBe(true)
    expect(wrapper.findAll('.tpc-line').length).toBe(2)
  })

  it('applies theme background color to the shell', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: makeTheme({ background: '#123456' }), auto: false },
    })
    expect(wrapper.find('.tpc-shell').attributes('style')).toContain('#123456')
  })

  it('renders placeholder skeleton when theme is undefined', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: undefined, auto: false },
    })
    expect(wrapper.find('.tpc-shell--placeholder').exists()).toBe(true)
  })

  it('renders split gradient shell for auto mode', () => {
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme: undefined, auto: true },
    })
    expect(wrapper.find('.tpc-shell--auto').exists()).toBe(true)
  })

  it('uses green prompt, blue directory and cyan filename', () => {
    const theme = makeTheme({ green: '#00ff00', blue: '#0000ff', cyan: '#00ffff' })
    const wrapper = mount(TerminalPreviewCard, {
      props: { theme, auto: false },
    })
    const prompt = wrapper.find('.tpc-prompt')
    expect(prompt.attributes('style')).toContain('#00ff00')
    const dir = wrapper.find('.tpc-dir')
    expect(dir.attributes('style')).toContain('#0000ff')
    const file = wrapper.find('.tpc-file')
    expect(file.attributes('style')).toContain('#00ffff')
  })
})
```

### Step 2: 运行测试确认失败

Run: `npx vitest run src/components/common/__tests__/TerminalPreviewCard.test.ts 2>&1 | tail -20`
Expected: FAIL（组件不存在）

### Step 3: 实现组件

创建 `web/src/components/common/TerminalPreviewCard.vue`：

```vue
<template>
  <div class="tpc" :class="{ 'tpc--placeholder': !theme, 'tpc--auto': auto }">
    <div class="tpc-titlebar">
      <span class="tpc-dot tpc-dot--red"></span>
      <span class="tpc-dot tpc-dot--yellow"></span>
      <span class="tpc-dot tpc-dot--green"></span>
    </div>
    <div class="tpc-body">
      <div class="tpc-line">
        <span class="tpc-prompt">$</span>
        <span class="tpc-cmd">ls</span>
      </div>
      <div class="tpc-line">
        <span class="tpc-dir">src</span>
        <span class="tpc-sep">  </span>
        <span class="tpc-file">main.go</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ITheme } from '@xterm/xterm'

const props = defineProps<{
  /** Terminal theme colors. Undefined while lazy-loading → placeholder skeleton. */
  theme?: ITheme
  /** Auto mode: split light/dark gradient to represent "follow app". */
  auto?: boolean
}>()

const bg = computed(() => props.theme?.background ?? '')
const fg = computed(() => props.theme?.foreground ?? '')
const green = computed(() => props.theme?.green ?? '')
const blue = computed(() => props.theme?.blue ?? '')
const cyan = computed(() => props.theme?.cyan ?? '')
const accent = computed(() => props.theme?.cursor ?? props.theme?.foreground ?? '')

const shellStyle = computed<Record<string, string>>(() => {
  if (props.auto) {
    return { background: 'linear-gradient(135deg, #ffffff 0%, #ffffff 48%, #1a1a2e 52%, #1a1a2e 100%)' }
  }
  if (!props.theme) return {}
  return {
    background: bg.value,
    color: fg.value,
    '--tpc-accent': accent.value,
  }
})

const promptStyle = computed<Record<string, string>>(() => {
  if (props.auto || !props.theme) return {}
  return { color: green.value }
})

const dirStyle = computed<Record<string, string>>(() => {
  if (props.auto || !props.theme) return {}
  return { color: blue.value }
})

const fileStyle = computed<Record<string, string>>(() => {
  if (props.auto || !props.theme) return {}
  return { color: cyan.value }
})
</script>

<style scoped>
.tpc {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 6px;
  overflow: hidden;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
}

.tpc--placeholder {
  background: color-mix(in srgb, var(--text-muted) 15%, var(--bg-tertiary));
}

.tpc-titlebar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  height: 16px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.15);
}

.tpc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.tpc-dot--red { background: #ff5f56; }
.tpc-dot--yellow { background: #ffbd2e; }
.tpc-dot--green { background: #27c93f; }

.tpc-body {
  flex: 1;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
}

.tpc-line {
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tpc-prompt {
  font-weight: 700;
  margin-right: 4px;
  color: var(--text-secondary);
}

.tpc-cmd {
  color: inherit;
}

.tpc-dir,
.tpc-file {
  color: var(--text-secondary);
}
</style>
```

> 说明：`--tpc-accent` 目前用于标题栏圆点，但我们用固定 macOS 三色，`--tpc-accent` 暂不消费。**实现时若确定不需要就删掉该变量，避免死代码。** 同样，`auto` 模式的 prompt/dir/file 都走默认灰，所以那些 computed 在 `auto` 下返回空对象——这符合"auto 展示半亮半暗渐变"的设计。

### Step 4: 跑测试确认通过

Run: `npx vitest run src/components/common/__tests__/TerminalPreviewCard.test.ts 2>&1 | tail -20`
Expected: PASS

### Step 5: Commit

```bash
git add web/src/components/common/TerminalPreviewCard.vue web/src/components/common/__tests__/TerminalPreviewCard.test.ts
git commit -m "feat(settings): add TerminalPreviewCard mini-terminal theme preview component"
```

---

## Task 3: SettingsGroupPanel 懒加载主题并传 optionPreviews

**Files:**
- Modify: `web/src/components/settings/SettingsGroupPanel.vue`

### Step 1: import 扩展

第 171 行目前：
```ts
import { SORTED_THEME_IDS, formatThemeName } from '@/utils/terminalThemes'
```
改为：
```ts
import { SORTED_THEME_IDS, formatThemeName, loadThemesModule } from '@/utils/terminalThemes'
```
并 import TerminalPreview 类型：
```ts
import type { TerminalPreview } from './SettingsItem.vue'
```

### Step 2: 新增主题加载状态 ref

在 `activeKey`（第 207 行）附近新增：

```ts
const loadedTerminalThemes = ref<Record<string, import('@xterm/xterm').ITheme> | null>(null)

/** 懒加载终端主题配色（首次打开终端主题网格时触发）。 */
async function ensureTerminalThemesLoaded() {
  if (loadedTerminalThemes.value) return
  try {
    loadedTerminalThemes.value = await loadThemesModule()
  } catch {
    // 加载失败：卡片保持占位骨架，不阻断网格交互
  }
}
```

### Step 3: 构造 terminalTheme 的 optionPreviews

在 `resolveFieldOptions` 附近新增 computed：

```ts
const terminalThemePreviews = computed<Record<string, TerminalPreview> | undefined>(() => {
  if (!settingsFieldIsTerminalTheme) return undefined
  const map: Record<string, TerminalPreview> = {}
  map.auto = { type: 'terminal', themeId: 'auto' }
  for (const id of SORTED_THEME_IDS) {
    map[id] = { type: 'terminal', themeId: id, theme: loadedTerminalThemes.value?.[id] }
  }
  return map
})

const settingsFieldIsTerminalTheme = computed(() =>
  props.config.commonFields.some(f => f.key === 'terminalTheme')
)
```

> 注意：这里需要判断当前 panel 是否包含 terminalTheme 字段。`settingsFieldIsTerminalTheme` 用 commonFields 检查即可（终端 panel 只有 commonFields）。如果未来 optionSubFields 也要用，再扩展。

### Step 4: SettingsItem 传 option-previews

在模板的 SettingsItem 绑定（第 41-70 行）中，给 select 字段加：

```vue
:option-previews="entry.field.key === 'terminalTheme' ? terminalThemePreviews : undefined"
```

### Step 5: 触发懒加载

在 `handleEditToggle`（第 413 行）里，当 terminalTheme 字段打开时触发：

```ts
function handleEditToggle(key: string, open: boolean) {
  if (open) {
    activeKey.value = key
    if (key === 'terminalTheme') void ensureTerminalThemesLoaded()
  } else if (activeKey.value === key) {
    activeKey.value = null
  }
}
```

### Step 6: 跑测试确认

Run: `npx vitest run src/components/settings/__tests__/usePanelSnapshot.test.ts src/components/settings/__tests__/SettingsAgentsIndex.test.ts 2>&1 | tail -20`
Expected: PASS

### Step 7: Commit

```bash
git add web/src/components/settings/SettingsGroupPanel.vue
git commit -m "feat(settings): lazy-load terminal themes and pass previews to theme grid picker"
```

---

## Task 4: App 主题卡片主题名做样式样例

**Files:**
- Modify: `web/src/components/settings/SettingsItem.vue`
- Modify: `web/src/components/settings/SettingsCategory.vue`
- Test: `web/src/components/settings/__tests__/SettingsItemThemeGrid.test.ts` (Task 1 中已创建，这里补充断言)

### Step 1: SettingsCategory.vue 传 themeId 给 previews

第 250-256 行 `themePreviews` 目前是 `Record<string, {bg,text,accent}>`。改为：

```ts
const themePreviews = computed<Record<string, OptionPreview>>(() => {
  const map: Record<string, OptionPreview> = {}
  for (const t of THEMES) {
    map[t.id] = { type: 'color', bg: t.preview.bg, text: t.preview.text, accent: t.preview.accent, themeId: t.id }
  }
  // Auto option: neutral light/dark split handled by CSS, no real colors needed
  map.auto = { type: 'color', bg: '#ffffff', text: '#1a1a2e', accent: '#888888', themeId: 'auto' }
  return map
})
```

import 处（第 95 行附近）加：
```ts
import type { OptionPreview } from './SettingsItem.vue'
```

### Step 2: 更新 ColorPreview 类型加 themeId

在 Task 1 的类型定义中给 ColorPreview 加 `themeId`：

```ts
export interface ColorPreview { type: 'color'; bg: string; text: string; accent: string; themeId: string }
```

### Step 3: App 主题 swatch 显示主题名

在 SettingsItem.vue 的 color swatch 分支里，把 accent 圆点改为主题名展示。当前模板（第 184-190 行）：

```vue
<div
  v-else
  class="theme-picker-swatch"
  :class="{ 'theme-picker-swatch--auto': opt.value === 'auto' }"
  :style="previewStyleFor(opt)"
>
  <span class="theme-picker-swatch-accent"></span>
</div>
```

改为：

```vue
<div
  v-else
  class="theme-picker-swatch"
  :class="{ 'theme-picker-swatch--auto': opt.value === 'auto', 'theme-picker-swatch--label': previewFor(opt)?.type === 'color' }"
  :style="previewStyleFor(opt)"
>
  <span class="theme-picker-swatch-label">{{ opt.label }}</span>
</div>
```

样式调整：
- `.theme-picker-swatch` 高度从 52px 提到 64px
- 新增 `.theme-picker-swatch-label`：居中、两行截断、用主题 text 色
- `.theme-picker-swatch-accent` 圆点保留但缩小移到左上角？——**不**，设计决定是主题名替代下方标签。让圆点仍保留在右上角，主题名居中。

具体：
```css
.theme-picker-swatch {
  height: 64px;
  ...
}

.theme-picker-swatch-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4px 6px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.theme-picker-swatch--auto .theme-picker-swatch-label {
  /* auto 半亮半暗渐变上文字可读性：跟随渐变取深/浅色 */
  color: #666;
}
```

同时删除下方标签（第 191 行）：
```vue
<span class="theme-picker-cell-label">{{ opt.label }}</span>
```
**注意**：删除后 cell 的 gap 布局仍正常。`auto` 选项也要显示"跟随 App 主题"字样，所以 label 在 swatch 内统一显示。

> 关键点：终端卡片（Task 1 Step 4 分支）下方 label 保留（终端主题名较长，放 swatch 内放不下），App 卡片 label 移到 swatch 内。所以 `theme-picker-cell-label` 只在终端分支显示。

### Step 4: 补充测试

在 `SettingsItemThemeGrid.test.ts` 追加：

```ts
it('renders theme name inside color swatch', () => {
  const wrapper = mount(SettingsItem, {
    props: {
      label: 'Theme',
      type: 'select',
      modelValue: 'one-light',
      options: [{ label: 'One Light', value: 'one-light' }],
      optionPreviews: {
        'one-light': { type: 'color', bg: '#fafafa', text: '#383a42', accent: '#4078f2', themeId: 'one-light' },
      },
    },
    global: { stubs: { BottomSheet: true } },
  })
  // 打开 BottomSheet
  await wrapper.find('.settings-item').trigger('click')
  await wrapper.vm.$nextTick()
  const label = wrapper.find('.theme-picker-swatch-label')
  expect(label.exists()).toBe(true)
  expect(label.text()).toContain('One Light')
})
```

### Step 5: 跑测试

Run: `npx vitest run src/components/settings/__tests__/SettingsItemThemeGrid.test.ts 2>&1 | tail -20`
Expected: PASS

### Step 6: Commit

```bash
git add web/src/components/settings/SettingsItem.vue web/src/components/settings/SettingsCategory.vue web/src/components/settings/__tests__/SettingsItemThemeGrid.test.ts
git commit -m "feat(settings): render theme name as sample text inside app theme swatches"
```

---

## Task 5: i18n 文案

**Files:**
- Modify: `web/src/i18n/locales/zh.ts`
- Modify: `web/src/i18n/locales/en.ts`

### Step 1: 确认现有文案

当前已有（zh.ts 第 1556-1557 行，en.ts 同位置）：
```ts
terminalTheme: '配色主题',
terminalThemeDesc: '终端配色方案，"跟随 App" 自动匹配当前应用主题',
```
```ts
terminalTheme: 'Color Theme',
terminalThemeDesc: 'Terminal color scheme. "Follow App" matches the current app theme automatically',
```

这些无需改动（标题、描述语义不变，只是展示形式变网格）。

### Step 2: 检查是否需要新增文案

本改造不引入新的用户可见文案（主题名在 swatch 内用的是现有 label，auto 用现有 `terminal.themeFollowApp`）。**运行中检查**是否有遗漏——如果发现新增文案需求，加到 `terminal` 命名空间。

### Step 3: 跑 i18n 一致性测试

Run: `npx vitest run src/i18n/__tests__/navKeys.test.ts 2>&1 | tail -20`
Expected: PASS

### Step 4: Commit

```bash
git add web/src/i18n/locales/zh.ts web/src/i18n/locales/en.ts
git commit -m "chore(i18n): no new strings needed for terminal theme grid picker"
```

---

## Task 6: 集成验证 + 类型检查 + 全量测试

**Files:** 无（验证步骤）

### Step 1: TypeScript 类型检查

Run: `npx vue-tsc --noEmit 2>&1 | tail -30`
Expected: 无类型错误（如果有 `SettingsItem.vue` 的类型错误，修复 Task 1-4 的类型定义）。

### Step 2: 前端全量测试

Run: `npm test 2>&1 | tail -30`
Expected: 全部 PASS（含新增 TerminalPreviewCard 和 SettingsItemThemeGrid 测试）。

### Step 3: Lint

Run: `npx eslint src/components/settings/SettingsItem.vue src/components/settings/SettingsGroupPanel.vue src/components/settings/SettingsCategory.vue src/components/common/TerminalPreviewCard.vue 2>&1 | tail -30`
Expected: 无 error（注意：项目 pre-commit hook 用 ESLint，但当前 worktree 有 @eslint/js 缺失问题，见 memory `eslint_broken_worktree`——如果 lint 环境坏了可跳过，用类型检查兜底）。

### Step 4: 手动验证清单（dev-server）

用 `./dev-server.sh` 起开发服务，人工验证：
1. 设置 → 终端 → 配色主题 → 弹出卡片网格（157 个主题 + auto）
2. 卡片显示迷你终端（标题栏 + `$ ls` + 彩色输出），颜色与真实主题一致
3. 滚动到底部网格稳定（懒加载占位 → 真实配色无闪烁）
4. 点选主题 → 卡片 ✓ 标记、设置保存、终端实际应用
5. auto 卡片显示半亮半暗渐变
6. 设置 → 外观 → 主题 → 卡片内显示主题名样式样例，下方无重复标签
7. App 主题点选、切换正常工作

### Step 5: 推送前检查（若在 push 前）

Run: `./scripts/pre-push-checks.sh --skip-coverage`
Expected: PASS

---

## 风险与注意事项

1. **类型扩展的兼容性**：`optionPreviews` 从窄类型扩成判别联合，`SettingsCategory.vue` 和 `SettingsGroupPanel.vue` 两个调用方都必须同步更新，否则 TS 报错。Task 3、4 覆盖。
2. **懒加载时序**：`loadThemesModule()` 有模块级缓存（`cachedThemes`），多组件共享。SettingsGroupPanel 维护自己的 ref，加载完成后通过响应式更新卡片。占位骨架保证无闪烁。
3. **auto 主题卡片**：终端 auto 卡片由 TerminalPreviewCard 的 `auto` prop 渲染半亮半暗渐变；App auto 卡片仍走现有渐变（在 previewStyleFor 里）。两套逻辑独立，互不干扰。
4. **主题名两行截断**：App 主题名如 "High Contrast Light" 较长，swatch 内用 `-webkit-line-clamp: 2` 截断。若主题名超长溢出，可考虑减小字号。
5. **`--tpc-accent` 死代码**：实现时如果确认不使用该变量，直接删除，保持代码干净。
6. **测试环境**：TerminalPreviewCard 测试需要 mount 组件，无 DOM 依赖（组件只渲染静态结构 + 内联样式），Vitest jsdom 环境可跑。
