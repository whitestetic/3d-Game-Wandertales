import { useEffect, useState, type RefObject } from 'react'
import { ChibiCharacter, type ChibiMotion } from '../threejs/ChibiCharacter'
import { loadCatalog } from '../threejs/characterKit'
import { loadCharacter, saveCharacter, type CharacterAppearance } from '../character-creator/appearance'
import { generateNpcAppearance, type Role } from './npcGenerator'

let available: Promise<Set<string>> | null = null
const availableIds = () => (available ??= loadCatalog().then((c) => new Set(c.assets.filter((a) => a.readyForPlayer).map((a) => a.id))))

/** Saved look for this NPC, or a seeded one that is saved so it never changes unless regenerated. */
export async function npcAppearance(id: string, role: Role): Promise<CharacterAppearance> {
  const key = `npc:${id}:${role}`
  const saved = await loadCharacter(key).catch(() => undefined)
  if (saved) return saved.appearance
  const app = generateNpcAppearance(id, role, { available: await availableIds() })
  saveCharacter(key, app).catch(() => {}) // storage blocked: still deterministic from the seed
  return app
}

/** Master-rig character in town; shows `fallback` until the GLBs are loaded. */
export function TownChibi({ load, motion, fallback }: { load: () => Promise<CharacterAppearance>; motion: RefObject<ChibiMotion>; fallback: React.ReactNode }) {
  const [app, setApp] = useState<CharacterAppearance | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { let alive = true; load().then((a) => alive && setApp(a)).catch(() => {}); return () => { alive = false } }, [load])
  return <>{!ready && fallback}{app && <group visible={ready}><ChibiCharacter appearance={app} motion={motion} onReady={() => setReady(true)} /></group>}</>
}
