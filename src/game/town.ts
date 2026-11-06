// Town management: building types, construction & upgrades, storage, prices, trade and the ledger.
// Pure logic (no React/Three). Gold and goods only move through the functions below.
// shortcut: all rules run in the browser for now; Phase 4 moves gold/stock validation server-side.
import { BUILDINGS, EDGES, NODES, RIVER_X, SOLIDS, WORLD_HALF, addBuilding, buildingBox, getBuilding, removeBuilding, type BuildingDef, type BuildingKind } from './map.ts'
import { RESOURCES, type Bundle, type Resource } from './professions.ts'
import { LAMP_BOXES, TREES, distToSegment } from './scenery.ts'
import { circleHitsBox, type Box } from './collision.ts'
import { RESIDENTS } from './residents.mock.ts'
import { chron } from './chronicle.ts'

export interface BuildingType {
  name: string
  w: number
  d: number
  cost: Bundle
  gold: number
  /** builder-minutes to construct at skill level 1 */
  minutes: number
  /** worker slots at level 1; +1 per extra level */
  slots: number
  beds?: number
  buildable: boolean
  maxLevel: number
  description: string
}

const T = (name: string, w: number, d: number, cost: Bundle, gold: number, minutes: number, slots: number, buildable: boolean, description: string, extra: Partial<BuildingType> = {}): BuildingType =>
  ({ name, w, d, cost, gold, minutes, slots, buildable, maxLevel: 3, description, ...extra })

export const TYPES: Record<BuildingKind, BuildingType> = {
  square: T('Town Square', 4, 4, {}, 0, 0, 0, false, 'The heart of town.', { maxLevel: 1 }),
  guild: T('Guild Headquarters', 12, 10, { wood: 40, stone: 60 }, 200, 300, 2, false, 'Each level adds +100 storage per resource.'),
  tavern: T('Tavern', 9, 8, { wood: 40, stone: 20 }, 120, 240, 2, true, 'Serves meals from stored Bread, Fish or Vegetables while staffed.'),
  bakery: T('Bakery', 7, 7, { wood: 30, stone: 20 }, 80, 200, 2, true, 'Bakers turn Wheat into Bread.'),
  blacksmith: T('Smithy', 8, 7, { wood: 25, stone: 30, iron: 5 }, 100, 240, 1, true, 'Blacksmiths forge Weapons from Iron and Wood.'),
  market: T('Market', 10, 8, { wood: 40 }, 100, 200, 2, true, 'Residents buy goods here while it is staffed.'),
  farm: T('Farm', 14, 10, { wood: 25 }, 40, 150, 3, true, 'Farmers grow Wheat and Vegetables; Herbalists grow Herbs.'),
  house: T('Cottage', 6, 6, { wood: 30, stone: 15 }, 50, 180, 0, true, 'Homes for residents. +1 bed per level.', { beds: 3 }),
  construction: T("Builders' Yard", 8, 8, { wood: 30 }, 60, 150, 2, false, 'Builders work every construction and upgrade.'),
  dock: T('Fishing Dock', 6, 4, { wood: 20 }, 40, 120, 1, false, 'Fishermen catch Fish.'),
  lumber: T('Lumber Camp', 7, 6, { wood: 10, stone: 5 }, 40, 120, 2, true, 'Woodcutters produce Wood.'),
  quarry: T('Stone Quarry', 8, 7, { wood: 20 }, 50, 150, 2, true, 'Stonecutters produce Stone.'),
  mine: T('Iron Mine', 7, 7, { wood: 30, stone: 10 }, 80, 200, 2, true, 'Miners dig Iron.'),
  workshop: T("Carpenter's Workshop", 7, 7, { wood: 30, stone: 15 }, 70, 180, 1, true, 'Carpenters turn Wood into Furniture.'),
  alchemist: T("Alchemist's Lab", 6, 6, { wood: 20, stone: 25 }, 120, 220, 1, true, 'Alchemists brew Potions from Herbs.'),
}

