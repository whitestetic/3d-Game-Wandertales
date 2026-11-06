// Character pipeline core: master body analysis, posing/skinning, surface queries, mesh builders, GLB export.
// Runs headless in Node (no Blender needed). All coordinates are WORLD metres of the master (Y-up, feet at y=0).
import { Document, NodeIO, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import { MASTER } from './inspect.ts'

export type V3 = [number, number, number]
export type M4 = number[] // column-major 4x4

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

// ---------- vector / matrix math ----------
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const dist = (a: V3, b: V3) => len(sub(a, b))

export function mul(a: ArrayLike<number>, b: ArrayLike<number>): M4 {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
export const apply = (m: ArrayLike<number>, p: V3): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]
export const applyDir = (m: ArrayLike<number>, p: V3): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]]
export function axisAngle(axis: V3, angle: number): M4 {
  const [x, y, z] = norm(axis), c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]
}
/** Rotation part of a matrix with scale removed (columns normalized). */
function rotationOnly(m: ArrayLike<number>): M4 {
  const cols = [0, 1, 2].map((c) => norm([m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]))
  return [...cols[0], 0, ...cols[1], 0, ...cols[2], 0, 0, 0, 0, 1]
}
const transpose3 = (m: M4): M4 => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]

// ---------- master body ----------
export interface Body {
  joints: string[]
  parent: number[]
  local: M4[] // joint local matrices (rest)
  world: M4[] // joint world matrices (rest)
  rootParentWorld: M4
  ibm: M4[]
  meshWorld: M4 // mesh node world (0.01 scale)
  verts: V3[]
  normals: V3[]
  jw: { j: number[]; w: number[] }[]
  tris: [number, number, number][]
  dominant: string[]
  eyeBox: { min: V3; max: V3 }
  eyeVerts: V3[]
  eyeTris: number[]
  jointPos: Record<string, V3>
}

export const J = {
  root: '_rootJoint', hips: 'Hips_01', spine: 'Spine_02', spine1: 'Spine1_03', chest: 'Spine2_04', neck: 'Neck_05', head: 'Head_06',
  rShoulder: 'RightShoulder_08', rArm: 'RightArm_09', rForeArm: 'RightForeArm_010', rHand: 'RightHand_011',
  lShoulder: 'Left_Shoulder_016', lArm: 'Left_Arm_017', lForeArm: 'Left_ForeArm_018', lHand: 'Left_Hand_019',
  rUpLeg: 'RightUpLeg_024', rLeg: 'RightLeg_025', rFoot: 'RightFoot_026', rToe: 'RightToeBase_027',
  lUpLeg: 'Left_UpLeg_00', lLeg: 'Left_Leg_028', lFoot: 'Left_Foot_029', lToe: 'Left_ToeBase_030',
} as const

let cached: Body | null = null
export async function loadBody(): Promise<Body> {
  if (cached) return cached
  const doc = await io.read(MASTER)
  const skin = doc.getRoot().listSkins()[0]
  const jn = skin.listJoints()
  const ibmAcc = skin.getInverseBindMatrices()!
  const bodyNode = doc.getRoot().listNodes().find((n) => n.getName() === 'Object_7')!
  const eyeNode = doc.getRoot().listNodes().find((n) => n.getName() === 'Object_9')!
  const meshWorld = Array.from(bodyNode.getWorldMatrix())
  const prim = bodyNode.getMesh()!.listPrimitives()[0]
  const P = prim.getAttribute('POSITION')!, N = prim.getAttribute('NORMAL')!, JA = prim.getAttribute('JOINTS_0')!, WA = prim.getAttribute('WEIGHTS_0')!
  const verts: V3[] = [], normals: V3[] = [], jw: Body['jw'] = [], dominant: string[] = []
  for (let i = 0; i < P.getCount(); i++) {
    verts.push(apply(meshWorld, P.getElement(i, []) as V3))
    normals.push(norm(applyDir(meshWorld, N.getElement(i, []) as V3)))
    const j = JA.getElement(i, []), w = WA.getElement(i, [])
    jw.push({ j, w })
    let b = 0
    for (let k = 1; k < 4; k++) if (w[k] > w[b]) b = k
    dominant.push(jn[j[b]].getName())
  }
  const idx = prim.getIndices()!
  const tris: Body['tris'] = []
  for (let i = 0; i < idx.getCount(); i += 3) tris.push([idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)])
  const eyePrim = eyeNode.getMesh()!.listPrimitives()[0]
  const eyeP = eyePrim.getAttribute('POSITION')!
  const eyeIdx = eyePrim.getIndices()!
  const eyeTris = Array.from({ length: eyeIdx.getCount() }, (_, i) => eyeIdx.getScalar(i))
  const ew = Array.from(eyeNode.getWorldMatrix())
  const eyeVerts: V3[] = []
  for (let i = 0; i < eyeP.getCount(); i++) eyeVerts.push(apply(ew, eyeP.getElement(i, []) as V3))
  const world = jn.map((n) => Array.from(n.getWorldMatrix()))
  cached = {
    joints: jn.map((n) => n.getName()),
    parent: jn.map((n) => jn.indexOf(n.getParentNode() as Node)),
    local: jn.map((n) => Array.from(n.getMatrix())),
    world,
    rootParentWorld: Array.from((jn[0].getParentNode() as Node).getWorldMatrix()),
    ibm: jn.map((_, i) => ibmAcc.getElement(i, [])),
    meshWorld, verts, normals, jw, tris, dominant,
    eyeBox: boxOf(eyeVerts), eyeVerts, eyeTris,
    jointPos: Object.fromEntries(jn.map((n, i) => [n.getName(), apply(world[i], [0, 0, 0])])),
  }
  return cached
}

