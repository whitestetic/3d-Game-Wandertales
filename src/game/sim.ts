// Resident life simulation: needs, utility-based activity choice, professions, friendships.
// Pure logic (no React/Three) so it can be tested headless and moved to a Web Worker later.
import { RESIDENTS, type Personality, type Resident } from './residents.mock.ts'
import { NODES, getBuilding } from './map.ts'
import { MAX_LEVEL, PROFESSIONS, onShift, skillSpeed, wagePerHour, xpToNext, type Resource } from './professions.ts'
import { chatLine, hash, placeKind } from './dialogue.ts'
import { BUILDINGS } from './map.ts'
import { cal, exposure, festivalAt, workSpeed } from './calendar.ts'
import { chron } from './chronicle.ts'
import { activeSite, collectRent, isBuilt, levelOf, mealPrice, payWage, rollDay, runRecipe, sellGoods, sellMeal, slotsOf, workOnSite, workersOf } from './town.ts'

export type Activity = 'sleep' | 'eat' | 'work' | 'socialize' | 'shop' | 'relax'
export const ACTIVITIES: Activity[] = ['sleep', 'eat', 'work', 'socialize', 'shop', 'relax']
export type NeedKey = 'hunger' | 'energy' | 'social' | 'health' | 'happiness'
/** All needs are 0–100 where 100 = fully satisfied. */
export type Needs = Record<NeedKey, number>

export interface ResidentSim {
  id: string
  needs: Needs
  wealth: number
  level: number
  xp: number
  activity: Activity
  since: number // game minute the activity started
  nextThink: number
  target: string | null // walk-graph node; null = wander
  // movement state, written by the renderer (or the headless test)
  node: string
  x: number
  z: number
  walking: boolean
  arrived: boolean
  indoors: boolean
  talkingTo: string | null
  talkUntil: number
  lastChat: string | null
  bubble: string | null
  bubbleUntil: number // real ms (performance.now)
  gmFriendship: number
  gmTalkDay: number
  /** paid for the current meal / shopping trip */
  paid: boolean
  /** short-lived happiness bonus from treats (decays) */
  joy: number
  /** last wage could not be paid */
  unpaid: boolean
  workProgress: number
  workStatus: string
  /** skill kept per profession, so switching jobs doesn't erase experience */
  skills: Record<string, { level: number; xp: number }>
  /** away on a guild quest until this game minute (0 = in town) */
  awayUntil: number
}

export const residents: Resident[] = RESIDENTS
export const byId = (id: string) => residents.find((r) => r.id === id)!
export const sim: Record<string, ResidentSim> = {}
/** Friendship 0–100 keyed by sorted pair "a|b". */
export const friendships: Record<string, number> = {}
/** Game minute of the pair's last conversation / greeting. */
const lastTalk: Record<string, number> = {}
const lastGreet: Record<string, number> = {}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
export const friendship = (a: string, b: string) => friendships[pairKey(a, b)] ?? 0
export const addFriendship = (a: string, b: string, d: number) => {
  const k = pairKey(a, b)
  friendships[k] = clamp((friendships[k] ?? 0) + d)
}
export function friendLevel(v: number) {
  return v < 10 ? 'Stranger' : v < 30 ? 'Acquaintance' : v < 60 ? 'Friend' : v < 85 ? 'Good Friend' : 'Best Friend'
}
export function friendsOf(id: string) {
  return residents.filter((r) => r.id !== id).map((r) => ({ id: r.id, value: friendship(id, r.id) }))
    .filter((f) => f.value > 0).sort((a, b) => b.value - a.value)
}

const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v))
const door = (buildingId: string) => getBuilding(buildingId)!.door

