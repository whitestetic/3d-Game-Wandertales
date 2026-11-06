// CSV import for the Guild Master: parse, validate and de-duplicate before sending to the backend.
import type { ImportRow } from '../backend/types.ts'
import { PERSONALITIES, normalizeInstagram, randomAppearance, seedFrom, validName } from './avatar.ts'
import type { Personality } from './residents.mock.ts'

/** Minimal RFC 4180 parser: commas, quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

export interface PreviewRow { line: number; row: ImportRow | null; problem: string | null }
const YES = /^(yes|y|true|1|ya)$/i

/**
 * Expected header: instagram, display_name, consent, [personality], [show_instagram].
 * Rows without explicit consent are rejected. Avatars are generated from the handle.
 */
export function previewImport(text: string, existing: Set<string>): PreviewRow[] {
  const [header, ...lines] = parseCsv(text)
  if (!header) return []
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name)
  const iIg = col('instagram'), iName = col('display_name'), iConsent = col('consent'), iPers = col('personality'), iShow = col('show_instagram')
  if (iIg < 0 || iName < 0 || iConsent < 0) return [{ line: 1, row: null, problem: 'Header must include instagram, display_name and consent' }]
  const seen = new Set<string>()
  return lines.map((cells, i) => {
    const line = i + 2
    const h = normalizeInstagram(cells[iIg] ?? '')
    const name = (cells[iName] ?? '').trim()
    const persRaw = iPers >= 0 ? (cells[iPers] ?? '').trim() : ''
    const personality = (PERSONALITIES.find((p) => p.toLowerCase() === persRaw.toLowerCase()) ?? PERSONALITIES[seedFrom(h ?? name) % PERSONALITIES.length]) as Personality
    const problem = !h ? 'Invalid Instagram username'
      : !validName(name) ? 'Display name must be 2–24 characters'
        : !YES.test((cells[iConsent] ?? '').trim()) ? 'No consent'
          : persRaw && !PERSONALITIES.some((p) => p.toLowerCase() === persRaw.toLowerCase()) ? `Unknown personality "${persRaw}"`
            : existing.has(h) ? 'Already a resident'
              : seen.has(h) ? 'Duplicate in this file' : null
    if (h) seen.add(h)
    if (problem) return { line, row: null, problem }
    return { line, problem: null, row: {
      instagram: h!, display_name: name, personality, appearance: randomAppearance(seedFrom(h!)), consent: true,
      show_instagram: iShow >= 0 && YES.test((cells[iShow] ?? '').trim()),
    } }
  })
}
