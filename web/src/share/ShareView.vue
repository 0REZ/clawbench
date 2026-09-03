<template>
  <div class="share-view">
    <!-- Read-only top bar (not the app FileHeader) -->
    <div class="share-topbar">
      <span class="share-file-name" :title="file?.name || ''">{{ file?.name || '' }}</span>
      <span v-if="loading" class="share-status">{{ t('share.loading') }}</span>
      <span v-else-if="error" class="share-status share-error">{{ error }}</span>
      <span v-else class="share-spacer" />
      <div v-if="hasToc && !error" class="share-top-actions">
        <button class="share-btn" type="button" :title="t('share.toggleToc')" @click="tocOpen = !tocOpen">
          <List :size="16" />
        </button>
      </div>
      <a
        v-if="file && !error"
        class="share-btn"
        :href="downloadUrl"
        :download="file.name"
        :title="t('share.download')"
      >
        <Download :size="16" />
      </a>
    </div>

    <!-- Body: content + optional TOC -->
    <div class="share-body" :data-toc-open="tocOpen">
      <div class="share-content" ref="contentRef">
        <!-- Loading -->
        <div v-if="loading" class="share-center-hint">
          <LoadingIndicator size="md" />
        </div>

        <!-- Error / invalid link -->
        <div v-else-if="error" class="share-error-state">
          <FileX2 :size="40" />
          <div class="share-error-title">{{ t('share.invalidTitle') }}</div>
          <div class="share-error-desc">{{ error }}</div>
        </div>

        <template v-else-if="file">
          <!-- Markdown rendered -->
          <MarkdownPreview
            v-if="isMarkdown"
            :file="file"
            view-mode="rendered"
            :word-wrap="wordWrap"
            @close-search="() => {}"
          />

          <!-- PDF -->
          <PdfPreview
            v-else-if="file.isPdf"
            :file="file"
          />

          <!-- Image -->
          <ImagePreview
            v-else-if="file.isImage"
            :file="file"
          />

          <!-- Audio -->
          <AudioPreview
            v-else-if="file.isAudio"
            :file="file"
          />

          <!-- Video -->
          <VideoPreview
            v-else-if="file.isVideo"
            :file="file"
          />

          <!-- Office documents -->
          <OfficePreview
            v-else-if="file.isOffice"
            :file="file"
          />

          <!-- OpenAPI / Swagger spec (rendered docs) -->
          <div v-else-if="file.subtype === 'openapi'" class="share-fill-viewer">
            <OpenApiPreview :file="file" />
          </div>

          <!-- HTML rendered -->
          <iframe
            v-else-if="file.isHtml"
            class="share-html-iframe"
            :srcdoc="file.content"
            sandbox="allow-scripts"
          />

          <!-- Code / plain text -->
          <CodeMirrorViewer
            v-else-if="isTextContent"
            :file="file"
            :content="file.content"
            :language="rawLanguage"
            :editable="false"
            :word-wrap="wordWrap"
          />

          <!-- Binary / too-large / unsupported fallback: download -->
          <div v-else class="share-center-hint share-unsupported">
            <FileIcon :path="file.name" :size="48" />
            <div class="share-error-desc">{{ t('share.noPreview') }}</div>
            <a class="share-download-btn" :href="downloadUrl" :download="file.name">
              <Download :size="14" />
              {{ t('common.download') }}
            </a>
          </div>
        </template>
      </div>

      <!-- TOC -->
      <div v-if="hasToc && tocOpen" class="share-toc">
        <div class="share-toc-title">{{ t('share.toc') }}</div>
        <button
          v-for="item in tocItems"
          :key="item.id"
          class="share-toc-item"
          :data-level="item.level"
          :style="{ paddingLeft: (8 + (item.level - 1) * 14) + 'px' }"
          :title="item.text"
          @click="scrollToHeading(item.id)"
        >{{ item.text }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, defineAsyncComponent, provide, readonly } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, FileX2, List } from 'lucide-vue-next'
