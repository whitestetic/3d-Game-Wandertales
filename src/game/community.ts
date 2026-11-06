// Brings registered community members into the game world and finds them homes.
// Pure logic (no React), so housing rules are testable headless.
import { BUILDINGS, getBuilding } from './map.ts'
import { MOCK_RESIDENTS, RESIDENTS, type Appearance, type Personality, type Resident } from './residents.mock.ts'
import { addToTown, removeFromTown, unassignWorker } from './sim.ts'
import { TYPES, isBuilt, levelOf, pending, teardownBuilding, workersOf } from './town.ts'

export interface Member {
  id: string
  displayName: string
  instagram: string | null
  personality: Personality
  appearance: Appearance
  homeBuildingId: string | null
}

export const community = {
  /** all approved members from the backend */
  members: [] as Member[],
  /** approved, but no free bed yet */
  waiting: [] as Member[],
  placeholders: true,
}

export const bedsIn = (houseId: string) => (isBuilt(houseId) ? (TYPES.house.beds ?? 0) + levelOf(houseId) - 1 : 0)
export const occupants = (houseId: string) => RESIDENTS.filter((r) => r.home === houseId).length

/** Built house with a free bed, preferring the emptiest one. */
export function freeHouse(exclude?: string): string | null {
  const houses = BUILDINGS.filter((b) => b.kind === 'house' && b.id !== exclude && occupants(b.id) < bedsIn(b.id))
  houses.sort((a, b) => occupants(a.id) - occupants(b.id))
  return houses[0]?.id ?? null
}

/**
 * Demolish a player-built building (never the town's starter buildings — teardownBuilding refuses those).
 * Workers lose the job; residents who lived here move to another house with a free bed, or this refuses
 * instead of leaving anyone homeless. No refund.
 */
export function demolishBuilding(id: string, t: number): string | null {
  const b = getBuilding(id)
  if (!b) return 'Not found'
  if (b.kind === 'house') {
    const here = RESIDENTS.filter((r) => r.home === id)
    const freeElsewhere = BUILDINGS.filter((x) => x.kind === 'house' && x.id !== id).reduce((a, x) => a + Math.max(0, bedsIn(x.id) - occupants(x.id)), 0)
    if (here.length > freeElsewhere) return 'No free beds elsewhere for the residents living here'
    for (const r of here) r.home = freeHouse(id)! // capacity already confirmed above, so this always finds one
  }
  for (const r of workersOf(id)) unassignWorker(r.id)
  return teardownBuilding(id, t)
}

const toResident = (m: Member, home: string): Resident => ({
  id: m.id, name: m.displayName, instagram: m.instagram, profession: 'Unemployed', personality: m.personality, home, work: null,
  appearance: m.appearance, mock: false, originalWork: null, originalProfession: 'Unemployed',
})

/**
 * Sync the town with the backend's member list. New members move into a free bed (or wait),
 * removed members leave, existing ones get their latest name/look. Returns event messages.
 */
export function applyMembers(members: Member[]): { events: string[]; homeChanges: [string, string][] } {
  community.members = members
  const events: string[] = [], homeChanges: [string, string][] = []
  const ids = new Set(members.map((m) => m.id))
  for (const r of [...RESIDENTS]) if (!r.mock && !ids.has(r.id)) { removeFromTown(r.id); events.push(`${r.name} has left town`) }

  community.waiting = []
  for (const m of members) {
    const here = RESIDENTS.find((r) => r.id === m.id)
    if (here) {
      Object.assign(here, { name: m.displayName, instagram: m.instagram, personality: m.personality, appearance: m.appearance })
      continue
    }
    const saved = pending.homes[m.id] ?? m.homeBuildingId
    const keep = saved && BUILDINGS.some((b) => b.id === saved) && occupants(saved) < bedsIn(saved) ? saved : null
    const home = keep ?? freeHouse()
    if (!home) { community.waiting.push(m); continue }
    delete pending.homes[m.id]
    const r = toResident(m, home)
    const job = pending.jobs[m.id]
    if (job && (job.work === null || BUILDINGS.some((b) => b.id === job.work))) { r.work = job.work; r.profession = job.profession }
    delete pending.jobs[m.id]
    addToTown(r)
    if (home !== m.homeBuildingId) homeChanges.push([m.id, home])
    if (!keep) events.push(`${m.displayName} moved into ${BUILDINGS.find((b) => b.id === home)!.name}! 🏡`)
  }
  return { events, homeChanges }
}

/** Show or hide the 12 development placeholder residents (frees their beds for real members). */
export function setPlaceholders(on: boolean) {
  community.placeholders = on
  if (on) { for (const r of MOCK_RESIDENTS) addToTown(r) }
  else for (const r of MOCK_RESIDENTS) removeFromTown(r.id, false)
}

/**
 * Mock residents are already in `residents` before a save loads (resetSim() runs at import time), so unlike
 * community members they never pass back through pending.homes on their own. Call this once after loadGame()
 * to restore a placeholder's home if demolishBuilding moved them out of a cottage that's since been torn down.
 */
export function applyPendingHomes() {
  for (const r of RESIDENTS) {
    const saved = pending.homes[r.id]
    if (saved && saved !== r.home && BUILDINGS.some((b) => b.id === saved) && occupants(saved) < bedsIn(saved)) r.home = saved
  }
}
