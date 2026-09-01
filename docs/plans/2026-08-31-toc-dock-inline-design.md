# PC 模式 TOC 停靠栏内联设计

## 目标

PC 宽屏下，将 TOC 从浮动 BottomSheet 改为 FileOverlay 覆盖层内右侧停靠栏（类似 VS Code 大纲栏），支持 markdown 预览、代码预览与编辑。

## 设计决策（已与用户确认）

| 项 | 决策 |
|---|------|
| 范围 | B. 仅 TOC 停靠：文件仍走覆盖层，TOC 改为覆盖层内右侧停靠栏，不动整体导航 |
| 触发 | 按钮切换（FileHeader TOC 按钮），默认收起 |
| 记忆 | PC 宽屏下全局记忆开合 + 宽度（localStorage） |
| 编辑态 | A. 编辑态隐藏：进入编辑自动收起，退出编辑恢复之前开合状态 |
| 布局 | A. 覆盖层内右停靠：右侧 260px（可拖 200-400px）停靠栏，文件内容 flex:1 让位；移动端仍走底部抽屉 |

## 现状关键点

- TOC 组件 `TocDrawer.vue` 是纯内容组件：props `{file, pdfOutline, open}`，emits `close/jump/jumpPage`。**没有 BottomSheet 依赖**（BottomSheet 只是外层壳，去掉即可复用）。
- 开合状态在 `App.vue:790` 由 `useTabDrawer('view')` 管理（`tocDrawer`），按钮在 `FileHeader.vue:11`，事件链 `FileHeader → FileViewer → FileOverlay → App.vue`。
- 内容区在 `FileOverlay.vue:8`（`.file-overlay-body`），FileViewer 在其内。
- 移动端现状（宽屏变浮动卡片的 BottomSheet）由 `BottomSheet.vue` 的 `bs-wide-auto` 处理——但我们在宽屏下不再渲染 BottomSheet，移动端行为不变（仍底部抽屉）。
- `editing` 状态来自 `useFileEditor()` 模块级单例，任何组件可直接读。
- 宽屏判断：`useWideScreenLayout` 的 `isWideScreen`（`cssWidth≥1024px` 或宽屏高 DPR 横屏）。

## 架构

### 1. 布局：FileOverlay 内联停靠

`FileOverlay.vue` 的 `.file-overlay`（当前 `flex-direction: column`，含 body）改为 `flex-direction: row`：

```
.file-overlay (flex row)
 ├─ .file-overlay-left (flex:1, flex-direction: column, min-width: 0)
 │    ├─ .file-overlay-body (原内容区，flex:1)
 │    └─ 底部 TOC（窄屏 fallback，仅移动端渲染）
 └─ .toc-dock (宽屏时渲染)
      └─ TocDock 组件（含拖拽分隔条）
```

### 2. 新组件：TocDock.vue

`web/src/components/file/TocDock.vue`——右侧停靠容器，复用 `TocDrawer.vue` 内容：

- **模板**：`<div class="toc-dock">` + 左侧拖拽分隔条（宽度 resize，pointerdown/move/up，clamp 200-400px，初始 260px）+ `TocDrawer`（不带 BottomSheet 壳）。
- **props**：`{open, file, pdfOutline}`；emits `{close, jump, jumpPage}`。
- 停靠时 `scrollTo` 点击目录项后**不 emit close**（停靠栏常驻），区别于移动端底部抽屉的点击即关。通过 prop `docked` 控制 TocDrawer 内点击后是否 `emit('close')`。
- 切换文件时 `App.vue:1381` 的 watch 已有 `tocDrawer.close()`——保持，因为开合状态在 App 层。
- 搜索框、键盘导航（useListKeys）、IntersectionObserver 高亮逻辑全在 TocDrawer 内，零改动。

### 3. 持久化：useTocDockPreference.ts

`web/src/composables/useTocDockPreference.ts`，模块级单例：

- **开合记忆**：`tocDockOpen` ref。初始 false。toggle 时写入 localStorage key `clawbench.tocDock.open`（全局记忆）。
- **宽度记忆**：`tocDockWidth` ref，初始 260。resize 结束写入 `clawbench.tocDock.width`（clamp 200-400）。
- **编辑态隐藏**：`effectiveOpen = computed(() => tocDockOpen.value && isWideScreen.value && !editing.value)`。watch `editing`：进入编辑时若 open 则记 `wasOpenBeforeEdit=true` 并强制 false；退出编辑且 `wasOpenBeforeEdit` 时恢复 open。`wasOpenBeforeEdit` 仅内存态（不持久化）。
- **PC/移动端语义**：`docked = isWideScreen`；非宽屏时忽略偏好（移动端始终底部抽屉，open 状态仍由 tocDrawer 管理）。

