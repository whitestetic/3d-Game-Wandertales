import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { animate, buildCharacter, GAME_SCALE, type CharacterRig, type Motion } from './characterKit'
import type { CharacterAppearance } from '../character-creator/appearance'

export interface ChibiMotion { speed: number; mode: 'idle' | 'walk' | 'work' }

/**
 * A master-rig chibi with modular equipment. Rebuilds only when the appearance actually changes;
 * swaps in place without remounting the parent. `scale` defaults to town scale.
 */
export function ChibiCharacter({ appearance, motion, scale = GAME_SCALE, onReady }: {
  appearance: CharacterAppearance; motion?: RefObject<ChibiMotion>; scale?: number; onReady?: () => void
}) {
  const holder = useRef<Group>(null!)
  const [rig, setRig] = useState<CharacterRig | null>(null)
  const key = useMemo(() => JSON.stringify(appearance), [appearance])
  const phase = useRef(Math.random() * 10)

  useEffect(() => {
    let alive = true, built: CharacterRig | null = null
    buildCharacter(JSON.parse(key)).then((r) => {
      if (!alive) { r.dispose(); return }
      built = r
      setRig(r)
      onReady?.()
    }).catch((e) => console.error('character build failed', e))
    return () => { alive = false; built?.dispose() }
  }, [key])

  useFrame((_, dt) => {
    if (!rig) return
    const m = motion?.current
    const mode: Motion = m?.mode ?? 'idle'
    phase.current += dt * (mode === 'walk' ? 4 + (m?.speed ?? 1) * 2.2 : mode === 'work' ? 6 : 1.5)
    animate(rig, mode, phase.current, Math.min(1, 0.4 + (m?.speed ?? 0) * 0.25))
  })

  return <group ref={holder} scale={scale}>{rig && <primitive object={rig.root} />}</group>
}
