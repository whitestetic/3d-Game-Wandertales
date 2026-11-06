// Cloud save sync for the Guild Master. The town saves locally every 15 s; this uploads the same snapshot.
// Safety rule: a save is never overwritten silently. Every upload says which cloud revision it was based on;
// if another device saved since, the upload is refused and the player picks which save to keep.
import { getBackend } from './index'
import type { CloudSave } from './types'
import { KEY, saveGame, saving, snapshot, summarize } from '../game/persist'
import { useGame } from '../game/store'

export type CloudStatus = 'off' | 'idle' | 'working' | 'conflict' | 'error'
const K = { on: 'wt.cloud.on', rev: 'wt.cloud.rev', device: 'wt.cloud.device' }
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* blocked */ } }

export const cloud = {
  enabled: get(K.on) === '1',
  status: (get(K.on) === '1' ? 'idle' : 'off') as CloudStatus,
  /** the cloud revision this device last synced with (0 = never) */
  rev: Number(get(K.rev) ?? 0) || 0,
  lastSync: 0,
  error: null as string | null,
  /** set while status is 'conflict': the save that is stored in the cloud now */
  other: null as CloudSave | null,
}

const listeners = new Set<() => void>()
export const onCloudChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
const emit = () => listeners.forEach((f) => f())
const update = (patch: Partial<typeof cloud>) => { Object.assign(cloud, patch); emit() }

export function deviceName() {
  let d = get(K.device)
  if (!d) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    d = `${/Mobile|Android|iPhone/.test(ua) ? 'Phone' : 'Computer'} ${Math.random().toString(36).slice(2, 6)}`
    set(K.device, d)
  }
  return d
}

const message = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  // the SQL functions come from supabase/migrations/0004_cloud_save.sql, which the project owner has to run once
  return /cloud_save/.test(m) && /schema cache|does not exist|not find the function/i.test(m)
    ? 'The database does not have cloud saves yet. Run supabase/migrations/0004_cloud_save.sql in the Supabase SQL Editor, then try again.' : m
}
let busy = false
/** Run one sync step at a time (an upload and a timer tick must never overlap). */
async function exclusive(fn: () => Promise<void>) {
  if (busy) return
  busy = true
  update({ status: 'working', error: null })
  try { await fn() } catch (e) { update({ status: 'error', error: message(e) }) } finally { busy = false }
}

async function requireGuildMaster() {
  const b = await getBackend()
  if (!(await b.session()).isGuildMaster) throw new Error('Sign in as Guild Master (🏘️ Community) to use cloud saves.')
  return b
}

const remember = (rev: number) => { set(K.rev, String(rev)); update({ rev }) }

/** Upload the current town. `knownRev` lets "keep this device" retry on top of the newer cloud save. */
async function upload(knownRev: number) {
  const b = await requireGuildMaster()
  saveGame()
  const snap = snapshot()
  const res = await b.cloudSave(snap, summarize(snap.time), deviceName(), knownRev)
  if (res.ok) { remember(res.rev); update({ status: 'idle', other: null, lastSync: Date.now() }) } else update({ status: 'conflict', other: res.current })
}

export const pushNow = () => exclusive(() => upload(cloud.rev))

/** Compare with the cloud: nothing there → upload; same revision → fine; otherwise ask the player. */
async function check() {
  const b = await requireGuildMaster()
  const remote = await b.cloudLoad()
  if (!remote) return upload(0)
  if (remote.rev === cloud.rev) return update({ status: 'idle', lastSync: Date.now() })
  update({ status: 'conflict', other: remote })
}
export const checkNow = () => exclusive(check)

export async function setEnabled(on: boolean) {
  set(K.on, on ? '1' : '0')
  update({ enabled: on, status: on ? 'idle' : 'off', error: null, other: null })
  if (on) await checkNow()
}

/** Conflict answer 1: keep this device's town and replace the cloud save. */
export const keepThisDevice = () => exclusive(async () => {
  if (!cloud.other) return
  await upload(cloud.other.rev)
})

/** Conflict answer 2 (or plain "load"): replace this device's town with the cloud save, then reload the page. */
export const useCloudSave = () => exclusive(async () => {
  const other = cloud.other ?? (await (await requireGuildMaster()).cloudLoad())
  if (!other) throw new Error('There is no cloud save yet.')
  saving.paused = true // the page unloads next; its exit autosave must not overwrite what we write now
  try { localStorage.setItem(KEY, JSON.stringify(other.data)) } catch (e) { saving.paused = false; throw e }
  remember(other.rev)
  location.reload()
})

const SYNC_MS = 120_000
/** Start the background sync: check once on start, then upload every two minutes while playing. */
export function startCloudSync() {
  if (cloud.enabled) void checkNow()
  setInterval(() => {
    if (cloud.enabled && (cloud.status === 'idle' || cloud.status === 'error') && useGame.getState().screen === 'playing') void pushNow()
  }, SYNC_MS)
}
