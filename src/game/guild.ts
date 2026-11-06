// Guild quests, adventure records and reputation. Pure logic (testable headless).
// Members themselves come from the backend; quests run in the Guild Master's game.
import type { GuildMember } from '../backend/types.ts'
import { hash } from './dialogue.ts'
import { chron } from './chronicle.ts'
import { RESOURCES, type Bundle, type Resource } from './professions.ts'
import { sim } from './sim.ts'
import { RESIDENTS } from './residents.mock.ts'
import { changed, record, storageCap, town } from './town.ts'

export interface QuestTemplate {
  key: string; name: string; desc: string; difficulty: 1 | 2 | 3 | 4 | 5; hours: number
  party: [number, number]; gold: number; goods: Bundle; renown: number
}

export const QUESTS: QuestTemplate[] = [
  { key: 'wolves', name: 'Wolves at the Forest Edge', desc: 'A wolf pack has been seen near the farm fences.', difficulty: 1, hours: 4, party: [1, 2], gold: 40, goods: { wood: 6 }, renown: 25 },
  { key: 'herbs', name: 'Misty Hollow Herbs', desc: 'Gather rare herbs for the alchemist.', difficulty: 1, hours: 5, party: [1, 2], gold: 25, goods: { herbs: 12 }, renown: 20 },
  { key: 'caravan', name: 'Escort the Spice Caravan', desc: 'Guard a merchant caravan on the eastern road.', difficulty: 2, hours: 8, party: [2, 3], gold: 120, goods: {}, renown: 45 },
  { key: 'troll', name: 'The Bridge Troll’s Toll', desc: 'Talk (or fight) a troll out of charging travellers.', difficulty: 2, hours: 6, party: [1, 3], gold: 80, goods: { stone: 10 }, renown: 40 },
  { key: 'goblins', name: 'Goblin Camp in the Hills', desc: 'Goblins are raiding the quarry road.', difficulty: 3, hours: 10, party: [2, 3], gold: 160, goods: { iron: 6, weapons: 1 }, renown: 70 },
  { key: 'mill', name: 'The Haunted Mill', desc: 'Strange lights at the old mill downriver.', difficulty: 3, hours: 9, party: [2, 3], gold: 140, goods: { wheat: 20 }, renown: 75 },
  { key: 'crystal', name: 'Crystal Cave Survey', desc: 'Map a newly found cave full of glowing crystals.', difficulty: 3, hours: 12, party: [2, 3], gold: 100, goods: { stone: 25, iron: 8 }, renown: 80 },
  { key: 'bandits', name: 'Bandit Fort', desc: 'Clear the bandits blocking the mountain pass.', difficulty: 4, hours: 14, party: [3, 4], gold: 260, goods: { weapons: 3 }, renown: 120 },
  { key: 'ruins', name: 'Lost Ruins Expedition', desc: 'Explore ruins of the old kingdom beyond the river.', difficulty: 4, hours: 16, party: [2, 4], gold: 220, goods: { furniture: 2, potion: 2 }, renown: 130 },
  { key: 'wyvern', name: 'Wyvern on the Ridge', desc: 'A young wyvern threatens the shepherds.', difficulty: 5, hours: 20, party: [3, 4], gold: 400, goods: { potion: 4 }, renown: 220 },
]

export interface Active { id: string; key: string; members: string[]; residents: string[]; start: number; end: number; chance: number }
export interface QuestRecord { t: number; quest: string; members: string[]; success: boolean; gold: number; goods: Bundle; renown: number }
export interface RenownGrant { memberId: string; amount: number; reason: string }

export const guild = {
  members: [] as GuildMember[],
  reputation: 0,
  questGold: 0,
  active: [] as Active[],
  records: [] as QuestRecord[],
  /** renown not yet saved to the backend (e.g. Guild Master was offline) */
  pendingRenown: [] as RenownGrant[],
  /** quest ids already taken today */
  taken: [] as string[],
}

export const memberOf = (residentId: string) => guild.members.find((m) => m.residentId === residentId)
const busy = (memberId: string) => guild.active.some((a) => a.members.includes(memberId))

/** Three quests per day, the same for everyone on that day. */
export function questBoard(day: number) {
  const picks: { id: string; q: QuestTemplate }[] = []
  for (let i = 0; picks.length < 3 && i < 30; i++) {
    const q = QUESTS[hash('board', day, i) % QUESTS.length]
    if (!picks.some((p) => p.q.key === q.key)) picks.push({ id: `${day}-${q.key}`, q })
  }
  return picks
}

