// Runs the real migration in an in-memory Postgres (PGlite) with Supabase-like auth stubs,
// then exercises registration, review, import, RLS and consent withdrawal.
// Run: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'

const db = new PGlite()
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`)
for (const f of ['0001_community.sql', '0002_follower_check.sql', '0003_guild.sql', '0004_cloud_save.sql']) await db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'))
// Supabase grants table privileges to these roles by default; RLS is what must block them
await db.exec(`grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;`)

const FOLLOWER = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const GM = '33333333-3333-3333-3333-333333333333'
await db.exec(`insert into auth.users values ('${FOLLOWER}'), ('${OTHER}'), ('${GM}');
  insert into public.player_profiles (user_id, role) values ('${GM}', 'guild_master');`)

async function as<T>(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`)
  try { return (await db.query<T>(sql, params)).rows } finally { await db.exec('reset role') }
}
async function fails(user: string | null, sql: string, params: unknown[], msg: string) {
  await assert.rejects(as(user, sql, params), (e: Error) => e.message.includes(msg), `expected "${msg}"`)
}

const look = { skin: '#f1c9a5', hair: '#4a2c1c', hairStyle: 'bun', shirt: '#2f4f7f', pants: '#3a2e26', eyes: 'happy', accessory: 'glasses', build: 'slim', height: 1.02 }
const REG = 'select * from public.register_resident($1, $2, $3, $4, $5, $6)'

// --- follower registers ---
const [reg] = await as<{ id: string; verification_code: string; status: string }>(FOLLOWER, REG, ['@Wander.Fan', 'Pip', 'Cheerful', look, true, false])
assert.match(reg.verification_code, /^WTG-[0-9A-F]{6}$/)
assert.equal(reg.status, 'pending')
await fails(OTHER, REG, ['wander.fan', 'Copycat', 'Shy', look, true, false], 'already_registered') // same account, different casing
await fails(FOLLOWER, REG, ['second_acc', 'Pip2', 'Shy', look, true, false], 'already_pending')
await fails(null, REG, ['anon_user', 'Anon', 'Shy', look, true, false], 'permission denied') // must be signed in
await fails(OTHER, REG, ['bad..name', 'Bad', 'Shy', look, true, false], 'invalid_instagram')
await fails(OTHER, REG, ['ok_name', 'B', 'Shy', look, true, false], 'invalid_name')
await fails(OTHER, REG, ['ok_name', 'Bob', 'Evil', look, true, false], 'invalid_personality')
await fails(OTHER, REG, ['ok_name', 'Bob', 'Shy', { ...look, skin: 'red' }, true, false], 'invalid_appearance')
await fails(OTHER, REG, ['ok_name', 'Bob', 'Shy', look, false, false], 'consent_required')
assert.equal((await as(FOLLOWER, 'select * from public.my_registration()'))[0] !== undefined, true)

// --- RLS: tables are locked, only own registration is readable ---
assert.equal((await as(OTHER, 'select * from public.resident_registrations')).length, 0, 'others cannot read registrations')
assert.equal((await as(FOLLOWER, 'select * from public.resident_registrations')).length, 1)
await fails(FOLLOWER, `insert into public.residents (town_id, display_name, personality, appearance) values ('00000000-0000-0000-0000-000000000001', 'Hacker', 'Shy', '{}')`, [], 'row-level security')
// a follower cannot make themselves Guild Master
await fails(FOLLOWER, `insert into public.player_profiles (user_id, role) values ('${FOLLOWER}', 'guild_master')`, [], 'row-level security')
await as(FOLLOWER, `update public.player_profiles set role = 'guild_master'`) // RLS: no rows visible, no effect
assert.equal((await as<{ is_guild_master: boolean }>(FOLLOWER, 'select public.is_guild_master()'))[0].is_guild_master, false)
assert.equal((await as<{ is_guild_master: boolean }>(GM, 'select public.is_guild_master()'))[0].is_guild_master, true)

// --- only the Guild Master can review ---
await fails(FOLLOWER, 'select public.admin_review_registration($1, true)', [reg.id], 'not_guild_master')
await fails(FOLLOWER, `select public.admin_list_registrations('pending')`, [], 'not_guild_master')
const pending = await as<{ id: string }>(GM, `select * from public.admin_list_registrations('pending')`)
assert.equal(pending.length, 1)
const [{ admin_review_registration: residentId }] = await as<{ admin_review_registration: string }>(GM, 'select public.admin_review_registration($1, true, $2)', [reg.id, 'Code seen in DMs'])
assert.ok(residentId)
await fails(GM, 'select public.admin_review_registration($1, true)', [reg.id], 'already_reviewed')

