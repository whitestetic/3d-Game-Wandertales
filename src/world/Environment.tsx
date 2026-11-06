import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EDGES, NODES, RIVER_W, RIVER_X } from '../game/map'
import { FLOWERS, LAMPS, ROCKS, TREES, rng } from '../game/scenery'
import { useGame, hourOf } from '../game/store'
import { cam, env, player } from '../game/live'
import { town } from '../game/town'
import { geo, glow, mat } from './materials'
import { seasonOf, type Season } from '../game/calendar'
import { thunder, updateAudio } from '../game/audio'
import { Drift, FestivalDecor, Rain, SnowCover, stepWeather, tint } from './Weather'

const OAK: Record<Season, string[]> = {
  spring: ['#7ccf6a', '#8fd873', '#a6dc7e', '#f4a9c4'],
  summer: ['#5f9a46', '#6fa84e', '#7cae4a', '#d9a04a'],
  autumn: ['#d9822b', '#e0a030', '#c2562f', '#b8742a'],
  winter: ['#8a8f7c', '#9a9d8c', '#7d8472', '#a9aa9c'],
}
const BUSH: Record<Season, [string, string]> = {
  spring: ['#5fae4a', '#6fbe55'], summer: ['#4f8a3c', '#5c9a44'], autumn: ['#9a7a35', '#b0762c'], winter: ['#6d7a66', '#7b8574'],
}

/** Fill an InstancedMesh from a list of matrices. */
function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, items: { p: [number, number, number]; s: [number, number, number]; ry?: number; c?: string }[]) {
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.ry ?? 0, 0))
      m.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3(...it.s))
      ref.current!.setMatrixAt(i, m)
      if (it.c) ref.current!.setColorAt(i, new THREE.Color(it.c))
    })
    ref.current!.instanceMatrix.needsUpdate = true
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true
  }, [ref, items])
}

function Ground() {
  const g = useMemo(() => {
    const geom = new THREE.PlaneGeometry(240, 240, 80, 80)
    geom.rotateX(-Math.PI / 2)
    const r = rng(3), col = new THREE.Color(), colors: number[] = []
    const pos = geom.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      // gentle hills outside the playable area only
      const d = Math.max(Math.abs(x), Math.abs(z))
      if (d > 62) pos.setY(i, (d - 62) * 0.35 * (0.6 + r() * 0.8))
      col.setHSL(0.27 + r() * 0.04, 0.45, 0.42 + r() * 0.07)
      colors.push(col.r, col.g, col.b)
    }
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geom.computeVertexNormals()
    return geom
  }, [])
  return (
    <mesh geometry={g} receiveShadow>
      <meshStandardMaterial ref={(m) => { tint.ground = m ?? undefined }} vertexColors roughness={1} flatShading />
    </mesh>
  )
}

function Paths() {
  const rev = useGame((s) => s.rev) // new buildings add roads
  const segs = useMemo(() => EDGES.filter(([a, b]) => !(a.startsWith('s') && b.startsWith('s') && a.length < 4 && b.length < 4)).map(([a, b]) => {
    const [ax, az] = NODES[a], [bx, bz] = NODES[b]
    return { p: [(ax + bx) / 2, 0.03, (az + bz) / 2] as [number, number, number], len: Math.hypot(bx - ax, bz - az) + 2, ry: Math.atan2(bx - ax, bz - az) }
  }), [rev])
  const ref = useRef<THREE.InstancedMesh>(null)
  useInstances(ref, segs.map((s) => ({ p: s.p, s: [2.4, 0.05, s.len], ry: s.ry })))
  const stones = useMemo(() => {
    const r = rng(11), out: { p: [number, number, number]; s: [number, number, number]; ry: number; c: string }[] = []
    for (let i = 0; i < 320; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 9.6
      const s = 0.32 + r() * 0.3
      out.push({ p: [Math.cos(a) * d, 0.045, Math.sin(a) * d], s: [s, 0.03, s], ry: r() * 3, c: r() > 0.5 ? '#c2baae' : '#b3aa9c' })
    }
    return out
  }, [])
  const sref = useRef<THREE.InstancedMesh>(null)
  useInstances(sref, stones)
  return (
    <group>
      <instancedMesh key={segs.length} ref={ref} args={[geo.box, mat('#c8b896'), segs.length]} receiveShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} receiveShadow>
        <circleGeometry args={[10.2, 40]} />
        <meshStandardMaterial color="#cfc6b6" roughness={1} />
      </mesh>
      <instancedMesh ref={sref} args={[geo.cyl, undefined, stones.length]} receiveShadow>
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}

