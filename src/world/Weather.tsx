// Weather and season visuals: rain, snow, falling leaves/petals, snow cover, festival decorations.
// The weather itself comes from game/calendar.ts; this file only smooths it into `env` and draws it.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FESTIVALS, isFestivalDay, seasonOf, weatherAt, type Season, type Weather } from '../game/calendar'
import { cam, env, player } from '../game/live'
import { useGame } from '../game/store'
import { geo, glow } from './materials'

/** Materials/meshes that follow the season, registered by the scene components that own them. */
export const tint: { ground?: THREE.MeshStandardMaterial; flowers?: THREE.Object3D } = {}

const GROUND: Record<Season, THREE.Color> = {
  spring: new THREE.Color('#eaffec'), summer: new THREE.Color('#fffbe0'), autumn: new THREE.Color('#e2b46a'), winter: new THREE.Color('#cdd8d8'),
}
const CLOUD: Record<Weather, number> = { clear: 0, cloudy: 0.55, rain: 0.8, storm: 1, snow: 0.7, fog: 0.6 }
const target = new THREE.Color()
const ease = (rate: number, dt: number) => 1 - Math.exp(-dt * rate)

/** Ease the live weather values toward what the calendar says. Call once per frame (real seconds). */
export function stepWeather(dt: number, t: number) {
  const w = weatherAt(t), s = seasonOf(t), k = ease(0.6, dt), slow = ease(0.2, dt)
  env.cloud += (CLOUD[w] - env.cloud) * k
  env.rain += ((w === 'rain' ? 0.65 : w === 'storm' ? 1 : 0) - env.rain) * k
  env.snow += ((w === 'snow' ? 1 : 0) - env.snow) * k
  env.fog += ((w === 'fog' ? 1 : 0) - env.fog) * k
  env.wet += ((w === 'rain' || w === 'storm' ? 1 : w === 'snow' ? 0.4 : 0) - env.wet) * slow
  env.snowCover += ((s === 'winter' ? (w === 'snow' ? 1 : 0.8) : 0) - env.snowCover) * slow
  env.leaves += ((s === 'autumn' ? (w === 'rain' || w === 'storm' ? 0.3 : 0.7) : 0) - env.leaves) * k
  env.petals += ((s === 'spring' && w !== 'rain' && w !== 'storm' ? 0.6 : 0) - env.petals) * k
  if (tint.ground) tint.ground.color.lerp(target.copy(GROUND[s]).multiplyScalar(1 - 0.14 * env.wet), slow)
  if (tint.flowers) tint.flowers.visible = s === 'spring' || s === 'summer'
}

/** Centre and half-size of the area that gets particles: around the camera focus. */
const focus = () => {
  const iso = useGame.getState().mode === 'iso'
  const c = iso ? cam.isoTarget : player.pos
  return { x: c.x, z: c.z, L: iso ? 46 : 22, H: iso ? 30 : 20, iso }
}
/** Keep a drop fixed in the world while it wraps around the particle box. */
const wrap = (v: number, c: number, L: number) => c + ((((v - c + L) % (2 * L)) + 2 * L) % (2 * L)) - L

const rnd = (n: number, seed: number) => {
  let a = seed
  return Float32Array.from({ length: n }, () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296))
}

export function Rain() {
  const N = 3500
  const seeds = useMemo(() => ({ u: rnd(N, 1), v: rnd(N, 2), w: rnd(N, 3) }), [])
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3))
    return g
  }, [])
  const ref = useRef<THREE.LineSegments>(null!)
  useFrame(({ clock }) => {
    const r = useGame.getState().interior ? 0 : env.rain // no rain indoors
    ref.current.visible = r > 0.02
    if (!ref.current.visible) return
    const { x, z, L, H, iso } = focus(), t = clock.elapsedTime, pos = geom.attributes.position as THREE.BufferAttribute
    const n = Math.floor(N * r), len = iso ? 1.6 : 0.9, lean = env.rain > 0.9 ? 0.35 : 0.12
    for (let i = 0; i < n; i++) {
      const px = wrap(seeds.u[i] * 400, x, L), pz = wrap(seeds.w[i] * 400, z, L)
      const py = H - ((seeds.v[i] + t * (26 / H)) % 1) * H
      pos.setXYZ(i * 2, px, py, pz)
      pos.setXYZ(i * 2 + 1, px - len * lean, py - len, pz)
    }
    geom.setDrawRange(0, n * 2)
    pos.needsUpdate = true
  })
  return (
    <lineSegments ref={ref} geometry={geom} frustumCulled={false} visible={false}>
      <lineBasicMaterial color="#b9d6f0" transparent opacity={0.5} depthWrite={false} />
    </lineSegments>
  )
}