export const BASE_PRICE: Record<Resource, number> = {
  wood: 2, stone: 3, iron: 8, wheat: 2, vegetables: 3, bread: 5, fish: 4, herbs: 4, potion: 18, furniture: 22, weapons: 25,
}
export const RESOURCE_ICON: Record<Resource, string> = {
  wood: '🪵', stone: '🪨', iron: '⛓️', wheat: '🌾', vegetables: '🥕', bread: '🍞', fish: '🐟', herbs: '🌿', potion: '🧪', furniture: '🪑', weapons: '⚔️',
}
export const FOODS: Resource[] = ['bread', 'fish', 'vegetables']

export type TxKind = 'wages' | 'rent' | 'meals' | 'shop' | 'sell' | 'buy' | 'build' | 'quest'
export interface Tx { t: number; kind: TxKind; gold: number; note: string }
export interface DaySummary { day: number; income: number; expense: number; byKind: Partial<Record<TxKind, number>>; produced: Bundle }
export interface Job { type: 'build' | 'upgrade'; progress: number; needed: number }
export interface BState { level: number; job: Job | null }
/** A building the player placed: enough to rebuild it exactly on load. */
export interface Placed { id: string; kind: BuildingKind; name: string; x: number; z: number; rot: number; door: [number, number]; connect: string }

const START_STOCK: Record<Resource, number> = { wood: 80, stone: 60, iron: 12, wheat: 20, vegetables: 10, bread: 10, fish: 6, herbs: 0, potion: 0, furniture: 0, weapons: 0 }
const newDay = (day: number): DaySummary => ({ day, income: 0, expense: 0, byKind: {}, produced: {} })

export const town = {
  gold: 500,
  stock: { ...START_STOCK },
  b: {} as Record<string, BState>,
  ledger: [] as Tx[],
  days: [] as DaySummary[],
  today: newDay(1),
  cleared: new Set<number>(),
  placed: [] as Placed[],
  counter: 0,
  version: 0,
}

// ---------- change notification (UI subscribes; keeps this module React-free) ----------
const listeners = new Set<() => void>()
export const onTownChange = (f: () => void) => { listeners.add(f); return () => listeners.delete(f) }
export function changed() { town.version++; listeners.forEach((f) => f()) }

export function resetTown() {
  for (const p of [...town.placed]) removeBuilding(p.id)
  Object.assign(town, { gold: 500, stock: { ...START_STOCK }, b: {}, ledger: [], days: [], today: newDay(1), cleared: new Set(), placed: [], counter: 0 })
  for (const b of BUILDINGS) town.b[b.id] = { level: 1, job: null }
  for (const r of RESIDENTS) { r.work = r.originalWork; r.profession = r.originalProfession }
  pending.jobs = {}
  pending.homes = {}
  changed()
}
for (const b of BUILDINGS) town.b[b.id] = { level: 1, job: null }

// ---------- queries ----------
export const typeOf = (id: string) => TYPES[getBuilding(id)!.kind]
export const levelOf = (id: string) => town.b[id]?.level ?? 1
export const isBuilt = (id: string) => (town.b[id]?.level ?? 1) > 0
export const slotsOf = (id: string) => (isBuilt(id) ? typeOf(id).slots + (levelOf(id) - 1) : 0)
export const workersOf = (id: string) => RESIDENTS.filter((r) => r.work === id)
export const storageCap = () => 200 + 100 * (levelOf('guild') - 1)
export const beds = () => BUILDINGS.filter((b) => b.kind === 'house' && isBuilt(b.id)).reduce((a, b) => a + (TYPES.house.beds ?? 0) + levelOf(b.id) - 1, 0)

/** Supply & demand: scarce goods cost more, plentiful goods less (0.6×–1.8× base). */
export function price(r: Resource) {
  const target = 30
  return Math.max(1, Math.round(BASE_PRICE[r] * Math.max(0.6, Math.min(1.8, 1 + ((target - town.stock[r]) / target) * 0.6))))
}

