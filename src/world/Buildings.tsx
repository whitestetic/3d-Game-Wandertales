import { useRef, type ReactNode, useEffect, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Group, Mesh, Object3D } from 'three'
import { BUILDINGS, type BuildingDef, type BuildingKind } from '../game/map'
import { town } from '../game/town'
import { useGame } from '../game/store'
import { geo, glow, mat } from './materials'

type V3 = [number, number, number]
const Box = ({ p, s, c, r, m }: { p: V3; s: V3; c?: string; r?: V3; m?: ReturnType<typeof mat> }) => (
  <mesh geometry={geo.box} material={m ?? mat(c!)} position={p} scale={s} rotation={r} castShadow receiveShadow />
)
const Window = ({ p, w = 0.8, h = 0.9 }: { p: V3; w?: number; h?: number }) => (
  <group position={p}>
    <Box p={[0, 0, 0]} s={[w + 0.16, h + 0.16, 0.08]} c="#5a3e28" />
    <mesh geometry={geo.box} material={glow.window} position={[0, 0, 0.05]} scale={[w, h, 0.04]} />
  </group>
)
const Door = ({ p, w = 1.1, h = 1.8 }: { p: V3; w?: number; h?: number }) => (
  <group position={p}>
    <Box p={[0, h / 2, 0]} s={[w + 0.2, h + 0.15, 0.1]} c="#4a3220" />
    <Box p={[0, h / 2, 0.05]} s={[w, h, 0.06]} c="#7a4e2c" />
    <mesh geometry={geo.sphere} material={mat('#d8b24a', { rough: 0.3 })} position={[w * 0.3, h * 0.48, 0.12]} scale={0.06} />
  </group>
)
const Barrel = ({ p }: { p: V3 }) => (
  <group position={p}>
    <mesh geometry={geo.cyl} material={mat('#8a5a33')} position={[0, 0.45, 0]} scale={[0.38, 0.9, 0.38]} castShadow />
    <mesh geometry={geo.cyl} material={mat('#3d3d3d')} position={[0, 0.75, 0]} scale={[0.4, 0.06, 0.4]} />
    <mesh geometry={geo.cyl} material={mat('#3d3d3d')} position={[0, 0.15, 0]} scale={[0.4, 0.06, 0.4]} />
  </group>
)

// GLB loader cache
const BASE = import.meta.env.BASE_URL ?? '/'
const loader = new GLTFLoader()
const glbCache = new Map<string, Promise<any>>()
const loadGlb = (file: string) => {
  let p = glbCache.get(file)
  if (!p) { p = loader.loadAsync(BASE + file); glbCache.set(file, p) }
  return p
}

/** Generic timber cottage: front faces +z. */
function Cottage({ W, D, h = 3, wall = '#efe2c4', roof = '#b5523b', trim = '#6b4a2e', chimney, children }:
  { W: number; D: number; h?: number; wall?: string; roof?: string; trim?: string; chimney?: boolean; children?: ReactNode }) {
  const rh = Math.min(W, D) * 0.45
  return (
    <group>
      <Box p={[0, 0.2, 0]} s={[W + 0.3, 0.4, D + 0.3]} c="#9a948a" />
      <Box p={[0, 0.4 + h / 2, 0]} s={[W, h, D]} c={wall} />
      {/* timber frame corners */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
        <Box key={`${sx}${sz}`} p={[sx * W / 2, 0.4 + h / 2, sz * D / 2]} s={[0.25, h, 0.25]} c={trim} />
      ))}
      <Box p={[0, 0.4 + h, D / 2]} s={[W, 0.22, 0.2]} c={trim} />
      {/* roof: ridge runs along the front */}
      <mesh geometry={geo.prism} material={mat(roof)} position={[0, 0.4 + h, 0]} scale={[W + 0.7, rh, D + 0.9]} castShadow receiveShadow />
      {chimney && <Box p={[W * 0.28, 0.4 + h + rh * 0.7, -D * 0.15]} s={[0.7, rh * 1.1, 0.7]} c="#8b7f74" />}
      <Door p={[0, 0.4, D / 2 + 0.02]} />
      <Window p={[-W * 0.3, 0.4 + h * 0.55, D / 2 + 0.03]} />
      <Window p={[W * 0.3, 0.4 + h * 0.55, D / 2 + 0.03]} />
      {children}
    </group>
  )
}

