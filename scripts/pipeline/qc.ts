// Automated QC for every character asset GLB. Nothing is hidden: every check and number goes into the report.
import { readFileSync } from 'node:fs'
import { J, Surface, TEST_POSES, boxOf, dist, io, poseMatrices, skinPoint, type AssetDef, type Body, type V3 } from './lib.ts'
import type { SkirtInfo } from './generate.ts'

export type Status = 'PASS' | 'WARNING' | 'FAILED' | 'NEEDS_REVIEW'
export interface Check { name: string; ok: boolean; level: 'info' | 'warning' | 'review' | 'fail'; detail: string }
export interface QcResult {
  id: string; status: Status; checks: Check[]
  metrics: { vertices: number; triangles: number; bytes: number; clipping: Record<string, number>; maxStretch: number; bounds: { min: V3; max: V3 }; minDistanceToBody: number }
}

/** Body part groups: clipping inside your OWN group is an asset defect; another limb entering is pose contact. */
const GROUP: Record<string, string> = {}
for (const j of ['Head_06', 'HeadTop_End_07']) GROUP[j] = 'head'
for (const j of ['Hips_01', 'Spine_02', 'Spine1_03', 'Spine2_04', 'Neck_05', 'RightShoulder_08', 'Left_Shoulder_016', '_rootJoint']) GROUP[j] = 'torso'
const groupOf = (joint: string) => GROUP[joint] ?? (/^Right(Arm|ForeArm|Hand)/.test(joint) ? 'armR' : /^Left_(Arm|ForeArm|Hand)/.test(joint) ? 'armL' : /^Right/.test(joint) ? 'legR' : /^Left_/.test(joint) ? 'legL' : 'torso')

const posedBodies = new Map<string, { verts: V3[]; surface: Surface; mats: number[][] }>()
function posed(b: Body, pose: string) {
  let p = posedBodies.get(pose)
  if (!p) {
    const mats = poseMatrices(b, TEST_POSES[pose])
    const verts = b.verts.map((v, i) => skinPoint(v, b.jw[i], mats))
    // rest normals are fine for orientation of the posed triangles (consistent winding is what matters)
    p = { verts, surface: new Surface(verts, b.tris, b.normals, b.dominant.map(groupOf)), mats }
    posedBodies.set(pose, p)
  }
  return p
}

/** How much the bare body itself stretches in the test poses (the tolerance for clothing that follows it). */
let bodyStretch = 0
function bodyMaxStretch(b: Body) {
  if (bodyStretch) return bodyStretch
  bodyStretch = 1
  for (const pose of Object.keys(TEST_POSES)) {
    const P = posed(b, pose)
    for (const [i, j, k] of b.tris) for (const [x, y] of [[i, j], [j, k], [k, i]]) {
      const l0 = dist(b.verts[x], b.verts[y])
      if (l0 > 1e-4) bodyStretch = Math.max(bodyStretch, dist(P.verts[x], P.verts[y]) / l0)
    }
  }
  return bodyStretch
}

/** Loads the GLB through three.js' own GLTFLoader (what the game uses). */
async function threeLoads(file: string): Promise<string | null> {
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const buf = readFileSync(file)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const gltf = await new Promise<{ scene: { traverse: (f: (o: { isSkinnedMesh?: boolean }) => void) => void } }>((res, rej) => new GLTFLoader().parse(ab, '', res as never, rej))
    let skinned = 0
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++ })
    return skinned ? null : 'loaded, but no SkinnedMesh found'
  } catch (e) { return `three.js GLTFLoader failed: ${(e as Error).message}` }
}