function freshSim(r: Resident, node: string): ResidentSim {
  const i = hash(r.id)
  return {
    id: r.id,
    needs: { hunger: 60 + (i % 35), energy: 70 + ((i >>> 6) % 30), social: 50 + ((i >>> 12) % 40), health: 95, happiness: 70 },
    wealth: r.mock ? 20 + ((i >>> 3) % 30) : 25, level: r.mock ? 1 + (i % 3) : 1, xp: 0,
    activity: 'relax', since: 0, nextThink: 0, target: null,
    node, x: NODES[node][0], z: NODES[node][1], walking: false, arrived: false, indoors: false,
    talkingTo: null, talkUntil: 0, lastChat: null, bubble: null, bubbleUntil: 0, gmFriendship: 0, gmTalkDay: 0,
    paid: false, joy: 0, unpaid: false, workProgress: 0, workStatus: '', skills: {}, awayUntil: 0,
  }
}

/** Saved state for residents who are not in town yet (e.g. registered residents loaded before the backend answers). */
export const savedState: Record<string, Partial<ResidentSim>> = {}
export function applySaved(s: ResidentSim, saved: Partial<ResidentSim>) {
  Object.assign(s, saved, { needs: { ...s.needs, ...saved.needs }, skills: saved.skills ?? {}, nextThink: 0, talkingTo: null })
  if (!(s.node in NODES)) s.node = 'sN'
  if (s.target && !(s.target in NODES)) s.target = null
  s.x = NODES[s.node][0]
  s.z = NODES[s.node][1]
}

export function resetSim() {
  for (const k of Object.keys(friendships)) delete friendships[k]
  for (const k of Object.keys(lastTalk)) delete lastTalk[k]
  for (const k of Object.keys(lastGreet)) delete lastGreet[k]
  const ids = Object.keys(NODES)
  for (const r of residents) sim[r.id] = freshSim(r, ids[hash(r.id) % ids.length])
  // housemates and coworkers start out knowing each other
  for (const a of residents) for (const b of residents) {
    if (a.id >= b.id) continue
    if (a.home === b.home) addFriendship(a.id, b.id, 25)
    if (a.work && a.work === b.work) addFriendship(a.id, b.id, 15)
  }
}
resetSim()

/** A resident moves into town (at their home's door). */
export function addToTown(r: Resident) {
  if (residents.some((x) => x.id === r.id)) return
  residents.push(r)
  const s = freshSim(r, door(r.home))
  if (savedState[r.id]) { applySaved(s, savedState[r.id]); delete savedState[r.id] }
  sim[r.id] = s
  for (const o of residents) if (o.id !== r.id && o.home === r.home && !friendships[pairKey(o.id, r.id)]) addFriendship(o.id, r.id, 15)
}

/** A resident leaves town (removed, consent withdrawn, or placeholders turned off). */
export function removeFromTown(id: string, forget = true) {
  const i = residents.findIndex((r) => r.id === id)
  if (i < 0) return
  residents.splice(i, 1)
  if (!forget) savedState[id] = { ...sim[id], talkingTo: null } // temporarily away: keep needs, skills, friendships
  delete sim[id]
  if (forget) for (const k of Object.keys(friendships)) if (k.split('|').includes(id)) delete friendships[k]
  for (const s of Object.values(sim)) if (s.talkingTo === id) s.talkingTo = null
}

// ---------- utility AI ----------

const P = (res: Resident, ...ps: Personality[]) => (ps.includes(res.personality) ? 1 : 0)
const MEAL_HOURS = [7, 12.5, 19]

/** A building of this kind that is built and has a worker on duty right now (tavern/market open). */
export function openBuilding(kind: 'tavern' | 'market'): string | null {
  for (const b of BUILDINGS) {
    if (b.kind !== kind || !isBuilt(b.id)) continue
    if (workersOf(b.id).some((r) => sim[r.id].activity === 'work' && sim[r.id].arrived)) return b.id
  }
  return null
}
const SHOP_WANTS: Partial<Record<Personality, Resource[]>> = {
  Adventurous: ['weapons', 'potion', 'fish'], Greedy: ['furniture', 'weapons'], Kind: ['bread', 'potion', 'vegetables'],
  Cheerful: ['bread', 'furniture', 'potion'], Lazy: ['furniture', 'bread'],
}
const wants = (res: Resident): Resource[] => [...(SHOP_WANTS[res.personality] ?? []), 'bread', 'vegetables', 'fish', 'furniture', 'potion']

