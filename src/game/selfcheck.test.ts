// Run: npm test  — checks the town layout is walkable and the NPC graph is sound.
import assert from 'node:assert/strict'
import { BUILDINGS, EDGES, NODES, SOLIDS, WORLD_HALF, findPath } from './map.ts'
import { collides, slide } from './collision.ts'
import { LAMP_BOXES, TREE_BOXES } from './scenery.ts'

const all = [...SOLIDS, ...TREE_BOXES, ...LAMP_BOXES]
const NPC_CLEARANCE = 1.1 // 0.7 personal offset + 0.4 body radius

for (const [id, [x, z]] of Object.entries(NODES)) assert.ok(!collides(x, z, NPC_CLEARANCE, all, WORLD_HALF), `node ${id} blocked`)

for (const [a, b] of EDGES) {
  const [ax, az] = NODES[a], [bx, bz] = NODES[b]
  for (let t = 0; t <= 1; t += 0.02)
    assert.ok(!collides(ax + (bx - ax) * t, az + (bz - az) * t, NPC_CLEARANCE, all, WORLD_HALF), `edge ${a}-${b} blocked at t=${t.toFixed(2)}`)
}

for (const id of Object.keys(NODES)) assert.ok(findPath('sN', id).length > 0 || id === 'sN', `node ${id} unreachable`)
for (const b of BUILDINGS) assert.ok(b.door in NODES, `building ${b.id} door missing`)

assert.deepEqual(findPath('h4', 'h2'), ['h1', 'h2'])
assert.deepEqual(findPath('dock', 'dock'), [])

// sliding: walking into the guild wall stops at the wall, sideways motion continues
const [x1, z1] = slide(0, -14, 0.3, -2, 0.5, SOLIDS, WORLD_HALF)
assert.ok(z1 > -15 + 0.5 - 1e-9 && x1 === 0.3)

console.log('selfcheck ok:', Object.keys(NODES).length, 'nodes,', EDGES.length, 'edges,', TREE_BOXES.length, 'trees')

// ---------- life simulation: run 3 game days headless ----------
import { NODES as N } from './map.ts'
import { friendships, residents, sim, socialPass, tickSim, type Activity } from './sim.ts'

const startFriend = Object.values(friendships).reduce((a, b) => a + b, 0)
const startLevels = residents.map((r) => sim[r.id].level)
const did: Record<string, Set<Activity>> = Object.fromEntries(residents.map((r) => [r.id, new Set<Activity>()]))
let minHappy = 100
for (let t = 8 * 60; t < 8 * 60 + 3 * 1440; t += 1) {
  for (const r of residents) {
    const s = sim[r.id]
    // instant movement: teleport to the target node
    if (s.target) { s.node = s.target; s.x = N[s.target][0]; s.z = N[s.target][1] }
    s.walking = false
    s.arrived = true
    if (s.arrived) did[r.id].add(s.activity)
  }
  tickSim(1, t)
  if (t % 5 === 0) socialPass(t)
  for (const r of residents) {
    for (const [k, v] of Object.entries(sim[r.id].needs)) assert.ok(v >= 0 && v <= 100 && !Number.isNaN(v), `${r.id} ${k}=${v}`)
    if (t > 8 * 60 + 1440) minHappy = Math.min(minHappy, sim[r.id].needs.happiness)
  }
}
for (const r of residents) {
  for (const a of ['sleep', 'eat', 'work'] as Activity[]) assert.ok(did[r.id].has(a), `${r.name} never did ${a}`)
}
assert.ok(residents.some((r, i) => sim[r.id].level > startLevels[i]), 'nobody levelled up in 3 days')
assert.ok(Object.values(friendships).reduce((a, b) => a + b, 0) > startFriend, 'friendships never grew')
assert.ok(residents.some((r) => sim[r.id].lastChat), 'no conversations happened')
assert.ok(minHappy > 15, `someone became miserable (min happiness ${minHappy.toFixed(1)})`)
console.log('sim ok: 3 days,', 'min happiness', minHappy.toFixed(0), '· levels', residents.map((r) => sim[r.id].level).join(','))