function Smoke({ p }: { p: V3 }) {
  const g = useRef<Group>(null!)
  useFrame(({ clock }) => {
    g.current.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.35 + i / 4) % 1
      c.position.set(Math.sin(t * 6 + i) * 0.2, t * 3, 0)
      c.scale.setScalar(0.25 + t * 0.5)
      ;((c as Mesh).material as { opacity: number }).opacity = 0.55 * (1 - t)
    })
  })
  return (
    <group ref={g} position={p}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} geometry={geo.sphere}>
          <meshStandardMaterial color="#e8e4dc" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function Guild() {
  return (
    <group>
      <Box p={[0, 0.25, 0]} s={[12.4, 0.5, 10.4]} c="#8f8a82" />
      <Box p={[0, 3.2, 0]} s={[12, 5.4, 10]} c="#d9cfbd" />
      <Box p={[0, 3, 5.02]} s={[12, 0.25, 0.1]} c="#5c4430" />
      <mesh geometry={geo.prism} material={mat('#3f5f8f')} position={[0, 5.9, 0]} scale={[12.8, 3.4, 11]} castShadow />
      {/* tower */}
      <Box p={[0, 5.5, -2]} s={[3.4, 11, 3.4]} c="#cfc4b0" />
      <mesh geometry={geo.cone4} material={mat('#35527d')} position={[0, 13, -2]} rotation={[0, Math.PI / 4, 0]} scale={[3.1, 3.2, 3.1]} castShadow />
      <Window p={[0, 8.5, -0.28]} w={1} h={1.3} />
      <mesh geometry={geo.cyl} material={mat('#5c4430')} position={[0, 15.4, -2]} scale={[0.06, 1.6, 0.06]} />
      <Box p={[0.45, 15.8, -2]} s={[0.9, 0.55, 0.04]} c="#c23b3b" />
      {/* entrance */}
      <Box p={[0, 0.65, 5.6]} s={[4, 0.3, 1.4]} c="#a29a8e" />
      <Box p={[0, 0.85, 6.3]} s={[4.6, 0.2, 0.6]} c="#a29a8e" />
      <Door p={[0, 0.5, 5.03]} w={2} h={2.6} />
      {[-1.6, 1.6].map((x) => <Box key={x} p={[x, 2.2, 5.6]} s={[0.4, 3.4, 0.4]} c="#efe7d8" />)}
      <Box p={[0, 4, 5.7]} s={[4, 0.35, 1.4]} c="#3f5f8f" />
      {/* sign + banners */}
      <Box p={[0, 4.8, 5.1]} s={[3.6, 0.8, 0.12]} c="#6b4a2e" />
      <Box p={[0, 4.8, 5.17]} s={[0.6, 0.45, 0.04]} c="#e7c35b" />
      {[-4.2, 4.2].map((x) => (
        <group key={x} position={[x, 4.2, 5.08]}>
          <Box p={[0, 0, 0]} s={[1.1, 2.6, 0.05]} c="#b8392f" />
          <Box p={[0, 0.2, 0.03]} s={[0.5, 0.5, 0.03]} c="#e7c35b" />
        </group>
      ))}
      {[-3.5, 3.5].map((x) => <Window key={x} p={[x, 2.1, 5.04]} w={1.1} h={1.3} />)}
    </group>
  )
}

function Tavern({ W, D }: { W: number; D: number }) {
  return (
    <Cottage W={W} D={D} h={4.2} wall="#e6c99a" roof="#7c4a33" trim="#4e3523" chimney>
      <Smoke p={[W * 0.28, 7.5, -D * 0.15]} />
      <Box p={[W / 2 - 0.6, 3.6, D / 2 + 0.9]} s={[0.12, 0.12, 1.8]} c="#4e3523" />
      <Box p={[W / 2 - 0.6, 3.05, D / 2 + 1.5]} s={[1.1, 0.8, 0.08]} c="#b5823f" />
      <Barrel p={[-W / 2 + 0.4, 0, D / 2 + 0.8]} />
      <Barrel p={[-W / 2 + 1.3, 0, D / 2 + 0.6]} />
      <Box p={[2.3, 0.45, D / 2 + 1.6]} s={[1.6, 0.1, 0.8]} c="#8a5a33" />
      <Box p={[2.3, 0.22, D / 2 + 1.6]} s={[0.15, 0.45, 0.15]} c="#6b4a2e" />
    </Cottage>
  )
}

