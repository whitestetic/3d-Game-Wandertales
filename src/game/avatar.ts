// Avatar options + validation shared by the registration page, admin tools and the local backend.
// Keep in sync with valid_appearance() / normalize_instagram() in supabase/migrations.
import type { Appearance, Personality } from './residents.mock.ts'

export const PERSONALITIES: Personality[] = ['Cheerful', 'Shy', 'Hardworking', 'Social', 'Greedy', 'Kind', 'Adventurous', 'Lazy']
export const HAIR_STYLES = ['short', 'long', 'bun', 'spiky'] as const
export const EYES = ['round', 'happy', 'sleepy', 'wide'] as const
export const ACCESSORIES = ['none', 'glasses', 'scarf', 'flower'] as const
export const BUILDS = ['slim', 'regular', 'sturdy'] as const

export const SKIN_TONES = ['#fbe3d0', '#f6d2b8', '#efc6a4', '#e2b08a', '#c99a76', '#a8754f', '#8d5a3b', '#6b432b']
export const HAIR_COLORS = ['#1d1714', '#3a2416', '#6b3e22', '#8a4b2a', '#b8442e', '#d7a64a', '#e5c06e', '#c9b28a', '#5a5a5a', '#2f5a3a', '#4f6fb0', '#c86fa0']
export const CLOTH_COLORS = ['#f2e3c6', '#eeeeee', '#5b4636', '#3e5c8a', '#2f4f7f', '#3f7a8c', '#7fa65a', '#6aa38a', '#c98a4b', '#d6a03c', '#c96f3b', '#9c3d3d', '#cf7fa3', '#8a5a9a', '#3d3d3d']
export const HAT_COLORS = ['#d9b45a', '#6b5a3a', '#e0b23a', '#3e5c8a', '#9c3d3d']

const HEX = /^#[0-9a-f]{6}$/i

export function validAppearance(a: unknown): a is Appearance {
  if (!a || typeof a !== 'object') return false
  const x = a as Record<string, unknown>
  return [x.skin, x.hair, x.shirt, x.pants].every((c) => typeof c === 'string' && HEX.test(c))
    && (x.hat === undefined || (typeof x.hat === 'string' && HEX.test(x.hat)))
    && HAIR_STYLES.includes(x.hairStyle as never)
    && (x.eyes === undefined || EYES.includes(x.eyes as never))
    && (x.accessory === undefined || ACCESSORIES.includes(x.accessory as never))
    && (x.build === undefined || BUILDS.includes(x.build as never))
    && typeof x.height === 'number' && x.height >= 0.9 && x.height <= 1.1
}

/** Instagram handle → canonical form, or null if it can't be a valid handle. Accepts @name and profile URLs. */
export function normalizeInstagram(raw: string): string | null {
  let h = raw.trim().toLowerCase().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')
  if (!/^[a-z0-9._]{1,30}$/.test(h) || h.includes('..') || h.startsWith('.') || h.endsWith('.')) return null
  return h
}

export const validName = (n: string) => n.trim().length >= 2 && n.trim().length <= 24

/** Deterministic random look from a seed, so "Randomize" and CSV imports give varied avatars. */
export function randomAppearance(seed: number): Appearance {
  let s = seed >>> 0
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]
  return {
    skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS), hairStyle: pick(HAIR_STYLES),
    shirt: pick(CLOTH_COLORS), pants: pick(CLOTH_COLORS),
    eyes: pick(EYES), accessory: r() < 0.5 ? 'none' : pick(ACCESSORIES), build: pick(BUILDS),
    ...(r() < 0.3 ? { hat: pick(HAT_COLORS) } : {}),
    height: Math.round((0.92 + r() * 0.16) * 100) / 100,
  }
}

export const seedFrom = (text: string) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