// dialogue lines are always complete sentences
import { chatLine } from './dialogue.ts'
for (let seed = 0; seed < 300; seed++) for (const place of ['', 'tavern', 'square', 'market']) {
  const line = chatLine(residents[seed % 12], residents[(seed + 5) % 12], 'Friend', place, seed)
  assert.ok(!line.includes('undefined') && !line.endsWith(' ') && line.split(' ').length > 3, `bad line: "${line}"`)
}
console.log('dialogue ok')

// ---------- economy & construction ----------
import { town, checkPlacement, placeBuilding, cancelJob, startUpgrade, storageCap, TYPES, sellToMerchant, buyFromMerchant } from './town.ts'
import { RESOURCES } from './professions.ts'
import { BUILDINGS as ALL, NODES as NN } from './map.ts'
import { assignWorker, unassignWorker } from './sim.ts'

const money = () => town.gold + residents.reduce((a, r) => a + sim[r.id].wealth, 0)
function runDays(days: number, t0: number) {
  let t = t0
  for (; t < t0 + days * 1440; t++) {
    for (const r of residents) {
      const s = sim[r.id]
      if (s.target && NN[s.target]) { s.node = s.target; s.x = NN[s.target][0]; s.z = NN[s.target][1] }
      s.walking = false
      s.arrived = true
    }
    tickSim(1, t)
    if (t % 5 === 0) socialPass(t)
    for (const k of RESOURCES) assert.ok(town.stock[k] >= 0 && town.stock[k] <= storageCap(), `stock ${k}=${town.stock[k]}`)
  }
  return t
}

// money is conserved: only trade and construction move gold in or out of town
let t = 8 * 60 + 3 * 1440
const before = money()
const breadBefore = town.today.produced.bread ?? 0
t = runDays(2, t)
assert.ok(Math.abs(money() - before) < 1e-6, `gold leaked: ${before} -> ${money()}`)
const produced = town.days.slice(0, 2).reduce((a, d) => a + (d.produced.bread ?? 0), breadBefore)
assert.ok(produced > 0, 'bakery produced no bread')
assert.ok(town.ledger.some((x) => x.kind === 'meals'), 'nobody bought a tavern meal')

// placement: find a valid plot for a cottage, build it with the builder
town.gold += 300 // test-only grant: the treasury runs low without the player selling goods
let spot: [number, number, number] | null = null
for (let x = -50; x <= 50 && !spot; x += 2) for (let z = -50; z <= 50 && !spot; z += 2) for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  if (checkPlacement('house', x, z, rot).ok) { spot = [x, z, rot]; break }
}
assert.ok(spot, 'no valid spot for a cottage anywhere')
assert.equal(checkPlacement('house', 0, 0, 0).ok, false, 'square must be blocked')
assert.equal(checkPlacement('house', 40, 0, 0).ok, false, 'river must be blocked')
assert.equal(checkPlacement('house', -15, -4, 0).ok, false, 'overlap must be blocked')
const goldBeforeBuild = town.gold
const { id: houseId, error } = placeBuilding('house', spot![0], spot![1], spot![2], t)
assert.ok(houseId, error)
assert.equal(town.gold, goldBeforeBuild - TYPES.house.gold)
assert.equal(checkPlacement('house', spot![0], spot![1], spot![2]).ok, false, 'cannot build on top of a site')
t = runDays(2, t)
assert.equal(town.b[houseId!].level, 1, `cottage not finished: ${JSON.stringify(town.b[houseId!])}`)
assert.ok(ALL.some((b) => b.id === houseId))

// cancel before any work = full refund and the plot is freed
town.gold += 300 // test-only grant
const g0 = town.gold, w0 = town.stock.wood
let spot2: [number, number] | null = null
for (let x = -50; x <= 50 && !spot2; x += 2) for (let z = -50; z <= 50 && !spot2; z += 2) if (checkPlacement('lumber', x, z, 0).ok) spot2 = [x, z]
const { id: campId, error: campErr } = placeBuilding('lumber', spot2![0], spot2![1], 0, t)
assert.ok(campId, campErr)
cancelJob(campId!, t)
assert.equal(town.gold, g0)
assert.ok(town.stock.wood >= w0, 'wood not refunded')
assert.ok(!ALL.some((b) => b.id === campId), 'cancelled building still exists')

