<template>
  <ModalDialog :open="open" :title="t('shareDialog.title')" :z-index="2500" :max-width="520" @close="$emit('close')">
    <div class="share-dialog-body">
      <template v-if="!file">
        <div class="share-dialog-hint">{{ t('shareDialog.noFile') }}</div>
      </template>

      <template v-else-if="busy">
        <div class="share-dialog-hint">{{ t('common.loading') }}</div>
      </template>

      <template v-else-if="errorMsg">
        <div class="share-dialog-error">{{ errorMsg }}</div>
      </template>

      <template v-else-if="!linkUrl">
        <div class="share-dialog-hint">{{ t('shareDialog.explain') }}</div>
        <div class="share-dialog-file">{{ file.name }}</div>
        <button class="share-dialog-primary" :disabled="creating" @click="createLink">
          {{ creating ? t('common.loading') : t('shareDialog.generate') }}
        </button>
      </template>

      <template v-else>
        <div class="share-dialog-hint">{{ t('shareDialog.active') }}</div>
        <div class="share-dialog-link-row">
          <input
            ref="linkInputRef"
            class="share-dialog-link-input"
            type="text"
            :value="linkUrl"
            readonly
            @focus="$event.target.select()"
          />
          <button class="share-dialog-btn" :title="t('common.copy')" @click="copyLink">
            <Copy :size="14" />
            {{ t('common.copy') }}
          </button>
        </div>
        <div class="share-dialog-actions">
          <button class="share-dialog-secondary" @click="regenerateLink">{{ t('shareDialog.regenerate') }}</button>
          <button class="share-dialog-secondary danger" @click="revokeLink">{{ t('shareDialog.revoke') }}</button>
        </div>
      </template>
    </div>
    <template #footer>
      <button class="share-dialog-cancel" @click="$emit('close')">{{ t('common.close') }}</button>
    </template>
  </ModalDialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy } from 'lucide-vue-next'
import ModalDialog from '@/components/common/ModalDialog.vue'
import { useToast } from '@/composables/useToast.ts'
import { copyText } from '@/utils/clipboard.ts'

const props = defineProps({
  open: Boolean,
  file: Object,
})

const { t } = useI18n()
const toast = useToast()

const busy = ref(false)
const creating = ref(false)
const errorMsg = ref('')
const linkUrl = ref('')
const linkInputRef = ref(null)

// Build the absolute link from the server-returned path.
function toAbsoluteUrl(path) {
  return window.location.origin + path
}

watch(() => props.open, async (isOpen) => {
  if (!isOpen || !props.file?.path) return
  await loadStatus()
}, { immediate: true })

async function loadStatus() {
  busy.value = true
  errorMsg.value = ''
  linkUrl.value = ''
  try {
    const resp = await fetch(`/api/share?path=${encodeURIComponent(props.file.path)}`)
    if (!resp.ok) throw new Error(resp.statusText)
    const data = await resp.json()
    if (data.path) linkUrl.value = toAbsoluteUrl(data.path)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function createLink() {
  creating.value = true
  errorMsg.value = ''
  try {
    const resp = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: props.file.path }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err.error || resp.statusText)
    }
    const data = await resp.json()
    linkUrl.value = toAbsoluteUrl(data.path)
    copyLink()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

function copyLink() {
  if (!linkUrl.value) return
  copyText(linkUrl.value, () => {
    toast.show(t('common.copied'), { icon: '✅', type: 'success', duration: 2000 })
  })
}

async function regenerateLink() {
  // Re-creating rotates the token, invalidating the previous link.
  await createLink()
}

async function revokeLink() {
  errorMsg.value = ''
  try {
    const resp = await fetch(`/api/share?path=${encodeURIComponent(props.file.path)}`, { method: 'DELETE' })
    if (!resp.ok) throw new Error(resp.statusText)
    linkUrl.value = ''
    toast.show(t('shareDialog.revoked'), { icon: '🔗', type: 'success', duration: 2000 })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<style scoped>
.share-dialog-body {
  padding: 4px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.share-dialog-hint {
  font-size: 13px;
  color: var(--text-secondary, #57606a);
  line-height: 1.5;
}
.share-dialog-file {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1f2328);
  word-break: break-all;
}
.share-dialog-error {
  font-size: 13px;
  color: #cf222e;
  word-break: break-word;
}
.share-dialog-primary {
  align-self: flex-start;
  padding: 8px 16px;
  background: var(--accent-color, #0066cc);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.share-dialog-primary:disabled { opacity: 0.6; cursor: default; }
.share-dialog-link-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.share-dialog-link-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border-color, #dee2e6);
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}
.share-dialog-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-secondary, #666);
  border: 1px solid var(--border-color, #dee2e6);
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.share-dialog-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.share-dialog-secondary {
  padding: 7px 12px;
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-secondary, #666);
  border: 1px solid var(--border-color, #dee2e6);
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  cursor: pointer;
}
.share-dialog-secondary.danger { color: #cf222e; }
.share-dialog-cancel {
  padding: 7px 14px;
  background: var(--bg-tertiary, #f0f0f0);
  color: var(--text-secondary, #666);
  border: 1px solid var(--border-color, #dee2e6);
  border-radius: var(--radius-sm, 6px);
  font-size: 13px;
  cursor: pointer;
}
@media (hover: hover) {
  .share-dialog-primary:hover { filter: brightness(1.1); }
  .share-dialog-btn:hover, .share-dialog-secondary:hover, .share-dialog-cancel:hover { background: var(--bg-secondary); }
}
</style>
