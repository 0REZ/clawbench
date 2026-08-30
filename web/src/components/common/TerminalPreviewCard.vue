<template>
  <div class="tpc-shell" :class="{ 'tpc-shell--placeholder': !theme, 'tpc-shell--auto': auto }" :style="shellStyle">
    <div class="tpc-titlebar">
      <span class="tpc-dot tpc-dot--red"></span>
      <span class="tpc-dot tpc-dot--yellow"></span>
      <span class="tpc-dot tpc-dot--green"></span>
    </div>
    <div class="tpc-body">
      <div class="tpc-line">
        <span class="tpc-prompt" :style="promptStyle">$</span>
        <span class="tpc-cmd">ls</span>
      </div>
      <div class="tpc-line">
        <span class="tpc-dir" :style="dirStyle">src</span>
        <span class="tpc-sep">  </span>
        <span class="tpc-file" :style="fileStyle">main.go</span>
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

const shellStyle = computed<Record<string, string>>(() => {
  if (props.auto) {
    return { background: 'linear-gradient(135deg, #ffffff 0%, #ffffff 48%, #1a1a2e 52%, #1a1a2e 100%)' }
  }
  if (!props.theme) return {}
  return {
    background: props.theme.background ?? '',
    color: props.theme.foreground ?? '',
  }
})

const promptStyle = computed<Record<string, string>>(() => {
  if (props.auto || !props.theme?.green) return {}
  return { color: props.theme.green }
})

const dirStyle = computed<Record<string, string>>(() => {
  if (props.auto || !props.theme?.blue) return {}
  return { color: props.theme.blue }
})

const fileStyle = computed<Record<string, string>>(() => {
  if (props.auto || !props.theme?.cyan) return {}
  return { color: props.theme.cyan }
})
</script>

<style scoped>
.tpc-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 6px;
  overflow: hidden;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
}

.tpc-shell--placeholder {
  background: color-mix(in srgb, var(--text-muted) 15%, var(--bg-tertiary));
}

.tpc-titlebar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
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
