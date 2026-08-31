<template>
  <div class="toc-dock" :style="dockStyle">
    <!-- Drag divider to resize (mirrors SplitDivider interaction/style) -->
    <div
      ref="dividerRef"
      class="toc-dock-divider"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startDrag"
      :title="t('toc.dragResize')"
    >
      <div class="toc-dock-divider__line" />
    </div>

    <div class="toc-dock-header">
      <List :size="14" class="toc-dock-header-icon" />
      <span class="toc-dock-header-title">{{ t('toc.title') }}</span>
      <button class="toc-dock-close" @click="emit('close')" :title="t('common.close')">
        <X :size="14" />
      </button>
    </div>

    <TocPanel
      open
      :file="file"
      :pdf-outline="pdfOutline"
      @jump="emit('jump', $event)"
      @jump-page="emit('jumpPage', $event)"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { List, X } from 'lucide-vue-next'
import TocPanel from '@/components/TocPanel.vue'
import { useTocDockPreference } from '@/composables/useTocDockPreference'

defineProps({
  file: Object,
  pdfOutline: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'jump', 'jumpPage'])

const { t } = useI18n()
const { tocDockWidth, setWidth } = useTocDockPreference()

const dockStyle = computed(() => ({ width: `${tocDockWidth.value}px` }))

// ── Drag-to-resize (mirrors SplitDivider: pointer capture + body class) ──
const dividerRef = ref(null)
let dragging = false
let startClientX = 0
let startWidth = 0

function startDrag(e) {
  if (e.button !== 0) return
  dragging = true
  startClientX = e.clientX
  startWidth = tocDockWidth.value
  dividerRef.value?.setPointerCapture?.(e.pointerId)
  document.body.classList.add('toc-dock-resizing')
}

function onDragMove(e) {
  if (!dragging) return
  // The dock sits on the RIGHT edge of the content area; the divider is its
  // LEFT edge, which follows the pointer. Dragging left widens the dock,
  // dragging right narrows it — so the delta is SUBTRACTED.
  setWidth(startWidth - (e.clientX - startClientX))
}

function endDrag(e) {
  if (!dragging) return
  dragging = false
  dividerRef.value?.releasePointerCapture?.(e.pointerId)
  document.body.classList.remove('toc-dock-resizing')
}

onMounted(() => {
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  document.body.classList.remove('toc-dock-resizing')
})
</script>

<style scoped>
.toc-dock {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  max-width: 400px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
}

/* Divider (mirrors SplitDivider): a single 1px line by default; on hover/drag
   it expands (via negative margins so layout does NOT shift) into a grab-able
   gap with an accent highlight. */
.toc-dock-divider {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  z-index: 5;
  transition: width 0.15s ease, margin 0.15s ease, background 0.15s ease;
}
/* invisible wider hit area so hover/touch can catch the thin line */
.toc-dock-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}
.toc-dock-divider:active {
  width: 12px;
  margin-left: -3px;
  background: color-mix(in srgb, var(--accent-color, #0066cc) 12%, transparent);
}
@media (hover: hover) {
  .toc-dock-divider:hover {
    width: 12px;
    margin-left: -3px;
    background: color-mix(in srgb, var(--accent-color, #0066cc) 12%, transparent);
  }
}
.toc-dock-divider__line {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border-color, rgba(0, 0, 0, 0.12));
  transition: background 0.15s ease;
}
.toc-dock-divider:active .toc-dock-divider__line,
.toc-dock-divider:hover .toc-dock-divider__line {
  background: var(--accent-color, #0066cc);
}

.toc-dock-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.toc-dock-header-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.toc-dock-header-title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-dock-close {
  padding: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (hover: hover) {
  .toc-dock-close:hover {
    background: var(--accent-color-dim, rgba(74, 144, 217, 0.12));
    color: var(--accent-color);
  }
}
</style>

<style>
/* Prevent text selection while dragging the divider */
body.toc-dock-resizing {
  user-select: none;
  cursor: col-resize;
}
</style>
