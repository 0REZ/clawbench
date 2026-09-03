import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import { MONO_FONT_CHOICES, UI_FONT_CHOICES, DEFAULT_FONT_CHOICE, MONO_FALLBACK_CHOICES } from '@/utils/fontConfig'

/**
 * Ensures the font-config settings items and every font option label exist in
 * both en and zh locales. Font ids (e.g. 'JetBrains Mono') contain spaces but
 * no dots, so vue-i18n's dot-path resolver reaches `settings.items.fonts.<id>`
 * safely — this spec guards against a future id that would break that contract
 * (e.g. one containing a dot).
 */
describe('i18n font keys completeness', () => {
  const allIds = [
    DEFAULT_FONT_CHOICE,
    ...MONO_FONT_CHOICES.map(c => c.id),
    ...UI_FONT_CHOICES.map(c => c.id),
    ...MONO_FALLBACK_CHOICES.map(c => c.id),
  ]

  it('en and zh expose the two font setting items', () => {
    for (const locale of [zh, en]) {
      expect(locale.settings.items.fontMono).toBeTruthy()
      expect(locale.settings.items.fontUi).toBeTruthy()
      expect(locale.settings.items.fontMonoDesc).toBeTruthy()
      expect(locale.settings.items.fontUiDesc).toBeTruthy()
      expect(locale.settings.items.fontSection).toBeTruthy()
    }
  })

  it('every font option id resolves to a non-empty label in both locales', () => {
    for (const id of allIds) {
      // Font ids must stay dot-free: vue-i18n splits message paths on '.'.
      expect(id, `font id ${id} must not contain a dot`).not.toContain('.')
      for (const locale of [zh, en]) {
        const label = locale.settings.items.fonts[id as keyof typeof locale.settings.items.fonts]
        expect(label, `missing label for ${id}`).toBeTruthy()
      }
    }
  })

  it('UI table is a superset of the mono table (shared families intentional)', () => {
    const monoIds = MONO_FONT_CHOICES.map(c => c.id)
    const uiIds = UI_FONT_CHOICES.map(c => c.id)
    // The interface font pool intentionally lists every mono family too, so
    // all mono ids (beyond the shared 'default' sentinel) must exist in UI.
    const missing = monoIds.filter(id => id !== DEFAULT_FONT_CHOICE && !uiIds.includes(id))
    expect(missing).toEqual([])
  })

  it('fontsGroup headings and bundled badge exist in both locales', () => {
    const groupKeys = ['default', 'bundled', 'system']
    for (const locale of [zh, en]) {
      for (const g of groupKeys) {
        const v = locale.settings.items.fontsGroup?.[g as keyof typeof locale.settings.items.fontsGroup]
        expect(v, `missing fontsGroup.${g}`).toBeTruthy()
      }
      expect(locale.settings.items.fontsBadge?.bundled).toBeTruthy()
    }
  })

  it('fallback font select item labels exist in both locales', () => {
    for (const locale of [zh, en]) {
      expect(locale.settings.items.fontMonoFallback).toBeTruthy()
      expect(locale.settings.items.fontMonoFallbackDesc).toBeTruthy()
      expect(locale.settings.items.fontUiFallback).toBeTruthy()
      expect(locale.settings.items.fontUiFallbackDesc).toBeTruthy()
    }
  })
})
