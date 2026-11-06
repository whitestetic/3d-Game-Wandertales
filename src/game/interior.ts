// Walking inside a building. Each room is built far from the town (at ROOM.cx/cz) so rooms never overlap the
// world or each other; entering moves the player there, leaving puts them back at the door. Browser only.
import { NODES, getBuilding } from './map.ts'
import { cam, player } from './live.ts'
import { useGame } from './store.ts'
import type { Box } from './collision.ts'

/** Shared room shell: centre in world space and half-size. Local coordinates run -hx..hx, -hz..hz; the door is on +z. */
export const ROOM = { cx: 500, cz: 500, hx: 8, hz: 7, ceiling: 4.6 }

const wall = (minX: number, maxX: number, minZ: number, maxZ: number): Box => ({ minX, maxX, minZ, maxZ })
const SHELL = [wall(-9, -8, -8, 8), wall(8, 9, -8, 8), wall(-9, 9, -8, -7), wall(-9, -1.3, 7, 8), wall(1.3, 9, 7, 8)] // outer walls, door gap x -1.3..1.3

/** A room layout: solid furniture (local coords) and usable spots. Keyed by building KIND, not building id —
 * every cottage (h1, h2, h3, ... however many are built) shares the one 'house' layout. */
export type RoomId = 'guild' | 'tavern' | 'bakery' | 'blacksmith' | 'market' | 'house'
export const ROOMS: Record<RoomId, { boxes: Box[]; spots: Record<string, { x: number; z: number; r: number; label: string; action: string }> }> = {
  guild: {
    boxes: [
      ...SHELL,
      wall(-8, -5.3, -7, 3.05), // staircase
      wall(-3.8, 0.8, -7, -5.4), // reception desk
      wall(5.6, 8, 0, 3), // fireplace
      wall(6.9, 8, -5.9, -3.1), // bookshelf (right)
      wall(-8, -6.95, 3.3, 5.3), // bookshelf (left)
      wall(6.6, 7.8, 4.4, 6.8), // crates
      wall(-7.9, -6.5, 5.6, 6.8), // barrel
      wall(6.3, 7.5, -2.5, -1.1), // log crate
      wall(-5.3, -4.5, 3.5, 4.3), wall(3, 3.8, -6.6, -5.8), wall(6.5, 7.4, -6.8, -5.9), // plants
    ],
    spots: { board: { x: -1.5, z: -4.4, r: 2.2, label: 'Open the Quest Board', action: 'guild' }, exit: { x: 0, z: 6.5, r: 1.6, label: 'Leave the Guild Hall', action: 'exit' } },
  },
  tavern: {
    boxes: [
      ...SHELL,
      wall(-8, -6, -7, -4.2), // bar counter
      wall(5.6, 8, -2.5, 0.5), // fireplace
      wall(-3.4, -1.4, -2.4, -0.4), wall(-3.4, -1.4, 1.8, 3.8), // tables (left + right of the aisle)
      wall(1.4, 3.4, -2.4, -0.4), wall(1.4, 3.4, 1.8, 3.8),
      wall(-8, -6.6, 2.8, 5.3), // barrels by the door
      wall(6.9, 8, -5.9, -3.1), // pantry shelf
      wall(-5.3, -4.5, 3.5, 4.3), wall(3, 3.8, -6.6, -5.8), wall(6.5, 7.4, -6.8, -5.9), // plants
    ],
    spots: { bar: { x: -7, z: -5.6, r: 2.4, label: 'Order a round', action: 'tavern' }, exit: { x: 0, z: 6.5, r: 1.6, label: 'Leave the Tavern', action: 'exit' } },
  },
  bakery: {
    boxes: [
      ...SHELL,
      wall(4.8, 8, -7, 1.5), // brick oven
      wall(-8, -3.5, -7, -4.3), // work counter
      wall(-6.5, -1.5, -3, 0), // dough table (centre-left)
      wall(1.5, 8, -3.6, -1.2), wall(1.5, 8, 2.5, 4.9), // bread racks (right wall)
      wall(-8, -6, 2, 5.3), // flour sacks by the door
    ],
    spots: { oven: { x: 6.4, z: -2.8, r: 2.4, label: 'Check the oven', action: 'bakery' }, exit: { x: 0, z: 6.5, r: 1.6, label: 'Leave the Bakery', action: 'exit' } },
  },
  blacksmith: {
    boxes: [
      ...SHELL,
      wall(4.8, 8, -7, -2.5), // forge
      wall(-2, 1.4, -7, -4.5), // anvil + workbench
      wall(1.5, 8, -1.6, 5.3), // weapon racks (right wall)
      wall(-8, -5.2, -5.3, -1), // tool wall (left)
      wall(-8, -6, 2.5, 5.3), // ore crates by the door
    ],
    spots: { forge: { x: 6.4, z: -4.75, r: 2.4, label: 'Stoke the forge', action: 'blacksmith' }, exit: { x: 0, z: 6.5, r: 1.6, label: 'Leave the Smithy', action: 'exit' } },
  },
  market: {
    boxes: [
      ...SHELL,
      wall(-8, -3, -7, -4.3), wall(3, 8, -7, -4.3), // back stalls (left + right of the aisle)
      wall(-5.2, -1.8, -2.2, 0.8), wall(1.8, 5.2, -2.2, 0.8), // centre stalls
      wall(-8, -5.3, 1.8, 5.3), wall(5.3, 8, 1.8, 5.3), // crates by the door
    ],
    spots: { stall: { x: 0, z: -3.3, r: 2.6, label: 'Browse the stalls', action: 'market' }, exit: { x: 0, z: 6.5, r: 1.6, label: 'Leave the Market', action: 'exit' } },
  },
  house: {
    boxes: [
      ...SHELL,
      wall(-8, -5, -7, -3.5), // bed
      wall(-1.5, 1.5, -7, -5.5), // hearth
      wall(-1.3, 1.3, -1.3, 1.3), // table
      wall(5, 8, -7, -4), // wardrobe
    ],
    spots: { bed: { x: -6.5, z: -5.25, r: 2.2, label: 'Tidy the bed', action: 'house' }, exit: { x: 0, z: 6.5, r: 1.6, label: 'Leave the cottage', action: 'exit' } },
  },
}
export type SpotId = `${RoomId}:${string}`
export const isSpot = (id: string): id is SpotId => id.includes(':') && (id.split(':')[0] as RoomId) in ROOMS && (id.split(':')[1] as string) in ROOMS[id.split(':')[0] as RoomId].spots
const spotsOf = (room: RoomId) => Object.fromEntries(Object.entries(ROOMS[room].spots).map(([k, v]) => [`${room}:${k}`, v]))

