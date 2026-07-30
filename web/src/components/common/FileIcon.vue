<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { getFileIconUrl, getFolderIconUrl } from '@/utils/materialIcons'

const props = withDefaults(defineProps<{
  /** File path or file name */
  path: string
  /** Icon size in pixels */
  size?: number
  /** Whether this is a directory */
  isDir?: boolean
  /** Whether the directory is open (expanded) */
  isDirOpen?: boolean
}>(), {
  size: 16,
  isDir: false,
  isDirOpen: false,
})

const iconSrc = ref('')

watchEffect(async () => {
  const currentPath = props.path
  const currentIsDir = props.isDir
  const currentIsDirOpen = props.isDirOpen
  const url = currentIsDir
    ? await getFolderIconUrl(currentPath, currentIsDirOpen)
    : await getFileIconUrl(currentPath)
  // Only update if props haven't changed while we were awaiting
  if (props.path === currentPath && props.isDir === currentIsDir) {
    iconSrc.value = url
  }
})

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))

const alt = computed(() => props.isDir ? `folder: ${props.path}` : `file: ${props.path}`)
</script>

<template>
  <img
    v-if="iconSrc"
    :src="iconSrc"
    :alt="alt"
    class="file-type-icon"
    :style="sizeStyle"
    draggable="false"
  />
</template>

<style scoped>
.file-type-icon {
  display: inline-block;
  object-fit: contain;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