function River() {
  const ref = useRef<THREE.Mesh>(null!)
  const g = useMemo(() => {
    const geom = new THREE.PlaneGeometry(RIVER_W, 240, 8, 120)
    geom.rotateX(-Math.PI / 2)
    return geom
  }, [])
  const base = useMemo(() => Float32Array.from(g.attributes.position.array), [g])
  useFrame(({ clock }) => {
    const pos = g.attributes.position, t = clock.elapsedTime
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2]
      pos.setY(i, Math.sin(z * 0.5 + t * 1.6) * 0.06 + Math.cos(x * 1.3 + t) * 0.04)
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
  })
  return (
    <group position={[RIVER_X, 0, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={geo.box} material={mat('#8f7f63')} position={[s * (RIVER_W / 2 + 0.3), 0, 0]} scale={[0.9, 0.3, 240]} receiveShadow />
      ))}
      <mesh ref={ref} geometry={g} position={[0, 0.06, 0]} receiveShadow>
        <meshStandardMaterial color="#4aa3c7" transparent opacity={0.92} roughness={0.15} metalness={0.1} flatShading />
      </mesh>
    </group>
  )
}

function Trees() {
  useGame((s) => s.rev) // trees get cut down when building
  const season = useGame((s) => seasonOf(s.time)) // leaves change colour with the season
  const TREES_LEFT = TREES.filter((_, i) => !town.cleared.has(i))
  const k = TREES_LEFT.length
  const trunks = useRef<THREE.InstancedMesh>(null), pines = useRef<THREE.InstancedMesh>(null), oaks = useRef<THREE.InstancedMesh>(null)
  const pineList = TREES_LEFT.filter((t) => t.kind === 0), oakList = TREES_LEFT.filter((t) => t.kind === 1)
  useInstances(trunks, TREES_LEFT.map((t) => ({ p: [t.x, 0.7 * t.s, t.z], s: [0.22 * t.s, 1.4 * t.s, 0.22 * t.s] })))
  useInstances(pines, pineList.map((t, i) => ({ p: [t.x, 2.6 * t.s, t.z], s: [1.4 * t.s, 3.2 * t.s, 1.4 * t.s], ry: i, c: ['#2f6b3f', '#3a7a46', '#2a5e3a'][i % 3] })))
  useInstances(oaks, oakList.map((t, i) => ({ p: [t.x, 2.2 * t.s, t.z], s: [1.3 * t.s, 1.1 * t.s, 1.3 * t.s], ry: i, c: OAK[season][i % 4] })))
  return (
    <group>
      <instancedMesh key={`t${k}`} ref={trunks} args={[geo.cyl, mat('#6b4a2e'), TREES_LEFT.length]} castShadow />
      <instancedMesh key={`p${k}`} ref={pines} args={[geo.cone, undefined, pineList.length]} castShadow receiveShadow>
        <meshStandardMaterial flatShading roughness={0.9} />
      </instancedMesh>
      <instancedMesh key={`o${k}`} ref={oaks} args={[new THREE.IcosahedronGeometry(1, 0), undefined, oakList.length]} castShadow receiveShadow>
        <meshStandardMaterial flatShading roughness={0.9} />
      </instancedMesh>
    </group>
  )
}