function Bakery({ W, D }: { W: number; D: number }) {
  return (
    <Cottage W={W} D={D} h={3.2} wall="#f4e6cf" roof="#d0753f" chimney>
      <Smoke p={[W * 0.28, 6.3, -D * 0.15]} />
      <Box p={[0, 2.7, D / 2 + 0.6]} s={[W * 0.8, 0.12, 1.2]} r={[0.35, 0, 0]} c="#e8b4a0" />
      <Box p={[-W * 0.3, 0.55, D / 2 + 0.55]} s={[1.2, 0.3, 0.7]} c="#8a5a33" />
      {[-0.3, 0, 0.3].map((x) => <mesh key={x} geometry={geo.sphere} material={mat('#c98b4a')} position={[-W * 0.3 + x, 0.78, D / 2 + 0.55]} scale={[0.18, 0.1, 0.12]} />)}
    </Cottage>
  )
}

function Smithy({ W, D }: { W: number; D: number }) {
  return (
    <group>
      <Box p={[0, 0.15, 0]} s={[W, 0.3, D]} c="#7f7a72" />
      <Box p={[0, 2, -D / 2 + 0.3]} s={[W, 4, 0.6]} c="#7d756b" />
      <Box p={[-W / 2 + 0.3, 2, 0]} s={[0.6, 4, D]} c="#7d756b" />
      {[[W / 2 - 0.3, D / 2 - 0.3], [-W / 2 + 0.3, D / 2 - 0.3], [W / 2 - 0.3, -D / 2 + 0.3]].map(([x, z]) => (
        <Box key={`${x}${z}`} p={[x, 2, z]} s={[0.35, 4, 0.35]} c="#4e3523" />
      ))}
      <mesh geometry={geo.prism} material={mat('#5d4b3e')} position={[0, 4, 0]} scale={[W + 0.6, 2.2, D + 0.8]} castShadow />
      {/* forge */}
      <Box p={[-1.6, 0.8, -D / 2 + 1.4]} s={[2, 1.3, 1.6]} c="#6d655c" />
      <mesh geometry={geo.box} material={glow.forge} position={[-1.6, 1.5, -D / 2 + 1.4]} scale={[1.4, 0.15, 1.1]} />
      <Box p={[-1.6, 4.5, -D / 2 + 1.4]} s={[0.9, 3.5, 0.9]} c="#6d655c" />
      <Smoke p={[-1.6, 6.5, -D / 2 + 1.4]} />
      <pointLight position={[-1.6, 2.2, -D / 2 + 1.8]} color="#ff7a30" intensity={6} distance={7} />
      {/* anvil */}
      <Box p={[1.2, 0.5, 0.4]} s={[0.5, 0.7, 0.5]} c="#4a3a2e" />
      <Box p={[1.2, 0.95, 0.4]} s={[1, 0.25, 0.45]} c="#3a3d44" />
      <Box p={[W / 2 - 1, 0.9, -D / 2 + 1]} s={[1.4, 0.1, 0.6]} c="#8a5a33" />
      {[0, 0.4, 0.8].map((x) => <Box key={x} p={[W / 2 - 1.5 + x, 1.6, -D / 2 + 0.7]} s={[0.08, 1, 0.08]} c="#9aa0a8" />)}
    </group>
  )
}

const STRIPES = [['#c94f4f', '#f3e6d0'], ['#3f78a8', '#f3e6d0'], ['#4f9a5a', '#f3e6d0']]
const GOODS = ['#d4463b', '#e8b33a', '#7cb850', '#c98b4a', '#a874c9']
function Market({ W }: { W: number }) {
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <group key={i} position={[i * (W / 3), 0, 0]}>
          {[[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].map(([x, z]) => (
            <Box key={`${x}${z}`} p={[x, 1.25, z]} s={[0.15, 2.5, 0.15]} c="#6b4a2e" />
          ))}
          {[0, 1, 2, 3, 4].map((s) => (
            <Box key={s} p={[-1.2 + 0.6 * s, 2.6, 0.2]} s={[0.6, 0.08, 3.2]} r={[0.18, 0, 0]} c={STRIPES[i + 1][s % 2]} />
          ))}
          <Box p={[0, 0.85, 1.1]} s={[2.4, 0.2, 0.8]} c="#a2733f" />
          <Box p={[0, 0.4, 1.1]} s={[2.2, 0.7, 0.7]} c="#8a5a33" />
          {[-0.8, -0.3, 0.2, 0.7].map((x, k) => (
            <mesh key={x} geometry={geo.sphere} material={mat(GOODS[(k + i + 1) % 5])} position={[x, 1.05, 1.1]} scale={0.17} castShadow />
          ))}
          <Box p={[0.6, 0.3, -0.8]} s={[0.6, 0.6, 0.6]} c="#b08850" />
        </group>
      ))}
    </group>
  )
}