const scale = (b: Bundle, f: number): Bundle => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.ceil((v ?? 0) * f)]))
export const upgradeCost = (kind: BuildingKind, level: number) => ({ cost: scale(TYPES[kind].cost, 0.6 * level), gold: Math.ceil(TYPES[kind].gold * 0.6 * level) })
export const hasGoods = (b: Bundle) => Object.entries(b).every(([k, v]) => town.stock[k as Resource] >= (v ?? 0))
export const canAfford = (b: Bundle, gold: number) => town.gold >= gold && hasGoods(b)
export const missing = (b: Bundle, gold: number) => [
  ...(town.gold < gold ? [`${gold - town.gold} gold`] : []),
  ...Object.entries(b).filter(([k, v]) => town.stock[k as Resource] < (v ?? 0)).map(([k, v]) => `${(v ?? 0) - town.stock[k as Resource]} ${k}`),
]

// ---------- ledger ----------
export function record(kind: TxKind, gold: number, note: string, t: number, log = true) {
  if (gold >= 0) town.today.income += gold
  else town.today.expense -= gold
  town.today.byKind[kind] = (town.today.byKind[kind] ?? 0) + gold
  if (log) {
    town.ledger.unshift({ t, kind, gold, note })
    if (town.ledger.length > 80) town.ledger.length = 80
  }
}

/** Close the books when a new game day starts. */
export function rollDay(t: number) {
  const day = Math.floor(t / 1440) + 1
  if (day <= town.today.day) return false
  const w = town.today.byKind.wages
  if (w) town.ledger.unshift({ t, kind: 'wages', gold: w, note: `Wages for day ${town.today.day}` })
  town.days.unshift(town.today)
  if (town.days.length > 14) town.days.length = 14
  town.today = newDay(day)
  return true
}

export const RENT = 4
/** Daily rent from each resident (whatever they can afford). */
export function collectRent(name: string, wallet: { wealth: number }, t: number) {
  const paid = Math.min(RENT, wallet.wealth)
  if (paid <= 0) return
  wallet.wealth -= paid
  town.gold += paid
  record('rent', paid, '', t, false)
  void name
}

function addStock(b: Bundle, sign: 1 | -1) {
  for (const [k, v] of Object.entries(b)) town.stock[k as Resource] = Math.max(0, town.stock[k as Resource] + sign * (v ?? 0))
}

// ---------- production / services (called by the life sim) ----------

/** Try one production cycle. Returns a status string for the UI. */
export function runRecipe(input: Bundle, output: Bundle): string {
  const lacking = Object.entries(input).find(([k, v]) => town.stock[k as Resource] < (v ?? 0))
  if (lacking) return `Waiting for ${lacking[0]}`
  const cap = storageCap()
  const full = Object.entries(output).find(([k]) => town.stock[k as Resource] >= cap)
  if (full) return `Storage full (${full[0]})`
  addStock(input, -1)
  for (const [k, v] of Object.entries(output)) {
    town.stock[k as Resource] = Math.min(cap, town.stock[k as Resource] + (v ?? 0))
    town.today.produced[k as Resource] = (town.today.produced[k as Resource] ?? 0) + (v ?? 0)
  }
  return 'Producing'
}

/** Treasury pays a wage. Returns false if the treasury is empty. */
export function payWage(amount: number, t: number) {
  if (town.gold < amount) return false
  town.gold -= amount
  record('wages', -amount, '', t, false)
  return true
}

export const mealPrice = () => {
  const food = FOODS.find((f) => town.stock[f] >= 1)
  return food ? price(food) + 2 : null
}
/** Resident buys a meal at the tavern. Returns the food eaten, or null. */
export function sellMeal(name: string, wallet: { wealth: number }, t: number): Resource | null {
  const food = FOODS.find((f) => town.stock[f] >= 1)
  if (!food) return null
  const p = price(food) + 2
  if (wallet.wealth < p) return null
  town.stock[food]--
  wallet.wealth -= p
  town.gold += p
  record('meals', p, `${name} ate ${food} at the tavern`, t)
  return food
}

