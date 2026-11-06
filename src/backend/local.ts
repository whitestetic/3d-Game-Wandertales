// Local development backend: same rules as the Supabase functions, stored in this browser only.
// Clearly labelled "Local dev" in the UI. Not shared between devices and not secure — never use it live.
import { normalizeInstagram, validAppearance, validName, PERSONALITIES } from '../game/avatar.ts'
import { hashHandle } from '../game/followers.ts'
import { RANKS, rankFor, rankName, scoreEntries, validPostUrl, type CommentRow, type Entry, type GuildClass, type RecruitEvent } from '../game/recruitment.ts'
import type { Backend, CloudSave, CommunityResident, ImportResult, Registration, RegistrationInput } from './types.ts'

const KEY = 'wt.community.local'
interface Store {
  registrations: (Registration & { applicant: string | null })[]
  residents: (CommunityResident & { realInstagram: string; registrationId: string })[]
  followers?: { hashes: string[]; uploadedAt: string }
  events?: RecruitEvent[]
  comments?: Record<string, CommentRow[]>
  decisions?: Record<string, Record<string, Entry['status']>>
  members?: { id: string; residentId: string; rank: number; cls: GuildClass; renown: number; joinedAt: string; eventId: string | null }[]
}

// the "cloud" of the local backend: one slot in this browser, so the conflict flow can be tried without Supabase
const CLOUD_KEY = 'wt.cloudsave.local'
const MAX_CLOUD_BYTES = 4_000_000
const readCloud = (): CloudSave | null => {
  try { return JSON.parse(localStorage.getItem(CLOUD_KEY) ?? 'null') as CloudSave | null } catch { return null }
}

const read = (): Store => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '') as Store } catch { return { registrations: [], residents: [] } }
}
const write = (s: Store) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* blocked */ } }
const uuid = () => crypto.randomUUID()
const code = () => `WTG-${Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, '0')}`
function applicantId() {
  try {
    let id = localStorage.getItem('wt.applicant')
    if (!id) { id = uuid(); localStorage.setItem('wt.applicant', id) }
    return id
  } catch { return 'no-storage' }
}

function validate(input: RegistrationInput, s: Store) {
  const h = normalizeInstagram(input.instagram)
  if (!h) throw new Error('invalid_instagram')
  if (!validName(input.displayName)) throw new Error('invalid_name')
  if (!PERSONALITIES.includes(input.personality)) throw new Error('invalid_personality')
  if (!validAppearance(input.appearance)) throw new Error('invalid_appearance')
  if (!input.consentData) throw new Error('consent_required')
  if (s.registrations.some((r) => r.instagram === h && r.status !== 'rejected') || s.residents.some((r) => r.realInstagram === h)) throw new Error('already_registered')
  return h
}

function makeResident(s: Store, reg: Registration): string {
  const id = uuid()
  s.residents.push({
    id, registrationId: reg.id, displayName: reg.displayName, realInstagram: reg.instagram, instagram: reg.showInstagram ? reg.instagram : null,
    personality: reg.personality, appearance: reg.appearance, homeBuildingId: null, createdAt: new Date().toISOString(),
  })
  return id
}

function addApproved(s: Store, input: RegistrationInput, source: 'admin' | 'csv') {
  const h = validate(input, s)
  const reg = { id: uuid(), applicant: null, follows: null, instagram: h, displayName: input.displayName.trim(), personality: input.personality, appearance: input.appearance,
    status: 'approved' as const, verificationCode: 'MANUAL', source, showInstagram: input.showInstagram, reviewNote: null, createdAt: new Date().toISOString() }
  s.registrations.push(reg)
  return makeResident(s, reg)
}

function board(s: Store, eventId: string): Entry[] {
  const ev = s.events?.find((e) => e.id === eventId)
  if (!ev) throw new Error('not_found')
  const byHandle = new Map(s.residents.map((r) => [r.realInstagram, r.id]))
  const members = new Set((s.members ?? []).map((m) => m.residentId))
  return scoreEntries(ev, s.comments?.[eventId] ?? [], byHandle, members, new Map(Object.entries(s.decisions?.[eventId] ?? {})))
}

async function followCheck(s: Store, h: string): Promise<boolean | null> {
  if (!s.followers) return null
  return s.followers.hashes.includes(await hashHandle(h))
}

const strip = ({ realInstagram: _a, registrationId: _b, ...r }: Store['residents'][number]): CommunityResident => r

