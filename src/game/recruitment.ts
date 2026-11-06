// Recruitment events: comment CSV import + leaderboard scoring.
// scoreEntries() mirrors admin_recalculate() in supabase/migrations/0003_guild.sql (used by the local dev backend).
import { normalizeInstagram } from './avatar.ts'
import { parseCsv } from './csv.ts'
import { hashHandle } from './followers.ts'

export const GUILD_ACCOUNT = 'wandertales.guild'
export const CLASSES = ['Warrior', 'Mage', 'Archer', 'Rogue', 'Healer', 'Paladin'] as const
export type GuildClass = (typeof CLASSES)[number]
export const RANKS = [
  { rank: 1, name: 'Novice', minRenown: 0 }, { rank: 2, name: 'Apprentice', minRenown: 100 }, { rank: 3, name: 'Adventurer', minRenown: 300 },
  { rank: 4, name: 'Veteran', minRenown: 700 }, { rank: 5, name: 'Elite', minRenown: 1500 }, { rank: 6, name: 'Legendary', minRenown: 3000 },
] as const
export const rankName = (r: number) => RANKS[Math.max(0, Math.min(5, r - 1))].name
export const rankFor = (renown: number) => [...RANKS].reverse().find((r) => renown >= r.minRenown)!.rank

export interface RecruitEvent {
  id: string; title: string; postUrl: string; startsAt: string; endsAt: string
  minComments: number; minChars: number; maxPerDay: number; slots: number; status: 'open' | 'closed'; createdAt: string
}
export interface CommentRow { instagram: string; text_hash: string; chars: number; commented_at: string }
export interface Entry {
  place: number; instagram: string; totalComments: number; validComments: number
  eligible: boolean; reason: string | null; status: 'pending' | 'approved' | 'rejected'
}

export const validPostUrl = (u: string) => /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.trim())

/** Characters that carry meaning: letters and digits, ignoring @mentions, emoji and spaces. */
export const meaningfulChars = (text: string) => (text.replace(/@[\w.]+/g, '').match(/[\p{L}\p{N}]/gu) ?? []).length
const normText = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

function parseTime(raw: string): string | null {
  const t = raw.trim()
  if (/^\d{9,13}$/.test(t)) return new Date(Number(t) * (t.length <= 10 ? 1000 : 1)).toISOString()
  const d = Date.parse(t.includes('T') || t.endsWith('Z') ? t : t.replace(' ', 'T') + (/[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z'))
  return Number.isNaN(d) ? null : new Date(d).toISOString()
}

/**
 * Comment export CSV → rows ready to import. Comment text is hashed here and never uploaded.
 * Column names are matched loosely: username/user/instagram, text/comment, timestamp/date/created_at.
 */
export async function parseCommentsCsv(text: string): Promise<{ rows: CommentRow[]; problems: string[] }> {
  const [header, ...lines] = parseCsv(text)
  if (!header) return { rows: [], problems: ['The file is empty'] }
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h.trim().toLowerCase()))
  const iUser = find('username', 'user', 'instagram', 'owner_username', 'author', 'from')
  const iText = find('text', 'comment', 'content', 'message', 'comment_text')
  const iTime = find('timestamp', 'date', 'time', 'created_at', 'created', 'commented_at')
  if (iUser < 0 || iText < 0 || iTime < 0) return { rows: [], problems: ['Header needs username, text and timestamp columns'] }
  const rows: CommentRow[] = [], problems: string[] = []
  for (const [i, cells] of lines.entries()) {
    const h = normalizeInstagram(cells[iUser] ?? ''), at = parseTime(cells[iTime] ?? ''), body = cells[iText] ?? ''
    if (!h) { problems.push(`Line ${i + 2}: invalid username`); continue }
    if (!at) { problems.push(`Line ${i + 2}: unreadable date`); continue }
    rows.push({ instagram: h, text_hash: await hashHandle(normText(body)), chars: meaningfulChars(body), commented_at: at })
  }
  return { rows, problems }
}

/** Leaderboard from raw comments — same anti-spam rules as the database. */
export function scoreEntries(ev: RecruitEvent, comments: CommentRow[], residentByHandle: Map<string, string>,
  memberResidents: Set<string>, decided: Map<string, Entry['status']>): Entry[] {
  const start = Date.parse(ev.startsAt), end = Date.parse(ev.endsAt)
  const totals = new Map<string, number>()
  for (const c of comments) totals.set(c.instagram, (totals.get(c.instagram) ?? 0) + 1)
  // first occurrence of each (person, text) inside the window
  const firstSeen = new Map<string, CommentRow>()
  for (const c of [...comments].sort((a, b) => a.commented_at.localeCompare(b.commented_at))) {
    const t = Date.parse(c.commented_at)
    if (t < start || t > end || c.chars < ev.minChars || c.instagram === GUILD_ACCOUNT) continue
    const k = `${c.instagram}|${c.text_hash}`
    if (!firstSeen.has(k)) firstSeen.set(k, c)
  }
  const perDay = new Map<string, number>(), valid = new Map<string, number>(), lastAt = new Map<string, string>()
  for (const c of firstSeen.values()) {
    const k = `${c.instagram}|${c.commented_at.slice(0, 10)}`
    const n = (perDay.get(k) ?? 0) + 1
    perDay.set(k, n)
    if (n <= ev.maxPerDay) valid.set(c.instagram, (valid.get(c.instagram) ?? 0) + 1)
    if (!lastAt.has(c.instagram) || lastAt.get(c.instagram)! < c.commented_at) lastAt.set(c.instagram, c.commented_at)
  }
  const entries = [...totals.keys()].map((h) => {
    const v = valid.get(h) ?? 0, rid = residentByHandle.get(h)
    const status = decided.get(h) ?? 'pending'
    const reason = status === 'approved' ? null : rid && memberResidents.has(rid) ? 'Already a Guild Member' : !rid ? 'Not a registered resident'
      : v < ev.minComments ? `Needs ${ev.minComments - v} more valid comments` : null
    return { place: 0, instagram: h, totalComments: totals.get(h)!, validComments: v, eligible: reason === null, reason, status }
  })
  entries.sort((a, b) => b.validComments - a.validComments || (lastAt.get(a.instagram) ?? '~').localeCompare(lastAt.get(b.instagram) ?? '~') || a.instagram.localeCompare(b.instagram))
  entries.forEach((e, i) => (e.place = i + 1))
  return entries
}