export function boxOf(pts: V3[]) {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]) }
  return { min, max }
}
export const regionBox = (b: Body, bones: string[]) => boxOf(b.verts.filter((_, i) => bones.includes(b.dominant[i])))
export const ji = (b: Body, name: string) => { const i = b.joints.indexOf(name); if (i < 0) throw new Error(`no joint ${name}`); return i }

// ---------- posing + skinning (for deformation tests) ----------
export type Pose = Record<string, { axis: V3; deg: number }[]> // world-space rotations per joint

/** Posed skinning matrices (world) for each joint. Rotations are given around WORLD axes at the joint pivot. */
export function poseMatrices(b: Body, pose: Pose): M4[] {
  const posedWorld: M4[] = []
  for (let i = 0; i < b.joints.length; i++) {
    const p = b.parent[i]
    const parentW = p >= 0 ? posedWorld[p] : b.rootParentWorld
    let local = b.local[i]
    for (const r of pose[b.joints[i]] ?? []) {
      // express the world axis in the joint's rest frame, then rotate locally
      const R = rotationOnly(b.world[i])
      const axisLocal = norm(applyDir(transpose3(R), r.axis))
      local = mul(local, axisAngle(axisLocal, (r.deg * Math.PI) / 180))
    }
    posedWorld.push(mul(parentW, local))
  }
  return posedWorld.map((w, i) => mul(w, b.ibm[i]))
}

const inv0_01 = (p: V3): V3 => [p[0] * 100, p[1] * 100, p[2] * 100] // world → mesh-local (master mesh node is a pure 0.01 scale)
export function skinPoint(world: V3, jw: { j: number[]; w: number[] }, mats: M4[]): V3 {
  const local = inv0_01(world)
  const out: V3 = [0, 0, 0]
  for (let k = 0; k < 4; k++) {
    if (!jw.w[k]) continue
    const q = apply(mats[jw.j[k]], local)
    out[0] += jw.w[k] * q[0]; out[1] += jw.w[k] * q[1]; out[2] += jw.w[k] * q[2]
  }
  return out
}

export const TEST_POSES: Record<string, Pose> = {
  rest: {},
  arms_down: { [J.rArm]: [{ axis: [0, 0, 1], deg: 65 }], [J.lArm]: [{ axis: [0, 0, 1], deg: -65 }] },
  walk: {
    [J.rArm]: [{ axis: [0, 0, 1], deg: 65 }, { axis: [1, 0, 0], deg: -25 }], [J.lArm]: [{ axis: [0, 0, 1], deg: -65 }, { axis: [1, 0, 0], deg: 25 }],
    [J.rUpLeg]: [{ axis: [1, 0, 0], deg: -30 }], [J.lUpLeg]: [{ axis: [1, 0, 0], deg: 30 }],
  },
  head_turn: { [J.head]: [{ axis: [0, 1, 0], deg: 35 }, { axis: [1, 0, 0], deg: 15 }] },
  arms_up: { [J.rArm]: [{ axis: [0, 0, 1], deg: -50 }], [J.lArm]: [{ axis: [0, 0, 1], deg: 50 }] },
  crouch: { [J.rUpLeg]: [{ axis: [1, 0, 0], deg: -60 }], [J.lUpLeg]: [{ axis: [1, 0, 0], deg: -60 }], [J.rLeg]: [{ axis: [1, 0, 0], deg: 70 }], [J.lLeg]: [{ axis: [1, 0, 0], deg: 70 }], [J.chest]: [{ axis: [1, 0, 0], deg: 15 }] },
}