// upgrade the bakery, then hire a second baker into the new slot
town.gold += 1000; town.stock.wood += 50; town.stock.stone += 50 // test-only grant
assert.equal(startUpgrade('bakery', t), null)
t = runDays(1, t)
assert.equal(town.b.bakery.level, 2)
const jobless = residents.find((r) => r.work === 'farm')!
assert.equal(assignWorker(jobless.id, 'bakery', 'Baker'), null)
assert.equal(jobless.profession, 'Baker')
assert.ok(assignWorker(jobless.id, 'bakery', 'Miner'), 'wrong profession must be rejected')
unassignWorker(jobless.id)
assert.equal(jobless.work, null)
t = runDays(1, t)

// merchant trade
town.stock.weapons = 5
const g1 = town.gold
assert.ok(sellToMerchant('weapons', 5, t))
assert.ok(town.gold > g1 && town.stock.weapons === 0)
assert.ok(!sellToMerchant('weapons', 1, t), 'cannot sell what you do not have')
assert.ok(buyFromMerchant('iron', 5, t))
console.log('economy ok · treasury by day:', town.days.slice().reverse().map((d) => `${d.day}:${Math.round(d.income - d.expense)}`).join(' '), '· gold', Math.round(town.gold))

// save → reset → load gives back the same town
import { serializeTown, loadTown, resetTown } from './town.ts'
const snap = JSON.stringify(serializeTown())
const ids = ALL.map((b) => b.id).join(','), edges = ALL.length
resetTown()
assert.ok(!ALL.some((b) => b.id === houseId), 'reset must remove player buildings')
loadTown(JSON.parse(snap))
assert.equal(ALL.map((b) => b.id).join(','), ids)
assert.equal(ALL.length, edges)
assert.equal(JSON.stringify(serializeTown()), snap)
assert.ok(NN[`d_${houseId}`], 'road node restored')
console.log('save/load ok')

// ---------- community: CSV, avatars, housing ----------
import { parseCsv, previewImport } from './csv.ts'
import { normalizeInstagram, randomAppearance, validAppearance } from './avatar.ts'
import { applyMembers, community, setPlaceholders, bedsIn, occupants } from './community.ts'
import { RESIDENTS } from './residents.mock.ts'

assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n\n1,2'), [['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']])
assert.equal(normalizeInstagram('@Wander.Fan'), 'wander.fan')
assert.equal(normalizeInstagram('https://www.instagram.com/some_one/'), 'some_one')
for (const bad of ['', 'a..b', '.dot', 'dot.', 'has space', 'x'.repeat(31), 'émoji']) assert.equal(normalizeInstagram(bad), null, bad)
for (let i = 0; i < 200; i++) assert.ok(validAppearance(randomAppearance(i)), `random avatar ${i} invalid`)
assert.ok(!validAppearance({ ...randomAppearance(1), skin: 'red' }))

const preview = previewImport('instagram,display_name,consent,personality\n@one,Alpha,yes,kind\ntwo,Beta,no,\n@ONE,Gamma,yes,\nbad..name,Delta,yes,\nthree,Echo,yes,Grumpy\nfour,Foxtrot,yes,\nexisting,Golf,yes,', new Set(['existing']))
assert.deepEqual(preview.map((p) => p.problem), [null, 'No consent', 'Duplicate in this file', 'Invalid Instagram username', 'Unknown personality "Grumpy"', null, 'Already a resident'])
assert.equal(preview[0].row!.personality, 'Kind')
assert.equal(previewImport('name,ig\nx,y', new Set())[0].problem, 'Header must include instagram, display_name and consent')