export function successChance(q: QuestTemplate, party: GuildMember[]) {
  if (!party.length) return 0
  const avgRank = party.reduce((a, m) => a + m.rank, 0) / party.length
  const classes = new Set(party.map((m) => m.cls))
  let c = 0.55 + 0.1 * (avgRank - q.difficulty) + 0.04 * (party.length - 1)
  if (classes.has('Healer')) c += 0.06
  if (classes.size >= 3) c += 0.05
  return Math.max(0.1, Math.min(0.95, c))
}

/** Why a party can't go, or null if it can. */
export function partyProblem(q: QuestTemplate, party: GuildMember[]): string | null {
  if (party.length < q.party[0]) return `Needs at least ${q.party[0]} member${q.party[0] > 1 ? 's' : ''}`
  if (party.length > q.party[1]) return `At most ${q.party[1]} members`
  const away = party.find((m) => busy(m.id))
  if (away) return `${away.displayName} is already on a quest`
  const absent = party.find((m) => !RESIDENTS.some((r) => r.id === m.residentId))
  if (absent) return `${absent.displayName} doesn't live in town yet`
  return null
}

export function startQuest(questId: string, q: QuestTemplate, party: GuildMember[], t: number): string | null {
  if (guild.taken.includes(questId)) return 'This quest was already taken'
  const problem = partyProblem(q, party)
  if (problem) return problem
  const end = t + q.hours * 60
  guild.active.push({ id: questId, key: q.key, members: party.map((m) => m.id), residents: party.map((m) => m.residentId), start: t, end, chance: successChance(q, party) })
  guild.taken.push(questId)
  for (const m of party) if (sim[m.residentId]) sim[m.residentId].awayUntil = end
  changed()
  return null
}

/** Finish quests whose time is up. Returns renown to save in the backend. */
export function resolveQuests(t: number): { grants: RenownGrant[]; messages: string[] } {
  const grants: RenownGrant[] = [], messages: string[] = []
  for (const a of guild.active.filter((x) => x.end <= t)) {
    const q = QUESTS.find((x) => x.key === a.key)!
    const success = (hash(a.id, ...a.members) % 1000) / 1000 < a.chance
    const names = a.members.map((id) => guild.members.find((m) => m.id === id)?.displayName ?? 'A member')
    let gold = 0, goods: Bundle = {}
    if (success) {
      gold = q.gold
      town.gold += gold
      guild.questGold += gold
      record('quest', gold, `Quest reward: ${q.name}`, t)
      goods = q.goods
      for (const [k, v] of Object.entries(goods)) town.stock[k as Resource] = Math.min(storageCap(), town.stock[k as Resource] + (v ?? 0))
      guild.reputation += q.difficulty * 5
    } else {
      guild.reputation = Math.max(0, guild.reputation - 2)
      for (const rid of a.residents) if (sim[rid]) sim[rid].needs.health = Math.max(5, sim[rid].needs.health - 30)
    }
    const renown = success ? q.renown : Math.max(1, Math.round(q.renown * 0.2))
    for (const id of a.members) grants.push({ memberId: id, amount: renown, reason: `${success ? 'Completed' : 'Survived'}: ${q.name}` })
    guild.records.unshift({ t, quest: q.name, members: names, success, gold, goods, renown })
    if (guild.records.length > 60) guild.records.length = 60
    messages.push(success ? `⚔️ ${names.join(', ')} completed “${q.name}”! +${gold} gold` : `💢 ${names.join(', ')} failed “${q.name}” and limped home`)
    chron(t, 'quest', success ? '⚔️' : '💢', success ? `${names.join(', ')} completed “${q.name}” and earned ${gold} gold.` : `${names.join(', ')} failed “${q.name}” and limped home.`)
  }
  if (grants.length || messages.length) {
    guild.active = guild.active.filter((x) => x.end > t)
    guild.pendingRenown.push(...grants)
    changed()
  }
  return { grants, messages }
}

export const goodsText = (b: Bundle) => Object.entries(b).filter(([k]) => (RESOURCES as readonly string[]).includes(k)).map(([k, v]) => `${v} ${k}`).join(', ')

export function serializeGuild() {
  return { reputation: guild.reputation, questGold: guild.questGold, active: guild.active, records: guild.records, pendingRenown: guild.pendingRenown, taken: guild.taken }
}
export function loadGuild(d: Partial<ReturnType<typeof serializeGuild>> | undefined) {
  if (!d) return
  Object.assign(guild, {
    reputation: d.reputation ?? 0, questGold: d.questGold ?? 0, active: d.active ?? [], records: d.records ?? [],
    pendingRenown: d.pendingRenown ?? [], taken: (d.taken ?? []).slice(-30),
  })
}
export function resetGuild() { loadGuild({}) ; guild.taken = [] }
