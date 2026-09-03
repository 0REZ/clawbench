import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import { MONO_FONT_CHOICES, UI_FONT_CHOICES, DEFAULT_FONT_CHOICE } from '@/utils/fontConfig'

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

  it('duplicate ids between mono/ui tables would not silently shadow labels', () => {
    const monoIds = MONO_FONT_CHOICES.map(c => c.id)
    const uiIds = UI_FONT_CHOICES.map(c => c.id)
    // 'default' is intentionally shared as the sentinel; other overlaps would
    // be accidental (same family listed in both dimensions).
    const overlap = monoIds.filter(id => id !== DEFAULT_FONT_CHOICE && uiIds.includes(id))
    expect(overlap).toEqual([])
  })
})
