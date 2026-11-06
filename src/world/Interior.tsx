// The Guild Hall interior, built from boxes (no model files). Layout follows the reference art:
// wooden hall, red-carpet staircase on the left, quest board + reception desk at the back, fireplace on the right.
import { useCallback, useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ROOM, roomKindOf, type RoomId } from '../game/interior'
import { rng } from '../game/scenery'
import { guild, memberOf } from '../game/guild'
import { TownChibi, npcAppearance } from '../npc-generator/TownChibi'
import { roleFor } from '../npc-generator/npcGenerator'
import type { ChibiMotion } from '../threejs/ChibiCharacter'
import type { GuildMember } from '../backend/types'
import { getBuilding } from '../game/map'
import { residents, sim } from '../game/sim'
import type { Resident } from '../game/residents.mock'
import { useGame } from '../game/store'
import { geo, mat } from './materials'

type V3 = [number, number, number]
const WOOD = '#7a4b27', DARK = '#4d3220', BEAM = '#5a3a22', PLASTER = '#e8d9b8', STONE = '#9a9a9a', RED = '#a82e2c', GOLD = '#d9b04a'

function Box({ p, s, c, rx = 0, ry = 0, rz = 0, emissive }: { p: V3; s: V3; c: string; rx?: number; ry?: number; rz?: number; emissive?: string }) {
  return <mesh geometry={geo.box} material={emissive ? mat(c, { emissive }) : mat(c)} position={p} scale={s} rotation={[rx, ry, rz]} castShadow receiveShadow />
}
function Cyl({ p, r, h, c, rz = 0 }: { p: V3; r: number; h: number; c: string; rz?: number }) {
  return <mesh geometry={geo.cyl} material={mat(c)} position={p} scale={[r, h, r]} rotation={[0, 0, rz]} castShadow receiveShadow />
}