function Farm({ W, D }: { W: number; D: number }) {
  const rows = 8
  return (
    <group>
      {Array.from({ length: rows }, (_, i) => {
        const x = -W / 2 + 1.5 + i * 1.3
        const wheat = i < 5
        return (
          <group key={i} position={[x, 0, 0.8]}>
            <Box p={[0, 0.12, 0]} s={[0.9, 0.24, D - 4]} c="#7a5434" />
            {Array.from({ length: 9 }, (_, k) => (
              <mesh key={k} geometry={wheat ? geo.cone : geo.sphere} material={mat(wheat ? '#e3c25a' : '#5ea34a')}
                position={[0, wheat ? 0.6 : 0.4, -D / 2 + 2.6 + k * 0.85]} scale={wheat ? [0.2, 0.75, 0.2] : 0.28} castShadow />
            ))}
          </group>
        )
      })}
      {/* barn */}
      <group position={[W / 2 - 3, 0, -1]}>
        <Box p={[0, 1.8, 0]} s={[4.4, 3.6, 5]} c="#b8432f" />
        <mesh geometry={geo.prism} material={mat('#5d4b3e')} position={[0, 3.6, 0]} scale={[5.6, 2, 4.9]} rotation={[0, Math.PI / 2, 0]} castShadow />
        <Box p={[0, 1.3, 2.52]} s={[2, 2.6, 0.06]} c="#f1e7d4" />
        <Box p={[0, 1.3, 2.56]} s={[1.7, 2.3, 0.06]} c="#9c3627" />
        <Box p={[0, 1.3, 2.6]} s={[2.4, 0.12, 0.04]} r={[0, 0, 0.83]} c="#f1e7d4" />
        <Box p={[0, 1.3, 2.6]} s={[2.4, 0.12, 0.04]} r={[0, 0, -0.83]} c="#f1e7d4" />
      </group>
      {/* hay + scarecrow */}
      <mesh geometry={geo.cyl} material={mat('#e0c066')} position={[W / 2 - 1.5, 0.6, D / 2 - 1.5]} rotation={[Math.PI / 2, 0, 0]} scale={[0.6, 1.2, 0.6]} castShadow />
      <group position={[-W / 2 + 6, 0, 0.6]}>
        <Box p={[0, 1, 0]} s={[0.1, 2, 0.1]} c="#6b4a2e" />
        <Box p={[0, 1.5, 0]} s={[1.4, 0.1, 0.1]} c="#6b4a2e" />
        <mesh geometry={geo.sphere} material={mat('#e0c066')} position={[0, 2.1, 0]} scale={0.25} />
        <mesh geometry={geo.cone} material={mat('#6b5a3a')} position={[0, 2.4, 0]} scale={[0.35, 0.3, 0.35]} />
      </group>
      <Fence W={W} D={D} />
    </group>
  )
}

function Fence({ W, D }: { W: number; D: number }) {
  const posts: V3[] = []
  const rails: { p: V3; s: V3 }[] = []
  const side = (ax: number, az: number, bx: number, bz: number, gap = false) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2)
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t
      if (gap && Math.abs(x) < 1.6) continue
      posts.push([x, 0.5, z])
      if (i < n && !(gap && Math.abs(x + (bx - ax) / n / 2) < 1.6)) {
        const mx = x + (bx - ax) / n / 2, mz = z + (bz - az) / n / 2
        rails.push({ p: [mx, 0.65, mz], s: [Math.abs(bx - ax) / n + 0.1, 0.1, Math.abs(bz - az) / n + 0.1] })
      }
    }
  }
  side(-W / 2, D / 2, W / 2, D / 2, true)
  side(-W / 2, -D / 2, W / 2, -D / 2)
  side(-W / 2, -D / 2, -W / 2, D / 2)
  side(W / 2, -D / 2, W / 2, D / 2)
  return (
    <group>
      {posts.map((p, i) => <Box key={i} p={p} s={[0.16, 1, 0.16]} c="#8a6240" />)}
      {rails.map((r, i) => <Box key={`r${i}`} p={r.p} s={r.s} c="#a27a50" />)}
    </group>
  )
}