export function scores(res: Resident, s: ResidentSim, hour: number): Record<Activity, number> {
  const n = s.needs
  const night = hour >= 22 || hour < 5.5
  const shift = !!res.work && isBuilt(res.work) && onShift(res.profession, hour)
  const mealTime = MEAL_HOURS.some((m) => Math.abs(hour - m) < 1)
  return {
    sleep: (night ? 0.75 : 0) + Math.pow(1 - n.energy / 100, 1.4) * (night ? 1 : 0.9) + P(res, 'Lazy') * 0.08,
    eat: Math.pow(1 - n.hunger / 100, 1.3) * 1.3 + (mealTime && n.hunger < 80 ? 0.25 : 0),
    work: shift ? 1.05 + P(res, 'Hardworking') * 0.15 - P(res, 'Lazy') * 0.12 - (n.energy < 15 ? 0.6 : 0) - (n.hunger < 15 ? 0.5 : 0) : 0,
    socialize: (1 - n.social / 100) * 0.95 + P(res, 'Social', 'Cheerful') * 0.15 - P(res, 'Shy') * 0.2 + (hour >= 17 && hour < 22 ? 0.15 : 0) + (cal.festival ? 0.6 : 0),
    shop: s.wealth > 20 && openBuilding('market') ? 0.3 + Math.min(0.35, s.wealth / 200) + P(res, 'Greedy') * 0.08 : 0,
    relax: 0.32 + P(res, 'Lazy', 'Adventurous') * 0.06,
  }
}

function isDone(res: Resident, s: ResidentSim, hour: number, t: number): boolean {
  const n = s.needs, elapsed = t - s.since
  switch (s.activity) {
    case 'sleep': return n.energy >= 98 || (n.energy >= 65 && hour >= 6 && hour < 21)
    case 'eat': return n.hunger >= 96
    case 'work': return !res.work || !onShift(res.profession, hour) || n.energy < 8 || n.hunger < 8
    case 'socialize': return (n.social >= 92 && !s.talkingTo) || elapsed > 150
    case 'shop': return elapsed > 45 && s.arrived
    case 'relax': return elapsed > 60
  }
}

function targetFor(res: Resident, s: ResidentSim, a: Activity, t: number): string | null {
  switch (a) {
    case 'sleep': return door(res.home)
    case 'eat': {
      const tavern = openBuilding('tavern'), p = mealPrice()
      return tavern && p !== null && s.wealth >= p ? door(tavern) : door(res.home)
    }
    case 'work': return workTarget(res)
    case 'shop': { const m = openBuilding('market'); return m ? door(m) : null }
    case 'relax': return null
    case 'socialize': {
      // prefer meeting the closest friend who is out and about
      const best = friendsOf(res.id).find((f) => f.value >= 30 && !sim[f.id].indoors && OPEN.includes(sim[f.id].activity))
      if (best && hash(res.id, Math.floor(t / 60)) % 2 === 0) return sim[best.id].node
      const spots = ['sN', 'sE', 'sS', 'sW', 'sNE', 'sSW', 'tavern']
      return spots[hash(res.id, t) % spots.length]
    }
  }
}

/** Builders go to the oldest construction site; everyone else to their workplace. */
function workTarget(res: Resident) {
  if (!res.work) return null
  if (res.profession === 'Builder') { const site = activeSite(); if (site) return door(site) }
  return door(res.work)
}

function choose(res: Resident, s: ResidentSim, a: Activity, t: number) {
  if (s.activity !== a) { s.activity = a; s.since = t; s.arrived = false; s.paid = false }
  s.target = targetFor(res, s, a, t)
}