/** Resident buys one item they like at the market. */
export function sellGoods(name: string, wants: Resource[], wallet: { wealth: number }, t: number): Resource | null {
  for (const item of wants) {
    const p = price(item)
    if (town.stock[item] >= 1 && wallet.wealth >= p) {
      town.stock[item]--
      wallet.wealth -= p
      town.gold += p
      record('shop', p, `${name} bought ${item}`, t)
      return item
    }
  }
  return null
}

// ---------- trade with the travelling merchant ----------
export const sellQuote = (r: Resource, qty: number) => Math.floor(price(r) * 0.8 * qty)
export const buyQuote = (r: Resource, qty: number) => Math.ceil(price(r) * 1.3 * qty)

export function sellToMerchant(r: Resource, qty: number, t: number) {
  if (qty <= 0 || town.stock[r] < qty) return false
  const g = sellQuote(r, qty)
  town.stock[r] -= qty
  town.gold += g
  record('sell', g, `Sold ${qty} ${r} to the merchant`, t)
  changed()
  return true
}
export function buyFromMerchant(r: Resource, qty: number, t: number) {
  const g = buyQuote(r, qty)
  if (qty <= 0 || town.gold < g || town.stock[r] + qty > storageCap()) return false
  town.gold -= g
  town.stock[r] += qty
  record('buy', -g, `Bought ${qty} ${r} from the merchant`, t)
  changed()
  return true
}

// ---------- construction ----------

export const footprint = (kind: BuildingKind, rot: number) => {
  const sideways = Math.abs(Math.sin(rot)) > 0.5
  const { w, d } = TYPES[kind]
  return sideways ? { w: d, d: w } : { w, d }
}

export interface PlacementCheck { ok: boolean; reason: string; door: [number, number]; connect: string; trees: number[] }

const segmentClear = (a: [number, number], b: [number, number], r: number, boxes: Box[]) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(len / 0.5))
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n
    if (boxes.some((bx) => circleHitsBox(x, z, r, bx))) return false
  }
  return true
}

export function checkPlacement(kind: BuildingKind, x: number, z: number, rot: number): PlacementCheck {
  const { w, d } = footprint(kind, rot)
  const box: Box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }
  const depth = Math.abs(Math.sin(rot)) > 0.5 ? w : d
  const door: [number, number] = [x + Math.sin(rot) * (depth / 2 + 2), z + Math.cos(rot) * (depth / 2 + 2)]
  const fail = (reason: string): PlacementCheck => ({ ok: false, reason, door, connect: '', trees: [] })

  const lim = WORLD_HALF - 3
  if (box.minX < -lim || box.maxX > lim || box.minZ < -lim || box.maxZ > lim || Math.abs(door[0]) > lim || Math.abs(door[1]) > lim) return fail('Too close to the edge of the map')
  if (box.maxX > RIVER_X - 7 && box.minX < RIVER_X + 7) return fail('Too close to the river')
  if (circleHitsBox(0, 0, 11, box)) return fail('Keep the Town Square open')
  if (BUILDINGS.some((b) => b.kind !== 'square' && rectsOverlap(box, buildingBox(b, 1.5)))) return fail('Overlaps another building')
  if (EDGES.some(([a, b]) => !segmentClear(NODES[a], NODES[b], 1.5, [box]))) return fail('Blocks a road')
  if (LAMP_BOXES.some((l) => rectsOverlap(box, l))) return fail('Blocks a street lamp')

  // door must reach the road network along a clear line
  const solids = [...SOLIDS, box]
  if (solids.some((s) => circleHitsBox(door[0], door[1], 1.1, s))) return fail('The door is blocked')
  const candidates = Object.entries(NODES).map(([id, p]) => ({ id, p, dist: Math.hypot(p[0] - door[0], p[1] - door[1]) }))
    .filter((c) => c.dist < 30).sort((a, b) => a.dist - b.dist)
  const lampBoxes = LAMP_BOXES.map((l) => ({ minX: l.minX - 0.6, maxX: l.maxX + 0.6, minZ: l.minZ - 0.6, maxZ: l.maxZ + 0.6 }))
  const connect = candidates.find((c) => segmentClear(door, c.p, 1.1, [...solids, ...lampBoxes]))
  if (!connect) return fail('No road access (move closer to a road)')

  // trees on the plot or the new road get cut down
  const trees = TREES.map((t, i) => ({ t, i })).filter(({ t, i }) => !town.cleared.has(i) &&
    (circleHitsBox(t.x, t.z, 1, box) || distToSegment(t.x, t.z, door, connect.p) < 1.8 || Math.hypot(t.x - door[0], t.z - door[1]) < 1.8)).map(({ i }) => i)
  return { ok: true, reason: trees.length ? `Clears ${trees.length} tree${trees.length > 1 ? 's' : ''} (+${trees.length * 2} wood)` : '', door, connect: connect.id, trees }
}