// ---------- surface queries ----------
function closestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return a
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return b
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scl(ab, d1 / (d1 - d3)))
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return c
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scl(ac, d2 / (d2 - d6)))
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scl(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))))
  const den = 1 / (va + vb + vc)
  return add(a, add(scl(ab, vb * den), scl(ac, vc * den)))
}

/** Surface of a (possibly posed) body for closest-point queries. */
export class Surface {
  tris: { a: V3; b: V3; c: V3; n: V3; tag: string }[]
  constructor(verts: V3[], tris: [number, number, number][], vertNormals?: V3[], tags?: string[]) {
    this.tris = tris.map(([i, j, k]) => {
      let n = norm(cross(sub(verts[j], verts[i]), sub(verts[k], verts[i])))
      // keep orientation consistent with the authored vertex normals
      if (vertNormals && dot(n, add(add(vertNormals[i], vertNormals[j]), vertNormals[k])) < 0) n = scl(n, -1)
      return { a: verts[i], b: verts[j], c: verts[k], n, tag: tags?.[i] ?? '' }
    })
  }
  boxes?: Float64Array
  /** Signed distance: positive outside the body, negative inside. */
  signed(p: V3) {
    if (!this.boxes) {
      this.boxes = new Float64Array(this.tris.length * 6)
      this.tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { this.boxes![i * 6 + k] = Math.min(t.a[k], t.b[k], t.c[k]); this.boxes![i * 6 + 3 + k] = Math.max(t.a[k], t.b[k], t.c[k]) } })
    }
    let best = Infinity, bestCp: V3 = p, bestN: V3 = [0, 1, 0], bestTag = ''
    const bx = this.boxes
    for (let ti = 0; ti < this.tris.length; ti++) {
      // skip triangles whose bounding box is farther than the best hit so far
      let lb = 0
      for (let k = 0; k < 3; k++) { const lo = bx[ti * 6 + k], hi = bx[ti * 6 + 3 + k], v = p[k]; const d = v < lo ? lo - v : v > hi ? v - hi : 0; lb += d * d }
      if (lb > best * best + 1e-12) continue
      const t = this.tris[ti]
      const cp = closestOnTri(p, t.a, t.b, t.c)
      const d = dist(p, cp)
      if (d < best - 1e-9 || (Math.abs(d - best) < 1e-9 && Math.abs(dot(sub(p, cp), t.n)) > Math.abs(dot(sub(p, bestCp), bestN)))) { best = d; bestCp = cp; bestN = t.n; bestTag = t.tag }
    }
    const s = dot(sub(p, bestCp), bestN) >= 0 ? 1 : -1
    return { d: s * best, cp: bestCp, n: bestN, tag: bestTag }
  }
}

// ---------- asset parts ----------
export type Channel = 'primary' | 'secondary' | 'trim' | 'leather' | 'metal' | 'hair' | 'gem' | 'cloth' | 'dark'
export interface Part {
  name: string
  channel: Channel
  pos: V3[]
  idx: number[]
  jw: { j: number[]; w: number[] }[]
}

export const rigidWeights = (b: Body, bone: string, n: number) => Array.from({ length: n }, () => ({ j: [ji(b, bone), 0, 0, 0], w: [1, 0, 0, 0] }))

