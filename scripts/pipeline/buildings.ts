// Building GLB asset pipeline: generate low-poly GLB models for all 15 building types.
// Mirrors the character pipeline: builds geometry, writes GLB with materials, exports manifest.
// Run: node scripts/pipeline/buildings.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const ROOT = process.cwd()
const OUT = join(ROOT, 'public/buildings')
const REL = (p: string) => relative(ROOT, p).replace(/\\/g, '/')

type V3 = [number, number, number]
type M4 = number[]

const hex = (h: string): [number, number, number, number] => {
  const n = parseInt(h.slice(1), 16)
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1]
}

function vertexNormals(pos: V3[], idx: number[]): V3[] {
  const n: V3[] = pos.map(() => [0, 0, 0])
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]]
    const f = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]))
    for (const v of [a, b, c]) n[v] = add(n[v], f)
  }
  return n.map((v) => (len(v) ? norm(v) : [0, 1, 0]))
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

function merge(...gs: Geo[]): Geo {
  const pos: V3[] = [], idx: number[] = []
  for (const g of gs) { const o = pos.length; pos.push(...g.pos); idx.push(...g.idx.map((i) => i + o)) }
  return { pos, idx }
}
function xform(g: Geo, f: (p: V3) => V3): Geo { return { pos: g.pos.map(f), idx: g.idx } }
const rotY = (deg: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => { const a = (deg * Math.PI) / 180, x = p[0] - c[0], z = p[2] - c[2]; return [c[0] + x * Math.cos(a) + z * Math.sin(a), p[1], c[2] - x * Math.sin(a) + z * Math.cos(a)] }
const rotX = (deg: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => { const a = (deg * Math.PI) / 180, y = p[1] - c[1], z = p[2] - c[2]; return [p[0], c[1] + y * Math.cos(a) - z * Math.sin(a), c[2] + y * Math.sin(a) + z * Math.cos(a)] }
const rotZ = (deg: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => { const a = (deg * Math.PI) / 180, x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), p[2]] }
const move = (d: V3) => (p: V3): V3 => add(p, d)

function cylinder(c: V3, r0: number, r1: number, h: number, seg = 8, caps = true, sx = 1, sz = 1): Geo {
  const pos: V3[] = [], idx: number[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    pos.push([c[0] + Math.cos(a) * r0 * sx, c[1], c[2] + Math.sin(a) * r0 * sz], [c[0] + Math.cos(a) * r1 * sx, c[1] + h, c[2] + Math.sin(a) * r1 * sz])
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = ((i + 1) % seg) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1) }
  if (caps) {
    const bc = pos.length; pos.push([c[0], c[1], c[2]]); const tc = pos.length; pos.push([c[0], c[1] + h, c[2]])
    for (let i = 0; i < seg; i++) { const a = i * 2, b = ((i + 1) % seg) * 2; idx.push(bc, b, a, tc, a + 1, b + 1) }
  }
  return { pos, idx }
}
function box(c: V3, s: V3): Geo {
  const [x, y, z] = [s[0] / 2, s[1] / 2, s[2] / 2]
  const pos: V3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].map((p) => add(c, p as V3))
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
  return { pos, idx }
}
function prism(c: V3, w: number, h: number, d: number): Geo {
  return box([c[0], c[1] + h / 2, c[2]], [w, h, d])
}
function cone4(c: V3, r: number, h: number, seg = 4): Geo {
  return cylinder(c, r, 0, h, seg, true)
}

interface Geo { pos: V3[]; idx: number[] }
interface BuildingPart { name: string; geo: Geo; color: string; channel: string }

interface BuildingDef {
  id: string
  name: string
  kind: string
  w: number
  d: number
  parts: BuildingPart[]
}

function mat(doc: Document, name: string, color: string) {
  const m = doc.createMaterial(`wt_${name}`)
  const [r, g, b, a] = hex(color)
  m.setBaseColorFactor([r, g, b, a]).setRoughnessFactor(0.3).setDoubleSided(true)
  return m
}

async function writeBuildingGlb(def: BuildingDef, file: string) {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const buffer = doc.createBuffer('Buffer')
  const mats = new Map<string, ReturnType<Document['createMaterial']>>()

  for (const part of def.parts) {
    if (!part.geo.pos.length) continue
    if (!mats.has(part.channel)) mats.set(part.channel, mat(doc, part.channel, part.color))
    const mesh = doc.createMesh(part.name)
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.geo.pos.flat())).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(vertexNormals(part.geo.pos, part.geo.idx).flat())).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(part.geo.pos.length > 65535 ? new Uint32Array(part.geo.idx) : new Uint16Array(part.geo.idx)).setBuffer(buffer))
      .setMaterial(mats.get(part.channel)!)
      .setName(part.name)
    mesh.addPrimitive(prim)
    const node = doc.createNode(part.name).setMesh(mesh)
    scene.addChild(node)
  }

  doc.getRoot().getAsset().generator = 'WanderTales building pipeline (Node, glTF-Transform)'
  await doc.transform(prune({ keepLeaves: true }))
  mkdirSync(join(ROOT, 'public/buildings', def.id), { recursive: true })
  writeFileSync(file, Buffer.from(await io.writeBinary(doc)))
}

const STRIPES = [['#c94f4f', '#f3e6d0'], ['#3f78a8', '#f3e6d0'], ['#4f9a5a', '#f3e6d0']]
const GOODS = ['#d4463b', '#e8b33a', '#7cb850', '#c98b4a', '#a874c9']
const HOUSE_COLORS = [['#efe2c4', '#b5523b'], ['#dfe7d4', '#4f7a8c'], ['#f2dcc8', '#8a5a9a'], ['#e9dcb4', '#5d7a3a']]
const idHash = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0)