const FLOWER_COLORS = ['#f4d35e', '#ee6c9a', '#f6f1e9', '#a77ee0', '#ff8a5b']
function Decor() {
  const season = useGame((s) => seasonOf(s.time))
  const rocks = useRef<THREE.InstancedMesh>(null), flowers = useRef<THREE.InstancedMesh>(null), bushes = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => { tint.flowers = flowers.current ?? undefined }, [])
  useInstances(rocks, ROCKS.map((r) => ({ p: [r.x, r.s * 0.3, r.z], s: [r.s, r.s * 0.7, r.s], ry: r.ry })))
  useInstances(flowers, FLOWERS.map((f) => ({ p: [f.x, 0.18, f.z], s: [0.13, 0.13, 0.13], c: FLOWER_COLORS[f.c] })))
  const bushList = useMemo(() => FLOWERS.filter((_, i) => i % 6 === 0), [])
  useInstances(bushes, bushList.map((f, i) => ({ p: [f.x + 0.5, 0.35, f.z + 0.3], s: [0.6, 0.45, 0.6], ry: i, c: BUSH[season][i % 2] })))
  return (
    <group>
      <instancedMesh ref={rocks} args={[new THREE.DodecahedronGeometry(1, 0), mat('#9a958c'), ROCKS.length]} castShadow receiveShadow />
      <instancedMesh ref={flowers} args={[geo.sphere, undefined, FLOWERS.length]}>
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={bushes} args={[new THREE.IcosahedronGeometry(1, 0), undefined, bushList.length]} castShadow>
        <meshStandardMaterial flatShading roughness={1} />
      </instancedMesh>
    </group>
  )
}

function Lamps() {
  const posts = useRef<THREE.InstancedMesh>(null), heads = useRef<THREE.InstancedMesh>(null)
  useInstances(posts, LAMPS.map(([x, z]) => ({ p: [x, 1.3, z], s: [0.09, 2.6, 0.09] })))
  useInstances(heads, LAMPS.map(([x, z]) => ({ p: [x, 2.75, z], s: [0.3, 0.38, 0.3] })))
  return (
    <group>
      <instancedMesh ref={posts} args={[geo.cyl, mat('#3b332c'), LAMPS.length]} castShadow />
      <instancedMesh ref={heads} args={[geo.box, glow.lamp, LAMPS.length]} />
    </group>
  )
}

function Mountains() {
  const list = useMemo(() => {
    const r = rng(99), out: { p: [number, number, number]; s: [number, number, number]; ry: number; c: string }[] = []
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2, d = 105 + r() * 15, h = 18 + r() * 22
      out.push({ p: [Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d], s: [14 + r() * 10, h, 14 + r() * 10], ry: r() * 3, c: r() > 0.5 ? '#6f8a7a' : '#7d9384' })
    }
    return out
  }, [])
  const ref = useRef<THREE.InstancedMesh>(null)
  useInstances(ref, list)
  return (
    <instancedMesh ref={ref} args={[new THREE.ConeGeometry(1, 1, 6), undefined, list.length]}>
      <meshStandardMaterial flatShading roughness={1} />
    </instancedMesh>
  )
}