export const localBackend: Backend = {
  mode: 'local',
  async register(input) {
    const s = read(), me = applicantId()
    const h = validate(input, s)
    const follows = await followCheck(s, h)
    if (follows === false) throw new Error('not_following')
    if (s.registrations.some((r) => r.applicant === me && r.status === 'pending')) throw new Error('already_pending')
    const reg = { id: uuid(), applicant: me, follows, instagram: h, displayName: input.displayName.trim(), personality: input.personality, appearance: input.appearance,
      status: 'pending' as const, verificationCode: code(), source: 'self' as const, showInstagram: input.showInstagram, reviewNote: null, createdAt: new Date().toISOString() }
    s.registrations.push(reg)
    write(s)
    return { id: reg.id, verificationCode: reg.verificationCode, status: reg.status }
  },
  async myRegistration() {
    const me = applicantId()
    return [...read().registrations].reverse().find((r) => r.applicant === me) ?? null
  },
  async withdraw() {
    const s = read(), me = applicantId()
    const mine = new Set(s.registrations.filter((r) => r.applicant === me).map((r) => r.id))
    s.residents = s.residents.filter((r) => !mine.has(r.registrationId))
    s.registrations = s.registrations.filter((r) => r.applicant !== me)
    write(s)
  },
  async listResidents() { return read().residents.map(strip) },
  async isFollower(instagram) {
    const h = normalizeInstagram(instagram), s = read()
    if (!s.followers) return null
    return h ? followCheck(s, h) : false
  },
  async followerListInfo() {
    const f = read().followers
    return f ? { uploadedAt: f.uploadedAt, count: f.hashes.length } : null
  },
  async listGuildMembers() {
    const s = read()
    return (s.members ?? []).filter((m) => s.residents.some((r) => r.id === m.residentId)).map((m) => ({
      id: m.id, residentId: m.residentId, displayName: s.residents.find((r) => r.id === m.residentId)!.displayName,
      rank: m.rank, rankName: rankName(m.rank), cls: m.cls, renown: m.renown, joinedAt: m.joinedAt,
    })).sort((a, b) => b.rank - a.rank || b.renown - a.renown)
  },
  async listEvents() { return [...(read().events ?? [])].reverse() },
  async leaderboard(eventId) { return board(read(), eventId) },
  async createEvent(e) {
    if (e.title.trim().length < 3 || e.title.trim().length > 60) throw new Error('Title must be 3 to 60 characters')
    if (!validPostUrl(e.postUrl)) throw new Error('Use an Instagram post link like https://www.instagram.com/p/ABC123/')
    if (!(Date.parse(e.endsAt) > Date.parse(e.startsAt))) throw new Error('The end must be after the start')
    const s = read(), id = uuid()
    ;(s.events ??= []).push({ id, title: e.title.trim(), postUrl: e.postUrl.trim(), startsAt: e.startsAt, endsAt: e.endsAt, minComments: e.minComments,
      minChars: e.minChars, maxPerDay: e.maxPerDay, slots: e.slots, status: 'open', createdAt: new Date().toISOString() })
    write(s)
    return id
  },
  async importComments(eventId, rows) {
    const s = read(), ev = s.events?.find((e) => e.id === eventId)
    if (!ev || ev.status !== 'open') throw new Error('event_not_open')
    const list = ((s.comments ??= {})[eventId] ??= [])
    const seen = new Set(list.map((c) => `${c.instagram}|${c.text_hash}|${c.commented_at}`))
    let added = 0, duplicates = 0, invalid = 0
    for (const r of rows) {
      const h = normalizeInstagram(r.instagram)
      if (!h || !/^[0-9a-f]{64}$/.test(r.text_hash) || Number.isNaN(Date.parse(r.commented_at))) { invalid++; continue }
      const at = new Date(r.commented_at).toISOString()
      const k = `${h}|${r.text_hash}|${at}`
      if (seen.has(k)) { duplicates++; continue }
      seen.add(k)
      list.push({ ...r, instagram: h, commented_at: at })
      added++
    }
    write(s)
    return { added, duplicates, invalid }
  },
  async reviewEntry(eventId, instagram, approve, cls) {
    const s = read(), ev = s.events?.find((e) => e.id === eventId)
    if (!ev) throw new Error('not_found')
    const entry = board(s, eventId).find((e) => e.instagram === instagram)
    if (!entry) throw new Error('not_found')
    if (entry.status !== 'pending') throw new Error('already_reviewed')
    const dec = ((s.decisions ??= {})[eventId] ??= {})
    if (approve) {
      if (!entry.eligible) throw new Error('not_eligible')
      if (Object.values(dec).filter((d) => d === 'approved').length >= ev.slots) throw new Error('no_slots_left')
      const rid = s.residents.find((r) => r.realInstagram === instagram)!.id
      ;(s.members ??= []).push({ id: uuid(), residentId: rid, rank: 1, cls, renown: 0, joinedAt: new Date().toISOString(), eventId })
    }
    dec[instagram] = approve ? 'approved' : 'rejected'
    write(s)
  },
  async closeEvent(eventId) {
    const s = read(), ev = s.events?.find((e) => e.id === eventId)
    if (ev) { ev.status = 'closed'; write(s) }
  },
  async updateMember(id, rank, cls) {
    const s = read(), m = s.members?.find((x) => x.id === id)
    if (!m) throw new Error('not_found')
    if (rank !== null) m.rank = Math.max(1, Math.min(RANKS.length, rank))
    if (cls !== null) m.cls = cls
    write(s)
  },
  async addRenown(id, amount) {
    if (!(amount >= 1 && amount <= 500)) throw new Error('invalid_amount')
    const s = read(), m = s.members?.find((x) => x.id === id)
    if (!m) throw new Error('not_found')
    m.renown += Math.round(amount)
    m.rank = Math.max(m.rank, rankFor(m.renown))
    write(s)
    return m.rank
  },
  async removeMember(id) {
    const s = read()
    s.members = (s.members ?? []).filter((m) => m.id !== id)
    write(s)
  },
  async cloudLoad() { return readCloud() },
  async cloudSave(data, summary, device, baseRev) {
    if (!data || typeof data !== 'object') throw new Error('invalid_save')
    const json = JSON.stringify(data)
    if (json.length > MAX_CLOUD_BYTES) throw new Error('save_too_large')
    const cur = readCloud()
    if ((cur?.rev ?? 0) !== baseRev) return { ok: false, current: cur! }
    const next: CloudSave = { rev: (cur?.rev ?? 0) + 1, savedAt: new Date().toISOString(), device, summary, data }
    try { localStorage.setItem(CLOUD_KEY, JSON.stringify(next)) } catch { throw new Error('storage_full') }
    return { ok: true, rev: next.rev }
  },
  async setFollowers(hashes) {
    if (!hashes.length) throw new Error('empty_follower_list')
    if (hashes.some((x) => !/^[0-9a-f]{64}$/.test(x))) throw new Error('invalid_follower_list')
    const s = read()
    s.followers = { hashes: [...new Set(hashes)], uploadedAt: new Date().toISOString() }
    write(s)
    return s.followers.hashes.length
  },
  // in local mode the person at the keyboard is the Guild Master
  async session() { return { signedIn: true, email: null, isGuildMaster: true } },
  async signIn() {},
  async signOut() {},
  async listRegistrations(status) { return read().registrations.filter((r) => r.status === status) },
  async review(id, approve, note) {
    const s = read(), reg = s.registrations.find((r) => r.id === id)
    if (!reg) throw new Error('not_found')
    if (reg.status !== 'pending') throw new Error('already_reviewed')
    reg.status = approve ? 'approved' : 'rejected'
    reg.reviewNote = note ?? null
    if (approve) makeResident(s, reg)
    write(s)
  },
  async addResident(input) {
    const s = read(), id = addApproved(s, input, 'admin')
    write(s)
    return id
  },
  async importResidents(rows) {
    const s = read()
    const results: ImportResult[] = rows.map((row, i) => {
      try {
        const id = addApproved(s, { instagram: row.instagram, displayName: row.display_name, personality: row.personality, appearance: row.appearance,
          consentData: row.consent, showInstagram: row.show_instagram }, 'csv')
        return { row: i + 1, ok: true, resident_id: id }
      } catch (e) { return { row: i + 1, ok: false, error: (e as Error).message } }
    })
    write(s)
    return results
  },
  async removeResident(id) {
    const s = read(), res = s.residents.find((r) => r.id === id)
    s.residents = s.residents.filter((r) => r.id !== id)
    if (res) s.registrations = s.registrations.filter((r) => r.id !== res.registrationId)
    write(s)
  },
  async setHome(id, home) {
    const s = read(), res = s.residents.find((r) => r.id === id)
    if (res) { res.homeBuildingId = home; write(s) }
  },
}