const DRIFT = {
  snow: { color: '#ffffff', size: [0.3, 0.1], fall: 2.2, sway: 0.6, level: () => env.snow },
  leaves: { color: '#e08a2e', size: [0.34, 0.11], fall: 1.4, sway: 1.8, level: () => env.leaves },
  petals: { color: '#ffb7d0', size: [0.3, 0.1], fall: 1.1, sway: 1.5, level: () => env.petals },
} as const

/** Slow falling flakes: snow, autumn leaves, spring petals. */
export function Drift({ kind }: { kind: keyof typeof DRIFT }) {
  const N = 900, d = DRIFT[kind]
  const seeds = useMemo(() => ({ u: rnd(N, 7), v: rnd(N, 8), w: rnd(N, 9) }), [])
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    return g
  }, [])
  const ref = useRef<THREE.Points>(null!), mat = useRef<THREE.PointsMaterial>(null!)
  useFrame(({ clock }) => {
    const lvl = useGame.getState().interior ? 0 : d.level()
    ref.current.visible = lvl > 0.02
    if (!ref.current.visible) return
    const { x, z, L, H, iso } = focus(), t = clock.elapsedTime, pos = geom.attributes.position as THREE.BufferAttribute
    const n = Math.floor(N * lvl)
    mat.current.size = iso ? d.size[0] : d.size[1]
    for (let i = 0; i < n; i++) {
      const ph = seeds.v[i] * 40
      pos.setXYZ(i, wrap(seeds.u[i] * 400 + Math.sin(t * 0.7 + ph) * d.sway, x, L), H - ((seeds.v[i] + (t * d.fall) / H) % 1) * H, wrap(seeds.w[i] * 400 + Math.cos(t * 0.6 + ph) * d.sway, z, L))
    }
    geom.setDrawRange(0, n)
    pos.needsUpdate = true
  })
  return (
    <points ref={ref} geometry={geom} frustumCulled={false} visible={false}>
      <pointsMaterial ref={mat} color={d.color} size={0.3} transparent opacity={0.9} depthWrite={false} />
    </points>
  )
}

/** White blanket over the grass (roads and the square stay visible). */
export function SnowCover() {
  const m = useRef<THREE.MeshStandardMaterial>(null!), mesh = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    mesh.current.visible = env.snowCover > 0.02
    m.current.opacity = env.snowCover * 0.88
  })
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow visible={false}>
      <planeGeometry args={[132, 132]} />
      <meshStandardMaterial ref={m} color="#f4f8ff" roughness={1} transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

const POLES = 16, FLAGS = 6, R = 9.3
/** Poles, bunting and lanterns around the town square on festival days. */
export function FestivalDecor() {
  const season = useGame((s) => (isFestivalDay(s.time) && (s.time % 1440) / 60 >= 10 ? seasonOf(s.time) : ''))
  if (!season) return null
  return <Decor colors={FESTIVALS[season].colors} />
}

function Decor({ colors }: { colors: string[] }) {
  const poles = useRef<THREE.InstancedMesh>(null), flags = useRef<THREE.InstancedMesh>(null), lamps = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color()
    const at = (i: number) => [Math.cos((i / POLES) * Math.PI * 2) * R, Math.sin((i / POLES) * Math.PI * 2) * R] as const
    for (let i = 0; i < POLES; i++) {
      const [x, z] = at(i)
      poles.current!.setMatrixAt(i, m.compose(new THREE.Vector3(x, 1.6, z), q.identity(), new THREE.Vector3(0.1, 3.2, 0.1)))
      lamps.current!.setMatrixAt(i, m.compose(new THREE.Vector3(x, 3.35, z), q.identity(), new THREE.Vector3(0.24, 0.3, 0.24)))
      const [x2, z2] = at(i + 1)
      for (let f = 0; f < FLAGS; f++) {
        const s = (f + 0.5) / FLAGS
        m.compose(new THREE.Vector3(x + (x2 - x) * s, 3.05 - 0.55 * 4 * s * (1 - s) - 0.18, z + (z2 - z) * s), q.setFromEuler(e.set(0, Math.atan2(x2 - x, z2 - z) + Math.PI / 2, 0)), new THREE.Vector3(0.05, 0.36, 0.3))
        flags.current!.setMatrixAt(i * FLAGS + f, m)
        flags.current!.setColorAt(i * FLAGS + f, c.set(colors[(i * FLAGS + f) % colors.length]))
      }
    }
    for (const r of [poles, flags, lamps]) r.current!.instanceMatrix.needsUpdate = true
    flags.current!.instanceColor!.needsUpdate = true
  }, [colors])
  return (
    <group>
      <instancedMesh ref={poles} args={[geo.cyl, undefined, POLES]} castShadow><meshStandardMaterial color="#6b4a2e" roughness={1} /></instancedMesh>
      <instancedMesh ref={flags} args={[geo.box, undefined, POLES * FLAGS]}><meshStandardMaterial roughness={0.9} side={THREE.DoubleSide} /></instancedMesh>
      <instancedMesh ref={lamps} args={[geo.sphere, glow.lamp, POLES]} />
    </group>
  )
}