/** Decide what to do. Commits to an activity, switching only when done, urgent, or clearly better. */
export function think(res: Resident, s: ResidentSim, hour: number, t: number) {
  if (s.target && !(s.target in NODES)) s.nextThink = 0 // destination was demolished
  if (s.activity === 'work' && res.profession === 'Builder' && !s.talkingTo) {
    const site = workTarget(res)
    if (site !== s.target) { s.target = site; s.arrived = false }
  }
  if (t < s.nextThink || s.talkingTo) return
  s.nextThink = t + 10
  const sc = scores(res, s, hour)
  const best = ACTIVITIES.reduce((a, b) => (sc[b] > sc[a] ? b : a))
  if (s.needs.hunger < 10 && s.activity !== 'eat') return choose(res, s, 'eat', t)
  if (s.needs.energy < 8 && s.activity !== 'sleep') return choose(res, s, 'sleep', t)
  const committed = t - s.since < 30
  const finishFirst = s.activity === 'eat' || s.activity === 'sleep' // don't walk away from a half-eaten meal
  if (isDone(res, s, hour, t) || (!committed && !finishFirst && sc[best] > sc[s.activity] + 0.2)) choose(res, s, best, t)
}

// ---------- needs & effects ----------

const PER_H = (v: number, dtMin: number) => (v * dtMin) / 60

export function stepNeeds(res: Resident, s: ResidentSim, dtMin: number, t = 0) {
  const n = s.needs, here = s.arrived
  const a = s.activity
  const asleep = a === 'sleep' && here
  n.hunger -= PER_H(asleep ? 3 : 7, dtMin)
  n.energy -= PER_H(asleep ? 0 : a === 'work' && here ? 8 : 5, dtMin)
  n.social -= PER_H(asleep ? 1 : res.personality === 'Social' ? 6 : res.personality === 'Shy' ? 2.5 : 4, dtMin)

  if (here) {
    if (a === 'sleep') n.energy += PER_H(15, dtMin)
    if (a === 'eat') {
      const atTavern = atKind(s, 'tavern')
      if (atTavern && !s.paid) {
        s.paid = true
        if (!sellMeal(res.name, s, t)) { s.target = door(res.home); s.arrived = false } // sold out: eat at home
      }
      n.hunger += PER_H(atTavern ? 100 : 60, dtMin) // home meals are simpler
      if (atTavern) s.joy = Math.min(20, s.joy + PER_H(10, dtMin))
    }
    if (a === 'work' && res.work) {
      const prof = PROFESSIONS[res.profession]
      const wage = PER_H(wagePerHour(res.profession, s.level), dtMin)
      if (payWage(wage, t)) { s.wealth += wage; s.unpaid = false } else s.unpaid = true
      if (res.profession === 'Builder') {
        const site = s.target ? BUILDINGS.find((b) => b.door === s.target && b.id !== res.work) : null
        s.workStatus = site ? `Building ${site.name}` : 'No construction to work on'
        if (site && workOnSite(site.id, dtMin * skillSpeed(s.level), t)) s.nextThink = 0
      } else if (prof?.recipe) {
        s.workProgress += dtMin * skillSpeed(s.level) * (1 + 0.25 * (levelOf(res.work) - 1)) * workSpeed(BUILDINGS.find((b) => b.id === res.work)?.kind, t)
        if (s.workProgress >= prof.recipe.minutes) {
          s.workStatus = runRecipe(prof.recipe.input, prof.recipe.output)
          s.workProgress = s.workStatus === 'Producing' ? s.workProgress - prof.recipe.minutes : prof.recipe.minutes
        } else if (!s.workStatus) s.workStatus = 'Producing'
      } else {
        s.workStatus = 'Serving customers'
        n.social += PER_H(15, dtMin) // service jobs are sociable
      }
      if (s.level < MAX_LEVEL) {
        s.xp += PER_H(20 * (res.personality === 'Hardworking' ? 1.4 : res.personality === 'Lazy' ? 0.7 : 1), dtMin)
        if (s.xp >= xpToNext(s.level)) { s.xp -= xpToNext(s.level); s.level++; if (s.level >= 3) chron(t, 'people', '⭐', `${res.name} reached level ${s.level} as ${res.profession}.`); s.bubble = '⭐'; s.bubbleUntil = now() + 3000 }
      }
    }
    if (a === 'socialize') n.social += PER_H(20, dtMin) // company of the crowd
    if (festivalAt(t) && (a === 'socialize' || a === 'relax')) { n.social += PER_H(25, dtMin); s.joy = Math.min(20, s.joy + PER_H(20, dtMin)) } // festival fun
    if (a === 'shop') {
      if (!s.paid && atKind(s, 'market')) {
        s.paid = true
        const item = sellGoods(res.name, wants(res), s, t)
        if (item) { s.joy = Math.min(20, s.joy + 15); s.bubble = '🛍️'; s.bubbleUntil = now() + 2500 }
      }
      n.social += PER_H(5, dtMin)
    }
    if (a === 'relax') { n.energy += PER_H(2, dtMin); n.social += PER_H(2, dtMin) }
  }
  if (s.talkingTo) n.social += PER_H(45, dtMin)

  n.health += PER_H(n.hunger < 10 || n.energy < 10 ? -6 : 2, dtMin)
  s.joy = Math.max(0, s.joy - PER_H(4, dtMin))
  const bias = (res.personality === 'Cheerful' ? 10 : res.personality === 'Greedy' ? (s.wealth > 50 ? 5 : -8) : 0) + s.joy - (s.unpaid ? 12 : 0) - (s.indoors ? 0 : exposure(t))
  const mood = clamp(0.3 * n.hunger + 0.25 * n.energy + 0.25 * n.social + 0.2 * n.health + bias)
  n.happiness += (mood - n.happiness) * Math.min(1, dtMin / 60)

  for (const k of Object.keys(n) as NeedKey[]) n[k] = clamp(n[k])
  s.wealth = Math.max(0, s.wealth)
}