function Construction({ W, D }: { W: number; D: number }) {
  return (
    <group>
      <Box p={[0, 0.15, 0]} s={[W - 1, 0.3, D - 1]} c="#a39b8f" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]].map(([sx, sz]) => (
        <Box key={`${sx}${sz}`} p={[sx * (W / 2 - 0.8), 2, sz * (D / 2 - 0.8)]} s={[0.18, 4, 0.18]} c="#b08850" />
      ))}
      {[1.6, 3.4].map((y) => (
        <group key={y}>
          <Box p={[0, y, D / 2 - 0.8]} s={[W - 1.4, 0.12, 0.12]} c="#b08850" />
          <Box p={[0, y, -D / 2 + 0.8]} s={[W - 1.4, 0.12, 0.12]} c="#b08850" />
          <Box p={[W / 2 - 0.8, y, 0]} s={[0.12, 0.12, D - 1.4]} c="#b08850" />
          <Box p={[-W / 2 + 0.8, y, 0]} s={[0.12, 0.12, D - 1.4]} c="#b08850" />
        </group>
      ))}
      <Box p={[0, 1.6, D / 2 - 0.8]} s={[W - 1.4, 0.1, 0.9]} c="#c9a36a" />
      {[0, 1, 2, 3].map((i) => <Box key={i} p={[-W / 2 + 2, 0.45 + i * 0.18, -1 + (i % 2) * 0.05]} s={[2.6, 0.16, 0.5]} c={i % 2 ? '#c49a62' : '#b08850'} />)}
      {[0, 1, 2].map((i) => <mesh key={i} geometry={geo.sphere} material={mat('#9a958c')} position={[1.5 + i * 0.6, 0.5, -1.5]} scale={0.32} castShadow />)}
      <group position={[2.6, 0, D / 2 + 0.3]}>
        <Box p={[0, 0.7, 0]} s={[0.12, 1.4, 0.12]} c="#6b4a2e" />
        <Box p={[0, 1.4, 0.05]} s={[1.4, 0.7, 0.06]} c="#e3c25a" />
      </group>
    </group>
  )
}

function Dock({ W, D }: { W: number; D: number }) {
  return (
    <group>
      {Array.from({ length: Math.round(D / 0.5) }, (_, i) => (
        <Box key={i} p={[0, 0.28, -D / 2 + 0.25 + i * 0.5]} s={[W, 0.12, 0.44]} c={i % 3 ? '#9a6f45' : '#8a6240'} />
      ))}
      {[[-1, -1], [1, -1], [-1, 0], [1, 0]].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} geometry={geo.cyl} material={mat('#6b4a2e')} position={[sx * (W / 2 - 0.1), 0.1, sz * (D / 2 - 0.3)]} scale={[0.14, 1.2, 0.14]} castShadow />
      ))}
      <group position={[W / 2 + 1, 0, -D / 2 + 1]}>
        <mesh geometry={geo.sphere} material={mat('#8a5a33')} position={[0, 0.05, 0]} scale={[0.75, 0.35, 1.6]} castShadow />
        <Box p={[0, 0.25, 0]} s={[1.2, 0.08, 0.3]} c="#6b4a2e" />
      </group>
      <Barrel p={[-W / 2 + 0.5, 0.3, D / 2 - 0.6]} />
    </group>
  )
}

