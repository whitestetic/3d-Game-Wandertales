// Local save of the simulated world (browser). Cloud saves (backend/cloud.ts) upload the very same snapshot.
import { applySaved, friendships, resetSim, savedState, sim, type ResidentSim } from './sim.ts'
import { useGame } from './store.ts'
import { loadTown, resetTown, serializeTown, town } from './town.ts'
import { loadGuild, resetGuild, serializeGuild } from './guild.ts'
import { loadChronicle, resetChronicle, serializeChronicle } from './chronicle.ts'
import { SEASON_INFO, seasonOf } from './calendar.ts'
import { RESIDENTS } from './residents.mock.ts'
import { BUILDINGS } from './map.ts'

export const KEY = 'wt.save'
const VERSION = 3
// fields worth keeping; transient movement/conversation state is rebuilt on load
const KEEP = ['needs', 'wealth', 'level', 'xp', 'activity', 'since', 'target', 'node', 'gmFriendship', 'gmTalkDay', 'lastChat', 'skills', 'workProgress', 'joy', 'awayUntil'] as const

export interface Snapshot {
  v: number; savedAt: number; time: number
  residents: Record<string, Partial<ResidentSim>>; friendships: Record<string, number>
  town?: ReturnType<typeof serializeTown>; guild?: ReturnType<typeof serializeGuild>; chronicle?: ReturnType<typeof serializeChronicle>
}

/** While true nothing is written to the local save (used while swapping in a cloud save and reloading). */
export const saving = { paused: false }

export function snapshot(): Snapshot {
  const residents: Record<string, Partial<ResidentSim>> = {}
  Object.assign(residents, savedState) // residents not in town right now keep their saved state
  for (const [id, s] of Object.entries(sim)) residents[id] = Object.fromEntries(KEEP.map((k) => [k, s[k]]))
  return { v: VERSION, savedAt: Date.now(), time: useGame.getState().time, residents, friendships, town: serializeTown(), guild: serializeGuild(), chronicle: serializeChronicle() }
}

/** Short description of a save, shown when two saves conflict. */
export function summarize(time: number) {
  return { day: Math.floor(time / 1440) + 1, season: SEASON_INFO[seasonOf(time)].name, gold: Math.round(town.gold), population: RESIDENTS.length, buildings: BUILDINGS.length }
}

export function saveGame() {
  if (saving.paused) return
  try { localStorage.setItem(KEY, JSON.stringify(snapshot())) } catch { /* storage full or blocked: keep playing unsaved */ }
}

export function loadGame() {
  let data: Snapshot | null = null
  try { data = JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { data = null }
  // v1 saves (Phase 2) have no town data: keep residents, start the economy fresh. v2 saves have no chronicle.
  if (!data || ![1, 2, VERSION].includes(data.v) || typeof data.time !== 'number') return
  loadGuild(data.guild)
  loadChronicle(data.chronicle)
  if (data.town) loadTown(data.town) // first, so saved residents can stand on player-built roads
  for (const [id, saved] of Object.entries(data.residents ?? {})) {
    if (sim[id]) applySaved(sim[id], saved)
    else savedState[id] = saved // registered resident: applied when they arrive in town
  }
  for (const [k, v] of Object.entries(data.friendships ?? {})) if (typeof v === 'number') friendships[k] = v
  useGame.setState({ time: data.time })
}

export function startAutosave() {
  setInterval(() => { if (useGame.getState().screen === 'playing') saveGame() }, 15000)
  addEventListener('pagehide', () => { if (useGame.getState().screen === 'playing') saveGame() })
}

export function resetWorld() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  resetTown()
  resetGuild()
  resetSim()
  resetChronicle()
  useGame.setState({ time: 8 * 60, selection: null, placing: null })
}