/** Plank floor drawn once on a canvas. */
function useFloorTexture() {
  return useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 256
    const g = cv.getContext('2d')!, r = rng(21)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(${28 + r() * 6}, ${48 + r() * 10}%, ${36 + r() * 9}%)`
      g.fillRect(0, i * 32, 256, 32)
      g.fillStyle = 'rgba(40,20,8,0.55)'
      g.fillRect(0, i * 32, 256, 2)
      g.fillRect(r() * 220 + 10, i * 32, 2, 32) // plank joint
    }
    const t = new THREE.CanvasTexture(cv)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(5, 4)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.NearestFilter
    return t
  }, [])
}

/** Half-timbered wall: plaster, stone base and dark posts. `len` runs along the wall. */
function Wall({ at, len, ry, gap }: { at: V3; len: number; ry: number; gap?: number }) {
  const posts = Math.max(2, Math.round(len / 3))
  return (
    <group position={at} rotation={[0, ry, 0]}>
      <Box p={[0, 2.3, 0]} s={[len, 4.6, 0.4]} c={PLASTER} />
      <Box p={[0, 0.45, 0.22]} s={[len, 0.9, 0.08]} c="#8f8f95" />
      <Box p={[0, 2.5, 0.22]} s={[len, 0.22, 0.1]} c={BEAM} />
      <Box p={[0, 4.45, 0.22]} s={[len, 0.25, 0.12]} c={BEAM} />
      {Array.from({ length: posts + 1 }, (_, i) => (i / posts - 0.5) * len).filter((x) => gap === undefined || Math.abs(x) > gap).map((x, i) => (
        <Box key={i} p={[x, 2.3, 0.22]} s={[0.28, 4.6, 0.12]} c={BEAM} />
      ))}
    </group>
  )
}

function Lantern({ p, light = 0 }: { p: V3; light?: number }) {
  return (
    <group position={p}>
      <Box p={[0, 0, 0]} s={[0.26, 0.38, 0.26]} c="#fff1c0" emissive="#ffb347" />
      <Box p={[0, 0.24, 0]} s={[0.32, 0.07, 0.32]} c="#2b2118" />
      <Box p={[0, -0.24, 0]} s={[0.32, 0.07, 0.32]} c="#2b2118" />
      {light > 0 && <pointLight color="#ffb35a" intensity={light} distance={15} decay={1.6} />}
    </group>
  )
}

function Plant({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <Cyl p={[0, 0.3, 0]} r={0.34} h={0.6} c="#6b4423" />
      <mesh geometry={geo.sphere} material={mat('#3f8f3f')} position={[0, 0.95, 0]} scale={[0.5, 0.6, 0.5]} castShadow />
      <mesh geometry={geo.sphere} material={mat('#58a84a')} position={[0.1, 1.25, 0.05]} scale={[0.32, 0.36, 0.32]} />
    </group>
  )
}

function Banner({ p, ry = 0 }: { p: V3; ry?: number }) {
  return (
    <group position={p} rotation={[0, ry, 0]}>
      <Box p={[0, 1.4, 0]} s={[1.5, 0.08, 0.08]} c={GOLD} />
      <Box p={[0, 0, 0]} s={[1.1, 2.6, 0.05]} c={RED} />
      <Box p={[0, -1.35, 0]} s={[1.1, 0.12, 0.06]} c={GOLD} />
      <Box p={[0, 0.2, 0.04]} s={[0.1, 1.0, 0.03]} c={GOLD} rz={0.75} />
      <Box p={[0, 0.2, 0.04]} s={[0.1, 1.0, 0.03]} c={GOLD} rz={-0.75} />
      <Box p={[0, 0.85, 0.04]} s={[0.45, 0.22, 0.03]} c={GOLD} />
    </group>
  )
}

function Stairs() {
  const N = 12, RUN = 0.55, RISE = 0.3, X = -6.7
  return (
    <group>
      {Array.from({ length: N }, (_, i) => {
        const top = (i + 1) * RISE, z = 3.0 - i * RUN - RUN / 2
        return (
          <group key={i}>
            <Box p={[X, top / 2, z]} s={[2.4, top, RUN]} c="#8a5a32" />
            <Box p={[X, top + 0.02, z]} s={[1.5, 0.05, RUN]} c="#b32d2d" />
            {i % 2 === 0 && <Box p={[-5.45, top + 0.55, z]} s={[0.12, 1.1, 0.12]} c={WOOD} />}
          </group>
        )
      })}
      <Box p={[X, N * RISE - 0.1, -6.2]} s={[2.4, 0.2, 1.6]} c="#8a5a32" />
      <Box p={[-5.45, (N * RISE) / 2 + 1.05, 3.0 - (N * RUN) / 2]} s={[0.14, 0.14, Math.hypot(N * RUN, N * RISE)]} c="#6b4423" rx={Math.atan2(N * RISE, N * RUN)} />
    </group>
  )
}

function Books({ p, w, rows, seed }: { p: V3; w: number; rows: number; seed: number }) {
  const list = useMemo(() => {
    const r = rng(seed), out: { p: V3; s: V3; c: string }[] = []
    const colors = ['#2f5aa8', '#a83a30', '#3f8f4a', '#d4a443', '#6a3a8a', '#e8dcc0']
    for (let row = 0; row < rows; row++) {
      let z = -w / 2 + 0.1
      while (z < w / 2 - 0.15) {
        const bw = 0.12 + r() * 0.1, bh = 0.4 + r() * 0.22
        out.push({ p: [0, 0.42 + row * 0.72 + bh / 2, z + bw / 2], s: [0.4, bh, bw], c: colors[Math.floor(r() * colors.length)] })
        z += bw + 0.015
      }
    }
    return out
  }, [w, rows, seed])
  return <group position={p}>{list.map((b, i) => <Box key={i} {...b} />)}</group>
}

function Fire({ p = [6.55, 0.15, 1.5] }: { p?: V3 }) {
  const flames = useRef<THREE.Group>(null!), light = useRef<THREE.PointLight>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    flames.current.children.forEach((f, i) => { f.scale.y = 0.8 + Math.sin(t * (7 + i * 2.3) + i) * 0.3; f.rotation.y = t * (1 + i * 0.4) })
    light.current.intensity = 16 + Math.sin(t * 9) * 3 + Math.sin(t * 23) * 2
  })
  const fire = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ff9a2a', emissive: '#ff5a10', emissiveIntensity: 2.2 }), [])
  return (
    <group position={p}>
      <Cyl p={[0, 0.12, -0.35]} r={0.12} h={0.9} c="#4a2e1a" rz={Math.PI / 2} />
      <Cyl p={[0, 0.12, 0.3]} r={0.12} h={0.9} c="#5a3a22" rz={Math.PI / 2} />
      <group ref={flames} position={[0, 0.2, 0]}>
        {[[-0.2, 0.9], [0.15, 1.2], [0, 0.7]].map(([z, h], i) => <mesh key={i} geometry={geo.cone4} material={fire} position={[0, h / 2, z]} scale={[0.4, h, 0.4]} />)}
      </group>
      <pointLight ref={light} color="#ff8a30" intensity={16} distance={14} decay={1.5} position={[-0.6, 0.9, 0]} />
    </group>
  )
}

/** Shared shell every room sits in: floor, ceiling, side/back walls, windows, and a front wall that
 * fades out when the camera is outside it (so it never blocks the view). `children` draws the furniture. */
function RoomShell({ children }: { children: React.ReactNode }) {
  const floor = useFloorTexture()
  const front = useRef<THREE.Group>(null!)
  const { camera } = useThree()
  useFrame(() => { front.current.visible = camera.position.z < ROOM.cz + ROOM.hz - 0.2 })
  return (
    <group position={[ROOM.cx, 0, ROOM.cz]}>
      <ambientLight intensity={0.55} color="#ffd9a8" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[16.8, 14.8]} /><meshStandardMaterial map={floor} roughness={0.9} /></mesh>
      <Box p={[0, ROOM.ceiling + 0.1, 0]} s={[16.8, 0.2, 14.8]} c="#6b4423" />
      {[-5.5, -1.8, 1.8, 5.5].map((z) => <Box key={z} p={[0, ROOM.ceiling - 0.2, z]} s={[16.8, 0.35, 0.4]} c={BEAM} />)}
      <Wall at={[0, 0, -7.2]} len={16.8} ry={0} />
      <Wall at={[-8.2, 0, 0]} len={14.8} ry={Math.PI / 2} />
      <Wall at={[8.2, 0, 0]} len={14.8} ry={-Math.PI / 2} />
      <group ref={front}>
        <Wall at={[-4.85, 0, 7.2]} len={7.1} ry={Math.PI} />
        <Wall at={[4.85, 0, 7.2]} len={7.1} ry={Math.PI} />
        <Box p={[0, 3.7, 7.2]} s={[2.7, 1.8, 0.4]} c={PLASTER} />
        <Box p={[-1.35, 1.8, 7.0]} s={[0.22, 3.6, 0.3]} c={BEAM} /><Box p={[1.35, 1.8, 7.0]} s={[0.22, 3.6, 0.3]} c={BEAM} />
        <Box p={[0, 3.6, 7.0]} s={[2.9, 0.22, 0.3]} c={BEAM} />
      </group>
      <Box p={[4.8, 3.2, -6.95]} s={[1.5, 1.6, 0.1]} c={BEAM} /><Box p={[4.8, 3.2, -6.9]} s={[1.2, 1.3, 0.08]} c="#6aa8ff" emissive="#2a5ab0" />
      <Box p={[7.95, 3.0, -1.2]} s={[0.1, 1.5, 1.3]} c={BEAM} /><Box p={[7.9, 3.0, -1.2]} s={[0.08, 1.2, 1.0]} c="#6aa8ff" emissive="#2a5ab0" />
      <Box p={[-7.95, 3.0, 5.6]} s={[0.1, 1.5, 1.3]} c={BEAM} /><Box p={[-7.9, 3.0, 5.6]} s={[0.08, 1.2, 1.0]} c="#6aa8ff" emissive="#2a5ab0" />
      {children}
    </group>
  )
}

// where members stand (x, z, facing); the first three members who are not out on a quest
const SPOTS: [number, number, number][] = [[2.8, -3.0, -0.6], [-3.6, 1.2, 0.7], [3.2, 2.8, 2.6]]

function Member({ m, at }: { m: GuildMember; at: [number, number, number] }) {
  const motion = useRef<ChibiMotion>({ speed: 0, mode: 'idle' })
  const look = useCallback(() => npcAppearance(m.residentId, 'Adventurer'), [m.residentId])
  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, at[2], 0]}>
      <TownChibi load={look} motion={motion} fallback={null} />
      <Html position={[0, 2.05, 0]} center pointerEvents="none" zIndexRange={[5, 0]}><div className="nameplate">{m.displayName}</div></Html>
    </group>
  )
}

/** Guild members who are home (not on a quest) wait in the hall. */
function HallMembers() {
  useGame((s) => s.rev) // members join and leave on quests
  const home = guild.members.filter((m) => !guild.active.some((a) => a.members.includes(m.id))).slice(0, SPOTS.length)
  return <>{home.map((m, i) => <Member key={m.id} m={m} at={SPOTS[i]} />)}</>
}

/** Who to show standing in a room right now, and where: a worker on shift, a tavern patron, a sleeping
 * resident at home. Not the simulation's real position — like the Guild Hall members, just a few fixed spots. */
const onShift = (r: Resident, buildingId: string) => r.work === buildingId && sim[r.id].activity === 'work' && sim[r.id].arrived
const PRESENCE: Partial<Record<RoomId, { spots: V3[]; present: (r: Resident, buildingId: string, doorNode: string) => boolean }>> = {
  tavern: {
    spots: [[-5.5, 0, -5], [-2.4, 0, 0.3], [2.4, 0, 0.3]],
    present: (r, id, door) => onShift(r, id) || (sim[r.id].arrived && sim[r.id].target === door && (sim[r.id].activity === 'eat' || sim[r.id].activity === 'socialize')),
  },
  bakery: { spots: [[-4, 0, 0.8], [-5.75, 0, -4.1]], present: onShift },
  blacksmith: { spots: [[-0.3, 0, -3], [4.9, 0, -4]], present: onShift },
  market: {
    spots: [[-5.5, 0, -3], [5.5, 0, -3], [0, 0, 3]],
    present: (r, id, door) => onShift(r, id) || (sim[r.id].arrived && sim[r.id].target === door && sim[r.id].activity === 'shop'),
  },
  house: { spots: [[-7.3, 0, -2.2], [-6.5, 0, -2.2], [-5.7, 0, -2.2]], present: () => true /* filtered to this home's own residents below */ },
}

function Occupant({ r, at }: { r: Resident; at: V3 }) {
  const motion = useRef<ChibiMotion>({ speed: 0, mode: 'idle' })
  const cls = memberOf(r.id)?.cls
  const role = roleFor(cls ?? r.profession)
  const look = useCallback(() => npcAppearance(r.id, role), [r.id, role])
  return (
    <group position={[at[0], 0, at[2]]}>
      <TownChibi load={look} motion={motion} fallback={null} />
      <Html position={[0, 2.05, 0]} center pointerEvents="none" zIndexRange={[5, 0]}><div className="nameplate">{r.name}</div></Html>
    </group>
  )
}

/** Residents on shift, eating, shopping or sleeping here right now — a handful of fixed spots, not their real position. */
function RoomResidents({ kind, buildingId }: { kind: RoomId; buildingId: string }) {
  useGame((s) => Math.floor(s.time)) // refresh as residents arrive, work, sleep or leave
  const cfg = PRESENCE[kind]
  if (!cfg) return null
  const door = getBuilding(buildingId)!.door
  const here = (kind === 'house' ? residents.filter((r) => r.home === buildingId && sim[r.id]?.indoors) : residents.filter((r) => sim[r.id] && cfg.present(r, buildingId, door))).slice(0, cfg.spots.length)
  return <>{here.map((r, i) => <Occupant key={r.id} r={r} at={cfg.spots[i]} />)}</>
}

/** The Guild Hall room. Local origin is the room centre; the door is on the +z wall. */
function GuildHall() {
  const parchments = useMemo(() => {
    const r = rng(8)
    return Array.from({ length: 6 }, (_, i) => ({ p: [-3 + (i % 3) * 1.25 + 0.3, 2.35 + Math.floor(i / 3) * 0.95, -6.78] as V3, rz: (r() - 0.5) * 0.18 }))
  }, [])
  return (
    <RoomShell>
      {/* rug */}
      <Box p={[0, 0.02, 0]} s={[5.4, 0.03, 7.4]} c={GOLD} />
      <Box p={[0, 0.035, 0]} s={[5, 0.03, 7]} c="#8e2b24" />
      <Box p={[0, 0.02, 6.6]} s={[1.8, 0.03, 1]} c={RED} />
      <Stairs />
      <HallMembers />
      {/* quest board and reception desk */}
      <Box p={[-1.5, 2.8, -6.96]} s={[4.4, 2.5, 0.12]} c="#6b4423" />
      <Box p={[-1.5, 2.8, -6.9]} s={[4, 2.1, 0.1]} c="#c9a06a" />
      {parchments.map((q, i) => <Box key={i} p={q.p} s={[0.62, 0.8, 0.03]} c="#f1e6c8" rz={q.rz} />)}
      <Box p={[-1.5, 0.55, -6.0]} s={[4.4, 1.1, 1.2]} c={WOOD} />
      <Box p={[-1.5, 1.14, -6.0]} s={[4.6, 0.1, 1.35]} c="#8b5a2e" />
      <Box p={[-1.1, 0.6, -5.37]} s={[0.95, 0.85, 0.04]} c={RED} />
      <Box p={[-1.1, 0.7, -5.34]} s={[0.1, 0.5, 0.02]} c={GOLD} rz={0.7} /><Box p={[-1.1, 0.7, -5.34]} s={[0.1, 0.5, 0.02]} c={GOLD} rz={-0.7} />
      <Box p={[-2.6, 1.22, -5.9]} s={[0.55, 0.07, 0.4]} c="#efe3c2" />
      <Box p={[-0.3, 1.38, -6.1]} s={[0.7, 0.4, 0.45]} c={DARK} />
      <Cyl p={[-1.7, 1.3, -6.2]} r={0.08} h={0.2} c="#222" />
      <Box p={[-1.7, 1.55, -6.2]} s={[0.03, 0.35, 0.03]} c="#f4f0e4" rz={0.3} />
      <Banner p={[2.8, 2.9, -6.95]} />
      <Banner p={[7.92, 2.9, -4.5]} ry={-Math.PI / 2} />
      {/* right wall: fireplace, bookshelf, logs */}
      <Box p={[7.3, 1.6, 1.5]} s={[1.4, 3.2, 3]} c={STONE} />
      <Box p={[6.62, 0.75, 1.5]} s={[0.12, 1.3, 1.9]} c="#1a120d" />
      <Box p={[6.5, 1.65, 1.5]} s={[0.4, 0.2, 3.4]} c="#6b4423" />
      <Box p={[6.2, 0.07, 1.5]} s={[1.3, 0.14, 3.3]} c="#8c8c8c" />
      <Fire />
      <Box p={[6.9, 0.4, -1.8]} s={[1, 0.8, 1.2]} c={WOOD} />
      <Cyl p={[6.9, 0.95, -2.1]} r={0.11} h={0.9} c="#5a3a22" rz={Math.PI / 2} /><Cyl p={[6.9, 1.0, -1.6]} r={0.11} h={0.9} c="#4a2e1a" rz={Math.PI / 2} />
      <Box p={[7.45, 1.55, -4.5]} s={[1.1, 3.1, 2.8]} c={WOOD} />
      <Books p={[6.85, 0, -4.5]} w={2.6} rows={4} seed={3} />
      {/* left wall below the stairs: bookshelf, barrel, crate */}
      <Box p={[-7.5, 1.4, 4.3]} s={[1, 2.8, 2]} c={WOOD} />
      <Books p={[-6.95, 0, 4.3]} w={2} rows={3} seed={7} />
      <Cyl p={[-7.2, 0.55, 6.2]} r={0.6} h={1.1} c="#7a4b27" />
      <Cyl p={[-7.2, 0.3, 6.2]} r={0.63} h={0.07} c="#5b5b66" /><Cyl p={[-7.2, 0.85, 6.2]} r={0.63} h={0.07} c="#5b5b66" />
      <Box p={[7.2, 0.55, 5.0]} s={[1.1, 1.1, 1.1]} c="#8a5a32" /><Box p={[7.2, 0.55, 6.2]} s={[1.1, 1.1, 1.1]} c="#7a4b27" /><Box p={[7.2, 1.45, 5.1]} s={[0.8, 0.8, 0.8]} c="#8a5a32" />
      <Plant p={[-4.9, 0, 3.9]} /><Plant p={[3.4, 0, -6.2]} /><Plant p={[6.95, 0, -6.35]} />
      {/* light */}
      <Lantern p={[-1.5, 3.7, -4.6]} light={12} />
      <Box p={[-1.5, 4.15, -4.6]} s={[0.04, 0.9, 0.04]} c="#2b2118" />
      <Lantern p={[-7.8, 2.6, 6.8]} light={5} /><Lantern p={[7.8, 2.6, 4.6]} light={5} /><Lantern p={[-4.4, 3.3, -6.8]} /><Lantern p={[4.2, 2.7, 6.8]} />
    </RoomShell>
  )
}

const BARREL_OAK = '#6b4423', ALE = '#d9a63a'
function Table({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <Box p={[0, 0.5, 0]} s={[1.4, 0.08, 0.9]} c={WOOD} />
      {[[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]].map(([x, z], i) => <Box key={i} p={[x, 0.25, z]} s={[0.1, 0.5, 0.1]} c={DARK} />)}
      <Cyl p={[0.35, 0.56, -0.15]} r={0.1} h={0.16} c={ALE} />
      {[[-0.9, 0, -Math.PI / 2], [0.9, 0, Math.PI / 2]].map(([x, z, ry], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, ry as number, 0]}>
          <Box p={[0, 0.28, 0]} s={[0.9, 0.08, 0.35]} c="#8a5a32" />
          {[[-0.35, 0.1], [0.35, 0.1], [-0.35, -0.1], [0.35, -0.1]].map(([bx, bz], j) => <Box key={j} p={[bx, 0.14, bz]} s={[0.07, 0.28, 0.07]} c={DARK} />)}
        </group>
      ))}
    </group>
  )
}
function Barrel({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <Cyl p={[0, 0.5, 0]} r={0.5} h={1} c={BARREL_OAK} />
      <Cyl p={[0, 0.2, 0]} r={0.53} h={0.06} c="#5b5b66" /><Cyl p={[0, 0.8, 0]} r={0.53} h={0.06} c="#5b5b66" />
    </group>
  )
}

/** The Tavern: bar along the back wall, tables and benches, barrels by the door, a fireplace. */
function Tavern() {
  const buildingId = useGame((s) => s.interior)!
  return (
    <RoomShell>
      <RoomResidents kind="tavern" buildingId={buildingId} />
      <Box p={[-7, 0.6, -5.6]} s={[2, 1.2, 2.8]} c={WOOD} />
      <Box p={[-7, 1.22, -5.6]} s={[2.2, 0.1, 3]} c="#8b5a2e" />
      <Box p={[-7, 1.8, -6.9]} s={[2.3, 1.6, 2]} c={DARK} />
      {[[-7.7, -6.3], [-7, -6.3], [-6.3, -6.3]].map(([x, z], i) => <Cyl key={i} p={[x, 2.2, z]} r={0.1} h={0.5} c="#4a2e1a" />)}
      <Banner p={[-4.2, 2.9, -6.95]} />
      <Banner p={[7.92, 2.9, -4.5]} ry={-Math.PI / 2} />
      {/* fireplace */}
      <Box p={[7.3, 1.6, -1]} s={[1.4, 3.2, 3]} c={STONE} />
      <Box p={[6.62, 0.75, -1]} s={[0.12, 1.3, 1.9]} c="#1a120d" />
      <Box p={[6.5, 1.65, -1]} s={[0.4, 0.2, 3.4]} c="#6b4423" />
      <Box p={[6.2, 0.07, -1]} s={[1.3, 0.14, 3.3]} c="#8c8c8c" />
      <Fire p={[6.55, 0.15, -1]} />
      {/* tables */}
      <Table p={[-2.4, 0, -1.4]} /><Table p={[2.4, 0, -1.4]} /><Table p={[-2.4, 0, 2.8]} /><Table p={[2.4, 0, 2.8]} />
      {/* barrels and crates by the door, bookshelf-turned-pantry on the right */}
      <Barrel p={[-7.4, 0, 4]} /><Barrel p={[-6.9, 0, 3.6]} /><Barrel p={[-7.4, 0, 3.2]} />
      <Books p={[6.85, 0, -4.5]} w={2.6} rows={3} seed={11} />
      <Box p={[7.45, 1.2, -4.5]} s={[1.1, 2.5, 2.8]} c={WOOD} />
      <Plant p={[-4.9, 0, 3.9]} /><Plant p={[3.4, 0, -6.2]} /><Plant p={[6.95, 0, -6.35]} />
      {/* light */}
      <Lantern p={[-2.4, 3.3, 0]} light={9} /><Lantern p={[2.4, 3.3, 0]} light={9} />
      <Lantern p={[-7.8, 2.6, 6.8]} light={5} /><Lantern p={[7.8, 2.6, 4.6]} light={5} /><Lantern p={[-4.4, 3.3, -6.8]} /><Lantern p={[4.2, 2.7, 6.8]} />
    </RoomShell>
  )
}

function Loaf({ p }: { p: V3 }) {
  return <mesh geometry={geo.sphere} material={mat('#c98a3f')} position={p} scale={[0.26, 0.17, 0.18]} castShadow />
}
function Shelf({ p, w }: { p: V3; w: number }) {
  const rows = [0.4, 0.9, 1.4]
  const loaves = useMemo(() => {
    const r = rng(Math.round(w * 97)), out: V3[] = []
    for (const y of rows) { let x = -w / 2 + 0.3; while (x < w / 2 - 0.2) { out.push([x, y, (r() - 0.5) * 0.3]); x += 0.38 + r() * 0.1 } }
    return out
  }, [w])
  return (
    <group position={p}>
      <Box p={[0, 0.9, 0]} s={[w, 1.8, 0.7]} c={DARK} />
      {rows.map((y, i) => <Box key={i} p={[0, y, 0]} s={[w - 0.1, 0.05, 0.65]} c={WOOD} />)}
      {loaves.map((l, i) => <Loaf key={i} p={[l[0], l[1] + 0.12, l[2]]} />)}
    </group>
  )
}

/** The Bakery: a brick oven with a glowing mouth, a work counter, a flour-dusted kneading table, bread shelves. */
function Bakery() {
  const buildingId = useGame((s) => s.interior)!
  return (
    <RoomShell>
      <RoomResidents kind="bakery" buildingId={buildingId} />
      {/* brick oven, back-right */}
      <Box p={[6.4, 1.6, -2.75]} s={[3.2, 3.2, 8.5]} c="#8a5a46" />
      <Box p={[6.4, ROOM.ceiling - 0.3, -5]} s={[0.8, ROOM.ceiling, 0.8]} c="#6b4a3a" />
      <Box p={[4.85, 1.1, -2.75]} s={[0.3, 1.6, 1.8]} c="#2a1a10" />
      <Box p={[4.72, 1.1, -2.75]} s={[0.08, 1.5, 1.6]} c="#ff7a2a" emissive="#ff5a10" />
      <Box p={[4.9, 0.35, -2.75]} s={[0.9, 0.1, 2]} c={DARK} />
      <Cyl p={[4.3, 0.42, -3.6]} r={0.03} h={1.3} c="#5a3a22" rz={1.3} />
      {/* work counter, back-left */}
      <Box p={[-5.75, 0.55, -5.65]} s={[4.5, 1.1, 2.7]} c={WOOD} />
      <Box p={[-5.75, 1.14, -5.65]} s={[4.7, 0.1, 2.9]} c="#c9a06a" />
      {/* kneading table, centre */}
      <Box p={[-4, 0.5, -1.5]} s={[5, 1, 3]} c={WOOD} />
      <Box p={[-4, 1.03, -1.5]} s={[5.2, 0.08, 3.2]} c="#e8dcc0" />
      <Cyl p={[-5, 1.1, -1.5]} r={0.07} h={0.9} c="#8a5a32" rz={Math.PI / 2} />
      {[[-3, -2.2], [-2.3, -0.8], [-5.2, -0.6]].map(([x, z], i) => <Cyl key={i} p={[x, 1.15, z]} r={0.22} h={0.2} c="#e8dcc0" />)}
      {/* bread shelves, right wall */}
      <Shelf p={[4.9, 0, -2.4]} w={6} />
      <Shelf p={[4.9, 0, 3.7]} w={6} />
      {/* flour sacks by the door */}
      <Barrel p={[-7.4, 0, 3.6]} /><Barrel p={[-6.7, 0, 3.2]} /><Barrel p={[-7.2, 0, 4.4]} />
      <Plant p={[-4.9, 0, 5.8]} /><Plant p={[6.95, 0, 5.8]} />
      {/* light */}
      <Lantern p={[-4, 3.6, -1.5]} light={10} />
      <Lantern p={[-7.8, 2.6, 6.8]} light={5} /><Lantern p={[7.8, 2.6, 6.2]} light={5} /><Lantern p={[-4.4, 3.3, -6.8]} /><Lantern p={[4.2, 2.7, 6.8]} />
    </RoomShell>
  )
}

const FRUIT = ['#c94f4f', '#e0a64a', '#6aa35a', '#d9b45a', '#a85cc9']
/** A market stall: counter, two support poles and a striped awning, with produce piles on top. */
function Stall({ p, w, d, ry = 0, color, seed }: { p: V3; w: number; d: number; ry?: number; color: string; seed: number }) {
  const piles = useMemo(() => {
    const r = rng(seed), out: { p: V3; c: string }[] = []
    for (let i = 0; i < Math.round(w * 1.5); i++) out.push({ p: [-w / 2 + 0.35 + i * ((w - 0.7) / Math.max(1, Math.round(w * 1.5) - 1)), 1.08, (r() - 0.5) * (d - 0.6)], c: FRUIT[Math.floor(r() * FRUIT.length)] })
    return out
  }, [w, d, seed])
  return (
    <group position={p} rotation={[0, ry, 0]}>
      <Box p={[0, 0.5, 0]} s={[w, 1, d]} c={WOOD} />
      <Box p={[0, 1.02, 0]} s={[w + 0.1, 0.06, d + 0.1]} c="#c9a06a" />
      {piles.map((f, i) => <mesh key={i} geometry={geo.sphere} material={mat(f.c)} position={f.p} scale={[0.16, 0.14, 0.16]} castShadow />)}
      {[-w / 2 + 0.3, w / 2 - 0.3].map((x, i) => <Cyl key={i} p={[x, 1.9, -d / 2 + 0.1]} r={0.06} h={2.8} c="#5a3a22" />)}
      <mesh geometry={geo.prism} material={mat(color)} position={[0, 3.3, -d / 2 + 0.1]} scale={[w + 0.4, 1, 1.1]} castShadow />
    </group>
  )
}

const IRON = '#3a3c42', EMBER = '#ff5a10'
function Blade({ p, ry = 0 }: { p: V3; ry?: number }) {
  return (
    <group position={p} rotation={[0, ry, Math.PI / 2]}>
      <Box p={[0, 0.55, 0]} s={[0.1, 1, 0.26]} c="#c7cdd6" />
      <Box p={[0, 0, 0]} s={[0.14, 0.3, 0.1]} c={DARK} />
      <Box p={[0, -0.2, 0]} s={[0.07, 0.3, 0.07]} c="#8a5a32" />
    </group>
  )
}
/** Wall-mounted weapon rack: swords, axes and a shield along the wall's length. */
function WeaponRack({ p, w }: { p: V3; w: number }) {
  const blades = useMemo(() => Array.from({ length: Math.max(2, Math.round(w / 1.1)) }, (_, i) => -w / 2 + 0.7 + i * ((w - 1.4) / Math.max(1, Math.round(w / 1.1) - 1))), [w])
  return (
    <group position={p}>
      <Box p={[0, 1.4, 0]} s={[0.18, 2.6, w]} c={DARK} />
      {blades.map((z, i) => <Blade key={i} p={[0.14, 1.4, z]} ry={i % 2 ? 0.15 : -0.15} />)}
      <Cyl p={[0.14, 2.3, blades[0] - 0.75]} r={0.35} h={0.07} c="#6b4a2e" />
      <Cyl p={[0.14, 2.3, blades[0] - 0.75]} r={0.22} h={0.09} c={IRON} />
    </group>
  )
}

/** The Blacksmith: a glowing forge, anvil and workbench, a weapon rack along the wall, hanging tools. */
function Blacksmith() {
  const buildingId = useGame((s) => s.interior)!
  return (
    <RoomShell>
      <RoomResidents kind="blacksmith" buildingId={buildingId} />
      {/* forge, back-right */}
      <Box p={[6.4, 1.5, -4.75]} s={[3.2, 3, 4.5]} c={STONE} />
      <Box p={[6.4, ROOM.ceiling - 0.3, -4.75]} s={[0.8, ROOM.ceiling, 0.8]} c="#5a5a5a" />
      <Box p={[4.9, 0.6, -4.75]} s={[0.4, 1.2, 1.4]} c="#1a1a1a" />
      <Box p={[4.78, 0.55, -4.75]} s={[0.1, 1, 1.2]} c={EMBER} emissive={EMBER} />
      <Box p={[5.9, 0.18, -3.5]} s={[1.6, 0.18, 1]} c="#2a2a2a" />
      <Cyl p={[6.3, 0.5, -2.2]} r={0.12} h={1.3} c="#4a2e1a" rz={1.2} />
      <Cyl p={[6.65, 0.75, -2.5]} r={0.26} h={0.5} c={DARK} rz={1.2} />
      <pointLight color={EMBER} intensity={9} distance={9} decay={1.8} position={[4.9, 0.8, -4.75]} />
      {/* anvil and workbench */}
      <Cyl p={[-0.3, 0.3, -6]} r={0.3} h={0.6} c="#4a2e1a" />
      <Box p={[-0.3, 0.72, -6]} s={[1, 0.3, 0.4]} c={IRON} />
      <Box p={[-0.3, 0.9, -6]} s={[0.3, 0.06, 0.3]} c="#c7cdd6" />
      <Box p={[-0.3, 0.3, -5]} s={[1.6, 0.9, 1.2]} c={WOOD} />
      <Box p={[-0.3, 0.76, -5]} s={[1.7, 0.08, 1.3]} c="#8b5a2e" />
      {[[-0.8, -5.1], [0.3, -4.9]].map(([x, z], i) => <Cyl key={i} p={[x, 0.9, z]} r={0.04} h={0.5} c="#4a2e1a" rz={1} />)}
      {/* weapon rack, right wall */}
      <WeaponRack p={[4.9, 0, 1.85]} w={6.9} />
      {/* tool wall + grindstone, left */}
      <Box p={[-6.6, 1.8, -3.15]} s={[2.8, 2.6, 0.3]} c={DARK} />
      {[[-7.6, 2.8], [-6.6, 2.8], [-5.6, 2.8], [-7.1, 1.6], [-6.1, 1.6]].map(([x, y], i) => <Cyl key={i} p={[x, y, -3.1]} r={0.06} h={0.7} c="#8a8a8a" rz={0.4} />)}
      <Cyl p={[-6.6, 0.55, -2]} r={0.55} h={0.15} c="#7a7a7a" />
      <Cyl p={[-6.6, 0.55, -2]} r={0.08} h={0.6} c="#4a2e1a" rz={Math.PI / 2} />
      {/* ore crates by the door */}
      <Box p={[-7.1, 0.4, 3.6]} s={[0.9, 0.8, 0.9]} c="#6b4a2e" /><Box p={[-6.3, 0.45, 4.3]} s={[1, 0.9, 1]} c="#5a3a22" />
      <Cyl p={[-7.3, 0.35, 4.6]} r={0.1} h={0.5} c="#8a8a8a" />
      <Plant p={[4.2, 0, 6.3]} /><Plant p={[-4.9, 0, 5.8]} />
      {/* light */}
      <Lantern p={[-0.3, 3.6, -5.5]} light={10} />
      <Lantern p={[-7.8, 2.6, 6.8]} light={5} /><Lantern p={[7.8, 2.6, 4.8]} light={5} /><Lantern p={[-4.4, 3.3, -6.8]} /><Lantern p={[4.2, 2.7, 6.8]} />
    </RoomShell>
  )
}

/** The Market: four produce stalls with striped awnings, crates by the door. */
function Market() {
  const buildingId = useGame((s) => s.interior)!
  return (
    <RoomShell>
      <RoomResidents kind="market" buildingId={buildingId} />
      <Stall p={[-5.5, 0, -5.65]} w={4.6} d={2.3} color="#c94f4f" seed={2} />
      <Stall p={[5.5, 0, -5.65]} w={4.6} d={2.3} color="#4a8cc9" seed={5} />
      <Stall p={[-3.5, 0, -0.7]} w={3} d={2.6} color="#6aa35a" seed={9} />
      <Stall p={[3.5, 0, -0.7]} w={3} d={2.6} color="#d9b45a" seed={13} />
      {/* crates by the door */}
      <Box p={[-7, 0.45, 3.2]} s={[0.9, 0.9, 0.9]} c="#6b4a2e" /><Box p={[-6.1, 0.45, 3.8]} s={[0.9, 0.9, 0.9]} c="#7a5a3e" />
      <Box p={[7, 0.45, 3.2]} s={[0.9, 0.9, 0.9]} c="#6b4a2e" /><Box p={[6.1, 0.45, 3.8]} s={[0.9, 0.9, 0.9]} c="#7a5a3e" />
      <Plant p={[-4.9, 0, 5.8]} /><Plant p={[4.9, 0, 5.8]} />
      {/* light */}
      <Lantern p={[-3.5, 3.7, -0.7]} light={9} /><Lantern p={[3.5, 3.7, -0.7]} light={9} />
      <Lantern p={[-5.5, 3.7, -5.65]} light={7} /><Lantern p={[5.5, 3.7, -5.65]} light={7} />
      <Lantern p={[-7.8, 2.6, 6.8]} light={5} /><Lantern p={[7.8, 2.6, 6.8]} light={5} />
    </RoomShell>
  )
}

const QUILT = '#6a8ec9'
/** A cottage: the one layout every house building shares (h1, h2, ... however many are built). */
function House() {
  const buildingId = useGame((s) => s.interior)!
  return (
    <RoomShell>
      <RoomResidents kind="house" buildingId={buildingId} />
      {/* bed, back-left */}
      <Box p={[-6.5, 1.1, -6.6]} s={[3.1, 1.3, 0.3]} c={WOOD} />
      <Box p={[-6.5, 0.45, -5]} s={[3, 0.9, 2.8]} c="#e8dcc0" />
      <Box p={[-6.5, 0.95, -5.4]} s={[3, 0.3, 2]} c={QUILT} />
      <Box p={[-6.5, 0.75, -6.3]} s={[2.8, 0.5, 0.5]} c="#f4f0e4" />
      {/* hearth, back-centre */}
      <Box p={[0, 1.1, -6.6]} s={[3, 2.2, 0.8]} c={STONE} />
      <Box p={[0, 0.5, -6.3]} s={[0.4, 1, 1.5]} c="#1a1a1a" />
      <Box p={[0, 0.43, -6.3]} s={[0.1, 0.8, 1.3]} c="#ff7a2a" emissive="#ff5a10" />
      <Box p={[0, 2.25, -6.6]} s={[3.2, 0.1, 0.9]} c="#8b5a2e" />
      {/* table + stools, centre */}
      <Box p={[0, 0.5, 0]} s={[1.3, 0.08, 1.3]} c={WOOD} />
      <Box p={[0, 0.25, 0]} s={[0.12, 0.5, 0.12]} c={DARK} />
      <Cyl p={[0, 0.56, 0]} r={0.18} h={0.1} c="#e8dcc0" />
      {[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([x, z], i) => <Cyl key={i} p={[x, 0.26, z]} r={0.22} h={0.52} c="#8a5a32" />)}
      {/* wardrobe, back-right */}
      <Box p={[6.5, 1.5, -5.5]} s={[3, 3, 1.6]} c={WOOD} />
      <Box p={[6.5, 1.5, -4.75]} s={[2.8, 2.8, 0.1]} c="#8b5a2e" />
      <Cyl p={[5.6, 1.5, -4.7]} r={0.04} h={0.2} c="#2b2118" rz={Math.PI / 2} /><Cyl p={[7.4, 1.5, -4.7]} r={0.04} h={0.2} c="#2b2118" rz={Math.PI / 2} />
      <Plant p={[6.9, 0, 5.8]} /><Plant p={[-6.9, 0, 5.8]} />
      {/* light */}
      <Lantern p={[0, 3.6, 0]} light={10} />
      <Lantern p={[-7.8, 2.6, 6.8]} light={5} /><Lantern p={[7.8, 2.6, 6.8]} light={5} />
    </RoomShell>
  )
}

/** Mounts the room the player is standing in, or nothing while outside. */
export function InteriorScene() {
  const inside = useGame((s) => s.interior)
  const kind = inside ? roomKindOf(inside) : undefined
  if (kind === 'guild') return <GuildHall />
  if (kind === 'tavern') return <Tavern />
  if (kind === 'bakery') return <Bakery />
  if (kind === 'blacksmith') return <Blacksmith />
  if (kind === 'market') return <Market />
  if (kind === 'house') return <House />
  return null
}