import LoadingIndicator from '@/components/common/LoadingIndicator.vue'
import FileIcon from '@/components/common/FileIcon.vue'
import ImagePreview from '@/components/media/ImagePreview.vue'
import PdfPreview from '@/components/media/PdfPreview.vue'
import AudioPreview from '@/components/media/AudioPreview.vue'
import VideoPreview from '@/components/media/VideoPreview.vue'
import { buildAsyncComponentOptions } from '@/composables/useAsyncComponent.ts'
import MarkdownPreview from '@/components/file/MarkdownPreview.vue'
const CodeMirrorViewer = defineAsyncComponent(buildAsyncComponentOptions({ loader: () => import('@/components/file/CodeMirrorViewer.vue') }))
const OfficePreview = defineAsyncComponent(buildAsyncComponentOptions({ loader: () => import('@/components/media/OfficePreview.vue') }))
const OpenApiPreview = defineAsyncComponent(buildAsyncComponentOptions({ loader: () => import('@/components/file/OpenApiPreview.vue') }))
import { getFileType } from '@/utils/fileType.ts'
import { extractToc, type TocItem } from '@/utils/toc.ts'
import { setShareToken, setSharedFile, shareApiUrl } from '@/share/shareMode'
import { store } from '@/stores/app.ts'

// Share the resolved theme id with child components (OpenApiPreview reads it via
// inject('theme') to pick Swagger UI colors). share.html sets data-theme on <html>.
const themeId = ref(document.documentElement.getAttribute('data-theme') || 'github-dark')
provide('theme', readonly(themeId))

/** The file payload returned by the share /file endpoint (FileContent JSON)
 *  extended with the viewer flags set by decorateFile. */
interface ShareFile {
  name: string
  path: string
  content: string
  isBinary?: boolean
  isPdf?: boolean
  isImage?: boolean
  isAudio?: boolean
  isVideo?: boolean
  isOffice?: boolean
  isHtml?: boolean
  isExcalidraw?: boolean
  tooLarge?: boolean
  subtype?: string
}

const { t } = useI18n()

// ─── State ───
const loading = ref(true)
const error = ref('')
const file = ref<ShareFile | null>(null)
const tocOpen = ref(true)
const wordWrap = ref(false)
const contentRef = ref<HTMLElement | null>(null)
const tocItems = ref<TocItem[]>([])

// ─── Parse token from /share/{token} ───
function parseTokenFromPath(): string {
  const m = location.pathname.match(/^\/share\/([^/]+)\/?$/)
  return m ? decodeURIComponent(m[1]) : ''
}

const downloadUrl = computed(() => {
  if (!file.value) return ''
  return shareApiUrl('download')
})

const rawLanguage = computed(() => {
  if (!file.value?.name) return 'plaintext'
  return getFileType(file.value.name)?.lang || 'plaintext'
})

const isMarkdown = computed(() => {
  if (!file.value) return false
  return !!getFileType(file.value.name)?.isMarkdown
})

const isTextContent = computed(() => {
  if (!file.value) return false
  if (file.value.isBinary || file.value.tooLarge) return false
  return typeof file.value.content === 'string' && file.value.content.length > 0
})

const hasToc = computed(() => {
  if (!file.value || error.value) return false
  if (file.value.isBinary || file.value.tooLarge) return false
  return isMarkdown.value || isTextContent.value
})

// ─── File shape (mirrors store.selectFile extension detection) ───
function decorateFile(data: ShareFile): ShareFile {
  const lower = (data.name || '').toLowerCase()
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']
  const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma', '.opus']
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.m3u8']
  const officeExts = ['.docx', '.xlsx', '.pptx', '.xls']
  if (lower.endsWith('.pdf')) data.isPdf = true
  if (imageExts.some(e => lower.endsWith(e))) data.isImage = true
  if (audioExts.some(e => lower.endsWith(e))) data.isAudio = true
  if (videoExts.some(e => lower.endsWith(e))) data.isVideo = true
  if (officeExts.some(e => lower.endsWith(e))) data.isOffice = true
  const htmlExts = ['.html', '.htm', '.xhtml']
  if (htmlExts.some(e => lower.endsWith(e))) data.isHtml = true
  if (data.subtype === 'excalidraw') data.isExcalidraw = true
  return data
}