export async function qcAsset(b: Body, def: AssetDef & { skirt?: SkirtInfo; sourceVertices?: number }, file: string, bytes: number): Promise<QcResult> {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, level: Check['level'], detail: string) => checks.push({ name, ok, level: ok ? 'info' : level, detail })

  // 1. the file opens and is structurally right
  let doc
  try { doc = await io.read(file) } catch (e) { add('opens', false, 'fail', String(e)); return finish(def.id, checks, emptyMetrics(bytes)) }
  add('opens', true, 'fail', 'GLB parsed by glTF-Transform')
  const root = doc.getRoot()
  const mats = root.listMaterials()
  add('materials', mats.length > 0 && root.listMeshes().every((m) => m.listPrimitives().every((p) => !!p.getMaterial())), 'fail', `${mats.length} materials: ${mats.map((m) => m.getName()).join(', ')}`)
  const skin = root.listSkins()[0]
  const names = skin?.listJoints().map((j) => j.getName()) ?? []
  add('rig_compatible', names.length === b.joints.length && names.every((n, i) => n === b.joints[i]), 'fail', `${names.length} joints, same names and order as the master: ${names.every((n, i) => n === b.joints[i])}`)
  let badW = 0, verts = 0, tris = 0
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const W = p.getAttribute('WEIGHTS_0'), JA = p.getAttribute('JOINTS_0')
    verts += p.getAttribute('POSITION')!.getCount()
    tris += (p.getIndices()?.getCount() ?? 0) / 3
    if (!W || !JA) { badW += p.getAttribute('POSITION')!.getCount(); continue }
    for (let i = 0; i < W.getCount(); i++) {
      const w = W.getElement(i, []), j = JA.getElement(i, [])
      if (Math.abs(w.reduce((a, x) => a + x, 0) - 1) > 0.01 || j.some((x, k) => w[k] > 0 && x >= names.length)) badW++
    }
  }
  add('weights_valid', badW === 0, 'fail', badW ? `${badW} vertices with invalid weights` : 'all vertices have normalized weights on existing joints')
  const threeErr = await threeLoads(file)
  add('threejs_loads', !threeErr, 'fail', threeErr ?? 'three.js GLTFLoader parses it into a SkinnedMesh')
  add('file_size', bytes < 150_000, 'warning', `${(bytes / 1024).toFixed(1)} KB`)
  add('poly_budget', verts < 3000, 'warning', `${verts} vertices, ${tris} triangles`)

  // 2. geometry vs the body
  const allPts = def.parts.flatMap((p) => p.pos)
  const bounds = boxOf(allPts)
  const tallOk = def.category === 'headwear' || def.category === 'hair' ? bounds.max[1] < 0.72 : bounds.max[1] < 0.53
  // silhouette sanity per category (catches mis-oriented or wildly mis-scaled items that are still "attached")
  const w = bounds.max[0] - bounds.min[0], h = bounds.max[1] - bounds.min[1], dpt = bounds.max[2] - bounds.min[2]
  const LIMITS: Record<string, [number, number, number]> = { hair: [0.46, 0.34, 0.4], headwear: [0.46, 0.3, 0.46], clothing: [0.32, 0.24, 0.3], armor: [0.3, 0.24, 0.26], footwear: [0.2, 0.07, 0.14], accessory: [0.32, 0.24, 0.24] }
  const SLOT_LIMITS: Record<string, [number, number, number]> = { hands: [0.45, 0.08, 0.12], ears: [0.36, 0.08, 0.08], feet: [0.2, 0.08, 0.14], headwear: [0.46, 0.36, 0.46] }
  const lim = SLOT_LIMITS[def.slot] ?? LIMITS[def.category]
  add('silhouette', w <= lim[0] && h <= lim[1] && dpt <= lim[2], 'review', `size ${w.toFixed(3)} x ${h.toFixed(3)} x ${dpt.toFixed(3)} m (limit for ${def.category}: ${lim.join(' x ')})`)
  add('scale_position', tallOk && bounds.min[1] > -0.01 && Math.abs(bounds.max[0]) < 0.3 && Math.abs(bounds.min[0]) < 0.3, 'review', `bounds y ${bounds.min[1].toFixed(3)}–${bounds.max[1].toFixed(3)}, x ${bounds.min[0].toFixed(3)}–${bounds.max[0].toFixed(3)} (master 0–0.475)`)

  const rest = posed(b, 'rest')
  let minD = Infinity
  const clipping: Record<string, number> = {}, contact: Record<string, number> = {}
  let maxStretch = 1
  for (const pose of Object.keys(TEST_POSES)) {
    const P = posed(b, pose)
    let inside = 0, touched = 0, n = 0
    for (const part of def.parts) {
      const pp = part.pos.map((v, i) => skinPoint(v, part.jw[i], P.mats))
      for (let i = 0; i < pp.length; i++) {
        const s = P.surface.signed(pp[i])
        if (pose === 'rest') minD = Math.min(minD, Math.abs(s.d))
        if (s.d < -0.0015) {
          const w = part.jw[i]
          const own = groupOf(b.joints[w.j[w.w.indexOf(Math.max(...w.w))]])
          if (s.tag === own || pose === 'rest') inside++
          else touched++ // another limb pushed into the item (pose contact), not a fitting defect
        }
        n++
      }
      // stretch: only meaningful for skinned (multi-bone) parts
      if (pose !== 'rest') for (let t = 0; t < part.idx.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = part.idx[t + e], c = part.idx[t + ((e + 1) % 3)]
        const l0 = dist(part.pos[a], part.pos[c])
        if (l0 > 1e-4) maxStretch = Math.max(maxStretch, dist(pp[a], pp[c]) / l0)
      }
    }
    clipping[pose] = n ? inside / n : 0
    contact[pose] = n ? touched / n : 0
  }
  void rest
  const worst = Math.max(...Object.values(clipping))
  const worstPose = Object.entries(clipping).sort((a, c) => c[1] - a[1])[0][0]
  add('clipping_rest', clipping.rest <= 0.02, clipping.rest > 0.15 ? 'fail' : clipping.rest > 0.06 ? 'review' : 'warning', `${(clipping.rest * 100).toFixed(1)}% of vertices inside the body in the rest pose`)
  add('clipping_poses', worst <= 0.03, worst > 0.1 ? 'review' : 'warning', `own-region clipping, worst ${(worst * 100).toFixed(1)}% in "${worstPose}" (${Object.entries(clipping).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')})`)
  const bodyS = bodyMaxStretch(b)
  add('deformation', maxStretch <= bodyS * 1.05 || maxStretch < 1.5, maxStretch > bodyS * 1.6 ? 'review' : 'warning', `max edge stretch x${maxStretch.toFixed(2)} (the bare body itself stretches up to x${bodyS.toFixed(2)} in the same poses)`)
  const worstContact = Math.max(...Object.values(contact))
  add('limb_contact', worstContact <= 0.12, 'warning', `other limbs pass through up to ${(worstContact * 100).toFixed(1)}% of the item (${Object.entries(contact).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ') || 'none'})`)
  add('attachment', minD < 0.035, 'review', `closest point to the body: ${(minD * 1000).toFixed(1)} mm`)

  if (def.skirt) {
    // legs stepping through a skirt/robe: leg vertices at skirt height that end up outside the skirt radius
    let exits = 0
    for (const pose of ['walk', 'crouch']) {
      const P = posed(b, pose)
      b.verts.forEach((_, i) => {
        if (![J.rUpLeg, J.lUpLeg, J.rLeg, J.lLeg, J.rFoot, J.lFoot].includes(b.dominant[i] as never)) return
        const p = P.verts[i], s = def.skirt!
        if (p[1] > s.y0 || p[1] < s.y1) return
        const t = (s.y0 - p[1]) / (s.y0 - s.y1), r = s.r0 + (s.r1 - s.r0) * t
        if (Math.hypot(p[0], (p[2] - 0.008) / 0.85) > r) exits++
      })
    }
    add('skirt_legs', exits === 0, exits > 20 ? 'review' : 'warning', exits ? `${exits} leg vertices pass through the skirt in walk/crouch` : 'legs stay inside the skirt in walk/crouch')
  }
  if (def.source === 'provided_blockout') {
    // deforming garments need enough vertices to bend; small rigid trinkets can be simple
    const need = def.category === 'clothing' || def.category === 'armor' || (def.slot === 'back' && def.method !== 'rigid_bone') ? 60 : 24
    const crude = (def.sourceVertices ?? 0) < need
    add('source_detail', !crude, 'review', crude ? `source blockout has only ${def.sourceVertices} vertices (needs at least ${need} for a ${def.category} item) — too crude to ship; needs remodelling` : `source blockout: ${def.sourceVertices} vertices`)
  }

  return finish(def.id, checks, { vertices: verts, triangles: tris, bytes, clipping, maxStretch, bounds, minDistanceToBody: minD })
}

const emptyMetrics = (bytes: number): QcResult['metrics'] => ({ vertices: 0, triangles: 0, bytes, clipping: {}, maxStretch: 0, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, minDistanceToBody: 0 })
function finish(id: string, checks: Check[], metrics: QcResult['metrics']): QcResult {
  const has = (l: Check['level']) => checks.some((c) => !c.ok && c.level === l)
  const status: Status = has('fail') ? 'FAILED' : has('review') ? 'NEEDS_REVIEW' : has('warning') ? 'WARNING' : 'PASS'
  return { id, status, checks, metrics }
}