// ---------- social ----------

const atKind = (s: ResidentSim, kind: string) => s.arrived && !!s.target && BUILDINGS.some((b) => b.kind === kind && b.door === s.target)

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const OPEN: Activity[] = ['socialize', 'eat', 'relax', 'shop']

export function compatibility(a: Resident, b: Resident) {
  let c = 1
  if (a.personality === b.personality) c *= 1.3
  if (a.personality === 'Social' || b.personality === 'Social') c *= 1.2
  if (a.personality === 'Shy' || b.personality === 'Shy') c *= 0.75
  const pair = [a.personality, b.personality]
  if (pair.includes('Greedy') && pair.includes('Kind')) c *= 0.6
  if (pair.includes('Hardworking') && pair.includes('Lazy')) c *= 0.7
  return c
}

/** Proximity-based conversations and greetings. Call a few times per second. */
export function socialPass(t: number) {
  for (let i = 0; i < residents.length; i++) for (let j = i + 1; j < residents.length; j++) {
    const ra = residents[i], rb = residents[j], a = sim[ra.id], b = sim[rb.id]
    if (a.indoors || b.indoors) continue
    const d = Math.hypot(a.x - b.x, a.z - b.z)
    const k = pairKey(ra.id, rb.id)
    // start a conversation: both standing still, both free, and one of them wants company
    if (d < 3 && !a.walking && !b.walking && !a.talkingTo && !b.talkingTo && OPEN.includes(a.activity) && OPEN.includes(b.activity)
      && (a.activity === 'socialize' || b.activity === 'socialize' || a.activity === b.activity)
      && t - (lastTalk[k] ?? -1e9) > 120) {
      lastTalk[k] = t
      const until = t + 20 + (hash(k, t) % 20)
      const level = friendLevel(friendship(ra.id, rb.id))
      const place = placeKind(a.node)
      a.talkingTo = rb.id; b.talkingTo = ra.id
      a.talkUntil = b.talkUntil = until
      a.lastChat = `To ${rb.name}: “${chatLine(ra, rb, level, place, t)}”`
      b.lastChat = `To ${ra.name}: “${chatLine(rb, ra, level, place, t + 1)}”`
      continue
    }
    // passing greeting between people who know each other
    if (d < 2.2 && (a.walking || b.walking) && friendship(ra.id, rb.id) >= 10 && t - (lastGreet[k] ?? -1e9) > 90) {
      lastGreet[k] = t
      addFriendship(ra.id, rb.id, 1)
      a.bubble = b.bubble = '👋'
      a.bubbleUntil = b.bubbleUntil = now() + 2500
    }
  }
}