// housing: placeholders fill the original cottages, the cottage built above has 3 beds
const member = (n: number) => ({ id: `00000000-0000-0000-0000-00000000000${n}`, displayName: `Member ${n}`, instagram: null, personality: 'Kind' as const, appearance: randomAppearance(n), homeBuildingId: null })
const members = [1, 2, 3, 4, 5].map(member)
const before4 = RESIDENTS.length
let ev = applyMembers(members)
assert.equal(RESIDENTS.length, before4 + 3, 'three free beds in the new cottage')
assert.equal(community.waiting.length, 2)
assert.ok(ev.events.some((e) => e.includes('moved into')))
assert.ok(occupants(houseId!) <= bedsIn(houseId!))
setPlaceholders(false)
applyMembers(members)
assert.equal(community.waiting.length, 0, 'placeholders off frees beds')
assert.ok(RESIDENTS.every((r) => !r.mock))
const newcomer = RESIDENTS.find((r) => r.id === member(1).id)!
assert.equal(newcomer.work, null)
assert.ok(sim[newcomer.id], 'newcomer has a life simulation')
t = runDays(1, t) // newcomers live a day without errors
ev = applyMembers(members.slice(1))
assert.ok(!RESIDENTS.some((r) => r.id === member(1).id) && !sim[member(1).id], 'removed member left town')
setPlaceholders(true)
assert.ok(RESIDENTS.some((r) => r.mock))
console.log('community ok')

// ---------- local dev backend: follower registers, Guild Master approves, member moves in ----------
const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
const { localBackend: lb } = await import('../backend/local.ts')
const reg1 = await lb.register({ instagram: '@Fan.One', displayName: 'Fan One', personality: 'Social', appearance: randomAppearance(7), consentData: true, showInstagram: true })
assert.match(reg1.verificationCode, /^WTG-/)
await assert.rejects(lb.register({ instagram: 'fan.one', displayName: 'Again', personality: 'Social', appearance: randomAppearance(7), consentData: true, showInstagram: false }), /already_registered/)
await assert.rejects(lb.register({ instagram: 'fan.two', displayName: 'Two', personality: 'Social', appearance: randomAppearance(7), consentData: true, showInstagram: false }), /already_pending/)
assert.equal((await lb.myRegistration())!.status, 'pending')
await lb.review(reg1.id, true, 'ok')
const listed1 = await lb.listResidents()
assert.equal(listed1.length, 1)
assert.equal(listed1[0].instagram, 'fan.one')
setPlaceholders(false)
applyMembers(listed1)
assert.ok(RESIDENTS.some((r) => r.name === 'Fan One' && r.instagram === 'fan.one'), 'approved follower lives in town')
await lb.withdraw()
assert.equal((await lb.listResidents()).length, 0)
applyMembers(await lb.listResidents())
assert.ok(!RESIDENTS.some((r) => r.name === 'Fan One'), 'withdrawn follower left town')
setPlaceholders(true)
console.log('local backend ok')