/** Copy skin weights from the k nearest body vertices (inverse-distance blend), keeping the 4 strongest joints. */
export function transferWeights(b: Body, pts: V3[], allowed?: string[], k = 4) {
  const cand = b.verts.map((v, i) => i).filter((i) => !allowed || allowed.includes(b.dominant[i]))
  return pts.map((p) => {
    const near = cand.map((i) => ({ i, d: dist(p, b.verts[i]) })).sort((x, y) => x.d - y.d).slice(0, k)
    const acc = new Map<number, number>()
    for (const { i, d } of near) {
      const f = 1 / (d + 1e-4)
      for (let q = 0; q < 4; q++) if (b.jw[i].w[q] > 0) acc.set(b.jw[i].j[q], (acc.get(b.jw[i].j[q]) ?? 0) + b.jw[i].w[q] * f)
    }
    const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
    const s = top.reduce((a, [, w]) => a + w, 0)
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0]
    top.forEach(([jj, ww], q) => { j[q] = jj; w[q] = ww / s })
    return { j, w }
  })
}

/** Push vertices that are inside (or too close to) the body back out along the surface normal. */
export function conform(surface: Surface, pts: V3[], margin: number) {
  let moved = 0
  const out = pts.map((p) => {
    const s = surface.signed(p)
    if (s.d >= margin) return p
    moved++
    return add(s.cp, scl(s.n, margin))
  })
  return { pts: out, moved }
}

// ---------- low-poly primitive builders (world space) ----------
export interface Geo { pos: V3[]; idx: number[] }
export const merge = (...gs: Geo[]): Geo => {
  const pos: V3[] = [], idx: number[] = []
  for (const g of gs) { const o = pos.length; pos.push(...g.pos); idx.push(...g.idx.map((i) => i + o)) }
  return { pos, idx }
}
export const xform = (g: Geo, f: (p: V3) => V3): Geo => ({ pos: g.pos.map(f), idx: g.idx })
export const rotY = (deg: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => { const a = (deg * Math.PI) / 180, x = p[0] - c[0], z = p[2] - c[2]; return [c[0] + x * Math.cos(a) + z * Math.sin(a), p[1], c[2] - x * Math.sin(a) + z * Math.cos(a)] }
export const rotX = (deg: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => { const a = (deg * Math.PI) / 180, y = p[1] - c[1], z = p[2] - c[2]; return [p[0], c[1] + y * Math.cos(a) - z * Math.sin(a), c[2] + y * Math.sin(a) + z * Math.cos(a)] }
export const rotZ = (deg: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => { const a = (deg * Math.PI) / 180, x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), p[2]] }
export const move = (d: V3) => (p: V3): V3 => add(p, d)

/** Frustum/cylinder along +Y from y0 to y1, with optional caps. Elliptic via rx/rz scaling. */
export function cylinder(c: V3, r0: number, r1: number, h: number, seg = 8, caps = true, sx = 1, sz = 1): Geo {
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
export function box(c: V3, s: V3): Geo {
  const [x, y, z] = [s[0] / 2, s[1] / 2, s[2] / 2]
  const pos: V3[] = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].map((p) => add(c, p as V3))
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
  return { pos, idx }
}
export function sphere(c: V3, r: number, seg = 8, rings = 5, sy = 1): Geo {
  const pos: V3[] = [], idx: number[] = []
  for (let y = 0; y <= rings; y++) {
    const v = y / rings, phi = v * Math.PI
    for (let x = 0; x < seg; x++) { const th = (x / seg) * Math.PI * 2; pos.push([c[0] + Math.cos(th) * Math.sin(phi) * r, c[1] + Math.cos(phi) * r * sy, c[2] + Math.sin(th) * Math.sin(phi) * r]) }
  }
  for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
    const a = y * seg + x, b = y * seg + ((x + 1) % seg), c2 = a + seg, d = b + seg
    idx.push(a, b, c2, b, d, c2)
  }
  return { pos, idx }
}
export function torus(c: V3, R: number, r: number, seg = 12, tube = 4, sx = 1, sz = 1): Geo {
  const pos: V3[] = [], idx: number[] = []
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2
    for (let j = 0; j < tube; j++) {
      const b = (j / tube) * Math.PI * 2, rr = R + Math.cos(b) * r
      pos.push([c[0] + Math.cos(a) * rr * sx, c[1] + Math.sin(b) * r, c[2] + Math.sin(a) * rr * sz])
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const a = i * tube + j, b = ((i + 1) % seg) * tube + j, c2 = i * tube + ((j + 1) % tube), d = ((i + 1) % seg) * tube + ((j + 1) % tube)
    idx.push(a, b, c2, b, d, c2)
  }
  return { pos, idx }
}
/** Flat panel (quad grid) — for capes, aprons. corner + u,v edge vectors. */
export function panel(o: V3, u: V3, v: V3, nu = 2, nv = 3): Geo {
  const pos: V3[] = [], idx: number[] = []
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(add(o, add(scl(u, i / nu), scl(v, j / nv))))
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c2 = a + nu + 1, d = c2 + 1; idx.push(a, b, d, a, d, c2) }
  return { pos, idx }
}