const rectsOverlap = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

function spend(cost: Bundle, gold: number, note: string, t: number) {
  addStock(cost, -1)
  town.gold -= gold
  if (gold) record('build', -gold, note, t)
}

/** Place a new building site. Returns the new id, or an error message. */
export function placeBuilding(kind: BuildingKind, x: number, z: number, rot: number, t: number): { id?: string; error?: string } {
  const type = TYPES[kind]
  if (!type.buildable) return { error: 'This building cannot be built' }
  const check = checkPlacement(kind, x, z, rot)
  if (!check.ok) return { error: check.reason }
  if (!canAfford(type.cost, type.gold)) return { error: `Need ${missing(type.cost, type.gold).join(', ')}` }
  spend(type.cost, type.gold, `Started building a ${type.name}`, t)
  for (const i of check.trees) town.cleared.add(i)
  town.stock.wood = Math.min(storageCap(), town.stock.wood + check.trees.length * 2)
  const id = `b${++town.counter}`
  const same = BUILDINGS.filter((b) => b.kind === kind).length
  const p: Placed = { id, kind, name: `${type.name}${same ? ` ${same + 1}` : ''}`, x, z, rot, door: check.door, connect: check.connect }
  addPlaced(p)
  town.b[id] = { level: 0, job: { type: 'build', progress: 0, needed: type.minutes } }
  changed()
  return { id }
}

function addPlaced(p: Placed) {
  const { w, d } = footprint(p.kind, p.rot)
  const def: BuildingDef = { id: p.id, kind: p.kind, name: p.name, x: p.x, z: p.z, w, d, rot: p.rot, door: `d_${p.id}`, description: TYPES[p.kind].description }
  addBuilding(def, p.door, p.connect)
  town.placed.push(p)
}

export function startUpgrade(id: string, t: number): string | null {
  const st = town.b[id], kind = getBuilding(id)!.kind, type = TYPES[kind]
  if (!st || st.job || st.level >= type.maxLevel) return 'Cannot upgrade now'
  const { cost, gold } = upgradeCost(kind, st.level)
  if (!canAfford(cost, gold)) return `Need ${missing(cost, gold).join(', ')}`
  spend(cost, gold, `Started upgrading ${getBuilding(id)!.name} to level ${st.level + 1}`, t)
  st.job = { type: 'upgrade', progress: 0, needed: Math.ceil(type.minutes * 0.6 * st.level) }
  changed()
  return null
}

/** Cancel a construction or upgrade. Full refund if no work was done yet, otherwise half. */
export function cancelJob(id: string, t: number) {
  const st = town.b[id], b = getBuilding(id)
  if (!st?.job || !b) return
  const type = TYPES[b.kind]
  const paid = st.job.type === 'build' ? { cost: type.cost, gold: type.gold } : upgradeCost(b.kind, st.level)
  const f = st.job.progress > 0 ? 0.5 : 1
  addStock(scale(paid.cost, f), 1)
  for (const k of RESOURCES) town.stock[k] = Math.min(storageCap(), town.stock[k])
  const refund = Math.floor(paid.gold * f)
  town.gold += refund
  if (refund) record('build', refund, `Cancelled ${st.job.type} of ${b.name} (refund)`, t)
  if (st.job.type === 'build') {
    removeBuilding(id)
    town.placed = town.placed.filter((p) => p.id !== id)
    delete town.b[id]
  } else st.job = null
  changed()
}