// ---------- follower export parsing + follow check ----------
import { parseFollowerExport, hashHandle } from './followers.ts'
const jsonExport = JSON.stringify([
  { title: '', media_list_map: [], string_list_data: [{ href: 'https://www.instagram.com/pip.bakes', value: 'pip.bakes', timestamp: 1 }] },
  { title: 'Bram_Iron', string_list_data: [{ href: 'https://www.instagram.com/_u/bram_iron', timestamp: 2 }] },
])
assert.deepEqual([...parseFollowerExport(jsonExport)].sort(), ['bram_iron', 'pip.bakes'])
assert.deepEqual([...parseFollowerExport(JSON.stringify({ relationships_followers: JSON.parse(jsonExport) }))].sort(), ['bram_iron', 'pip.bakes'])
const htmlExport = '<html><body><div><a target="_blank" href="https://www.instagram.com/wren.farm">wren.farm</a></div><div><a href="https://www.instagram.com/_u/oli_f">oli_f</a></div></body></html>'
assert.deepEqual([...parseFollowerExport(htmlExport)].sort(), ['oli_f', 'wren.farm'])
assert.deepEqual([...parseFollowerExport('@One\ntwo, three;bad..name')].sort(), ['one', 'three', 'two'])
assert.equal(await hashHandle('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

assert.equal(await lb.isFollower('anyone'), null, 'no list = not checked')
await lb.setFollowers(await Promise.all(['pip.bakes', 'wren.farm'].map(hashHandle)))
assert.equal(await lb.isFollower('@Pip.Bakes'), true)
assert.equal(await lb.isFollower('stranger'), false)
await assert.rejects(lb.register({ instagram: 'stranger', displayName: 'Stranger', personality: 'Shy', appearance: randomAppearance(3), consentData: true, showInstagram: false }), /not_following/)
const okReg = await lb.register({ instagram: 'wren.farm', displayName: 'Wren', personality: 'Kind', appearance: randomAppearance(4), consentData: true, showInstagram: false })
assert.equal((await lb.listRegistrations('pending')).find((r) => r.id === okReg.id)!.follows, true)
console.log('follower check ok')

// ---------- Phase 5: recruitment scoring (same fixture as the database test) ----------
import { scoreEntries, parseCommentsCsv, meaningfulChars, rankFor, type RecruitEvent as REv } from './recruitment.ts'
import { guild, questBoard, startQuest, resolveQuests, successChance, QUESTS } from './guild.ts'
const ev5: REv = { id: 'e', title: 'T', postUrl: 'https://www.instagram.com/p/x/', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T00:00:00Z',
  minComments: 3, minChars: 5, maxPerDay: 2, slots: 1, status: 'open', createdAt: '' }
const cm = async (instagram: string, text: string, at: string) => ({ instagram, text_hash: await hashHandle(text), chars: meaningfulChars(text), commented_at: new Date(at).toISOString() })
const fixture = await Promise.all([
  cm('csv_one', 'go guild go!', '2026-11-02T10:00Z'), cm('csv_one', 'pick me please', '2026-11-02T11:00Z'), cm('csv_one', 'love this town', '2026-11-02T12:00Z'), cm('csv_one', 'day two hello', '2026-11-03T09:00Z'),
  cm('csv_three', 'same text again', '2026-11-02T10:00Z'), cm('csv_three', 'same text again', '2026-11-02T10:05Z'), cm('csv_three', 'hi', '2026-11-02T10:10Z'), cm('csv_three', 'too late comment', '2026-11-20T10:00Z'),
  cm('manual.member', 'first comment!', '2026-11-04T10:00Z'), cm('manual.member', 'second comment', '2026-11-05T10:00Z'), cm('manual.member', 'third comment!', '2026-11-06T10:00Z'),
  cm('random.person', 'spam spam spam', '2026-11-02T10:00Z'), cm('wandertales.guild', 'thanks everyone', '2026-11-02T10:00Z'),
  cm('emoji.only', '🔥🔥🔥 @friend @buddy', '2026-11-02T10:00Z'),
])
const scored = scoreEntries(ev5, fixture, new Map([['csv_one', 'r1'], ['csv_three', 'r3'], ['manual.member', 'r2'], ['emoji.only', 'r4']]), new Set(), new Map())
const sc = Object.fromEntries(scored.map((e) => [e.instagram, e]))
assert.deepEqual([sc['csv_one'].validComments, sc['csv_three'].validComments, sc['manual.member'].validComments, sc['wandertales.guild'].validComments, sc['emoji.only'].validComments], [3, 1, 3, 0, 0])
assert.equal(sc['random.person'].reason, 'Not a registered resident')
assert.equal(sc['csv_three'].reason, 'Needs 2 more valid comments')
assert.ok(sc['csv_one'].eligible && sc['manual.member'].eligible)
assert.equal(scoreEntries(ev5, fixture, new Map([['csv_one', 'r1']]), new Set(['r1']), new Map())[0].reason, 'Already a Guild Member')
const csv5 = await parseCommentsCsv('username,text,timestamp\n@Fan.One,"Great, post!",2026-11-02 10:00\nfan.two,nice,1793600000\nbad..x,hi,2026-11-02\nfan.three,hello,not-a-date')
assert.equal(csv5.rows.length, 2)
assert.equal(csv5.rows[0].instagram, 'fan.one')
assert.equal(csv5.problems.length, 2)
assert.equal(rankFor(0), 1); assert.equal(rankFor(320), 3); assert.equal(rankFor(9999), 6)

// ---------- local backend: event → import → recruit → quest ----------
setPlaceholders(false)
const recruitIds: string[] = []
for (const [ig, name] of [['hero.one', 'Hero One'], ['hero.two', 'Hero Two']] as const) {
  recruitIds.push(await lb.addResident({ instagram: ig, displayName: name, personality: 'Adventurous', appearance: randomAppearance(9), consentData: true, showInstagram: true }))
}
applyMembers(await lb.listResidents())
const evId = await lb.createEvent({ title: 'Test Recruitment', postUrl: 'https://www.instagram.com/p/TEST1/', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T00:00:00Z', minComments: 2, slots: 2, minChars: 3, maxPerDay: 5 })
await assert.rejects(lb.createEvent({ title: 'Bad', postUrl: 'https://example.com', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T00:00:00Z', minComments: 2, slots: 2, minChars: 3, maxPerDay: 5 }))
const imported = await lb.importComments(evId, await Promise.all([cm('hero.one', 'I want to join!', '2026-11-02T10:00Z'), cm('hero.one', 'pick me pls', '2026-11-03T10:00Z'),
  cm('hero.two', 'adventure time', '2026-11-02T10:00Z'), cm('hero.two', 'for the guild', '2026-11-02T11:00Z'), cm('hero.two', 'for the guild', '2026-11-02T11:00Z')]))
assert.deepEqual(imported, { added: 4, duplicates: 1, invalid: 0 })
assert.equal((await lb.listGuildMembers()).length, 0, 'no automatic recruitment')
await lb.reviewEntry(evId, 'hero.one', true, 'Warrior')
await lb.reviewEntry(evId, 'hero.two', true, 'Healer')
await assert.rejects(lb.reviewEntry(evId, 'hero.two', true, 'Healer'), /already_reviewed/)
guild.members = await lb.listGuildMembers()
assert.equal(guild.members.length, 2)

// quest: party leaves town, comes back with rewards and renown
const tq = t
const boardToday = questBoard(Math.floor(tq / 1440) + 1)
assert.equal(boardToday.length, 3)
const pick = boardToday.find((b) => b.q.party[0] <= 2) ?? { id: 'test-wolves', q: QUESTS.find((x) => x.key === 'wolves')! }
const { id: qid, q } = pick
const party = guild.members.slice(0, Math.min(2, q.party[1]))
assert.ok(successChance(q, party) > 0)
const goldBeforeQuest = town.gold
assert.equal(startQuest(qid, q, party, tq), null)
assert.ok(startQuest(qid, q, party, tq), 'same quest cannot be taken twice')
assert.ok(sim[party[0].residentId].awayUntil > tq)
tickSim(1, tq + 1)
assert.ok(sim[party[0].residentId].indoors, 'away members are out of town')
const res = resolveQuests(tq + q.hours * 60)
assert.equal(guild.active.length, 0)
assert.equal(guild.records.length, 1)
assert.equal(res.grants.length, party.length)
if (guild.records[0].success) assert.equal(town.gold, goldBeforeQuest + q.gold); else assert.equal(town.gold, goldBeforeQuest)
for (const g of res.grants) await lb.addRenown(g.memberId, g.amount, g.reason)
tickSim(1, tq + q.hours * 60 + 1)
assert.equal(sim[party[0].residentId].awayUntil, 0, 'back in town')
assert.ok((await lb.listGuildMembers()).every((m) => m.renown > 0))
assert.ok(QUESTS.every((x) => x.renown <= 500))
setPlaceholders(true)
console.log('guild ok · quest', guild.records[0].success ? 'won' : 'failed', guild.records[0].quest)

// ---------- character system: NPC generator + appearance validation ----------
import { readFileSync as readCat } from 'node:fs'
import { generateNpcAppearance, ROLES, auditLoadouts } from '../npc-generator/npcGenerator.ts'
import { validateAppearance } from '../character-creator/appearance.ts'
const cat = JSON.parse(readCat(new URL('../../data/character_assets.json', import.meta.url), 'utf8')) as { assets: { id: string; slot: string; readyForPlayer: boolean; qc: string }[] }
assert.ok(!cat.assets.some((a) => a.qc === 'FAILED' && a.readyForPlayer), 'failed assets must never be player-ready')
assert.deepEqual(auditLoadouts(new Map(cat.assets.map((a) => [a.id, a.slot]))), [])
const avail = new Set(cat.assets.filter((a) => a.readyForPlayer).map((a) => a.id))
for (const role of ROLES) for (let i = 0; i < 20; i++) {
  const a = generateNpcAppearance(`npc-${i}`, role, { available: avail })
  assert.deepEqual(a, generateNpcAppearance(`npc-${i}`, role, { available: avail }), 'same seed, same look')
  assert.deepEqual(validateAppearance(a, cat.assets), { ...a, name: undefined }, `${role} look must validate`)
}
assert.notDeepEqual(generateNpcAppearance('a', 'Knight', { available: avail }), generateNpcAppearance('b', 'Knight', { available: avail }))
assert.throws(() => validateAppearance({ schemaVersion: 1, equipment: { hair: 'apron_baker' } }, cat.assets), /slot/)
assert.throws(() => validateAppearance({ schemaVersion: 1, equipment: { apron: 'apron_baker' } }, cat.assets), /QC/)
assert.throws(() => validateAppearance({ schemaVersion: 1, equipment: { hair: '../../etc/passwd' } }, cat.assets), /Unknown/)
console.log('characters ok')

// ---------- Phase 6: seasons, weather, festivals, chronicle, cloud save ----------
const cal6 = await import('./calendar.ts')
const chr6 = await import('./chronicle.ts')
const D = 1440
assert.deepEqual([0, 7, 14, 21, 28].map((d) => cal6.seasonOf(d * D)), ['spring', 'summer', 'autumn', 'winter', 'spring'])
assert.deepEqual([0, 6, 7, 13].map((d) => cal6.dayInSeason(d * D)), [1, 7, 1, 7])
assert.equal(cal6.yearOf(27 * D), 1); assert.equal(cal6.yearOf(28 * D), 2)
assert.equal(cal6.weatherAt(8 * 60), 'clear', 'the first day is always clear')
for (let d = 0; d < 28 * 6; d++) {
  const w = cal6.weatherOfDay(d), s = cal6.seasonOf(d * D)
  assert.deepEqual(w, cal6.weatherOfDay(d), 'weather is deterministic')
  assert.ok(w.from >= 0 && w.to <= 24 && w.to > w.from, `day ${d} window`)
  if (s === 'winter') assert.ok(w.type !== 'rain' && w.type !== 'storm', 'no rain in winter')
  if (s !== 'winter') assert.ok(w.type !== 'snow', 'snow only in winter')
}
const types = new Set(Array.from({ length: 28 * 6 }, (_, d) => cal6.weatherOfDay(d).type))
assert.equal(types.size, 6, 'every weather type happens within 6 years')
// festivals: the last day of each season, 14:00–23:00 only
assert.equal(cal6.festivalAt(6 * D + 13.9 * 60), null); assert.equal(cal6.festivalAt(6 * D + 14 * 60)?.key, 'blossom')
assert.equal(cal6.festivalAt(13 * D + 20 * 60)?.key, 'midsummer'); assert.equal(cal6.festivalAt(6 * D + 23 * 60), null); assert.equal(cal6.festivalAt(5 * D + 20 * 60), null)
// production: farms like summer, hate winter; indoor work and non-farm outdoor work ignore the season
const clearDay = (s: number) => { let d = s * 7; while (cal6.weatherOfDay(d).type !== 'clear') d++; return d * D + 12 * 60 }
assert.ok(cal6.workSpeed('farm', clearDay(1)) > cal6.workSpeed('farm', clearDay(0)) && cal6.workSpeed('farm', clearDay(3)) < 0.6)
assert.equal(cal6.workSpeed('bakery', clearDay(3)), 1); assert.equal(cal6.workSpeed('lumber', clearDay(1)), 1)
const stormDay = Array.from({ length: 200 }, (_, d) => d).find((d) => cal6.weatherOfDay(d).type === 'storm')!
const st = cal6.weatherOfDay(stormDay)
assert.ok(cal6.workSpeed('quarry', stormDay * D + st.from * 60) < 0.7 && cal6.exposure(stormDay * D + st.from * 60) > 0)

// the calendar writes the chronicle once per event and survives a save/load
chr6.resetChronicle()
assert.deepEqual(cal6.advanceCalendar(8 * 60), [], 'first call only syncs the day counter')
const summer = cal6.advanceCalendar(7 * D + 60)
assert.ok(summer.some((m) => m.includes('Summer')), 'season change is announced')
const fest = cal6.advanceCalendar(13 * D + 15 * 60)
assert.ok(fest.some((m) => m.includes('Midsummer Fair has begun')) && cal6.cal.festival?.key === 'midsummer')
assert.deepEqual(cal6.advanceCalendar(13 * D + 16 * 60), [], 'a festival is announced only once')
assert.equal(chr6.chronicle.entries.filter((e) => e.kind === 'festival').length, 1)
assert.equal(chr6.chronicle.entries.filter((e) => e.kind === 'season').length, 1)
assert.equal(chr6.chronicle.entries.filter((e) => e.kind === 'milestone' && e.text.includes('500 gold')).length, 1, 'milestones log once')
cal6.advanceCalendar(14 * D + 60)
cal6.advanceCalendar(14 * D + 120)
assert.equal(cal6.cal.festival, null, 'festival ends')
const { saveGame: sv6, loadGame: ld6 } = await import('./persist.ts')
const before6 = JSON.stringify(chr6.serializeChronicle())
sv6(); chr6.resetChronicle(); assert.equal(chr6.chronicle.entries.length, 0)
ld6()
assert.equal(JSON.stringify(chr6.serializeChronicle()), before6, 'chronicle survives save/load')
for (let i = 0; i < 400; i++) chr6.chron(i, 'people', '⭐', `entry ${i}`)
assert.equal(chr6.chronicle.entries.length, chr6.MAX_ENTRIES); assert.equal(chr6.chronicle.entries[0].text, 'entry 399')
chr6.chron(1, 'milestone', '💰', 'a', 'k'); chr6.chron(2, 'milestone', '💰', 'b', 'k')
assert.equal(chr6.chronicle.entries.filter((e) => e.text === 'a' || e.text === 'b').length, 1)
console.log('seasons ok · chronicle ok')

// cloud save: compare-and-set. A device that is behind is refused and nothing is overwritten.
const sum6 = { day: 1, season: 'Spring', gold: 1, population: 1, buildings: 1 }
assert.equal(await lb.cloudLoad(), null)
assert.deepEqual(await lb.cloudSave({ a: 1 }, sum6, 'laptop', 0), { ok: true, rev: 1 })
const refused = await lb.cloudSave({ a: 2 }, sum6, 'phone', 0)
assert.ok(!refused.ok && refused.current.rev === 1 && refused.current.device === 'laptop')
assert.deepEqual((await lb.cloudLoad())!.data, { a: 1 }, 'a refused write changes nothing')
assert.deepEqual(await lb.cloudSave({ a: 2 }, sum6, 'phone', 1), { ok: true, rev: 2 }, 'retrying on the current revision works')
await assert.rejects(lb.cloudSave('nope', sum6, 'x', 2), /invalid_save/)
console.log('cloud save ok')

// ---------- Phase 7: sound mix ----------
const { audioMix } = await import('./audiomix.ts')
const dry = { night: 0, rain: 0, snow: 0, cloud: 0 }, nightLook = { ...dry, night: 1 }
assert.deepEqual(audioMix(dry, 'spring'), { rain: 0, wind: 0, birds: 1, music: 1 }, 'clear spring day: birds and music')
assert.equal(audioMix(nightLook, 'summer').birds, 0, 'night: no birds')
assert.equal(audioMix(dry, 'winter').birds, 0)
const storm = audioMix({ night: 0, rain: 1, snow: 0, cloud: 1 }, 'summer')
assert.ok(storm.rain === 1 && storm.wind > 0.7 && storm.birds === 0, 'storm: rain and wind, birds silent')
assert.equal(audioMix(dry, 'autumn').music, 1, 'music is always on')
for (const l of Object.values(audioMix({ night: 1, rain: 1, snow: 1, cloud: 1 }, 'autumn'))) assert.ok(l >= 0 && l <= 1, 'levels stay in 0..1')
console.log('sound mix ok')