/** Shell: copy of the body surface where `keep(vertexIndex)` holds, pushed out along welded normals. */
export function shell(b: Body, keep: (i: number) => boolean, offset: (i: number, p: V3) => number): Geo & { src: number[] } {
  const key = (p: V3) => p.map((v) => v.toFixed(5)).join(',')
  const welded = new Map<string, V3>()
  b.verts.forEach((p, i) => { const k = key(p); welded.set(k, add(welded.get(k) ?? [0, 0, 0], b.normals[i])) })
  const used = new Map<number, number>(), pos: V3[] = [], idx: number[] = [], src: number[] = []
  for (const t of b.tris) {
    if (!t.every(keep)) continue
    for (const i of t) {
      if (!used.has(i)) {
        used.set(i, pos.length)
        const n = norm(welded.get(key(b.verts[i]))!)
        pos.push(add(b.verts[i], scl(n, offset(i, b.verts[i]))))
        src.push(i)
      }
      idx.push(used.get(i)!)
    }
  }
  return { pos, idx, src }
}

// ---------- GLB export ----------
export interface AssetDef {
  id: string
  name: string
  category: 'hair' | 'headwear' | 'clothing' | 'armor' | 'footwear' | 'accessory'
  slot: string
  method: 'shell_copy_weights' | 'weight_transfer' | 'rigid_bone' | 'rigid_multi_bone' | 'hybrid'
  source: 'generated' | 'provided_blockout'
  colors: Partial<Record<Channel, string>>
  parts: Part[]
  notes?: string[]
  /** extra QC context: e.g. rigid parts that should stay near the body */
  attachBones?: string[]
}

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

/** Writes the asset as a skinned GLB that reuses the master's exact skeleton and skin (same joint names/order). */
export async function writeAssetGlb(asset: AssetDef, file: string) {
  const doc = await io.read(MASTER)
  const root = doc.getRoot()
  const bodyNode = root.listNodes().find((n) => n.getName() === 'Object_7')!
  const eyeNode = root.listNodes().find((n) => n.getName() === 'Object_9')!
  bodyNode.getMesh()?.dispose()
  eyeNode.getMesh()?.dispose()
  eyeNode.dispose()
  for (const m of root.listMaterials()) m.dispose()
  const buffer = root.listBuffers()[0]
  const mesh = doc.createMesh(asset.id)
  const mats = new Map<Channel, ReturnType<Document['createMaterial']>>()
  for (const part of asset.parts) {
    if (!part.pos.length) continue
    let mat = mats.get(part.channel)
    if (!mat) {
      mat = doc.createMaterial(`wt_${part.channel}`).setBaseColorFactor(hex(asset.colors[part.channel] ?? '#cccccc'))
        .setRoughnessFactor(part.channel === 'metal' || part.channel === 'gem' ? 0.35 : 0.85).setMetallicFactor(part.channel === 'metal' ? 0.6 : 0).setDoubleSided(true)
      mats.set(part.channel, mat)
    }
    const local = part.pos.map((p) => [p[0] * 100, p[1] * 100, p[2] * 100]) // world → master mesh-local (pure 0.01 scale)
    const nrm = vertexNormals(part.pos, part.idx)
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(local.flat())).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm.flat())).setBuffer(buffer))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(part.jw.flatMap((x) => x.j))).setBuffer(buffer))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(part.jw.flatMap((x) => x.w))).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(part.pos.length > 65535 ? new Uint32Array(part.idx) : new Uint16Array(part.idx)).setBuffer(buffer))
      .setMaterial(mat)
      .setName(part.name)
    mesh.addPrimitive(prim)
  }
  bodyNode.setMesh(mesh).setName(asset.id)
  root.getAsset().generator = 'WanderTales character pipeline (Node, glTF-Transform)'
  root.getAsset().extras = { wtAsset: { id: asset.id, category: asset.category, slot: asset.slot, method: asset.method, source: asset.source } }
  await doc.transform(prune({ keepLeaves: true }))
  const bin = await io.writeBinary(doc)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bin)
  return bin.byteLength
}
