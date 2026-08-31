<template>
  <div class="toc-dock" :style="dockStyle">
    <!-- Drag divider to resize -->
    <div class="toc-dock-divider" @pointerdown="startDrag" :title="t('toc.dragResize')" />

    <div class="toc-dock-header">
      <List :size="14" class="toc-dock-header-icon" />
      <span class="toc-dock-header-title">{{ t('toc.title') }}</span>
      <button class="toc-dock-close" @click="emit('close')" :title="t('common.close')">
        <X :size="14" />
      </button>
    </div>

    <TocDrawer
      :open="open"
      :file="file"
      :pdf-outline="pdfOutline"
      docked
      @close="emit('close')"
      @jump="emit('jump', $event)"
      @jump-page="emit('jumpPage', $event)"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { List, X } from 'lucide-vue-next'
import TocDrawer from '@/components/TocDrawer.vue'
import { useTocDockPreference } from '@/composables/useTocDockPreference'

defineProps({
  open: Boolean,
  file: Object,
  pdfOutline: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'jump', 'jumpPage'])

const { t } = useI18n()
const { tocDockWidth, setWidth } = useTocDockPreference()

const dockStyle = computed(() => ({ width: `${tocDockWidth.value}px` }))

// ── Drag-to-resize ──
let dragging = false
let startClientX = 0
let startWidth = 0

function startDrag(e) {
  dragging = true
  startClientX = e.clientX
  startWidth = tocDockWidth.value
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  document.body.classList.add('toc-dock-resizing')
}

function onDragMove(e) {
  if (!dragging) return
  // Incremental resize: track the drag delta from the press point so both the
  // left and right edges move together without jumping, independent of the
  // pointer's absolute viewport position.
  setWidth(startWidth + (e.clientX - startClientX))
}

function endDrag() {
  if (!dragging) return
  dragging = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  document.body.classList.remove('toc-dock-resizing')
}

onBeforeUnmount(() => {
  if (dragging) endDrag()
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

.toc-dock-divider {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
}
.toc-dock-divider:hover {
  background: var(--accent-color-dim, rgba(74, 144, 217, 0.25));
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