// --- the town can list residents; Instagram hidden without consent ---
const listed = await as<{ id: string; instagram: string | null; display_name: string }>(null, 'select * from public.list_residents()')
assert.equal(listed.length, 1)
assert.equal(listed[0].instagram, null)
assert.equal(listed[0].id, residentId, 'resident_id is the permanent id')

// --- manual add + CSV import with per-row results ---
await as(GM, 'select public.admin_add_resident($1, $2, $3, $4, true, true)', ['manual.member', 'Bram', 'Kind', look])
await fails(GM, 'select public.admin_add_resident($1, $2, $3, $4, true, true)', ['MANUAL.member', 'Bram again', 'Kind', look], 'already_registered')
const rows = [
  { instagram: 'csv_one', display_name: 'Ivy', personality: 'Kind', appearance: look, consent: true },
  { instagram: 'wander.fan', display_name: 'Dupe', personality: 'Kind', appearance: look, consent: true },
  { instagram: 'csv_two', display_name: 'NoConsent', personality: 'Kind', appearance: look, consent: false },
  { instagram: 'csv_three', display_name: 'Finn', personality: 'Adventurous', appearance: look, consent: true },
]
const [{ admin_import_residents: results }] = await as<{ admin_import_residents: { ok: boolean; error?: string }[] }>(GM, 'select public.admin_import_residents($1)', [JSON.stringify(rows)])
assert.deepEqual(results.map((r) => r.ok), [true, false, false, true])
assert.match(results[1].error!, /already_registered/)
assert.match(results[2].error!, /consent_required/)
assert.equal((await as(null, 'select * from public.list_residents()')).length, 4)
assert.equal((await as<{ instagram: string }>(null, `select * from public.list_residents() where display_name = 'Bram'`))[0].instagram, 'manual.member')

// --- housing + removal ---
await as(GM, 'select public.admin_set_home($1, $2)', [residentId, 'h1'])
await fails(GM, 'select public.admin_set_home($1, $2)', [residentId, "h1'; drop table x"], 'invalid_home')
assert.equal((await as<{ home_building_id: string }>(null, 'select * from public.list_residents() where id = $1', [residentId]))[0].home_building_id, 'h1')

// --- consent withdrawal deletes the follower's data ---
await as(FOLLOWER, 'select public.withdraw_my_registration()')
assert.equal((await as(null, 'select * from public.list_residents() where id = $1', [residentId])).length, 0)
assert.equal((await as(FOLLOWER, 'select * from public.my_registration()')).length, 0)
// the account can register again after withdrawing
await as(FOLLOWER, REG, ['wander.fan', 'Pip', 'Cheerful', look, true, false])