function Fireflies() {
  const N = 90
  const { geom, seeds } = useMemo(() => {
    const r = rng(5), seeds = Array.from({ length: N }, () => [(r() - 0.5) * 70, (r() - 0.5) * 70, r() * 10])
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3))
    return { geom, seeds }
  }, [])
  const matRef = useRef<THREE.PointsMaterial>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, pos = geom.attributes.position
    seeds.forEach(([x, z, s], i) => pos.setXYZ(i, x + Math.sin(t * 0.3 + s) * 2, 0.8 + Math.sin(t * 0.9 + s * 3) * 0.6, z + Math.cos(t * 0.25 + s) * 2))
    pos.needsUpdate = true
    matRef.current.opacity = Math.max(0, env.night - 0.4) * 1.6 * (0.7 + Math.sin(t * 3) * 0.3)
  })
  return (
    <points geometry={geom} frustumCulled={false}>
      <pointsMaterial ref={matRef} color="#fff2a0" size={0.22} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

const SKY = { day: new THREE.Color('#a8d8f0'), dusk: new THREE.Color('#f2a675'), night: new THREE.Color('#0f1733') }
const tmp = new THREE.Color(), tmpGrey = new THREE.Color(), OVERCAST = new THREE.Color('#8d98a3')
const flash = { v: 0 }

/** Sun, sky colour, fog and night glow driven by the game clock. */
function DayNight() {
  const sun = useRef<THREE.DirectionalLight>(null!), hemi = useRef<THREE.HemisphereLight>(null!)
  const squareLights = useRef<THREE.Group>(null!)
  const { scene } = useThree()
  const quality = useGame((s) => s.quality)
  useMemo(() => {
    scene.background = new THREE.Color()
    scene.fog = new THREE.Fog('#a8d8f0', 70, 170)
  }, [scene])

  useFrame((_, dt) => {
    useGame.getState().tick(Math.min(dt, 0.1)) // capped: a throttled or hidden tab pauses instead of skipping hours
    stepWeather(Math.min(dt, 0.1), useGame.getState().time)
    const h = hourOf(useGame.getState().time)
    const ang = ((h - 6) / 12) * Math.PI // 0 at sunrise, π at sunset
    const height = Math.sin(ang)
    const day = THREE.MathUtils.smoothstep(height, -0.12, 0.3)
    const dusk = Math.max(0, 1 - Math.abs(height) / 0.3) * (height > -0.2 ? 1 : 0)
    env.night = 1 - day

    tmp.copy(SKY.night).lerp(SKY.day, day).lerp(SKY.dusk, dusk * 0.55)
    tmp.lerp(tmpGrey.copy(OVERCAST).multiplyScalar(0.2 + 0.8 * day), env.cloud * 0.6) // overcast sky
    const inside = !!useGame.getState().interior
    if (inside) tmp.set('#1c130d') // the room floats in a warm dark, not the town's sky
    ;(scene.background as THREE.Color).copy(tmp)
    const fog = scene.fog as THREE.Fog
    fog.color.copy(tmp)
    fog.near = inside ? 30 : 70 - env.fog * 58 - env.cloud * 10
    fog.far = inside ? 80 : 170 - env.fog * 105 - env.cloud * 25
    // thunderstorm: occasional lightning flashes
    if (env.rain > 0.9 && Math.random() < dt * 0.12) { flash.v = 1; thunder() }
    updateAudio(dt)
    flash.v = Math.max(0, flash.v - dt * 3.5)

    // light follows the player so the shadow map stays sharp around the action
    const c = useGame.getState().mode === 'iso' ? cam.isoTarget : player.pos
    sun.current.position.set(c.x + Math.cos(ang) * 40, Math.max(Math.abs(height), 0.25) * 50, c.z + 18)
    sun.current.target.position.set(c.x, 0, c.z)
    sun.current.target.updateMatrixWorld()
    sun.current.intensity = (0.25 + 2.4 * day) * (1 - 0.6 * env.cloud)
    sun.current.color.set(height > 0 ? '#fff1d6' : '#9fb4ff').lerp(SKY.dusk, dusk * 0.5)
    hemi.current.intensity = (0.35 + 0.75 * day) * (1 - 0.2 * env.cloud) + flash.v * 2.2
    hemi.current.color.set('#cfe6ff').lerp(SKY.night, (1 - day) * 0.4)

    glow.window.emissiveIntensity = env.night * 1.4
    glow.lamp.emissiveIntensity = 0.2 + env.night * 2.6
    squareLights.current.children.forEach((l) => ((l as THREE.PointLight).intensity = env.night * 14))
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={['#cfe6ff', '#5a7a3a', 1]} />
      <directionalLight ref={sun} castShadow={quality === 'high'} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={150} />
      <group ref={squareLights}>
        {LAMPS.slice(-4).map(([x, z], i) => <pointLight key={i} position={[x, 3, z]} color="#ffb35a" distance={14} decay={1.6} />)}
      </group>
    </>
  )
}

export function Environment() {
  return (
    <>
      <DayNight />
      <Ground />
      <Paths />
      <River />
      <Trees />
      <Decor />
      <Lamps />
      <Mountains />
      <Fireflies />
      <SnowCover />
      <Rain />
      <Drift kind="snow" />
      <Drift kind="leaves" />
      <Drift kind="petals" />
      <FestivalDecor />
    </>
  )
}
