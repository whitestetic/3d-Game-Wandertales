// Character appearance: the JSON saved for players and NPCs. Asset IDs are validated against the catalog,
// never trusted as file paths.
export const SLOTS = [
  'hair', 'headwear', 'hair_ornament', 'ears', 'torso', 'apron', 'chest_armor', 'shoulders', 'hands', 'legs', 'feet',
  'back', 'neck', 'waist', 'waist_side',
] as const
export type Slot = (typeof SLOTS)[number]
export type ChannelColors = Partial<Record<'primary' | 'secondary' | 'trim' | 'leather' | 'metal' | 'hair' | 'gem' | 'cloth' | 'dark', string>>

export interface CharacterAppearance {
  schemaVersion: 1
  name?: string
  skin: string
  eyes: string
  height: number
  equipment: Partial<Record<Slot, string | null>>
  /** per-slot channel color overrides, e.g. { hair: { hair: '#c86fa0' } } */
  colors: Partial<Record<Slot, ChannelColors>>
}

export const SKIN_TONES = ['#f6dcc6', '#efc9a8', '#e2b08a', '#d39b72', '#b97d57', '#9a6142', '#7a4a30', '#5c3622']
export const EYE_COLORS = ['#2a1f1a', '#3e5c8a', '#3f7a3a', '#6b3e22', '#5a5a5a', '#8a3d9c', '#b8392f']
export const PALETTE = ['#f2e3c6', '#e8dcc8', '#c9b28a', '#d9b45a', '#e7c35b', '#c98a4b', '#9c3d3d', '#b8392f', '#cf7fa3', '#8a5a9a', '#5b3d8a', '#3e5c8a', '#4f6fb0', '#3f7a8c', '#4f7a45', '#3f6b3a', '#7a5434', '#6b4a2e', '#5c4430', '#3a2e26', '#9aa0a8', '#d6d9de', '#2f2a35', '#eeeeee']
export const HAIR_COLORS = ['#1d1714', '#3a2416', '#4a2c1c', '#6b3e22', '#8a4b2a', '#b8442e', '#d7a64a', '#e5c06e', '#c9b28a', '#eeeeee', '#5a5a5a', '#2f5a3a', '#4f6fb0', '#c86fa0', '#8a3d9c']

export const defaultAppearance = (): CharacterAppearance => ({
  schemaVersion: 1, skin: SKIN_TONES[1], eyes: EYE_COLORS[0], height: 1,
  equipment: { hair: 'hair_short', torso: 'tunic_green', feet: 'boots_leather' }, colors: {},
})

const HEX = /^#[0-9a-f]{6}$/i

/** Validate untrusted JSON (imports, saves) against the catalog. Returns a clean copy or throws. */
export function validateAppearance(raw: unknown, catalog: { id: string; slot: string; readyForPlayer: boolean }[], allowNotReady = false): CharacterAppearance {
  if (!raw || typeof raw !== 'object') throw new Error('Appearance must be an object')
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== 1) throw new Error('Unsupported schemaVersion')
  const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback)
  const equipment: CharacterAppearance['equipment'] = {}
  for (const [slot, id] of Object.entries((r.equipment as Record<string, unknown>) ?? {})) {
    if (!(SLOTS as readonly string[]).includes(slot) || id === null || id === undefined) continue
    const a = catalog.find((x) => x.id === id)
    if (!a) throw new Error(`Unknown asset "${String(id)}"`)
    if (a.slot !== slot) throw new Error(`Asset "${a.id}" does not go in slot "${slot}"`)
    if (!a.readyForPlayer && !allowNotReady) throw new Error(`Asset "${a.id}" has not passed QC`)
    equipment[slot as Slot] = a.id
  }
  const colors: CharacterAppearance['colors'] = {}
  for (const [slot, ch] of Object.entries((r.colors as Record<string, Record<string, unknown>>) ?? {})) {
    if (!(SLOTS as readonly string[]).includes(slot) || !ch || typeof ch !== 'object') continue
    colors[slot as Slot] = Object.fromEntries(Object.entries(ch).filter(([, v]) => typeof v === 'string' && HEX.test(v)))
  }
  const height = typeof r.height === 'number' ? Math.min(1.1, Math.max(0.9, r.height)) : 1
  return {
    schemaVersion: 1, name: typeof r.name === 'string' ? r.name.slice(0, 40) : undefined,
    skin: color(r.skin, SKIN_TONES[1]), eyes: color(r.eyes, EYE_COLORS[0]), height, equipment, colors,
  }
}

// ---------- IndexedDB storage (per browser) ----------
const DB = 'wandertales-characters', STORE = 'characters'
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((res, rej) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
export interface SavedCharacter { key: string; savedAt: string; appearance: CharacterAppearance }
export const saveCharacter = (key: string, appearance: CharacterAppearance) =>
  tx('readwrite', (s) => s.put({ key, savedAt: new Date().toISOString(), appearance } satisfies SavedCharacter, key))
export const loadCharacter = (key: string) => tx<SavedCharacter | undefined>('readonly', (s) => s.get(key))
export const deleteCharacter = (key: string) => tx('readwrite', (s) => s.delete(key))
export async function listCharacters(): Promise<SavedCharacter[]> {
  const all = await tx<SavedCharacter[]>('readonly', (s) => s.getAll() as IDBRequest<SavedCharacter[]>)
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}
/** The Guild Master's look in town. */
export const PLAYER_KEY = 'player'