// ---------- follower check (export upload, no Meta API) ----------
const sha = (h: string) => createHash('sha256').update(h).digest('hex')
const NEWBIE = '44444444-4444-4444-4444-444444444444', STRANGER = '55555555-5555-5555-5555-555555555555'
await db.exec(`insert into auth.users values ('${NEWBIE}'), ('${STRANGER}')`)
assert.equal((await as<{ is_follower: boolean | null }>(null, 'select public.is_follower($1)', ['anyone']))[0].is_follower, null, 'no list yet = not checked')
await fails(FOLLOWER, 'select public.admin_set_followers($1)', [[sha('x')]], 'not_guild_master')
await fails(null, 'select public.admin_set_followers($1)', [[sha('x')]], 'permission denied')
await fails(GM, 'select public.admin_set_followers($1)', [['not-a-hash']], 'invalid_follower_list')
const [{ admin_set_followers: count }] = await as<{ admin_set_followers: number }>(GM, 'select public.admin_set_followers($1)', [[sha('real.follower'), sha('another_fan'), sha('real.follower')]])
assert.equal(count, 2, 'duplicates removed')
assert.equal((await as<{ is_follower: boolean }>(null, 'select public.is_follower($1)', ['@Real.Follower']))[0].is_follower, true)
assert.equal((await as<{ is_follower: boolean }>(null, 'select public.is_follower($1)', ['nobody_here']))[0].is_follower, false)
await fails(STRANGER, REG, ['nobody_here', 'Stranger', 'Shy', look, true, false], 'not_following')
const [ok] = await as<{ id: string }>(NEWBIE, REG, ['https://instagram.com/real.follower/', 'Real Fan', 'Kind', look, true, true])
assert.ok(ok.id)
const [p] = await as<{ follows: boolean }>(GM, `select * from public.admin_list_registrations('pending') where instagram = 'real.follower'`)
assert.equal(p.follows, true)
assert.equal((await as<{ follower_count: number }>(null, 'select * from public.follower_list_info()'))[0].follower_count, 2)
assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.instagram_followers where handle_hash = 'real.follower'`)).rows[0].n, 0, 'no plain usernames stored')
assert.equal((await as(FOLLOWER, 'select * from public.instagram_followers')).length, 0, 'follower hashes are not readable')

// ---------- Phase 5: recruitment + guild ----------
const EV = 'select public.admin_create_event($1, $2, $3, $4, $5, $6, $7, $8) as id'
const POST = 'https://www.instagram.com/p/AbC123_x/'
await fails(FOLLOWER, EV, ['Spring Recruitment', POST, '2026-11-01T00:00Z', '2026-11-10T00:00Z', 3, 1, 5, 2], 'not_guild_master')
await fails(GM, EV, ['Bad post', 'https://evil.example/p/1', '2026-11-01T00:00Z', '2026-11-10T00:00Z', 3, 1, 5, 2], 'check constraint')
const [{ id: ev }] = await as<{ id: string }>(GM, EV, ['Spring Recruitment', POST, '2026-11-01T00:00Z', '2026-11-10T00:00Z', 3, 1, 5, 2])
const c = (instagram: string, text: string, at: string, chars = text.length) => ({ instagram, text_hash: sha(text), chars, commented_at: at })
const comments = [
  // csv_one: 4 different good comments on 2 days, but max 2 count per day -> 3 valid (2 + 1)
  c('csv_one', 'go guild go!', '2026-11-02T10:00Z'), c('csv_one', 'pick me please', '2026-11-02T11:00Z'), c('csv_one', 'love this town', '2026-11-02T12:00Z'),
  c('csv_one', 'day two hello', '2026-11-03T09:00Z'),
  // csv_three: same text 3 times (counts once), one too short, one outside the window -> 1 valid
  c('csv_three', 'same text again', '2026-11-02T10:00Z'), c('csv_three', 'same text again', '2026-11-02T10:05Z'), c('csv_three', 'same text again', '2026-11-03T10:05Z'),
  c('csv_three', 'hi', '2026-11-02T10:10Z'), c('csv_three', 'too late comment', '2026-11-20T10:00Z'),
  // manual.member: 3 valid on separate days -> eligible
  c('manual.member', 'first comment!', '2026-11-04T10:00Z'), c('manual.member', 'second comment', '2026-11-05T10:00Z'), c('manual.member', 'third comment!', '2026-11-06T10:00Z'),
  // not a resident
  c('random.person', 'spam spam spam', '2026-11-02T10:00Z'), c('random.person', 'more spam here', '2026-11-03T10:00Z'), c('random.person', 'even more spam', '2026-11-04T10:00Z'),
  // the guild account itself and a broken row
  c('wandertales.guild', 'thanks everyone', '2026-11-02T10:00Z'), { instagram: 'bad..name', text_hash: 'x', chars: 1, commented_at: 'nope' },
]
const [{ admin_import_comments: imp }] = await as<{ admin_import_comments: { added: number; duplicates: number; invalid: number } }>(GM, 'select public.admin_import_comments($1, $2)', [ev, JSON.stringify(comments)])
assert.deepEqual(imp, { added: 16, duplicates: 0, invalid: 1 })
const [{ admin_import_comments: again }] = await as<{ admin_import_comments: { added: number; duplicates: number } }>(GM, 'select public.admin_import_comments($1, $2)', [ev, JSON.stringify(comments.slice(0, 3))])
assert.equal(again.duplicates, 3, 're-importing the same comments adds nothing')
type Entry = { place: number; instagram: string; total_comments: number; valid_comments: number; eligible: boolean; reason: string | null; status: string }
const board = await as<Entry>(null, 'select * from public.list_leaderboard($1)', [ev])
const byIg = Object.fromEntries(board.map((e) => [e.instagram, e]))
assert.equal(byIg['csv_one'].valid_comments, 3)
assert.equal(byIg['csv_one'].total_comments, 4)
assert.equal(byIg['csv_three'].valid_comments, 1)
assert.match(byIg['csv_three'].reason!, /Needs 2 more/)
assert.equal(byIg['manual.member'].eligible, true)
assert.equal(byIg['random.person'].reason, 'Not a registered resident')
assert.equal(byIg['wandertales.guild'].valid_comments, 0, 'guild account ignored')
assert.equal(board[0].place, 1)
// approval is manual, limited by slots, and only for eligible entries
await fails(GM, 'select public.admin_review_entry($1, $2, true)', [ev, 'random.person'], 'not_eligible')
await fails(FOLLOWER, 'select public.admin_review_entry($1, $2, true)', [ev, 'csv_one'], 'not_guild_master')
assert.equal((await as(null, 'select * from public.list_guild_members()')).length, 0, 'nobody recruited automatically')
const [{ admin_review_entry: memberId }] = await as<{ admin_review_entry: string }>(GM, 'select public.admin_review_entry($1, $2, true, $3)', [ev, 'csv_one', 'Mage'])
assert.ok(memberId)
await fails(GM, 'select public.admin_review_entry($1, $2, true, $3)', [ev, 'manual.member', 'Rogue'], 'no_slots_left')
await fails(GM, 'select public.admin_review_entry($1, $2, true, $3)', [ev, 'csv_one', 'Mage'], 'already_reviewed')
await as(GM, 'select public.admin_recalculate($1)', [ev])
assert.equal((await as<Entry>(null, 'select * from public.list_leaderboard($1)', [ev])).find((e) => e.instagram === 'csv_one')!.status, 'approved', 'recount keeps decisions')
// members: renown ranks up at thresholds, never down
type Member = { id: string; rank: number; rank_name: string; class: string; renown: number; display_name: string }
let [m] = await as<Member>(null, 'select * from public.list_guild_members()')
assert.deepEqual([m.rank_name, m.class, m.display_name], ['Novice', 'Mage', 'Ivy'])
await as(GM, 'select public.admin_add_renown($1, 120)', [memberId])
await as(GM, 'select public.admin_add_renown($1, 200)', [memberId]);
[m] = await as<Member>(null, 'select * from public.list_guild_members()')
assert.deepEqual([m.renown, m.rank_name], [320, 'Adventurer'])
await fails(GM, 'select public.admin_add_renown($1, 9999)', [memberId], 'invalid_amount')
await as(GM, 'select public.admin_update_member($1, $2, $3)', [memberId, 5, 'Paladin']);
[m] = await as<Member>(null, 'select * from public.list_guild_members()')
assert.deepEqual([m.rank_name, m.class], ['Elite', 'Paladin'])
await fails(null, 'select public.admin_remove_member($1)', [memberId], 'permission denied')
await as(GM, 'select public.admin_close_event($1)', [ev])
await fails(GM, 'select public.admin_import_comments($1, $2)', [ev, '[]'], 'event_not_open')
assert.equal((await as(FOLLOWER, 'select * from public.recruitment_comments')).length, 0, 'raw comments not readable')
console.log('guild database ok')

// ---------- cloud save: compare-and-set, Guild Master only ----------
type Write = { ok: boolean; rev?: number; current?: { rev: number; device: string; data: { day: number } } }
const SUM = JSON.stringify({ day: 1 })
const W = 'select public.cloud_save_write($1::jsonb, $2::jsonb, $3, $4) as r'
assert.equal((await as(GM, 'select public.cloud_save_load() as r'))[0].r, null, 'nothing saved yet')
let w = (await as<{ r: Write }>(GM, W, [JSON.stringify({ day: 3 }), SUM, 'laptop', 0]))[0].r
assert.deepEqual(w, { ok: true, rev: 1 })
// a second device that never synced still thinks the base is 0 → refused, gets the stored save back
w = (await as<{ r: Write }>(GM, W, [JSON.stringify({ day: 1 }), SUM, 'phone', 0]))[0].r
assert.equal(w.ok, false)
assert.deepEqual([w.current!.rev, w.current!.device, w.current!.data.day], [1, 'laptop', 3], 'conflict returns what is stored; nothing was overwritten')
assert.equal((await as<{ r: { rev: number; data: { day: number } } }>(GM, 'select public.cloud_save_load() as r'))[0].r.data.day, 3)
// after choosing "keep mine" the phone retries with the current revision
w = (await as<{ r: Write }>(GM, W, [JSON.stringify({ day: 1 }), SUM, 'phone', 1]))[0].r
assert.deepEqual(w, { ok: true, rev: 2 })
await fails(FOLLOWER, 'select public.cloud_save_load()', [], 'not_guild_master')
await fails(FOLLOWER, W, [JSON.stringify({ day: 9 }), SUM, 'x', 2], 'not_guild_master')
await fails(null, 'select public.cloud_save_load()', [], 'permission denied')
await fails(GM, W, ['[]', SUM, 'x', 2], 'invalid_save')
assert.equal((await as(GM, 'select * from public.game_saves')).length, 0, 'table is closed to everyone, even the Guild Master')
console.log('cloud save database ok')

const audit = await db.query<{ action: string }>('select action from public.audit_log order by id')
console.log('database ok · audit trail:', audit.rows.map((r) => r.action).join(', '))