### 4. 状态接线（App.vue）

当前 `tocDrawer` 的 `open/close/toggle` 驱动的是底部抽屉与 FileHeader 按钮高亮。引入 `useTocDockPreference` 后：

- **宽屏**：`toggleToc` 改走 `tocDockPreference.toggle()`；`FileOverlay` 收到 `tocDockPreference.effectiveOpen` 决定停靠栏显示。`tocDrawer` 在宽屏下不再渲染 BottomSheet（FileOverlay 内条件渲染）。
- **窄屏**：维持原链路（`tocDrawer.open`），TOC 按钮 → 底部抽屉。
- FileHeader 的 `:toc-open` 高亮改为 `effectiveTocOpen = isWideScreen ? tocDockPreference.effectiveOpen : tocDrawer.effectiveOpen`。
- 编辑态隐藏由 `useTocDockPreference` 内部处理，App 无需额外逻辑。

### 5. 数据流

```
FileHeader TOC 按钮
  └→ FileViewer @toggle-toc → FileOverlay @toggle-toc → App.vue
       App: isWideScreen ? tocDockPreference.toggle()      // 停靠栏
                         : tocDrawer.toggle()               // 底部抽屉
TocDock @close → App: tocDockPreference.close()
TocDock @jump/@jumpPage → App: handleJumpToc / handleJumpPdfPage（现有逻辑）
```

### 6. 错误处理 / 边界

- 非宽屏 resize 到窄屏：停靠栏消失，开合偏好保留；切回宽屏恢复。
- 关闭文件（`closeOverlayAndSync` 或 currentFile watch）：`tocDockPreference.close()` 同步关闭停靠栏（watch 已有 `tocDrawer.close()`，需补 dock 的 close）。
- 编辑中用户手动再点 TOC 按钮：`effectiveOpen` 已 false，按钮应显示非 active 状态，点击不展开（编辑态隐藏是硬性要求）；退出编辑后若 `wasOpenBeforeEdit` 恢复。
- 宽度拖拽最小 200 / 最大 400，超出 clamp；窄屏下宽度偏好保留供下次宽屏使用。

### 7. 测试

- `useTocDockPreference.test.ts`：
  - toggle 持久化 open 到 localStorage
  - width 拖拽 clamp 200-400 并持久化
  - 编辑进入时隐藏、退出恢复（wasOpenBeforeEdit）
  - 非宽屏时 effectiveOpen 恒 false
- `TocDock.test.ts`（若有组合逻辑）或复用 TocDrawer 既有测试。
- 手动验证：PC 宽屏打开 markdown → 点 TOC 按钮 → 右侧停靠栏展开，内容区自动让位；点击目录项滚动到标题且栏不关闭；进入编辑 → 栏收起 → 退出 → 恢复；拖拽分隔条改变宽度；刷新后开合与宽度保持；切窄屏回退底部抽屉。

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `web/src/components/file/TocDock.vue` | 新增：停靠栏容器 + 拖拽分隔条 + TocDrawer |
| `web/src/components/TocDrawer.vue` | 加 `docked` prop：停靠时不 emit close；（可选）去 BottomSheet 依赖改为纯内容组件 |
| `web/src/composables/useTocDockPreference.ts` | 新增：开合/宽度持久化 + 编辑态隐藏 + 宽屏判定 |
| `web/src/components/file/FileOverlay.vue` | 布局 flex row；条件渲染 TocDock vs TocDrawer；透传事件 |
| `web/src/App.vue` | toggleToc 分流宽屏/窄屏；closeOverlayAndSync 与 currentFile watch 补 dock close；toc-open 高亮合并 |
| i18n（zh/en） | 若有新增文案（如拖拽提示） |

## 不做的事（YAGNI）

- 不做整体内联（选项 A 被排除）：文件导航仍走覆盖层。
- 不做代码符号点击定位光标到行（选项 C 被排除）：编辑态直接隐藏。
- 不按文件类型记忆开合：全局记忆即可。
