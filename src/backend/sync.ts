import { getBackend } from './index'
import { applyMembers, community, setPlaceholders } from '../game/community'
import { useGame } from '../game/store'
import { chron } from '../game/chronicle'

const bump = () => useGame.setState((s) => ({ rev: s.rev + 1 }))
export const syncState = { error: null as string | null, lastSync: 0 }

/** Pull approved residents from the backend and update the town. */
export async function syncCommunity() {
  try {
    const b = await getBackend()
    const list = await b.listResidents()
    const { events, homeChanges } = applyMembers(list)
    syncState.error = null
    syncState.lastSync = Date.now()
    if (events.length) {
      useGame.getState().notify(events.join(' · '))
      for (const e of events) chron(useGame.getState().time, 'people', '🏡', e)
    }
    if (homeChanges.length && (await b.session()).isGuildMaster) for (const [id, home] of homeChanges) b.setHome(id, home).catch(() => {})
  } catch (e) {
    syncState.error = e instanceof Error ? e.message : String(e)
  }
  bump()
}

/** Re-check housing without a network call (e.g. a cottage just finished). */
export function rehouse() {
  const { events } = applyMembers(community.members)
  if (events.length) { useGame.getState().notify(events.join(' · ')); bump() }
}

const PKEY = 'wt.placeholders'
export function initPlaceholders() {
  let on = true
  try { on = localStorage.getItem(PKEY) !== 'off' } catch { /* default on */ }
  if (!on) setPlaceholders(false)
}
export function togglePlaceholders(on: boolean) {
  setPlaceholders(on)
  try { localStorage.setItem(PKEY, on ? 'on' : 'off') } catch { /* ignore */ }
  rehouse()
  bump()
}

// ---------- guild ----------
import { guild, resolveQuests } from '../game/guild'
import type { Backend } from './types'

/** Save quest renown to the backend (only possible while the Guild Master is signed in). */
async function flushRenown(b: Backend) {
  if (!guild.pendingRenown.length || !(await b.session()).isGuildMaster) return
  while (guild.pendingRenown.length) {
    const g = guild.pendingRenown[0]
    try { await b.addRenown(g.memberId, g.amount, g.reason) } catch (e) {
      if (!String((e as Error).message).includes('not_found')) break // keep it for later; drop only if the member is gone
    }
    guild.pendingRenown.shift()
  }
}

export async function syncGuild() {
  try {
    const b = await getBackend()
    await flushRenown(b)
    guild.members = await b.listGuildMembers()
  } catch (e) { syncState.error = e instanceof Error ? e.message : String(e) }
  bump()
}

/** Called every frame by the simulation: finishes quests whose time is up. */
export function checkQuests(t: number) {
  if (!guild.active.length || !guild.active.some((a) => a.end <= t)) return
  const { messages } = resolveQuests(t)
  if (messages.length) { useGame.getState().notify(messages.join(' · ')); syncGuild() }
}