/** Which room layout a building leads into (its kind), or undefined if it has none (most buildings don't). */
export const roomKindOf = (buildingId: string): RoomId | undefined => {
  const kind = getBuilding(buildingId)?.kind
  return kind && kind in ROOMS ? (kind as RoomId) : undefined
}

export function enterInterior(buildingId: string) {
  if (useGame.getState().interior || !roomKindOf(buildingId)) return
  player.pos.set(ROOM.cx, 0, ROOM.cz + 5.2)
  player.facing = Math.PI // looking at the back wall
  useGame.setState({ interior: buildingId, mode: 'third', selection: null, nearby: null, placing: null, openPanel: null })
  cam.tpYaw = 0; cam.tpPitch = 0.42; cam.tpDist = 6.5 // after the mode flip, which recomputes the yaw from the old camera
}

export function leaveInterior() {
  const buildingId = useGame.getState().interior
  if (!buildingId) return
  const [x, z] = NODES[getBuilding(buildingId)!.door] // the path in front of that building's door
  player.pos.set(x, 0, z)
  player.facing = 0 // walk away from the door
  useGame.setState({ interior: null, nearby: null })
  cam.tpYaw = Math.PI
}

/** Standing next to something you can use? Returns its id. */
export function spotNearPlayer(): SpotId | null {
  const buildingId = useGame.getState().interior
  const room = buildingId && roomKindOf(buildingId)
  if (!room) return null
  const lx = player.pos.x - ROOM.cx, lz = player.pos.z - ROOM.cz
  for (const [id, s] of Object.entries(spotsOf(room))) if (Math.hypot(lx - s.x, lz - s.z) < s.r) return id as SpotId
  return null
}

/** Use the thing you stand next to. */
export function useSpot(id: SpotId) {
  const [room, key] = id.split(':') as [RoomId, string]
  const action = ROOMS[room].spots[key].action
  if (action === 'exit') leaveInterior()
  else if (action === 'guild') useGame.setState({ openPanel: 'guild' })
  // 'tavern'/'bakery'/'blacksmith'/'market'/'house' spots: nothing to open yet, just flavor (shortcut: no panel for them; add one if a feature needs it)
}

// anything that switches to the town view (Build menu, camera button) takes you outside first
useGame.subscribe((s) => { if (s.interior && (s.mode === 'iso' || s.placing)) leaveInterior() })