/** Advance every resident by dtMin game minutes. */
export function tickSim(dtMin: number, t: number) {
  if (rollDay(t)) for (const r of residents) collectRent(r.name, sim[r.id], t)
  const hour = (t % 1440) / 60
  for (const r of residents) {
    const s = sim[r.id]
    if (s.awayUntil) {
      if (s.awayUntil > t) { s.indoors = true; s.talkingTo = null; continue } // adventuring: out of town, needs paused
      // back from a quest: walk home from the Guild HQ
      s.awayUntil = 0
      s.node = 'guild'; s.x = NODES.guild[0]; s.z = NODES.guild[1]
      s.target = null; s.arrived = false; s.indoors = false; s.nextThink = 0
    }
    if (s.talkingTo) {
      const other = residents.find((o) => o.id === s.talkingTo)!
      addFriendship(r.id, other.id, PER_H(5 * compatibility(r, other), dtMin)) // both sides add → 10/h
      if (t >= s.talkUntil) s.talkingTo = null
    }
    think(r, s, hour, t)
    stepNeeds(r, s, dtMin, t)
    s.indoors = s.arrived && (s.activity === 'sleep' || (s.activity === 'eat' && !atKind(s, 'tavern')))
  }
}

export const ACTIVITY_LABEL: Record<Activity, [string, string]> = {
  sleep: ['Sleeping', 'Heading home'],
  eat: ['Eating', 'Going to eat'],
  work: ['Working', 'Walking to work'],
  socialize: ['Socializing', 'Going to meet people'],
  shop: ['Shopping', 'Going to the market'],
  relax: ['Strolling', 'Strolling'],
}
export function activityLabel(s: ResidentSim) {
  if (s.talkingTo) return `Chatting with ${byId(s.talkingTo).name.split(' ')[0]}`
  const [at, going] = ACTIVITY_LABEL[s.activity]
  return s.target && !s.arrived ? going : at
}
export const moodEmoji = (h: number) => (h >= 75 ? '😄' : h >= 55 ? '🙂' : h >= 35 ? '😐' : '😟')

/** Guild Master talks to a resident: small social + friendship boost, once per game day. */
export function talkWithGM(id: string, day: number) {
  const s = sim[id]
  if (s.gmTalkDay === day) return
  s.gmTalkDay = day
  s.gmFriendship = clamp(s.gmFriendship + 5)
  s.needs.social = clamp(s.needs.social + 15)
}

// ---------- worker assignment ----------

/** Put a resident to work at a building in a given profession. Returns an error or null. */
export function assignWorker(resId: string, buildingId: string, profession: string): string | null {
  const res = byId(resId), b = BUILDINGS.find((x) => x.id === buildingId)
  if (!b || !isBuilt(buildingId)) return 'Building is not finished yet'
  if (PROFESSIONS[profession]?.workplace !== b.kind) return `A ${profession} can't work here`
  if (res.work !== buildingId && workersOf(buildingId).length >= slotsOf(buildingId)) return 'No free worker slots, upgrade the building'
  setJob(res, buildingId, profession)
  return null
}
export const unassignWorker = (resId: string) => setJob(byId(resId), null, 'Unemployed')

function setJob(res: Resident, work: string | null, profession: string) {
  const s = sim[res.id]
  s.skills[res.profession] = { level: s.level, xp: s.xp }
  const next = s.skills[profession] ?? { level: 1, xp: 0 }
  res.work = work
  res.profession = profession
  s.level = next.level
  s.xp = next.xp
  s.workProgress = 0
  s.workStatus = ''
  s.nextThink = 0
  if (s.activity === 'work') s.since = -1e9 // re-decide right away
}