function generateBuildings(): BuildingDef[] {
  const out: BuildingDef[] = []

  // Guild - full (flag, flagpole, door knob)
  out.push({ id: 'guild', name: 'Guild Headquarters', kind: 'guild', w: 12, d: 10, parts: [
    { name: 'foundation', geo: box([0, 0.25, 0], [12.4, 0.5, 10.4]), color: '#8f8a82', channel: 'stone' },
    { name: 'walls', geo: box([0, 3.2, 0], [12, 5.4, 10]), color: '#d9cfbd', channel: 'wall' },
    { name: 'trim_band', geo: box([0, 3, 5.02], [12, 0.25, 0.1]), color: '#5c4430', channel: 'trim' },
    { name: 'roof', geo: prism([0, 5.9, 0], 12.8, 3.4, 11), color: '#3f5f8f', channel: 'roof' },
    { name: 'tower_base', geo: box([0, 5.5, -2], [3.4, 11, 3.4]), color: '#cfc4b0', channel: 'wall' },
    { name: 'tower_roof', geo: cone4([0, 13, -2], 3.1, 3.2), color: '#35527d', channel: 'roof' },
    { name: 'tower_window', geo: box([0, 8.5, -0.28], [1, 1.3, 0.1]), color: '#5c4430', channel: 'trim' },
    { name: 'flagpole', geo: cylinder([0, 15.4, -2], 0.06, 0.06, 1.6), color: '#5c4430', channel: 'trim' },
    { name: 'flag', geo: box([0.45, 15.8, -2], [0.9, 0.55, 0.04]), color: '#c23b3b', channel: 'accent' },
    { name: 'porch_base', geo: box([0, 0.65, 5.6], [4, 0.3, 1.4]), color: '#a29a8e', channel: 'wood' },
    { name: 'porch_top', geo: box([0, 0.85, 6.3], [4.6, 0.2, 0.6]), color: '#a29a8e', channel: 'wood' },
    { name: 'door', geo: box([0, 0.5, 5.03], [2, 2.6, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 5.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
    { name: 'column_left', geo: box([-1.6, 2.2, 5.6], [0.4, 3.4, 0.4]), color: '#efe7d8', channel: 'stone' },
    { name: 'column_right', geo: box([1.6, 2.2, 5.6], [0.4, 3.4, 0.4]), color: '#efe7d8', channel: 'stone' },
    { name: 'sign_base', geo: box([0, 4, 5.7], [4, 0.35, 1.4]), color: '#3f5f8f', channel: 'wood' },
    { name: 'sign_board', geo: box([0, 4.8, 5.1], [3.6, 0.8, 0.12]), color: '#6b4a2e', channel: 'wood' },
    { name: 'sign_accent', geo: box([0, 4.8, 5.17], [0.6, 0.45, 0.04]), color: '#e7c35b', channel: 'accent' },
    { name: 'banner_left', geo: merge(box([-4.2, 4.2, 5.08], [1.1, 2.6, 0.05]), box([-4.2, 4.2, 5.11], [0.5, 0.5, 0.03])), color: '#b8392f', channel: 'accent' },
    { name: 'banner_right', geo: merge(box([4.2, 4.2, 5.08], [1.1, 2.6, 0.05]), box([4.2, 4.2, 5.11], [0.5, 0.5, 0.03])), color: '#b8392f', channel: 'accent' },
    { name: 'window_left', geo: box([-3.5, 2.1, 5.04], [1.1, 1.3, 0.1]), color: '#5c4430', channel: 'trim' },
    { name: 'window_right', geo: box([3.5, 2.1, 5.04], [1.1, 1.3, 0.1]), color: '#5c4430', channel: 'trim' },
  ]})

  // Tavern - full (smoke, sign, barrels, bench, door knob)
  out.push({ id: 'tavern', name: 'The Sleepy Griffin Tavern', kind: 'tavern', w: 9, d: 8, parts: [
    { name: 'foundation', geo: box([0, 0.2, 0], [9.3, 0.4, 8.3]), color: '#9a948a', channel: 'stone' },
    { name: 'walls', geo: box([0, 0.4 + 4.2 / 2, 0], [9, 4.2, 8]), color: '#e6c99a', channel: 'wall' },
    { name: 'corners', geo: merge(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
      box([sx * 9 / 2, 0.4 + 4.2 / 2, sz * 8 / 2], [0.25, 4.2, 0.25]))), color: '#4e3523', channel: 'trim' },
    { name: 'roof_trim', geo: box([0, 0.4 + 4.2, 8 / 2], [9, 0.22, 0.2]), color: '#4e3523', channel: 'trim' },
    { name: 'roof', geo: prism([0, 0.4 + 4.2, 0], 9.7, 4.2 * 0.45, 8.9), color: '#7c4a33', channel: 'roof' },
    { name: 'chimney', geo: box([9 * 0.28, 0.4 + 4.2 + 4.2 * 0.45 * 0.7, -8 * 0.15], [0.7, 4.2 * 0.45 * 1.1, 0.7]), color: '#8b7f74', channel: 'trim' },
    { name: 'smoke', geo: cylinder([9 * 0.28, 7.5, -8 * 0.15], 0.3, 0.1, 1), color: '#e8e4dc', channel: 'fx' },
    { name: 'door', geo: box([0, 0.4, 8 / 2 + 0.02], [1.1, 1.8, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 8 / 2 + 0.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
    { name: 'window_left', geo: box([-9 * 0.3, 0.4 + 4.2 * 0.55, 8 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'window_right', geo: box([9 * 0.3, 0.4 + 4.2 * 0.55, 8 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'sign_post', geo: box([9 / 2 - 0.6, 3.6, 8 / 2 + 0.9], [0.12, 0.12, 1.8]), color: '#4e3523', channel: 'wood' },
    { name: 'sign_board', geo: box([9 / 2 - 0.6, 3.05, 8 / 2 + 1.5], [1.1, 0.8, 0.08]), color: '#b5823f', channel: 'wood' },
    { name: 'barrel1', geo: merge(cylinder([-9 / 2 + 0.4, 0.45, 8 / 2 + 0.8], 0.38, 0.38, 0.9), cylinder([-9 / 2 + 0.4, 0.75, 8 / 2 + 0.8], 0.4, 0.4, 0.06), cylinder([-9 / 2 + 0.4, 0.15, 8 / 2 + 0.8], 0.4, 0.4, 0.06)), color: '#8a5a33', channel: 'wood' },
    { name: 'barrel2', geo: merge(cylinder([-9 / 2 + 1.3, 0.45, 8 / 2 + 0.6], 0.38, 0.38, 0.9), cylinder([-9 / 2 + 1.3, 0.75, 8 / 2 + 0.6], 0.4, 0.4, 0.06), cylinder([-9 / 2 + 1.3, 0.15, 8 / 2 + 0.6], 0.4, 0.4, 0.06)), color: '#8a5a33', channel: 'wood' },
    { name: 'bench_top', geo: box([2.3, 0.45, 8 / 2 + 1.6], [1.6, 0.1, 0.8]), color: '#8a5a33', channel: 'wood' },
    { name: 'bench_leg', geo: box([2.3, 0.22, 8 / 2 + 1.6], [0.15, 0.45, 0.15]), color: '#6b4a2e', channel: 'wood' },
  ]})

  // Bakery - full (smoke, oven breads, door knob)
  out.push({ id: 'bakery', name: 'Hearthstone Bakery', kind: 'bakery', w: 7, d: 7, parts: [
    { name: 'foundation', geo: box([0, 0.2, 0], [7.3, 0.4, 7.3]), color: '#9a948a', channel: 'stone' },
    { name: 'walls', geo: box([0, 0.4 + 3.2 / 2, 0], [7, 3.2, 7]), color: '#f4e6cf', channel: 'wall' },
    { name: 'corners', geo: merge(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
      box([sx * 7 / 2, 0.4 + 3.2 / 2, sz * 7 / 2], [0.25, 3.2, 0.25]))), color: '#4e3523', channel: 'trim' },
    { name: 'roof_trim', geo: box([0, 0.4 + 3.2, 7 / 2], [7, 0.22, 0.2]), color: '#4e3523', channel: 'trim' },
    { name: 'roof', geo: prism([0, 0.4 + 3.2, 0], 7.7, 3.2 * 0.45, 7.9), color: '#d0753f', channel: 'roof' },
    { name: 'chimney', geo: box([7 * 0.28, 0.4 + 3.2 + 3.2 * 0.45 * 0.7, -7 * 0.15], [0.7, 3.2 * 0.45 * 1.1, 0.7]), color: '#8b7f74', channel: 'trim' },
    { name: 'smoke', geo: cylinder([7 * 0.28, 6.3, -7 * 0.15], 0.3, 0.1, 1), color: '#e8e4dc', channel: 'fx' },
    { name: 'door', geo: box([0, 0.4, 7 / 2 + 0.02], [1.1, 1.8, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 7 / 2 + 0.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
    { name: 'window_left', geo: box([-7 * 0.3, 0.4 + 3.2 * 0.55, 7 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'window_right', geo: box([7 * 0.3, 0.4 + 3.2 * 0.55, 7 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'oven_front', geo: box([0, 2.7, 7 / 2 + 0.6], [7 * 0.8, 0.12, 1.2]), color: '#e8b4a0', channel: 'accent' },
    { name: 'oven_door', geo: box([-7 * 0.3, 0.55, 7 / 2 + 0.55], [1.2, 0.3, 0.7]), color: '#8a5a33', channel: 'wood' },
    { name: 'bread1', geo: cylinder([-7 * 0.3 - 0.3, 0.78, 7 / 2 + 0.55], 0.18, 0.18, 0.1), color: '#c98b4a', channel: 'food' },
    { name: 'bread2', geo: cylinder([-7 * 0.3, 0.78, 7 / 2 + 0.55], 0.18, 0.18, 0.1), color: '#c98b4a', channel: 'food' },
    { name: 'bread3', geo: cylinder([-7 * 0.3 + 0.3, 0.78, 7 / 2 + 0.55], 0.18, 0.18, 0.1), color: '#c98b4a', channel: 'food' },
  ]})

  // Blacksmith - full
  out.push({ id: 'blacksmith', name: 'Emberforge Smithy', kind: 'blacksmith', w: 8, d: 7, parts: [
    { name: 'floor', geo: box([0, 0.15, 0], [8, 0.3, 7]), color: '#7f7a72', channel: 'stone' },
    { name: 'back_wall', geo: box([0, 2, -7 / 2 + 0.3], [8, 4, 0.6]), color: '#7d756b', channel: 'wall' },
    { name: 'left_wall', geo: box([-8 / 2 + 0.3, 2, 0], [0.6, 4, 7]), color: '#7d756b', channel: 'wall' },
    { name: 'corner1', geo: box([8 / 2 - 0.3, 7 / 2 - 0.3, 0], [0.35, 4, 0.35]), color: '#4e3523', channel: 'trim' },
    { name: 'corner2', geo: box([-8 / 2 + 0.3, 7 / 2 - 0.3, 0], [0.35, 4, 0.35]), color: '#4e3523', channel: 'trim' },
    { name: 'corner3', geo: box([8 / 2 - 0.3, -7 / 2 + 0.3, 0], [0.35, 4, 0.35]), color: '#4e3523', channel: 'trim' },
    { name: 'roof', geo: prism([0, 4, 0], 8.6, 2.2, 7.8), color: '#5d4b3e', channel: 'roof' },
    { name: 'forge_base', geo: box([-1.6, 0.8, -7 / 2 + 1.4], [2, 1.3, 1.6]), color: '#6d655c', channel: 'stone' },
    { name: 'forge_glow', geo: box([-1.6, 1.5, -7 / 2 + 1.4], [1.4, 0.15, 1.1]), color: '#ff7a30', channel: 'fx' },
    { name: 'forge_chimney', geo: box([-1.6, 4.5, -7 / 2 + 1.4], [0.9, 3.5, 0.9]), color: '#6d655c', channel: 'trim' },
    { name: 'forge_smoke', geo: cylinder([-1.6, 6.5, -7 / 2 + 1.4], 0.3, 0.1, 1), color: '#e8e4dc', channel: 'fx' },
    { name: 'forge_light', geo: box([-1.6, 2.2, -7 / 2 + 1.8], [0.1, 0.1, 0.1]), color: '#ff7a30', channel: 'fx' },
    { name: 'anvil_base', geo: box([1.2, 0.5, 0.4], [0.5, 0.7, 0.5]), color: '#4a3a2e', channel: 'metal' },
    { name: 'anvil_top', geo: box([1.2, 0.95, 0.4], [1, 0.25, 0.45]), color: '#3a3d44', channel: 'metal' },
    { name: 'workbench', geo: box([8 / 2 - 1, 0.9, -7 / 2 + 1], [1.4, 0.1, 0.6]), color: '#8a5a33', channel: 'wood' },
    { name: 'tools1', geo: box([8 / 2 - 1.5, 1.6, -7 / 2 + 0.7], [0.08, 1, 0.08]), color: '#9aa0a8', channel: 'metal' },
    { name: 'tools2', geo: box([8 / 2 - 1.1, 1.6, -7 / 2 + 0.7], [0.08, 1, 0.08]), color: '#9aa0a8', channel: 'metal' },
    { name: 'tools3', geo: box([8 / 2 - 0.7, 1.6, -7 / 2 + 0.7], [0.08, 1, 0.08]), color: '#9aa0a8', channel: 'metal' },
    { name: 'door', geo: box([0, 0.5, 7 / 2 + 0.02], [1.1, 1.8, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 7 / 2 + 0.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
  ]})

  // Market
  out.push({ id: 'market', name: 'Market Row', kind: 'market', w: 10, d: 8, parts: [] })
  // Farm
  out.push({ id: 'farm', name: 'Goldenfield Farm', kind: 'farm', w: 18, d: 12, parts: [] })
  // Construction
  out.push({ id: 'construction', name: "Builders' Yard", kind: 'construction', w: 8, d: 8, parts: [] })
  // Dock
  out.push({ id: 'dock', name: 'Fishing Dock', kind: 'dock', w: 6, d: 4, parts: [] })
  // Square (Fountain)
  out.push({ id: 'square', name: 'Town Square', kind: 'square', w: 4, d: 4, parts: [] })
  // Lumber
  out.push({ id: 'lumber', name: 'Lumber Camp', kind: 'lumber', w: 8, d: 8, parts: [] })
  // Quarry
  out.push({ id: 'quarry', name: 'Stone Quarry', kind: 'quarry', w: 8, d: 8, parts: [] })
  // Mine
  out.push({ id: 'mine', name: 'Iron Mine', kind: 'mine', w: 8, d: 8, parts: [] })
  // Workshop
  out.push({ id: 'workshop', name: 'Workshop', kind: 'workshop', w: 8, d: 8, parts: [] })
  // Alchemist
  out.push({ id: 'alchemist', name: 'Alchemist', kind: 'alchemist', w: 8, d: 8, parts: [] })
  // House (generic - will use color variants)
  out.push({ id: 'house', name: 'Cottage', kind: 'house', w: 6, d: 6, parts: [] })

  // Add remaining building parts
  // Market
  const m = out.find(b => b.id === 'market')!
  m.parts.push(
    ...[-1, 0, 1].flatMap((i, si) => [
      { name: `stall${si}_post1`, geo: box([i * (10 / 3) - 1.2, 1.25, -1.2], [0.15, 2.5, 0.15]), color: '#6b4a2e', channel: 'wood' },
      { name: `stall${si}_post2`, geo: box([i * (10 / 3) + 1.2, 1.25, -1.2], [0.15, 2.5, 0.15]), color: '#6b4a2e', channel: 'wood' },
      { name: `stall${si}_post3`, geo: box([i * (10 / 3) - 1.2, 1.25, 1.2], [0.15, 2.5, 0.15]), color: '#6b4a2e', channel: 'wood' },
      { name: `stall${si}_post4`, geo: box([i * (10 / 3) + 1.2, 1.25, 1.2], [0.15, 2.5, 0.15]), color: '#6b4a2e', channel: 'wood' },
      ...[0, 1, 2, 3, 4].map((s) => ({
        name: `stall${si}_awning${s}`, geo: box([-1.2 + 0.6 * s + i * (10 / 3), 2.6, 0.2], [0.6, 0.08, 3.2]),
        color: STRIPES[i + 1][s % 2], channel: 'cloth'
      })),
      { name: `stall${si}_counter_top`, geo: box([i * (10 / 3), 0.85, 1.1], [2.4, 0.2, 0.8]), color: '#a2733f', channel: 'wood' },
      { name: `stall${si}_counter_base`, geo: box([i * (10 / 3), 0.4, 1.1], [2.2, 0.7, 0.7]), color: '#8a5a33', channel: 'wood' },
      ...[-0.8, -0.3, 0.2, 0.7].map((x, k) => ({
        name: `stall${si}_goods${k}`, geo: cylinder([x + i * (10 / 3), 1.05, 1.1], 0.17, 0.17, 0.1),
        color: GOODS[(k + si + 1) % 5], channel: 'food'
      })),
      { name: `stall${si}_crate`, geo: box([i * (10 / 3) + 0.6, 0.3, -0.8], [0.6, 0.6, 0.6]), color: '#b08850', channel: 'wood' },
    ])
  )

  // Farm
  const f = out.find(b => b.id === 'farm')!
  f.parts.push(
    ...Array.from({ length: 8 }, (_, i) => {
      const x = -18 / 2 + 1.5 + i * 1.3
      const wheat = i < 5
      return [
        { name: `row${i}_soil`, geo: box([x, 0.12, 0.8], [0.9, 0.24, 12 - 4]), color: '#7a5434', channel: 'ground' },
        ...Array.from({ length: 9 }, (_, k) => ({
          name: `row${i}_crop${k}`, geo: wheat
            ? cone4([x, wheat ? 0.6 : 0.4, -12 / 2 + 2.6 + k * 0.85], 0.2, 0.75)
            : cylinder([x, wheat ? 0.6 : 0.4, -12 / 2 + 2.6 + k * 0.85], 0.28, 0.28, 0.1),
          color: wheat ? '#e3c25a' : '#5ea34a', channel: 'food'
        }))
      ]
    }).flat(),
    { name: 'barn_base', geo: box([18 / 2 - 3, 1.8, -1], [4.4, 3.6, 5]), color: '#b8432f', channel: 'wall' },
    { name: 'barn_roof', geo: prism([18 / 2 - 3, 3.6, -1], 5.6, 2, 4.9), color: '#5d4b3e', channel: 'roof' },
    { name: 'barn_door_frame', geo: box([18 / 2 - 3, 1.3, 2.52], [2, 2.6, 0.06]), color: '#f1e7d4', channel: 'wood' },
    { name: 'barn_door', geo: box([18 / 2 - 3, 1.3, 2.56], [1.7, 2.3, 0.06]), color: '#9c3627', channel: 'wood' },
    { name: 'barn_x1', geo: box([18 / 2 - 3, 1.3, 2.6], [2.4, 0.12, 0.04]), color: '#f1e7d4', channel: 'wood' },
    { name: 'barn_x2', geo: box([18 / 2 - 3, 1.3, 2.6], [2.4, 0.12, 0.04]), color: '#f1e7d4', channel: 'wood' },
    { name: 'hay', geo: cylinder([18 / 2 - 1.5, 0.6, 12 / 2 - 1.5], 0.6, 0.6, 1.2), color: '#e0c066', channel: 'food' },
    { name: 'scarecrow_post', geo: box([-18 / 2 + 6, 1, 0.6], [0.1, 2, 0.1]), color: '#6b4a2e', channel: 'wood' },
    { name: 'scarecrow_arm', geo: box([-18 / 2 + 6, 1.5, 0.6], [1.4, 0.1, 0.1]), color: '#6b4a2e', channel: 'wood' },
    { name: 'scarecrow_head', geo: cylinder([-18 / 2 + 6, 2.1, 0.6], 0.25, 0.25, 0.1), color: '#e0c066', channel: 'food' },
    { name: 'scarecrow_hat', geo: cone4([-18 / 2 + 6, 2.4, 0.6], 0.35, 0.3), color: '#6b5a3a', channel: 'cloth' }
  )
  // Farm fence
  const fencePosts: V3[] = []
  const fenceRails: { p: V3; s: V3 }[] = []
  const side = (ax: number, az: number, bx: number, bz: number, gap = false) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2)
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t
      if (gap && Math.abs(x) < 1.6) continue
      fencePosts.push([x, 0.5, z])
      if (i < n && !(gap && Math.abs(x + (bx - ax) / n / 2) < 1.6)) {
        const mx = x + (bx - ax) / n / 2, mz = z + (bz - az) / n / 2
        fenceRails.push({ p: [mx, 0.65, mz], s: [Math.abs(bx - ax) / n + 0.1, 0.1, Math.abs(bz - az) / n + 0.1] })
      }
    }
  }
  side(-18 / 2, 12 / 2, 18 / 2, 12 / 2, true)
  side(-18 / 2, -12 / 2, 18 / 2, -12 / 2)
  side(-18 / 2, -12 / 2, -18 / 2, 12 / 2)
  side(18 / 2, -12 / 2, 18 / 2, 12 / 2)
  f.parts.push(
    ...fencePosts.map((p, i) => ({ name: `fence_post${i}`, geo: box(p, [0.16, 1, 0.16]), color: '#8a6240', channel: 'wood' })),
    ...fenceRails.map((r, i) => ({ name: `fence_rail${i}`, geo: box(r.p, r.s), color: '#a27a50', channel: 'wood' }))
  )

  // Construction
  const c = out.find(b => b.id === 'construction')!
  c.parts.push(
    { name: 'foundation', geo: box([0, 0.15, 0], [8 - 1, 0.3, 8 - 1]), color: '#a39b8f', channel: 'ground' },
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]].map(([sx, sz], i) => ({
      name: `post${i}`, geo: box([sx * (8 / 2 - 0.8), 2, sz * (8 / 2 - 0.8)], [0.18, 4, 0.18]), color: '#b08850', channel: 'wood'
    })),
    ...[1.6, 3.4].flatMap((y, yi) => [
      { name: `beam${yi}_front`, geo: box([0, y, 8 / 2 - 0.8], [8 - 1.4, 0.12, 0.12]), color: '#b08850', channel: 'wood' },
      { name: `beam${yi}_back`, geo: box([0, y, -8 / 2 + 0.8], [8 - 1.4, 0.12, 0.12]), color: '#b08850', channel: 'wood' },
      { name: `beam${yi}_right`, geo: box([8 / 2 - 0.8, y, 0], [0.12, 0.12, 8 - 1.4]), color: '#b08850', channel: 'wood' },
      { name: `beam${yi}_left`, geo: box([-8 / 2 + 0.8, y, 0], [0.12, 0.12, 8 - 1.4]), color: '#b08850', channel: 'wood' }
    ]),
    { name: 'floor_planks', geo: box([0, 1.6, 8 / 2 - 0.8], [8 - 1.4, 0.1, 0.9]), color: '#c9a36a', channel: 'wood' },
    ...[0, 1, 2, 3].map((i) => ({
      name: `stack${i}`, geo: box([-8 / 2 + 2, 0.45 + i * 0.18, -1 + (i % 2) * 0.05], [2.6, 0.16, 0.5]),
      color: i % 2 ? '#c49a62' : '#b08850', channel: 'wood'
    })),
    ...[0, 1, 2].map((i) => ({
      name: `stone${i}`, geo: cylinder([1.5 + i * 0.6, 0.5, -1.5], 0.32, 0.32, 0.1), color: '#9a958c', channel: 'stone'
    })),
    { name: 'sign_post', geo: box([2.6, 0.7, 8 / 2 + 0.3], [0.12, 1.4, 0.12]), color: '#6b4a2e', channel: 'wood' },
    { name: 'sign_board', geo: box([2.6, 1.4, 8 / 2 + 0.35], [1.4, 0.7, 0.06]), color: '#e3c25a', channel: 'wood' }
  )

  // Dock
  const d = out.find(b => b.id === 'dock')!
  d.parts.push(
    ...Array.from({ length: Math.round(4 / 0.5) }, (_, i) => ({
      name: `plank${i}`, geo: box([0, 0.28, -4 / 2 + 0.25 + i * 0.5], [6, 0.12, 0.44]),
      color: i % 3 ? '#9a6f45' : '#8a6240', channel: 'wood'
    })),
    ...[[-1, -1], [1, -1], [-1, 0], [1, 0]].map(([sx, sz], i) => ({
      name: `piling${i}`, geo: cylinder([sx * (6 / 2 - 0.1), 0.1, sz * (4 / 2 - 0.3)], 0.14, 0.14, 1.2),
      color: '#6b4a2e', channel: 'wood'
    })),
    { name: 'buoy_base', geo: cylinder([6 / 2 + 1, 0.05, -4 / 2 + 1], 0.75, 0.75, 0.35), color: '#8a5a33', channel: 'wood' },
    { name: 'buoy_top', geo: box([6 / 2 + 1, 0.25, -4 / 2 + 1], [1.2, 0.08, 0.3]), color: '#6b4a2e', channel: 'wood' },
    { name: 'barrel', geo: merge(
      cylinder([-6 / 2 + 0.5, 0.3, 4 / 2 - 0.6], 0.38, 0.38, 0.9),
      cylinder([-6 / 2 + 0.5, 0.75, 4 / 2 - 0.6], 0.4, 0.4, 0.06),
      cylinder([-6 / 2 + 0.5, 0.15, 4 / 2 - 0.6], 0.4, 0.4, 0.06)
    ), color: '#8a5a33', channel: 'wood' }
  )

  // Square (Fountain)
  const sq = out.find(b => b.id === 'square')!
  sq.parts.push(
    { name: 'basin', geo: cylinder([0, 0.4, 0], 2, 2, 0.8), color: '#b9b2a6', channel: 'stone' },
    { name: 'water', geo: cylinder([0, 0.72, 0], 1.75, 1.75, 0.1), color: '#5fb3d6', channel: 'fx' },
    { name: 'column', geo: cylinder([0, 1.4, 0], 0.3, 0.3, 1.6), color: '#c8c1b5', channel: 'stone' },
    { name: 'tier', geo: cylinder([0, 2.2, 0], 0.9, 0.9, 0.18), color: '#c8c1b5', channel: 'stone' },
    { name: 'spout', geo: cylinder([0, 2.5, 0], 0.35, 0.35, 0.1), color: '#5fb3d6', channel: 'fx' }
  )

  // Lumber Camp
  const l = out.find(b => b.id === 'lumber')!
  l.parts.push(
    { name: 'office', geo: box([-8 * 0.18, 0, -8 * 0.1], [8 * 0.55, 2.2, 8 * 0.6]), color: '#b08850', channel: 'wall' },
    { name: 'office_roof', geo: prism([-8 * 0.18, 2.2, -8 * 0.1], 8 * 0.55 + 0.7, 2.2 * 0.45, 8 * 0.6 + 0.9), color: '#5d7a3a', channel: 'roof' },
    ...[0, 1, 2].map((i) => ({
      name: `log${i}`, geo: cylinder([8 * 0.3, 0.3 + (i === 2 ? 0.5 : 0), -0.6 + (i % 2) * 0.62 + (i === 2 ? 0.3 : 0)], 0.3, 0.3, 2.4),
      color: '#8a5a33', channel: 'wood'
    })),
    { name: 'sawdust', geo: cylinder([8 * 0.25, 0.3, 8 * 0.32], 0.45, 0.45, 0.6), color: '#9a6f45', channel: 'ground' },
    { name: 'blade', geo: box([8 * 0.25, 0.75, 8 * 0.32], [0.08, 0.5, 0.08]), color: '#5a3e28', channel: 'metal' }
  )

  // Quarry
  const q = out.find(b => b.id === 'quarry')!
  q.parts.push(
    ...[[-1.5, -1, 2.2], [1.2, -1.5, 1.8], [0, -2, 2.6], [2.4, 0.5, 1.2]].map(([x, z, s], i) => ({
      name: `boulder${i}`, geo: cylinder([x, s * 0.4, z], s, s * 0.8, s), color: i % 2 ? '#9a958c' : '#a8a296', channel: 'stone'
    })),
    ...[0, 1, 2].map((i) => ({
      name: `block${i}`, geo: box([-8 / 2 + 1.4 + i * 0.95, 0.35, 8 / 2 - 1.2], [0.8, 0.7, 0.8]), color: '#c2baae', channel: 'stone'
    })),
    { name: 'block_top', geo: box([-8 / 2 + 1.9, 1.05, 8 / 2 - 1.2], [0.8, 0.7, 0.8]), color: '#b3aa9c', channel: 'stone' },
    { name: 'crane_post', geo: box([8 / 2 - 1, 1.8, 8 / 2 - 1.4], [0.15, 3.6, 0.15]), color: '#6b4a2e', channel: 'wood' },
    { name: 'crane_arm', geo: box([8 / 2 - 1.8, 3.5, 8 / 2 - 1.4], [1.8, 0.12, 0.12]), color: '#6b4a2e', channel: 'wood' }
  )

  // Mine
  const mi = out.find(b => b.id === 'mine')!
  mi.parts.push(
    { name: 'hill', geo: cone4([0, 2.2, -8 * 0.15], 8 * 0.62, 4.4), color: '#7d756b', channel: 'ground' },
    { name: 'entrance', geo: box([0, 1.1, 8 * 0.18], [2, 2.2, 0.3]), color: '#1d1714', channel: 'ground' },
    { name: 'support_left', geo: box([-1.1, 1.2, 8 * 0.22], [0.25, 2.4, 0.25]), color: '#6b4a2e', channel: 'wood' },
    { name: 'support_right', geo: box([1.1, 1.2, 8 * 0.22], [0.25, 2.4, 0.25]), color: '#6b4a2e', channel: 'wood' },
    { name: 'lintel', geo: box([0, 2.4, 8 * 0.22], [2.6, 0.25, 0.3]), color: '#6b4a2e', channel: 'wood' },
    { name: 'track_left', geo: box([-0.4, 0.05, 8 * 0.38], [0.08, 0.06, 8 * 0.4]), color: '#5a5a5a', channel: 'metal' },
    { name: 'track_right', geo: box([0.4, 0.05, 8 * 0.38], [0.08, 0.06, 8 * 0.4]), color: '#5a5a5a', channel: 'metal' },
    { name: 'cart_base', geo: box([0, 0.45, 8 * 0.42], [1, 0.6, 0.8]), color: '#5c4a3a', channel: 'wood' },
    { name: 'cart_wheel1', geo: cylinder([-0.2, 0.8, 8 * 0.42], 0.22, 0.22, 0.1), color: '#8a6f5a', channel: 'wood' },
    { name: 'cart_wheel2', geo: cylinder([0.2, 0.8, 8 * 0.42], 0.22, 0.22, 0.1), color: '#8a6f5a', channel: 'wood' }
  )

  // Workshop
  const w = out.find(b => b.id === 'workshop')!
  w.parts.push(
    { name: 'cottage', geo: merge(
      box([0, 0.2, 0], [8.3, 0.4, 8.3]),
      box([0, 0.4 + 3 / 2, 0], [8, 3, 8]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => box([sx * 8 / 2, 0.4 + 3 / 2, sz * 8 / 2], [0.25, 3, 0.25])),
      box([0, 0.4 + 3, 8 / 2], [8, 0.22, 0.2]),
      prism([0, 0.4 + 3, 0], 8.7, 3 * 0.45, 8.9)
    ), color: '#d8b98a', channel: 'wall' },
    { name: 'roof', geo: prism([0, 0.4 + 3, 0], 8.7, 3 * 0.45, 8.9), color: '#6b4a2e', channel: 'roof' },
    { name: 'chimney', geo: box([8 * 0.28, 0.4 + 3 + 3 * 0.45 * 0.7, -8 * 0.15], [0.7, 3 * 0.45 * 1.1, 0.7]), color: '#8b7f74', channel: 'trim' },
    ...[0, 1, 2].map((i) => ({
      name: `shelf${i}`, geo: box([8 / 2 + 0.7, 0.15 + i * 0.14, 0.5], [0.9, 0.12, 2.6]),
      color: i % 2 ? '#c49a62' : '#b08850', channel: 'wood'
    })),
    { name: 'workbench_top', geo: box([-8 / 2 - 0.8, 0.55, 1], [1.4, 0.12, 0.4]), color: '#8a5a33', channel: 'wood' },
    { name: 'workbench_leg', geo: box([-8 / 2 - 0.8, 0.3, 1], [0.1, 0.55, 0.5]), color: '#6b4a2e', channel: 'wood' },
    { name: 'door', geo: box([0, 0.4, 8 / 2 + 0.02], [1.1, 1.8, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 8 / 2 + 0.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
    { name: 'window_left', geo: box([-8 * 0.3, 0.4 + 3 * 0.55, 8 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'window_right', geo: box([8 * 0.3, 0.4 + 3 * 0.55, 8 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' }
  )

  // Alchemist
  const a = out.find(b => b.id === 'alchemist')!
  a.parts.push(
    { name: 'cottage', geo: merge(
      box([0, 0.2, 0], [8.3, 0.4, 8.3]),
      box([0, 0.4 + 2.8 / 2, 0], [8, 2.8, 8]),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => box([sx * 8 / 2, 0.4 + 2.8 / 2, sz * 8 / 2], [0.25, 2.8, 0.25])),
      box([0, 0.4 + 2.8, 8 / 2], [8, 0.22, 0.2]),
      prism([0, 0.4 + 2.8, 0], 8.7, 2.8 * 0.45, 8.9)
    ), color: '#e4dcef', channel: 'wall' },
    { name: 'roof', geo: prism([0, 0.4 + 2.8, 0], 8.7, 2.8 * 0.45, 8.9), color: '#6a4a8c', channel: 'roof' },
    { name: 'chimney', geo: box([8 * 0.28, 0.4 + 2.8 + 2.8 * 0.45 * 0.7, -8 * 0.15], [0.7, 2.8 * 0.45 * 1.1, 0.7]), color: '#8b7f74', channel: 'trim' },
    { name: 'smoke', geo: cylinder([8 * 0.28, 5.4, -8 * 0.15], 0.3, 0.1, 1), color: '#e8e4dc', channel: 'fx' },
    { name: 'cauldron_base', geo: cylinder([8 / 2 + 0.9, 0.5, 8 / 2 - 1], 0.6, 0.5, 0.6), color: '#2f2a35', channel: 'metal' },
    { name: 'cauldron_glow', geo: cylinder([8 / 2 + 0.9, 0.85, 8 / 2 - 1], 0.45, 0.45, 0.05), color: '#ff7a30', channel: 'fx' },
    ...['#6fd18a', '#b07ce0', '#e0c050'].map((c, i) => ({
      name: `bottle${i}`, geo: cylinder([-8 / 2 - 0.5, 0.25, -0.5 + i * 0.5], 0.14, 0.14, 0.5), color: c, channel: 'fx'
    })),
    { name: 'door', geo: box([0, 0.4, 8 / 2 + 0.02], [1.1, 1.8, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 8 / 2 + 0.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
    { name: 'window_left', geo: box([-8 * 0.3, 0.4 + 2.8 * 0.55, 8 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'window_right', geo: box([8 * 0.3, 0.4 + 2.8 * 0.55, 8 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' }
  )

  // House (generic - 4 color variants, first one shown)
  const h = out.find(b => b.id === 'house')!
  const [wallColor, roofColor] = HOUSE_COLORS[0]
  h.parts.push(
    { name: 'foundation', geo: box([0, 0.2, 0], [6.3, 0.4, 6.3]), color: '#9a948a', channel: 'stone' },
    { name: 'walls', geo: box([0, 0.4 + 2.8 / 2, 0], [6, 2.8, 6]), color: wallColor, channel: 'wall' },
    { name: 'corners', geo: merge(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
      box([sx * 6 / 2, 0.4 + 2.8 / 2, sz * 6 / 2], [0.25, 2.8, 0.25]))), color: '#4a3220', channel: 'trim' },
    { name: 'roof_trim', geo: box([0, 0.4 + 2.8, 6 / 2], [6, 0.22, 0.2]), color: '#4a3220', channel: 'trim' },
    { name: 'roof', geo: prism([0, 0.4 + 2.8, 0], 6.7, 2.8 * 0.45, 6.9), color: roofColor, channel: 'roof' },
    { name: 'chimney', geo: box([6 * 0.28, 0.4 + 2.8 + 2.8 * 0.45 * 0.7, -6 * 0.15], [0.7, 2.8 * 0.45 * 1.1, 0.7]), color: '#8b7f74', channel: 'trim' },
    { name: 'door', geo: box([0, 0.4, 6 / 2 + 0.02], [1.1, 1.8, 0.1]), color: '#7a4e2c', channel: 'wood' },
    { name: 'door_knob', geo: cylinder([0.3, 0.48, 6 / 2 + 0.12], 0.06, 0.06, 0.12), color: '#d8b24a', channel: 'metal' },
    { name: 'window_left', geo: box([-6 * 0.3, 0.4 + 2.8 * 0.55, 6 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' },
    { name: 'window_right', geo: box([6 * 0.3, 0.4 + 2.8 * 0.55, 6 / 2 + 0.03], [0.8, 0.9, 0.1]), color: '#5a3e28', channel: 'trim' }
  )

  return out
}

async function main() {
  const buildings = generateBuildings()
  console.log(`Generating ${buildings.length} building GLBs...`)

  // Create a minimal template GLB (just an empty scene with a node)
  const templateDoc = new Document()
  templateDoc.createScene().setName('Scene')
  templateDoc.createNode('Template').setName('Template')
  mkdirSync(join(OUT), { recursive: true })
  writeFileSync(join(OUT, 'template.glb'), Buffer.from(await io.writeBinary(templateDoc)))

  for (const b of buildings) {
    await writeBuildingGlb(b, join(OUT, b.id, `${b.id}.glb`))
    console.log(`  ✓ ${b.id} (${b.parts.length} parts)`)
  }

  // Manifest
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    buildings: buildings.map(b => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      w: b.w,
      d: b.d,
      file: `buildings/${b.id}/${b.id}.glb`,
      parts: b.parts.length,
    }))
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(ROOT, 'data/building_assets.json'), JSON.stringify(manifest, null, 2))
  console.log('\nDone! Manifest written to public/buildings/manifest.json and data/building_assets.json')
}

main().catch(e => { console.error(e); process.exit(1) })