function Fountain() {
  const water = useRef<Mesh>(null!)
  useFrame(({ clock }) => { water.current.position.y = 0.72 + Math.sin(clock.elapsedTime * 2) * 0.03 })
  return (
    <group>
      <mesh geometry={geo.cyl} material={mat('#b9b2a6')} position={[0, 0.4, 0]} scale={[2, 0.8, 2]} castShadow receiveShadow />
      <mesh ref={water} geometry={geo.cyl} material={mat('#5fb3d6', { rough: 0.15 })} position={[0, 0.72, 0]} scale={[1.75, 0.1, 1.75]} />
      <mesh geometry={geo.cyl} material={mat('#c8c1b5')} position={[0, 1.4, 0]} scale={[0.3, 1.6, 0.3]} castShadow />
      <mesh geometry={geo.cyl} material={mat('#c8c1b5')} position={[0, 2.2, 0]} scale={[0.9, 0.18, 0.9]} castShadow />
      <mesh geometry={geo.sphere} material={mat('#5fb3d6', { rough: 0.15 })} position={[0, 2.5, 0]} scale={[0.35, 0.3, 0.35]} />
    </group>
  )
}

function LumberCamp({ W, D }: { W: number; D: number }) {
  return (
    <group>
      <group position={[-W * 0.18, 0, -D * 0.1]}><Cottage W={W * 0.55} D={D * 0.6} h={2.2} wall="#b08850" roof="#5d7a3a" trim="#5a3e28" /></group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={geo.cyl} material={mat('#8a5a33')} position={[W * 0.3, 0.3 + (i === 2 ? 0.5 : 0), -0.6 + (i % 2) * 0.62 + (i === 2 ? 0.3 : 0)]}
          rotation={[0, 0, Math.PI / 2]} scale={[0.3, 2.4, 0.3]} castShadow />
      ))}
      <mesh geometry={geo.cyl} material={mat('#9a6f45')} position={[W * 0.25, 0.3, D * 0.32]} scale={[0.45, 0.6, 0.45]} castShadow />
      <Box p={[W * 0.25, 0.75, D * 0.32]} s={[0.08, 0.5, 0.08]} r={[0, 0, 0.4]} c="#5a3e28" />
    </group>
  )
}

function Quarry({ W, D }: { W: number; D: number }) {
  return (
    <group>
      {[[-1.5, -1, 2.2], [1.2, -1.5, 1.8], [0, -2, 2.6], [2.4, 0.5, 1.2]].map(([x, z, s], i) => (
        <mesh key={i} geometry={geo.sphere} material={mat(i % 2 ? '#9a958c' : '#a8a296')} position={[x, s * 0.4, z]} scale={[s, s * 0.8, s]} castShadow receiveShadow />
      ))}
      {[0, 1, 2].map((i) => <Box key={i} p={[-W / 2 + 1.4 + i * 0.95, 0.35, D / 2 - 1.2]} s={[0.8, 0.7, 0.8]} c="#c2baae" />)}
      <Box p={[-W / 2 + 1.9, 1.05, D / 2 - 1.2]} s={[0.8, 0.7, 0.8]} c="#b3aa9c" />
      <Box p={[W / 2 - 1, 1.8, D / 2 - 1.4]} s={[0.15, 3.6, 0.15]} c="#6b4a2e" />
      <Box p={[W / 2 - 1.8, 3.5, D / 2 - 1.4]} s={[1.8, 0.12, 0.12]} c="#6b4a2e" />
    </group>
  )
}

function Mine({ W, D }: { W: number; D: number }) {
  return (
    <group>
      <mesh geometry={geo.cone4} material={mat('#7d756b')} position={[0, 2.2, -D * 0.15]} rotation={[0, Math.PI / 4, 0]} scale={[W * 0.62, 4.4, D * 0.62]} castShadow receiveShadow />
      <Box p={[0, 1.1, D * 0.18]} s={[2, 2.2, 0.3]} c="#1d1714" />
      <Box p={[-1.1, 1.2, D * 0.22]} s={[0.25, 2.4, 0.25]} c="#6b4a2e" />
      <Box p={[1.1, 1.2, D * 0.22]} s={[0.25, 2.4, 0.25]} c="#6b4a2e" />
      <Box p={[0, 2.4, D * 0.22]} s={[2.6, 0.25, 0.3]} c="#6b4a2e" />
      {[-0.4, 0.4].map((x) => <Box key={x} p={[x, 0.05, D * 0.38]} s={[0.08, 0.06, D * 0.4]} c="#5a5a5a" />)}
      <group position={[0, 0, D * 0.42]}>
        <Box p={[0, 0.45, 0]} s={[1, 0.6, 0.8]} c="#5c4a3a" />
        {[-0.2, 0.2].map((x) => <mesh key={x} geometry={geo.sphere} material={mat('#8a6f5a')} position={[x, 0.8, 0]} scale={0.22} />)}
      </group>
    </group>
  )
}

