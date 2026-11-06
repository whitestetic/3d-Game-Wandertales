import { create } from 'zustand'
import type { BuildingKind } from './map.ts'

export type CameraMode = 'iso' | 'third'
export type Selection = { type: 'building' | 'resident'; id: string } | null
export type Quality = 'high' | 'low'

const load = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } }

interface GameState {
  screen: 'menu' | 'playing'
  playerName: string
  mode: CameraMode
  /** room the player is standing in (3D interior), or null when outside */
  /** building id the player is standing inside (any building with a room, e.g. 'guild' or a cottage like 'h2'), or null outside */
  interior: string | null
  /** game minutes since day 1, 00:00 */
  time: number
  timeScale: number
  selection: Selection
  hovered: string | null
  nearby: Selection
  quality: Quality
  /** bumped whenever town data changes, so the UI and scene re-render */
  rev: number
  /** building being placed (construction preview) */
  placing: { kind: BuildingKind; rot: number; x: number | null; z: number | null } | null
  toast: string | null
  /** request the HUD to open a side panel (e.g. from a building) */
  openPanel: string | null
  /** camera focus request (iso) */
  focus: [number, number] | null
  start: (name: string) => void
  setMode: (m: CameraMode) => void
  toggleMode: () => void
  tick: (realSeconds: number) => void
  setTimeScale: (s: number) => void
  select: (s: Selection) => void
  setHovered: (id: string | null) => void
  setNearby: (s: Selection) => void
  setQuality: (q: Quality) => void
  focusOn: (x: number, z: number) => void
  notify: (msg: string) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useGame = create<GameState>((set) => ({
  screen: 'menu',
  playerName: load('wt.name') ?? '',
  mode: 'iso',
  interior: null,
  time: 8 * 60,
  timeScale: 2, // 2 game minutes per real second → a day lasts 12 minutes
  selection: null,
  hovered: null,
  nearby: null,
  quality: (load('wt.quality') as Quality) ?? 'high',
  rev: 0,
  placing: null,
  toast: null,
  openPanel: null,
  focus: null,
  start: (name) => { save('wt.name', name); set({ screen: 'playing', playerName: name }) },
  setMode: (mode) => set((s) => (s.interior ? s : { mode })),
  toggleMode: () => set((s) => (s.interior ? s : { mode: s.mode === 'iso' ? 'third' : 'iso' })),
  tick: (dt) => set((s) => ({ time: s.time + dt * s.timeScale })),
  setTimeScale: (timeScale) => set({ timeScale }),
  select: (selection) => set({ selection }),
  setHovered: (hovered) => set({ hovered }),
  setNearby: (nearby) => set((s) => (s.nearby?.id === nearby?.id ? s : { nearby })),
  setQuality: (quality) => { save('wt.quality', quality); set({ quality }) },
  focusOn: (x, z) => set((s) => (s.interior ? s : { focus: [x, z], mode: 'iso' })),
  notify: (toast) => {
    clearTimeout(toastTimer)
    set({ toast })
    toastTimer = setTimeout(() => set({ toast: null }), 3500)
  },
}))

export const hourOf = (t: number) => (t % 1440) / 60
export const dayOf = (t: number) => Math.floor(t / 1440) + 1
export const clock = (t: number) => {
  const m = Math.floor(t % 1440)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
