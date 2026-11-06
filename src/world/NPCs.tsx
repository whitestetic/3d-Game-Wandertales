import { useCallback, useEffect, useRef } from 'react'
import { TownChibi, npcAppearance } from '../npc-generator/TownChibi'
import { roleFor } from '../npc-generator/npcGenerator'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import { Character, type Anim } from './Character'
import { NEIGHBORS, NODES, findPath, nearestNode } from '../game/map'
import { rng } from '../game/scenery'
import { lerpAngle, npcLive } from '../game/live'
import { useGame } from '../game/store'
import { activityLabel, residents, sim, socialPass, tickSim } from '../game/sim'
import { memberOf } from '../game/guild'
import { checkQuests } from '../backend/sync'
import { advanceCalendar } from '../game/calendar'
import type { Resident } from '../game/residents.mock'

/** Guild Members wear a cape in their class color. */
const CAPES: Record<string, string> = { Warrior: '#b8392f', Mage: '#6a4a8c', Archer: '#3f7a3a', Rogue: '#2f2a35', Healer: '#eeeeee', Paladin: '#d9b45a' }

const SPEED: Partial<Record<Resident['personality'], number>> = { Lazy: 1.0, Hardworking: 1.7, Adventurous: 1.8, Shy: 1.2 }

/** Moves one resident along the walk graph toward whatever the simulation wants. */
function NPC({ res, i }: { res: Resident; i: number }) {
  const g = useRef<Group>(null!)
  const bubble = useRef<HTMLDivElement>(null)
  const anim = useRef<Anim>({ speed: 0, mode: 'idle' })
  // guild members dress for their class, everyone else for their job
  const cls = memberOf(res.id)?.cls
  const role = roleFor(cls ?? res.profession)
  const look = useCallback(() => npcAppearance(res.id, role), [res.id, role])
  useEffect(() => () => { delete npcLive[res.id] }, [res.id])
  const selected = useGame((s) => s.selection?.type === 'resident' && s.selection.id === res.id)
  const mv = useRef<{ path: string[]; lastTarget: string | null | undefined; wait: number; facing: number; ox: number; oz: number; r: () => number } | null>(null)
  if (!mv.current) {
    const r = rng(i * 97 + 13)
    mv.current = { path: [], lastTarget: undefined, wait: r() * 3, facing: 0, ox: (r() - 0.5) * 1.2, oz: (r() - 0.5) * 1.2, r }
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1) // same cap as the clock
    const s = sim[res.id], m = mv.current!
    if (!s) return // just left town; unmounts on the next render
    if (m.lastTarget === undefined) { s.x = NODES[s.node][0] + m.ox; s.z = NODES[s.node][1] + m.oz } // first frame: snap to saved node

    // a building was removed under our feet: rejoin the road network
    if (!(s.node in NODES) || m.path.some((n) => !(n in NODES))) {
      if (!(s.node in NODES)) s.node = nearestNode(s.x, s.z)
      m.path = []
      m.lastTarget = null
    }
    // re-plan when the simulation picks a new destination (continue from the node we're heading to)
    if (s.target !== m.lastTarget) {
      m.lastTarget = s.target
      const from = m.path[0] ?? s.node
      m.path = s.target ? (m.path.length ? [from, ...findPath(from, s.target)] : findPath(from, s.target)) : m.path.slice(0, 1)
    }
    if (!s.target && !m.path.length && !s.talkingTo && (m.wait -= dt) <= 0) {
      const n = NEIGHBORS[s.node]
      m.path = [n[Math.floor(m.r() * n.length)]]
      m.wait = 2 + m.r() * 6
    }

    let speed = 0
    if (m.path.length && !s.talkingTo) {
      const tx = NODES[m.path[0]][0] + m.ox, tz = NODES[m.path[0]][1] + m.oz
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz)
      // walking keeps pace with fast-forwarded time so residents still reach places on time
      const fastForward = Math.max(1, useGame.getState().timeScale / 2)
      speed = (SPEED[res.personality] ?? 1.45) * (s.needs.energy < 25 ? 0.7 : 1) * fastForward
      if (d > 0.01) m.facing = lerpAngle(m.facing, Math.atan2(dx, dz), 1 - Math.exp(-dt * 8))
      // walk the full step, possibly past several waypoints when fast-forwarding
      let step = speed * dt
      while (m.path.length && step > 0) {
        const px = NODES[m.path[0]][0] + m.ox, pz = NODES[m.path[0]][1] + m.oz
        const dd = Math.hypot(px - s.x, pz - s.z)
        if (dd <= step) { s.x = px; s.z = pz; s.node = m.path.shift()!; step -= dd }
        else { s.x += ((px - s.x) / dd) * step; s.z += ((pz - s.z) / dd) * step; step = 0 }
      }
    } else if (s.talkingTo) {
      const o = sim[s.talkingTo]
      m.facing = lerpAngle(m.facing, Math.atan2(o.x - s.x, o.z - s.z), 1 - Math.exp(-dt * 6))
    }
    s.walking = speed > 0
    s.arrived = !m.path.length && (!s.target || s.node === s.target)

    anim.current.speed = Math.min(speed, 2.5) // keep legs readable when fast-forwarding
    anim.current.mode = speed ? 'walk' : s.activity === 'work' && s.arrived ? 'work' : 'idle'
    g.current.visible = !s.indoors
    g.current.position.set(s.x, 0, s.z)
    g.current.rotation.y = m.facing
    npcLive[res.id] = { x: s.x, z: s.z, activity: activityLabel(s), visible: !s.indoors }

    const b = bubble.current
    if (b) {
      const text = s.indoors ? '' : s.talkingTo ? '💬' : s.bubble && s.bubbleUntil > performance.now() ? s.bubble : ''
      if (b.textContent !== text) { b.textContent = text; b.style.display = text ? '' : 'none' }
    }
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return
    e.stopPropagation()
    useGame.getState().select({ type: 'resident', id: res.id })
  }

  return (
    <group ref={g} onClick={onClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}>
      <TownChibi load={look} motion={anim} fallback={<Character look={res.appearance} anim={anim} cape={CAPES[cls ?? '']} />} />
      <Html position={[0, 2.3, 0]} center pointerEvents="none" zIndexRange={[4, 0]}>
        <div ref={bubble} className="bubble" style={{ display: 'none' }} />
      </Html>
      {selected && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <ringGeometry args={[0.55, 0.75, 32]} />
            <meshBasicMaterial color="#ffd36b" />
          </mesh>
          <Html position={[0, 2.85, 0]} center pointerEvents="none" zIndexRange={[5, 0]}>
            <div className="nameplate">{res.name}</div>
          </Html>
        </>
      )}
    </group>
  )
}

/** Runs the life simulation in step with the game clock. */
function SimSystem() {
  const socialTimer = useRef(0)
  const last = useRef<number | null>(null)
  useFrame((_, rawDt) => {
    const { time } = useGame.getState()
    // advance by exactly the game time that passed, so needs stay in step with the clock
    const dtMin = last.current === null ? 0 : Math.max(0, Math.min(time - last.current, 30))
    last.current = time
    const news = advanceCalendar(time)
    if (news.length) useGame.getState().notify(news.join(' · '))
    tickSim(dtMin, time)
    checkQuests(time)
    if ((socialTimer.current -= rawDt) <= 0) { socialTimer.current = 0.3; socialPass(time) }
  })
  return null
}

export function NPCs() {
  useGame((s) => s.rev) // residents arrive and leave
  // the camera can't see the town from inside a room, so skip mounting town NPCs there (also avoids
  // a guild member being shown both in town and standing in the Guild Hall at once)
  const indoors = useGame((s) => !!s.interior)
  return (
    <>
      <SimSystem />
      {!indoors && residents.map((r) => <NPC key={r.id} res={r} i={[...r.id].reduce((a, c) => a + c.charCodeAt(0), 0)} />)}
    </>
  )
}