function Workshop({ W, D }: { W: number; D: number }) {
  return (
    <Cottage W={W} D={D} h={3} wall="#d8b98a" roof="#6b4a2e" trim="#4a3220" chimney>
      {[0, 1, 2].map((i) => <Box key={i} p={[W / 2 + 0.7, 0.15 + i * 0.14, 0.5]} s={[0.9, 0.12, 2.6]} c={i % 2 ? '#c49a62' : '#b08850'} />)}
      <Box p={[-W / 2 - 0.8, 0.55, 1]} s={[1.4, 0.12, 0.4]} c="#8a5a33" />
      <Box p={[-W / 2 - 0.8, 0.3, 1]} s={[0.1, 0.55, 0.5]} c="#6b4a2e" />
    </Cottage>
  )
}

function Alchemist({ W, D }: { W: number; D: number }) {
  return (
    <Cottage W={W} D={D} h={2.8} wall="#e4dcef" roof="#6a4a8c" chimney>
      <Smoke p={[W * 0.28, 5.4, -D * 0.15]} />
      <group position={[W / 2 + 0.9, 0, D / 2 - 1]}>
        <mesh geometry={geo.sphere} material={mat('#2f2a35')} position={[0, 0.5, 0]} scale={[0.6, 0.5, 0.6]} castShadow />
        <mesh geometry={geo.cyl} material={glow.forge} position={[0, 0.85, 0]} scale={[0.45, 0.05, 0.45]} />
      </group>
      {['#6fd18a', '#b07ce0', '#e0c050'].map((c, i) => (
        <mesh key={c} geometry={geo.cyl} material={mat(c, { rough: 0.2 })} position={[-W / 2 - 0.5, 0.25, -0.5 + i * 0.5]} scale={[0.14, 0.5, 0.14]} />
      ))}
    </Cottage>
  )
}

const HOUSE_COLORS = [['#efe2c4', '#b5523b'], ['#dfe7d4', '#4f7a8c'], ['#f2dcc8', '#8a5a9a'], ['#e9dcb4', '#5d7a3a']]
const idHash = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0)

/** Scaffolding shown around a building while it's being built or upgraded. */
function Scaffold({ W, D, h }: { W: number; D: number; h: number }) {
  const posts: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
  return (
    <group>
      {posts.map(([sx, sz]) => <Box key={`${sx}${sz}`} p={[sx * (W / 2 + 0.4), h / 2, sz * (D / 2 + 0.4)]} s={[0.15, h, 0.15]} c="#c9a36a" />)}
      {[h * 0.45, h * 0.9].map((y) => (
        <group key={y}>
          <Box p={[0, y, D / 2 + 0.4]} s={[W + 0.8, 0.1, 0.1]} c="#c9a36a" />
          <Box p={[0, y, -D / 2 - 0.4]} s={[W + 0.8, 0.1, 0.1]} c="#c9a36a" />
          <Box p={[W / 2 + 0.4, y, 0]} s={[0.1, 0.1, D + 0.8]} c="#c9a36a" />
          <Box p={[-W / 2 - 0.4, y, 0]} s={[0.1, 0.1, D + 0.8]} c="#c9a36a" />
        </group>
      ))}
    </group>
  )
}

function ProceduralModel({ b, W, D }: { b: { id: string; kind: BuildingKind }; W: number; D: number }) {
  switch (b.kind) {
    case 'guild': return <Guild />
    case 'tavern': return <Tavern W={W} D={D} />
    case 'bakery': return <Bakery W={W} D={D} />
    case 'blacksmith': return <Smithy W={W} D={D} />
    case 'market': return <Market W={W} />
    case 'farm': return <Farm W={W} D={D} />
    case 'construction': return <Construction W={W} D={D} />
    case 'dock': return <Dock W={W} D={D} />
    case 'square': return <Fountain />
    case 'lumber': return <LumberCamp W={W} D={D} />
    case 'quarry': return <Quarry W={W} D={D} />
    case 'mine': return <Mine W={W} D={D} />
    case 'workshop': return <Workshop W={W} D={D} />
    case 'alchemist': return <Alchemist W={W} D={D} />
    case 'house': {
      const [wall, roof] = HOUSE_COLORS[idHash(b.id) % HOUSE_COLORS.length]
      return <Cottage W={W} D={D} h={2.8} wall={wall} roof={roof} chimney />
    }
  }
}