/** Finished, player-built, no job in progress. Just the building itself — residents who worked or
 * lived there are the caller's job (demolishBuilding in community.ts, which can reach sim.ts). No refund. */
export function teardownBuilding(id: string, t: number): string | null {
  const st = town.b[id], b = getBuilding(id)
  if (!b || !st || st.job || st.level < 1) return 'Cannot demolish now'
  if (!town.placed.some((p) => p.id === id)) return 'This building cannot be demolished'
  removeBuilding(id)
  town.placed = town.placed.filter((p) => p.id !== id)
  delete town.b[id]
  chron(t, 'build', '🧱', `${b.name} was demolished.`)
  changed()
  return null
}

/** The construction builders should work on: oldest pending job. */
export function activeSite(): string | null {
  for (const b of BUILDINGS) if (town.b[b.id]?.job) return b.id
  return null
}

/** Builder-minutes of work on a job. Returns true when the job finished. */
export function workOnSite(id: string, minutes: number, t: number) {
  const st = town.b[id]
  if (!st?.job) return false
  st.job.progress += minutes
  if (st.job.progress < st.job.needed) return false
  const name = getBuilding(id)!.name
  if (st.job.type === 'build') st.level = 1
  else st.level++
  st.job = null
  const note = st.level === 1 ? `${name} finished!` : `${name} upgraded to level ${st.level}`
  record('build', 0, note, t)
  chron(t, 'build', '🏗️', note)
  changed()
  return true
}

// ---------- collision for the player (buildings + standing trees + lamps) ----------
let cacheV = -1, cache: Box[] = []
export function blockers() {
  if (cacheV !== town.version) {
    cacheV = town.version
    cache = [...SOLIDS, ...TREES.filter((_, i) => !town.cleared.has(i)).map((t) => ({ minX: t.x - 0.4, maxX: t.x + 0.4, minZ: t.z - 0.4, maxZ: t.z + 0.4 })), ...LAMP_BOXES]
  }
  return cache
}

// ---------- save / load ----------
/** Jobs and homes of residents who aren't in town yet (registered residents arrive after the backend answers). */
export const pending = { jobs: {} as Record<string, { work: string | null; profession: string }>, homes: {} as Record<string, string> }

export function serializeTown() {
  return {
    gold: town.gold, stock: town.stock, b: town.b, ledger: town.ledger, days: town.days, today: town.today,
    cleared: [...town.cleared], placed: town.placed, counter: town.counter,
    jobs: { ...pending.jobs, ...Object.fromEntries(RESIDENTS.map((r) => [r.id, { work: r.work, profession: r.profession }])) },
    // mock residents' homes are normally fixed, but demolishBuilding can move one out of a torn-down cottage
    homes: { ...pending.homes, ...Object.fromEntries(RESIDENTS.map((r) => [r.id, r.home])) },
  }
}

export function loadTown(data: ReturnType<typeof serializeTown>) {
  for (const p of data.placed ?? []) if (!getBuilding(p.id)) addPlaced(p)
  Object.assign(town, {
    gold: Number(data.gold) || 0,
    stock: { ...START_STOCK, ...data.stock },
    b: { ...town.b, ...data.b },
    ledger: data.ledger ?? [], days: data.days ?? [], today: data.today ?? newDay(1),
    cleared: new Set(data.cleared ?? []), counter: data.counter ?? 0,
  })
  for (const [id, j] of Object.entries(data.jobs ?? {})) {
    if (j.work !== null && !getBuilding(j.work)) continue
    const r = RESIDENTS.find((x) => x.id === id)
    if (r) { r.work = j.work; r.profession = j.profession } else pending.jobs[id] = j
  }
  Object.assign(pending.homes, data.homes ?? {})
  changed()
}
