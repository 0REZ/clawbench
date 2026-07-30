/**
 * Material Icon Theme integration.
 * Resolves file/folder paths to per-file-type SVG icon URLs
 * using the vscode-material-icon-theme package.
 *
 * Icons are loaded lazily (not eager) to reduce initial bundle size.
 * Each icon URL is fetched on first access and cached.
 */

import { generateManifest } from 'material-icon-theme'
import { appLog } from '@/utils/appLog'

// Lazy-load icon modules — Vite splits each SVG into its own chunk
const iconModules = import.meta.glob<string>('../assets/material-icons/*.svg', {
  query: '?url',
  import: 'default',
})

// Cache: iconName → resolved URL (populated on first access)
const iconUrlCache = new Map<string, string>()

// Pending loads: iconName → Promise<string> (dedup concurrent loads)
const iconUrlPending = new Map<string, Promise<string>>()

// Generate manifest once at module init
const manifest = generateManifest()

// Build lookup maps from manifest data
const extMap = new Map<string, string>()
const fileNameMap = new Map<string, string>()
const folderNameMap = new Map<string, string>()
const folderNameOpenMap = new Map<string, string>()

for (const [ext, iconName] of Object.entries(manifest.fileExtensions || {})) {
  extMap.set(ext.toLowerCase(), iconName)
}

for (const [name, iconName] of Object.entries(manifest.fileNames || {})) {
  fileNameMap.set(name.toLowerCase(), iconName)
}

for (const [name, iconName] of Object.entries(manifest.folderNames || {})) {
  folderNameMap.set(name.toLowerCase(), iconName)
}

for (const [name, iconName] of Object.entries(manifest.folderNamesExpanded || {})) {
  folderNameOpenMap.set(name.toLowerCase(), iconName)
}

/** Default file icon name */
const DEFAULT_FILE_ICON = manifest.file || 'file'
/** Default folder icon name */
const DEFAULT_FOLDER_ICON = manifest.folder || 'folder'
/** Default open folder icon name */
const DEFAULT_FOLDER_OPEN_ICON = manifest.folderExpanded || 'folder-open'

/**
 * Resolve the icon name for a file path.
 * Checks: exact file name → file extension → fallback.
 */
export function getFileIconName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  const baseName = parts[parts.length - 1]

  // Try exact file name match (case-insensitive)
  const nameHit = fileNameMap.get(baseName.toLowerCase())
  if (nameHit) return nameHit

  // Try file extension match
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex > 0) {
    // Try full extension (e.g., "tar.gz")
    const fullExt = baseName.slice(dotIndex + 1).toLowerCase()
    const fullHit = extMap.get(fullExt)
    if (fullHit) return fullHit

    // Try double extension (e.g., ".tar.gz" → "gz" already tried, try "tar.gz")
    if (dotIndex > 0) {
      const prevDot = baseName.lastIndexOf('.', dotIndex - 1)
      if (prevDot > 0) {
        const doubleExt = baseName.slice(prevDot + 1).toLowerCase()
        const doubleHit = extMap.get(doubleExt)
        if (doubleHit) return doubleHit
      }
    }
  }

  return DEFAULT_FILE_ICON
}

/**
 * Resolve the icon name for a folder.
 * @param name Folder name (not path)
 * @param open Whether the folder is expanded
 */
export function getFolderIconName(name: string, open = false): string {
  const map = open ? folderNameOpenMap : folderNameMap
  const hit = map.get(name.toLowerCase())
  if (hit) return hit
  return open ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON
}

/**
 * Get the Vite asset URL for an icon by name (lazy-loaded and cached).
 * Returns undefined if the icon SVG is not available.
 */
export async function getIconUrl(iconName: string): Promise<string | undefined> {
  // Check cache first
  const cached = iconUrlCache.get(iconName)
  if (cached) return cached

  // Dedup concurrent loads
  const pending = iconUrlPending.get(iconName)
  if (pending) return pending

  // Find the matching module path
  const modulePath = `../assets/material-icons/${iconName}.svg`
  const loader = iconModules[modulePath]
  if (!loader) return undefined

  const loadPromise = loader().then((url) => {
    iconUrlCache.set(iconName, url)
    iconUrlPending.delete(iconName)
    return url
  }).catch((err) => {
    iconUrlPending.delete(iconName)
    appLog.w('MaterialIcons', `Failed to load icon: ${iconName}`, err)
    return ''
  })

  iconUrlPending.set(iconName, loadPromise)
  return loadPromise
}

/**
 * Get the full URL for a file's icon (async).
 * Combines icon name resolution with URL lookup.
 * Falls back to the default file icon URL.
 */
export async function getFileIconUrl(path: string): Promise<string> {
  const iconName = getFileIconName(path)
  return (await getIconUrl(iconName)) || (await getIconUrl(DEFAULT_FILE_ICON)) || ''
}

/**
 * Get the full URL for a folder's icon (async).
 * Falls back to the default folder icon URL.
 */
export async function getFolderIconUrl(name: string, open = false): Promise<string> {
  const iconName = getFolderIconName(name, open)
  return (await getIconUrl(iconName)) || (await getIconUrl(open ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON)) || ''
}
