// Town Chronicle: a running diary of what happened in town. Pure logic (testable headless).
export type ChronKind = 'season' | 'weather' | 'festival' | 'build' | 'quest' | 'people' | 'milestone'
export interface Chron { t: number; kind: ChronKind; icon: string; text: string }

export const MAX_ENTRIES = 300
export const chronicle = {
  entries: [] as Chron[],
  /** keys of one-time entries (milestones) so they are never logged twice */
  seen: [] as string[],
  /** last game day the calendar processed */
  lastDay: -1,
}

/** Add an entry (newest first). With a `key`, the same entry is only ever logged once. */
export function chron(t: number, kind: ChronKind, icon: string, text: string, key?: string) {
  if (key) {
    if (chronicle.seen.includes(key)) return
    chronicle.seen.push(key)
    if (chronicle.seen.length > 200) chronicle.seen.shift()
  }
  chronicle.entries.unshift({ t, kind, icon, text })
  if (chronicle.entries.length > MAX_ENTRIES) chronicle.entries.length = MAX_ENTRIES
}

export const serializeChronicle = () => ({ entries: chronicle.entries, seen: chronicle.seen, lastDay: chronicle.lastDay })
export function loadChronicle(d: Partial<ReturnType<typeof serializeChronicle>> | undefined) {
  chronicle.entries = Array.isArray(d?.entries) ? d.entries.slice(0, MAX_ENTRIES) : []
  chronicle.seen = Array.isArray(d?.seen) ? d.seen.slice(-200) : []
  chronicle.lastDay = typeof d?.lastDay === 'number' ? d.lastDay : -1
}
export const resetChronicle = () => loadChronicle({})
