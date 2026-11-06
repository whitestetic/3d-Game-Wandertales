// Reads @wandertales.guild's follower list from Instagram's official "Download your information"
// export (JSON or HTML), or a plain list of usernames. No scraping, no API.
import { normalizeInstagram } from './avatar.ts'

const LINK = /instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{1,30})/g

function fromJson(data: unknown, out: Set<string>) {
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    // export entries look like { string_list_data: [{ href, value, timestamp }] } (newer ones put the name in title)
    if (Array.isArray(o.string_list_data)) {
      for (const d of o.string_list_data as Record<string, unknown>[]) {
        const h = normalizeInstagram(String(d.value ?? '')) ?? (typeof d.href === 'string' ? normalizeInstagram(d.href.replace('/_u/', '/')) : null)
        if (h) out.add(h)
      }
      if (typeof o.title === 'string' && o.title) { const h = normalizeInstagram(o.title); if (h) out.add(h) }
      return
    }
    Object.values(o).forEach(walk)
  }
  walk(data)
}

/** Usernames found in one export file. Accepts followers_*.json, followers_*.html, or one username per line. */
export function parseFollowerExport(text: string): Set<string> {
  const out = new Set<string>()
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { fromJson(JSON.parse(t), out); return out } catch { /* not JSON after all */ }
  }
  if (/<a\s|<html/i.test(t)) {
    for (const m of t.matchAll(LINK)) { const h = normalizeInstagram(m[1]); if (h) out.add(h) }
    return out
  }
  for (const line of t.split(/[\r\n,;]+/)) { const h = normalizeInstagram(line); if (h) out.add(h) }
  return out
}

/** SHA-256 hex of a normalized username — what the database stores instead of the name. */
export async function hashHandle(h: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(h))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