async function loadFile() {
  loading.value = true
  error.value = ''
  try {
    const resp = await fetch(shareApiUrl('file'))
    if (!resp.ok) {
      error.value = t('share.notFound')
      return
    }
    const data = await resp.json()
    decorateFile(data)
    file.value = data
    setSharedFile(data.path, data.name)

    // Build TOC for markdown / text content.
    if (isTextContent.value) {
      const lang = isMarkdown.value ? 'markdown' : (rawLanguage.value || 'plaintext')
      if (typeof data.content === 'string' && data.content) {
        tocItems.value = extractToc(data.content, lang)
      }
    }
    // Keep store project/home roots empty so markdown file-path annotations
    // inside the shared doc cannot resolve to clickable in-app file opens.
    store.state.projectRoot = store.state.projectRoot || ''
    store.state.homeDir = store.state.homeDir || ''
    tocOpen.value = window.innerWidth >= 900
  } finally {
    loading.value = false
  }
}

function scrollToHeading(id: string) {
  const root = contentRef.value
  if (!root) return
  const el = root.querySelector(`#${CSS.escape(id)}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

onMounted(() => {
  const token = parseTokenFromPath()
  if (!token) {
    error.value = t('share.invalidUrl')
    loading.value = false
    return
  }
  setShareToken(token)
  void loadFile()
})
</script>

<style scoped>
.share-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #1f2328);
  overflow: hidden;
}

.share-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,.25));
  background: var(--bg-secondary, #f6f8fa);
}

.share-file-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-status { font-size: 12px; color: var(--text-muted, #656d76); }
.share-error { color: #cf222e; }
.share-spacer { flex: 1; }

.share-top-actions { display: flex; align-items: center; }

.share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #57606a);
  cursor: pointer;
  text-decoration: none;
}
.share-btn:hover { background: var(--bg-tertiary, #eaeef2); color: var(--accent-color, #0969da); }

.share-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.share-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  position: relative;
}.share-toc {
  flex: 0 0 240px;
  width: 240px;
  min-width: 0;
  overflow-y: auto;
  border-left: 1px solid var(--border-color, rgba(128,128,128,.25));
  padding: 8px;
  box-sizing: border-box;
}

.share-toc-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #656d76);
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 4px 8px 8px;
}

.share-toc-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 5px 8px;
  font-size: 13px;
  color: var(--text-secondary, #57606a);
  cursor: pointer;
  border-radius: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.share-toc-item:hover { background: var(--bg-tertiary, #eaeef2); color: var(--accent-color, #0969da); }

.share-center-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  padding: 32px;
  text-align: center;
}

.share-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 32px;
  color: var(--text-muted, #656d76);
  text-align: center;
}

.share-error-title { font-size: 16px; font-weight: 600; color: var(--text-primary, #1f2328); }
.share-error-desc { font-size: 13px; max-width: 480px; word-break: break-word; }

.share-html-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

/* OpenAPI preview fills the visible content area. .share-content is an
   overflow:auto scroller whose height is determined by its children, so a
   flex:1 child would collapse to content height. Pin the viewer to the
   scroller's visible viewport instead. */
.share-fill-viewer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
}

.share-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  background: var(--accent-color, #0969da);
  color: #fff;
  text-decoration: none;
  font-size: 14px;
  cursor: pointer;
}

@media (max-width: 899px) {
  .share-body[data-toc-open="true"] .share-toc {
    display: none; /* TOC handled by overlay toggle on mobile */
  }
}

/* On very wide screens the content column would stretch content (PDFs, code)
   unreasonably wide. Cap it and center it, leaving generous side margins. */
@media (min-width: 1100px) {
  .share-content {
    max-width: 1080px;
    margin: 0 auto;
  }
}
</style>