export function Model({ b, W, D }: { b: { id: string; kind: BuildingKind }; W: number; D: number }) {
  const [scene, setScene] = useState<Object3D | null>(null)

  useEffect(() => {
    let alive = true
    const file = `buildings/${b.kind}/${b.kind}.glb`
    loadGlb(file)
      .then((gltf) => {
        if (!alive) return
        const cloned = gltf.scene.clone(true) as Object3D
        cloned.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true
            o.receiveShadow = true
            if (o.material) {
              const m = o.material.clone()
              m.flatShading = true
              // Apply house color variations
              if (b.kind === 'house') {
                const [wall, roof] = HOUSE_COLORS[idHash(b.id) % HOUSE_COLORS.length]
                if (m.name === 'wt_wall') m.color.set(wall)
                if (m.name === 'wt_roof') m.color.set(roof)
              }
              o.material = m
            }
          }
        })
        setScene(cloned)
      })
      .catch(() => {
        // Fallback to procedural
        if (alive) setScene(null)
      })
    return () => { alive = false }
  }, [b.id, b.kind])

  if (!scene) return <ProceduralModel b={b} W={W} D={D} />

  // Add dynamic elements (smoke, lights, water animation) on top of static GLB
  return (
    <group>
      <primitive object={scene} />
      {b.kind === 'square' && <Fountain />}
    </group>
  )
}

function Building({ b }: { b: BuildingDef }) {
  const selected = useGame((s) => s.selection?.type === 'building' && s.selection.id === b.id)
  const hovered = useGame((s) => s.hovered === b.id)
  const ring = useRef<Mesh>(null!)
  const body = useRef<Group>(null!)
  const bar = useRef<HTMLDivElement>(null)
  const sideways = Math.abs(Math.sin(b.rot)) > 0.5
  const W = sideways ? b.d : b.w, D = sideways ? b.w : b.d
  const job = town.b[b.id]?.job

  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.02)
    const j = town.b[b.id]?.job
    const f = j ? Math.min(1, j.progress / j.needed) : 1
    // a new building rises out of its foundation as builders work
    if (body.current) body.current.scale.y = j?.type === 'build' ? 0.08 + 0.92 * f : 1
    if (bar.current) bar.current.style.width = `${Math.round(f * 100)}%`
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8 || useGame.getState().placing) return // camera drag, or placing a building
    e.stopPropagation()
    useGame.getState().select({ type: 'building', id: b.id })
  }
  return (
    <group position={[b.x, 0, b.z]}>
      <group rotation={[0, b.rot, 0]}
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); useGame.getState().setHovered(b.id); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { useGame.getState().setHovered(null); document.body.style.cursor = '' }}>
        <group ref={body}><Model b={b} W={W} D={D} /></group>
        {job && <Scaffold W={W} D={D} h={b.kind === 'farm' ? 1.5 : 4.5} />}
      </group>
      {job && (
        <Html position={[0, 6, 0]} center pointerEvents="none" zIndexRange={[6, 0]}>
          <div className="progress"><span>{job.type === 'build' ? '🏗️' : '⬆️'}</span><div><i ref={bar} /></div></div>
        </Html>
      )}
      {(selected || hovered) && (
        <>
          <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
            <ringGeometry args={[Math.hypot(b.w, b.d) / 2 + 0.4, Math.hypot(b.w, b.d) / 2 + 0.9, 48]} />
            <meshBasicMaterial color={selected ? '#ffd36b' : '#fff4d6'} transparent opacity={0.85} />
          </mesh>
          <Html position={[0, b.kind === 'guild' ? 17.5 : 7, 0]} center pointerEvents="none" zIndexRange={[10, 0]}>
            <div className="label">{b.name}</div>
          </Html>
        </>
      )}
    </group>
  )
}

export function Buildings() {
  useGame((s) => s.rev) // re-render when buildings are added, finished or removed
  return <>{BUILDINGS.map((b) => <Building key={b.id} b={b} />)}</>
}
