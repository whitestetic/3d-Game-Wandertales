// Town layout: buildings, colliders and the walk graph NPCs use.
// World axes: x = east, z = south, y = up. 1 unit ≈ 1 metre.
import type { Box } from './collision.ts'

export type BuildingKind =
  | 'square' | 'guild' | 'tavern' | 'bakery' | 'blacksmith' | 'market'
  | 'farm' | 'house' | 'construction' | 'dock'
  | 'lumber' | 'quarry' | 'mine' | 'workshop' | 'alchemist'

export interface BuildingDef {
  id: string
  kind: BuildingKind
  name: string
  x: number
  z: number
  /** world-axis footprint (x size, z size) */
  w: number
  d: number
  /** facing of the front door, radians around y (0 = +z / south) */
  rot: number
  /** walk-graph node in front of the door */
  door: string
  description: string
  solid?: boolean
}

const S = Math.PI / 2

export const BUILDINGS: BuildingDef[] = [
  { id: 'square', kind: 'square', name: 'Town Square', x: 0, z: 0, w: 4, d: 4, rot: 0, door: 'sN',
    description: 'The heart of WanderTales. Residents gather around the old fountain to chat and celebrate.' },
  { id: 'guild', kind: 'guild', name: 'Guild Headquarters', x: 0, z: -20, w: 12, d: 10, rot: 0, door: 'guild',
    description: 'Seat of the Guild Master. Recruitment board, quest board and the Town Chronicle live here.' },
  { id: 'tavern', kind: 'tavern', name: 'The Sleepy Griffin Tavern', x: 16, z: -4, w: 9, d: 8, rot: -S, door: 'tavern',
    description: 'Warm stew, cold cider and the best gossip in town.' },
  { id: 'bakery', kind: 'bakery', name: 'Hearthstone Bakery', x: -15, z: -4, w: 7, d: 7, rot: S, door: 'bakery',
    description: 'Fresh bread every morning, baked from the farm\'s wheat.' },
  { id: 'blacksmith', kind: 'blacksmith', name: 'Emberforge Smithy', x: -15, z: 12, w: 8, d: 7, rot: S, door: 'smith',
    description: 'Tools and weapons hammered from Iron and Wood.' },
  { id: 'market', kind: 'market', name: 'Market Row', x: 14, z: 12, w: 10, d: 8, rot: Math.PI, door: 'market',
    description: 'Stalls where residents buy and sell goods.' },
  { id: 'farm', kind: 'farm', name: 'Goldenfield Farm', x: 0, z: 30, w: 18, d: 12, rot: Math.PI, door: 'farm',
    description: 'Rows of wheat and vegetables that feed the whole town.' },
  { id: 'h1', kind: 'house', name: 'Willow Cottage', x: -30, z: -14, w: 6, d: 6, rot: S, door: 'h1', description: 'A cosy home in the Residential District.' },
  { id: 'h2', kind: 'house', name: 'Mossy Cottage', x: -30, z: -2, w: 6, d: 6, rot: S, door: 'h2', description: 'A cosy home in the Residential District.' },
  { id: 'h3', kind: 'house', name: 'Bramble Cottage', x: -30, z: 10, w: 6, d: 6, rot: S, door: 'h3', description: 'A cosy home in the Residential District.' },
  { id: 'h4', kind: 'house', name: 'Acorn Cottage', x: -30, z: -26, w: 6, d: 6, rot: S, door: 'h4', description: 'A cosy home in the Residential District.' },
  { id: 'construction', kind: 'construction', name: "Builders' Yard", x: 22, z: 30, w: 8, d: 8, rot: Math.PI, door: 'build',
    description: 'Home base of the town builders. They head out from here to every construction and upgrade.' },
  { id: 'dock', kind: 'dock', name: 'Fishing Dock', x: 39, z: 4, w: 6, d: 4, rot: -S, door: 'dock', solid: false,
    description: 'A little pier on the river. Fishermen work here at dawn.' },
]

export const RIVER_X = 40
export const RIVER_W = 8
export const WORLD_HALF = 58

export function buildingBox(b: BuildingDef, pad = 0): Box {
  return { minX: b.x - b.w / 2 - pad, maxX: b.x + b.w / 2 + pad, minZ: b.z - b.d / 2 - pad, maxZ: b.z + b.d / 2 + pad }
}

