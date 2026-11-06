import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import { Character, type Anim } from './Character'
import { TownChibi, npcAppearance } from '../npc-generator/TownChibi'
import { PLAYER_KEY, loadCharacter } from '../character-creator/appearance'

/** The look made in the Character Creator, or a seeded Guild Master outfit. */
const playerLook = () => loadCharacter(PLAYER_KEY).then((s) => s?.appearance ?? npcAppearance('player', 'Guild Master'), () => npcAppearance('player', 'Guild Master'))
import { BUILDINGS, WORLD_HALF, buildingBox } from '../game/map'
import { blockers } from '../game/town'
import { circleHitsBox, slide } from '../game/collision'
import { cam, input, key, lerpAngle, npcLive, player } from '../game/live'
import { dayOf, useGame, type Selection } from '../game/store'
import { talkWithGM } from '../game/sim'
import { ROOM, ROOMS, enterInterior, isSpot, leaveInterior, roomKindOf, spotNearPlayer, useSpot } from '../game/interior'
import type { Appearance } from '../game/residents.mock'

const LOOK: Appearance = { skin: '#f1c9a5', hair: '#4a2c1c', hairStyle: 'short', shirt: '#2f4f7f', pants: '#3a2e26', height: 1.06 }

function findNearby(): Selection {
  if (useGame.getState().interior) { const id = spotNearPlayer(); return id ? { type: 'building', id } : null }
  const { x, z } = player.pos
  let best: Selection = null, bestD = 2.6
  for (const [id, n] of Object.entries(npcLive)) {
    const d = Math.hypot(n.x - x, n.z - z)
    if (n.visible && d < bestD) { best = { type: 'resident', id }; bestD = d }
  }
  if (best) return best
  const hit = BUILDINGS.find((b) => circleHitsBox(x, z, 2.2, buildingBox(b)))
  return hit ? { type: 'building', id: hit.id } : null
}

export function interact() {
  const s = useGame.getState()
  if (s.mode !== 'third' || !s.nearby) return
  if (isSpot(s.nearby.id)) return useSpot(s.nearby.id)
  if (s.nearby.type === 'resident') talkWithGM(s.nearby.id, dayOf(s.time))
  if (roomKindOf(s.nearby.id)) return enterInterior(s.nearby.id) // the door leads inside
  s.select(s.nearby)
}

export function Player() {
  const g = useRef<Group>(null!)
  const anim = useRef<Anim>({ speed: 0, mode: 'idle' })
  const name = useGame((s) => s.playerName)
  const mode = useGame((s) => s.mode)
  const scan = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'KeyE' && !(e.target instanceof HTMLInputElement)) interact() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = useGame.getState()
    const p = player.pos
    let speed = 0
    if (s.mode === 'third') {
      const fwd = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') + input.joy.y
      const right = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + input.joy.x
      const yaw = cam.tpYaw
      let mx = -Math.sin(yaw) * fwd + Math.cos(yaw) * right
      let mz = -Math.cos(yaw) * fwd - Math.sin(yaw) * right
      const len = Math.hypot(mx, mz)
      if (len > 0.08) {
        const sprint = key('ShiftLeft') || key('ShiftRight') || input.sprint
        speed = (sprint ? 7.5 : 4) * Math.min(1, len)
        mx /= len; mz /= len
        if (s.interior) { // room coordinates are local to its centre
          const [x, z] = slide(p.x - ROOM.cx, p.z - ROOM.cz, mx * speed * dt, mz * speed * dt, 0.4, ROOMS[roomKindOf(s.interior)!].boxes, 1e4)
          p.x = x + ROOM.cx; p.z = z + ROOM.cz
          if (z > ROOM.hz - 0.1) leaveInterior() // walked out through the door
        } else {
          const [x, z] = slide(p.x, p.z, mx * speed * dt, mz * speed * dt, 0.45, blockers(), WORLD_HALF)
          p.x = x; p.z = z
        }
        player.facing = lerpAngle(player.facing, Math.atan2(mx, mz), 1 - Math.exp(-dt * 12))
      }
    }
    anim.current.speed = speed
    anim.current.mode = speed > 0 ? 'walk' : 'idle'
    g.current.position.copy(p)
    g.current.rotation.y = player.facing

    scan.current -= dt
    if (scan.current <= 0) {
      scan.current = 0.2
      s.setNearby(s.mode === 'third' ? findNearby() : null)
    }
  })

  return (
    <group ref={g}>
      <TownChibi load={playerLook} motion={anim} fallback={<Character look={LOOK} anim={anim} cape="#b8392f" />} />
      {mode === 'third' && (
        <Html position={[0, 2.05, 0]} center pointerEvents="none" zIndexRange={[5, 0]}>
          <div className="nameplate gm">{name || 'Guild Master'}</div>
        </Html>
      )}
    </group>
  )
}
