<template>
    <svg v-if="svgHtml" class="provider-icon-svg" :class="[iconData?.needsBg ? 'provider-icon-bg' : '', iconData?.monoCssClass]" :style="svgStyle" :viewBox="viewBox" role="img" :aria-label="name || modelName" v-html="svgHtml" />
    <span v-else class="provider-icon-initial" :style="initialStyle">{{ initial }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getModelProvider, getProviderIcon, getProviderSvgHtml, getProviderViewBox } from '@/utils/providerIcons'

const props = withDefaults(defineProps<{
    /** Model name to detect provider from */
    modelName: string
    /** Display name for aria-label and initial-letter fallback */
    name?: string
    /** Icon size in pixels */
    size?: number
}>(), {
    size: 16,
})

const providerId = computed(() => getModelProvider(props.modelName))
const iconData = computed(() => providerId.value ? getProviderIcon(providerId.value) : null)

const svgHtml = computed(() => {
    if (!providerId.value) return null
    return getProviderSvgHtml(providerId.value)
})

const viewBox = computed(() => {
    if (!providerId.value) return '0 0 24 24'
    return getProviderViewBox(providerId.value)
})

const svgStyle = computed(() => ({
    width: `${props.size}px`,
    height: `${props.size}px`,
}))

const initial = computed(() => {
    if (props.name) return props.name.charAt(0).toUpperCase()
    return props.modelName ? props.modelName.charAt(0).toUpperCase() : '?'
})

const initialStyle = computed(() => ({
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${Math.max(props.size * 0.55, 8)}px`,
}))
</script>

<style scoped>
.provider-icon-svg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
}

/* Contrasting background for monochrome icons that would be
   invisible on same-colored backgrounds. Uses --bg-tertiary which
   automatically adapts: light=#e9ecef, dark=#21262d */
.provider-icon-bg {
    border-radius: 20%;
    background: var(--bg-tertiary);
}

.provider-icon-initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
    border-radius: 20%;
    background: color-mix(in srgb, var(--text-secondary) 18%, transparent);
    color: var(--text-primary);
    font-weight: 600;
}
</style>