export const RIVER_BOXES: Box[] = [
  { minX: 36, maxX: 44, minZ: -70, maxZ: 2 },
  { minX: 36, maxX: 44, minZ: 6, maxZ: 70 },
  { minX: 42, maxX: 44, minZ: 2, maxZ: 6 }, // end of the dock
]
/** Buildings + river. Mutated in place when buildings are added or removed. */
export const SOLIDS: Box[] = []
export function rebuildSolids() {
  SOLIDS.length = 0
  SOLIDS.push(...BUILDINGS.filter((b) => b.solid !== false).map((b) => buildingBox(b)), ...RIVER_BOXES)
}
rebuildSolids()

export const NODES: Record<string, [number, number]> = {
  sN: [0, -7], sNE: [5, -5], sE: [7, 0], sSE: [5, 5], sS: [0, 7], sSW: [-5, 5], sW: [-7, 0], sNW: [-5, -5],
  guild: [0, -13], tavern: [10, -4], bakery: [-10, -4], wJ: [-10, 3], smith: [-9.5, 12], wR: [-25, 3],
  h1: [-25, -14], h2: [-25, -2], h3: [-25, 10], h4: [-25, -26],
  eJ: [10, 3], market: [14, 6], eR: [25, 3], dock: [33, 4], farm: [0, 22], build: [22, 22],
}

export const EDGES: [string, string][] = [
  ['sN', 'sNE'], ['sNE', 'sE'], ['sE', 'sSE'], ['sSE', 'sS'], ['sS', 'sSW'], ['sSW', 'sW'], ['sW', 'sNW'], ['sNW', 'sN'],
  ['sN', 'guild'], ['sE', 'tavern'], ['sW', 'bakery'], ['sW', 'wJ'], ['wJ', 'bakery'], ['wJ', 'smith'],
  ['wJ', 'wR'], ['wR', 'h2'], ['wR', 'h3'], ['h2', 'h1'], ['h1', 'h4'],
  ['sE', 'eJ'], ['sSE', 'eJ'], ['tavern', 'eJ'], ['eJ', 'market'], ['eJ', 'eR'], ['eR', 'dock'], ['eR', 'build'],
  ['sS', 'farm'], ['farm', 'build'],
]

export const NEIGHBORS: Record<string, string[]> = {}
for (const [a, b] of EDGES) {
  ;(NEIGHBORS[a] ??= []).push(b)
  ;(NEIGHBORS[b] ??= []).push(a)
}

/** Initial layout ids, so saves only need to store what the player added. */
export const BASE_BUILDING_IDS = new Set(BUILDINGS.map((b) => b.id))

export function addBuilding(b: BuildingDef, door: [number, number], connectTo: string) {
  BUILDINGS.push(b)
  NODES[b.door] = door
  EDGES.push([b.door, connectTo])
  ;(NEIGHBORS[b.door] ??= []).push(connectTo)
  ;(NEIGHBORS[connectTo] ??= []).push(b.door)
  rebuildSolids()
}

export function removeBuilding(id: string) {
  const i = BUILDINGS.findIndex((b) => b.id === id)
  if (i < 0) return
  const [b] = BUILDINGS.splice(i, 1)
  const node = b.door
  delete NODES[node]
  for (let k = EDGES.length - 1; k >= 0; k--) if (EDGES[k].includes(node)) EDGES.splice(k, 1)
  for (const n of NEIGHBORS[node] ?? []) NEIGHBORS[n] = NEIGHBORS[n].filter((m) => m !== node)
  delete NEIGHBORS[node]
  rebuildSolids()
}

export function nearestNode(x: number, z: number) {
  let best = 'sN', bd = Infinity
  for (const [id, [nx, nz]] of Object.entries(NODES)) {
    const d = (nx - x) ** 2 + (nz - z) ** 2
    if (d < bd) { bd = d; best = id }
  }
  return best
}

/** Shortest hop path (BFS) from a to b, excluding a. */
export function findPath(a: string, b: string): string[] {
  if (a === b) return []
  const prev: Record<string, string> = { [a]: a }
  const queue = [a]
  while (queue.length) {
    const n = queue.shift()!
    for (const m of NEIGHBORS[n] ?? []) {
      if (m in prev) continue
      prev[m] = n
      if (m === b) {
        const path = [b]
        for (let c = n; c !== a; c = prev[c]) path.unshift(c)
        return path
      }
      queue.push(m)
    }
  }
  return []
}

export const getBuilding = (id: string) => BUILDINGS.find((b) => b.id === id)
