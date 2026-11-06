// Deterministic placement of trees, rocks, flowers and lamps.
import { BUILDINGS, EDGES, NODES, RIVER_X, buildingBox } from './map.ts'
import { circleHitsBox, type Box } from './collision.ts'

export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

export function distToSegment(px: number, pz: number, a: [number, number], b: [number, number]) {
  const vx = b[0] - a[0], vz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz)))
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t))
}

export const nearPath = (x: number, z: number, m: number) =>
  EDGES.some(([a, b]) => distToSegment(x, z, NODES[a], NODES[b]) < m)

const padded = BUILDINGS.map((b) => buildingBox(b, 2.5))
const blocked = (x: number, z: number, m: number) =>
  padded.some((b) => circleHitsBox(x, z, m, b)) || Math.abs(x - RIVER_X) < 6.5 || Math.hypot(x, z) < 11 || nearPath(x, z, 2.6)

export interface Tree { x: number; z: number; s: number; kind: 0 | 1 }
export const TREES: Tree[] = []
{
  const r = rng(7)
  for (let i = 0; i < 1400 && TREES.length < 260; i++) {
    const x = (r() - 0.5) * 112, z = (r() - 0.5) * 112
    const edge = Math.max(Math.abs(x), Math.abs(z))
    // forest gets dense toward the map edge, sparse inside town
    if (r() > (edge > 38 ? 0.9 : 0.12)) continue
    if (blocked(x, z, 1.2)) continue
    if (TREES.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue
    TREES.push({ x, z, s: 0.8 + r() * 0.6, kind: r() < 0.55 ? 0 : 1 })
  }
}
export const TREE_BOXES: Box[] = TREES.map((t) => ({ minX: t.x - 0.4, maxX: t.x + 0.4, minZ: t.z - 0.4, maxZ: t.z + 0.4 }))

export const ROCKS: { x: number; z: number; s: number; ry: number }[] = []
export const FLOWERS: { x: number; z: number; c: number }[] = []
{
  const r = rng(42)
  while (ROCKS.length < 40) {
    const x = (r() - 0.5) * 110, z = (r() - 0.5) * 110
    if (!blocked(x, z, 1)) ROCKS.push({ x, z, s: 0.3 + r() * 0.6, ry: r() * 6 })
  }
  for (let i = 0; i < 4000 && FLOWERS.length < 420; i++) {
    const x = (r() - 0.5) * 80, z = (r() - 0.5) * 80
    // flowers hug the paths and the residential district
    const close = nearPath(x, z, 4.2) || (x < -22 && x > -38 && z > -32 && z < 16)
    if (close && !nearPath(x, z, 1.5) && !padded.some((b) => circleHitsBox(x, z, 0.2, b)) && Math.abs(x - RIVER_X) > 5 && Math.hypot(x, z) > 10)
      FLOWERS.push({ x, z, c: Math.floor(r() * 5) })
  }
}

/** Lamp posts every ~9 units along each path, offset to the side. */
export const LAMPS: [number, number][] = []
for (const [a, b] of EDGES) {
  const [ax, az] = NODES[a], [bx, bz] = NODES[b]
  const len = Math.hypot(bx - ax, bz - az)
  if (a.startsWith('s') && b.startsWith('s')) continue // square has its own lamps
  for (let t = 4.5; t < len - 2; t += 9) {
    const x = ax + ((bx - ax) * t) / len + ((bz - az) / len) * 1.7
    const z = az + ((bz - az) * t) / len - ((bx - ax) / len) * 1.7
    if (!padded.some((p) => circleHitsBox(x, z, 0.3, p))) LAMPS.push([x, z])
  }
}
for (let i = 0; i < 4; i++) LAMPS.push([Math.cos(i * Math.PI / 2 + Math.PI / 4) * 9.5, Math.sin(i * Math.PI / 2 + Math.PI / 4) * 9.5])
export const LAMP_BOXES: Box[] = LAMPS.map(([x, z]) => ({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 }))
