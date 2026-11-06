// PHASE 1 — automatic inspection of the master character and every modular asset GLB.
// Run: node scripts/pipeline/inspect.ts   → reports/inspection.json + reports/inspection.md
import { NodeIO, type Document, type Node, type Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const MASTER = join(ROOT, 'assets/characters/base/source/chibi_base_mesh_rigged.glb')
export const INPUT_DIRS = [join(ROOT, 'incoming/kit_v2/wt_work/assets/glb'), join(ROOT, 'incoming/expansion_v1/WanderTales_Expansion_v1/assets/glb')]
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

type V3 = [number, number, number]
const mul = (a: number[], b: number[]) => { // column-major 4x4
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
export const worldMatrix = (n: Node): number[] => n.getWorldMatrix() as unknown as number[]
export const apply = (m: number[], p: V3): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]
void mul

export function bounds(points: V3[]) {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]) }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as V3 }
}
const r3 = (v: number[]) => v.map((x) => Math.round(x * 10000) / 10000)

/** World-space positions of every vertex of every mesh in the scene (bind pose). */
export function worldVertices(doc: Document) {
  const out: { mesh: string; prim: Primitive; node: Node; pts: V3[] }[] = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    // skinned meshes are drawn in bind pose = node-local positions transformed by the skin's bind; for inspection use node world matrix
    const m = worldMatrix(node)
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!
      const pts: V3[] = []
      for (let i = 0; i < pos.getCount(); i++) pts.push(apply(m, pos.getElement(i, []) as V3))
      out.push({ mesh: mesh.getName() || node.getName(), prim, node, pts })
    }
  }
  return out
}

export function hierarchy(doc: Document) {
  const lines: string[] = []
  const walk = (n: Node, d: number) => {
    const tags = [n.getMesh() ? `mesh:${n.getMesh()!.getName()}` : '', n.getSkin() ? 'skinned' : ''].filter(Boolean).join(' ')
    lines.push(`${'  '.repeat(d)}${n.getName() || '(unnamed)'}${tags ? ` [${tags}]` : ''}`)
    n.listChildren().forEach((c) => walk(c, d + 1))
  }
  for (const s of doc.getRoot().listScenes()) s.listChildren().forEach((n) => walk(n, 0))
  return lines
}

export async function inspectMaster() {
  const doc = await io.read(MASTER)
  const root = doc.getRoot()
  const skins = root.listSkins()
  const skin = skins[0]
  const joints = skin ? skin.listJoints() : []
  const jointInfo = joints.map((j, idx) => {
    const wp = apply(worldMatrix(j), [0, 0, 0])
    return { idx, name: j.getName(), parent: j.getParentNode()?.getName() ?? null, worldPos: r3(wp) as V3, children: j.listChildren().map((c) => c.getName()) }
  })

  // vertices, weights, and which joint dominates each vertex
  const meshes = worldVertices(doc)
  const weightIssues: string[] = []
  const regions: Record<string, V3[]> = {}
  let totalVerts = 0, totalTris = 0
  for (const m of meshes) {
    totalVerts += m.pts.length
    const idx = m.prim.getIndices()
    totalTris += (idx ? idx.getCount() : m.pts.length) / 3
    const J = m.prim.getAttribute('JOINTS_0'), W = m.prim.getAttribute('WEIGHTS_0')
    if (!J || !W) { weightIssues.push(`${m.mesh}: no JOINTS_0/WEIGHTS_0`); continue }
    let bad = 0
    for (let i = 0; i < m.pts.length; i++) {
      const j = J.getElement(i, []), w = W.getElement(i, [])
      const sum = w.reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 1) > 0.01) bad++
      let best = 0
      for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k
      const name = joints[j[best]]?.getName() ?? `joint${j[best]}`
      ;(regions[name] ??= []).push(m.pts[i])
    }
    if (bad) weightIssues.push(`${m.mesh}: ${bad} vertices whose weights don't sum to 1`)
  }
  const all = meshes.flatMap((m) => m.pts)
  const b = bounds(all)
  const regionBounds = Object.fromEntries(Object.entries(regions).map(([k, pts]) => [k, { vertices: pts.length, ...Object.fromEntries(Object.entries(bounds(pts)).map(([kk, v]) => [kk, r3(v)])) }]))

  return {
    file: basename(MASTER),
    bytes: statSync(MASTER).size,
    generator: root.getAsset().generator,
    hierarchy: hierarchy(doc),
    scenes: root.listScenes().length,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().map((m) => ({ name: m.getName(), primitives: m.listPrimitives().map((p) => ({ attributes: p.listSemantics(), vertices: p.getAttribute('POSITION')!.getCount(), material: p.getMaterial()?.getName() ?? null, morphTargets: p.listTargets().length })) })),
    materials: root.listMaterials().map((m) => ({ name: m.getName(), baseColor: r3(m.getBaseColorFactor()), texture: !!m.getBaseColorTexture(), metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(), alphaMode: m.getAlphaMode() })),
    textures: root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize() })),
    animations: root.listAnimations().map((a) => a.getName()),
    skins: skins.length,
    jointCount: joints.length,
    joints: jointInfo,
    totalVertices: totalVerts,
    totalTriangles: totalTris,
    bounds: { min: r3(b.min), max: r3(b.max), size: r3(b.size) },
    weightIssues,
    dominantJointRegions: regionBounds,
  }
}

export async function inspectAsset(file: string) {
  const doc = await io.read(file)
  const root = doc.getRoot()
  const meshes = worldVertices(doc)
  const all = meshes.flatMap((m) => m.pts)
  const b = bounds(all)
  return {
    id: basename(file, '.glb'),
    file,
    bytes: statSync(file).size,
    hierarchy: hierarchy(doc),
    meshes: meshes.map((m) => ({ name: m.mesh, vertices: m.pts.length, attributes: m.prim.listSemantics(), material: m.prim.getMaterial()?.getName() ?? null })),
    materials: root.listMaterials().map((m) => ({ name: m.getName(), baseColor: r3(m.getBaseColorFactor()) })),
    skins: root.listSkins().length,
    vertexColors: meshes.some((m) => m.prim.getAttribute('COLOR_0')),
    totalVertices: all.length,
    bounds: { min: r3(b.min), max: r3(b.max), size: r3(b.size), center: r3(b.min.map((v, i) => (v + b.max[i]) / 2)) },
  }
}

export const listAssetFiles = () => INPUT_DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.glb')).map((f) => join(d, f)))

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('inspect.ts')) {
  const master = await inspectMaster()
  const assets = []
  for (const f of listAssetFiles()) assets.push(await inspectAsset(f))
  mkdirSync(join(ROOT, 'reports'), { recursive: true })
  writeFileSync(join(ROOT, 'reports/inspection.json'), JSON.stringify({ generatedAt: new Date().toISOString(), master, assets }, null, 2))
  console.log(JSON.stringify({ ...master, hierarchy: master.hierarchy.slice(0, 80), dominantJointRegions: Object.keys(master.dominantJointRegions) }, null, 1).slice(0, 9000))
  console.log('\nASSETS')
  for (const a of assets) console.log(a.id.padEnd(34), String(a.totalVertices).padStart(5), 'v', 'skins', a.skins, 'vc', a.vertexColors, 'size', a.bounds.size.join(','), 'center', a.bounds.center.join(','), 'mats', a.materials.map((m) => m.name).join('|'))
}
