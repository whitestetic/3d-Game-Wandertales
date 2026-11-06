// Automatic fitting of the PROVIDED blockout assets onto the master character.
// Each rule maps the asset into a body region, pushes it out of the body, then binds it the right way
// (weight transfer for deforming cloth, single-bone for rigid items, per-side bones for pairs, gradient for capes).
import { basename } from 'node:path'
import { worldVertices } from './inspect.ts'
import {
  J, Surface, add, boxOf, conform, dot, io, ji, rigidWeights, scl, sub, transferWeights,
  type AssetDef, type Body, type Channel, type Part, type V3,
} from './lib.ts'

type Rule =
  | { fit: 'stretch'; box: { min: V3; max: V3 } }
  | { fit: 'anchor'; at: V3; width: number }
  | { fit: 'pair'; at: V3; width: number; floor?: boolean }
type Bind = { kind: 'rigid'; bone: string } | { kind: 'pair'; right: string; left: string } | { kind: 'transfer'; bones: string[] } | { kind: 'cape' }

interface FitSpec { id: string; name: string; category: AssetDef['category']; slot: string; rule: Rule; bind: Bind; margin?: number; conform?: boolean }

const TORSO = [J.spine, J.spine1, J.chest, J.hips, J.rShoulder, J.lShoulder]
const B = (min: V3, max: V3) => ({ min, max })

export const FIT_SPECS: FitSpec[] = [
  { id: 'hair_messy_brown', name: 'Messy Brown Hair (kit)', category: 'hair', slot: 'hair', rule: { fit: 'stretch', box: B([-0.17, 0.33, -0.147], [0.17, 0.49, 0.147]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.006, conform: true },
  { id: 'hair_short_black', name: 'Short Black Hair (kit)', category: 'hair', slot: 'hair', rule: { fit: 'stretch', box: B([-0.167, 0.35, -0.145], [0.167, 0.488, 0.145]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.006, conform: true },
  { id: 'hat_farmer_straw', name: 'Straw Farmer Hat (kit)', category: 'headwear', slot: 'headwear', rule: { fit: 'anchor', at: [0, 0.44, 0.005], width: 0.4 }, bind: { kind: 'rigid', bone: J.head }, margin: 0.004, conform: true },
  { id: 'hat_baker_cream', name: 'Baker Cap (kit)', category: 'headwear', slot: 'headwear', rule: { fit: 'stretch', box: B([-0.13, 0.4, -0.125], [0.13, 0.52, 0.125]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.004, conform: true },
  { id: 'tunic_forest', name: 'Forest Tunic (kit)', category: 'clothing', slot: 'torso', rule: { fit: 'stretch', box: B([-0.09, 0.05, -0.07], [0.09, 0.215, 0.09]) }, bind: { kind: 'transfer', bones: TORSO }, margin: 0.005, conform: true },
  { id: 'apron_baker', name: 'Baker Apron (kit)', category: 'clothing', slot: 'apron', rule: { fit: 'stretch', box: B([-0.07, 0.04, 0.075], [0.07, 0.2, 0.095]) }, bind: { kind: 'transfer', bones: TORSO }, margin: 0.006, conform: true },
  { id: 'apron_blacksmith', name: 'Blacksmith Apron (kit)', category: 'clothing', slot: 'apron', rule: { fit: 'stretch', box: B([-0.075, 0.03, 0.078], [0.075, 0.2, 0.1]) }, bind: { kind: 'transfer', bones: TORSO }, margin: 0.007, conform: true },
  { id: 'belt_pouch', name: 'Belt & Pouch (kit)', category: 'accessory', slot: 'waist', rule: { fit: 'stretch', box: B([-0.1, 0.06, -0.072], [0.11, 0.115, 0.098]) }, bind: { kind: 'transfer', bones: [J.hips] }, margin: 0.005, conform: true },
  { id: 'cape_traveler', name: 'Traveler Cape (kit)', category: 'accessory', slot: 'back', rule: { fit: 'stretch', box: B([-0.085, 0.04, -0.092], [0.085, 0.205, -0.066]) }, bind: { kind: 'cape' }, margin: 0.006, conform: true },
  { id: 'shoulder_guard_pair', name: 'Shoulder Guards (kit)', category: 'armor', slot: 'shoulders', rule: { fit: 'pair', at: [0.07, 0.192, -0.002], width: 0.065 }, bind: { kind: 'pair', right: J.rArm, left: J.lArm }, margin: 0.004, conform: true },
  { id: 'boots_leather_pair', name: 'Leather Boots (kit)', category: 'footwear', slot: 'feet', rule: { fit: 'pair', at: [0.045, 0.02, 0.016], width: 0.064, floor: true }, bind: { kind: 'transfer', bones: [J.rFoot, J.lFoot, J.rToe, J.lToe, J.rLeg, J.lLeg] }, margin: 0.004, conform: true },
  { id: 'guild_medallion', name: 'Guild Medallion (kit)', category: 'accessory', slot: 'neck', rule: { fit: 'anchor', at: [0, 0.172, 0.072], width: 0.045 }, bind: { kind: 'rigid', bone: J.chest }, margin: 0.003, conform: true },
  { id: 'hair_long_braid', name: 'Long Braid (expansion)', category: 'hair', slot: 'hair', rule: { fit: 'stretch', box: B([-0.168, 0.25, -0.17], [0.168, 0.49, 0.15]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.006, conform: true },
  { id: 'hair_twin_buns', name: 'Twin Buns (expansion)', category: 'hair', slot: 'hair', rule: { fit: 'stretch', box: B([-0.21, 0.33, -0.147], [0.21, 0.49, 0.147]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.006, conform: true },
  { id: 'hair_mage_swept', name: 'Mage Swept Hair (expansion)', category: 'hair', slot: 'hair', rule: { fit: 'stretch', box: B([-0.168, 0.31, -0.155], [0.168, 0.5, 0.15]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.006, conform: true },
  { id: 'outfit_ranger_vest', name: 'Ranger Vest (expansion)', category: 'clothing', slot: 'torso', rule: { fit: 'stretch', box: B([-0.09, 0.06, -0.07], [0.09, 0.215, 0.09]) }, bind: { kind: 'transfer', bones: TORSO }, margin: 0.006, conform: true },
  { id: 'outfit_mage_robe', name: 'Enchanter Robe (expansion)', category: 'clothing', slot: 'torso', rule: { fit: 'stretch', box: B([-0.1, 0.01, -0.075], [0.1, 0.215, 0.095]) }, bind: { kind: 'transfer', bones: [...TORSO, J.rUpLeg, J.lUpLeg] }, margin: 0.006, conform: true },
  { id: 'outfit_knight_surcoat', name: 'Knight Surcoat (expansion)', category: 'clothing', slot: 'torso', rule: { fit: 'stretch', box: B([-0.095, 0.035, -0.072], [0.095, 0.215, 0.092]) }, bind: { kind: 'transfer', bones: TORSO }, margin: 0.006, conform: true },
  { id: 'outfit_traveler_coat', name: 'Traveler Coat (expansion)', category: 'clothing', slot: 'torso', rule: { fit: 'stretch', box: B([-0.095, 0.03, -0.072], [0.095, 0.215, 0.092]) }, bind: { kind: 'transfer', bones: TORSO }, margin: 0.007, conform: true },
  { id: 'accessory_circlet', name: 'Moonstone Circlet (expansion)', category: 'headwear', slot: 'headwear', rule: { fit: 'stretch', box: B([-0.145, 0.355, 0.08], [0.145, 0.395, 0.15]) }, bind: { kind: 'rigid', bone: J.head }, margin: 0.004, conform: true },
  { id: 'accessory_crystal_pendant', name: 'Crystal Pendant (expansion)', category: 'accessory', slot: 'neck', rule: { fit: 'anchor', at: [0, 0.18, 0.07], width: 0.06 }, bind: { kind: 'rigid', bone: J.chest }, margin: 0.003, conform: true },
  { id: 'accessory_sapphire_earrings', name: 'Sapphire Earrings (expansion)', category: 'accessory', slot: 'ears', rule: { fit: 'pair', at: [0.15, 0.25, 0.02], width: 0.022 }, bind: { kind: 'rigid', bone: J.head }, margin: 0.003, conform: true },
  { id: 'accessory_scarf', name: 'Crimson Scarf (expansion)', category: 'accessory', slot: 'neck', rule: { fit: 'anchor', at: [0, 0.195, 0.03], width: 0.12 }, bind: { kind: 'transfer', bones: [J.chest, J.neck, J.spine1] }, margin: 0.005, conform: true },
  { id: 'accessory_bronze_pauldron_pair', name: 'Bronze Pauldrons (expansion)', category: 'armor', slot: 'shoulders', rule: { fit: 'pair', at: [0.07, 0.19, -0.002], width: 0.07 }, bind: { kind: 'pair', right: J.rArm, left: J.lArm }, margin: 0.004, conform: true },
  { id: 'accessory_adventurer_pack', name: 'Adventurer Pack (expansion)', category: 'accessory', slot: 'back', rule: { fit: 'anchor', at: [0, 0.14, -0.088], width: 0.1 }, bind: { kind: 'rigid', bone: J.chest }, margin: 0.004, conform: true },
]

interface SrcTri { a: V3; b: V3; c: V3; color: string }

/** Read an asset GLB into colored triangles in world space (material color or vertex color). */
async function readTriangles(file: string): Promise<SrcTri[]> {
  const doc = await io.read(file)
  const out: SrcTri[] = []
  const toHex = (c: number[]) => '#' + c.slice(0, 3).map((x) => Math.round(Math.pow(Math.max(0, Math.min(1, x)), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('')
  for (const m of worldVertices(doc)) {
    const idx = m.prim.getIndices()
    const ids = idx ? Array.from({ length: idx.getCount() }, (_, i) => idx.getScalar(i)) : m.pts.map((_, i) => i)
    const col = m.prim.getAttribute('COLOR_0')
    const matColor = toHex(m.prim.getMaterial()?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1])
    for (let i = 0; i < ids.length; i += 3) {
      const color = col ? toHex(col.getElement(ids[i], [])) : matColor
      out.push({ a: m.pts[ids[i]], b: m.pts[ids[i + 1]], c: m.pts[ids[i + 2]], color })
    }
  }
  return out
}

function placer(rule: Rule, src: { min: V3; max: V3 }, pts: V3[]): (p: V3) => V3 {
  const size = sub(src.max, src.min), c = scl(add(src.min, src.max), 0.5)
  if (rule.fit === 'stretch') {
    const t = rule.box
    return (p) => [0, 1, 2].map((k) => t.min[k] + ((p[k] - src.min[k]) / (size[k] || 1)) * (t.max[k] - t.min[k])) as V3
  }
  if (rule.fit === 'anchor') {
    const s = rule.width / (size[0] || 1)
    return (p) => add(rule.at, scl(sub(p, c), s))
  }
  // pair: each side keeps its shape, scaled uniformly and centred on its own anchor
  const right = pts.filter((p) => p[0] < c[0]), left = pts.filter((p) => p[0] >= c[0])
  const rb = boxOf(right), lb = boxOf(left)
  const rc = scl(add(rb.min, rb.max), 0.5), lc = scl(add(lb.min, lb.max), 0.5)
  const s = rule.width / Math.max(1e-6, rb.max[0] - rb.min[0], lb.max[0] - lb.min[0])
  const lift = rule.floor ? Math.max(0, -Math.min(rule.at[1] + (rb.min[1] - rc[1]) * s, rule.at[1] + (lb.min[1] - lc[1]) * s)) : 0
  return (p) => add(p[0] < c[0] ? add([-rule.at[0], rule.at[1], rule.at[2]], scl(sub(p, rc), s)) : add(rule.at, scl(sub(p, lc), s)), [0, lift, 0])
}

const CHANNELS: Channel[] = ['primary', 'secondary', 'trim', 'leather', 'metal', 'gem', 'dark', 'cloth']

export async function fitProvided(b: Body, files: string[]): Promise<(AssetDef & { sourceFile: string; sourceVertices: number })[]> {
  const surface = new Surface(b.verts, b.tris, b.normals)
  const out = []
  for (const spec of FIT_SPECS) {
    const file = files.find((f) => basename(f, '.glb') === spec.id)
    if (!file) continue
    let tris = await readTriangles(file)
    const notes: string[] = []
    // a hat whose source is thin in Z but tall in Y is lying on its side: stand it up before fitting
    const sb = boxOf(tris.flatMap((t) => [t.a, t.b, t.c]))
    if (spec.category === 'headwear' && spec.rule.fit !== 'stretch' && sb.max[1] - sb.min[1] > (sb.max[2] - sb.min[2]) * 1.5) {
      const cy = (sb.min[1] + sb.max[1]) / 2, cz = (sb.min[2] + sb.max[2]) / 2
      const r = (p: V3): V3 => [p[0], cy + (p[2] - cz), cz - (p[1] - cy)]
      tris = tris.map((t) => ({ ...t, a: r(t.a), b: r(t.b), c: r(t.c) }))
      notes.push('Source was lying on its side (thin in Z, tall in Y); rotated 90 degrees about X before fitting.')
    }
    const pts = tris.flatMap((t) => [t.a, t.b, t.c])
    const place = placer(spec.rule, boxOf(pts), pts)
    // weld identical source vertices so the mesh stays connected after conforming
    const key = (p: V3) => p.map((v) => v.toFixed(6)).join(',')
    const byColor = new Map<string, { pos: V3[]; idx: number[]; map: Map<string, number> }>()
    for (const t of tris) {
      let g = byColor.get(t.color)
      if (!g) { g = { pos: [], idx: [], map: new Map() }; byColor.set(t.color, g) }
      for (const v of [t.a, t.b, t.c]) {
        const k = key(v)
        if (!g.map.has(k)) { g.map.set(k, g.pos.length); g.pos.push(place(v)) }
        g.idx.push(g.map.get(k)!)
      }
    }
    const colors: Partial<Record<Channel, string>> = {}
    const parts: Part[] = []
    let moved = 0
    ;[...byColor.entries()].sort((x, y) => y[1].idx.length - x[1].idx.length).forEach(([color, g], n) => {
      const channel = CHANNELS[Math.min(n, CHANNELS.length - 1)]
      colors[channel] = color
      let pos = g.pos
      if (spec.conform) { const c = conform(surface, pos, spec.margin ?? 0.005); pos = c.pts; moved += c.moved }
      let jw: Part['jw']
      const bind = spec.bind
      if (bind.kind === 'rigid') jw = rigidWeights(b, bind.bone, pos.length)
      // pair (shoulder guards/pauldrons): blend shoulder↔arm by position along that axis, not 100% arm — a plate
      // rigid to the upper arm alone swings away from the torso and self-clips when the arm lifts (QC: up to
      // 39-45% of the item overlapped by the other side of the body in "arms_up"); the inner cap should stay put.
      else if (bind.kind === 'pair') {
        jw = pos.map((p) => {
          const right = p[0] < 0
          const armBone = right ? bind.right : bind.left, shoulderBone = right ? J.rShoulder : J.lShoulder
          const sp = b.jointPos[shoulderBone], ap = b.jointPos[armBone]
          const axis = sub(ap, sp), len2 = dot(axis, axis) || 1
          const t = Math.max(0, Math.min(1, dot(sub(p, sp), axis) / len2))
          return { j: [ji(b, shoulderBone), ji(b, armBone), 0, 0], w: [1 - t, t, 0, 0] }
        })
      }
      else if (bind.kind === 'transfer') jw = transferWeights(b, pos, bind.bones)
      else {
        const chest = ji(b, J.chest), spine = ji(b, J.spine1), hips = ji(b, J.hips)
        jw = pos.map((p) => p[1] > 0.16 ? { j: [chest, 0, 0, 0], w: [1, 0, 0, 0] } : p[1] > 0.11 ? { j: [chest, spine, 0, 0], w: [(p[1] - 0.11) / 0.05, 1 - (p[1] - 0.11) / 0.05, 0, 0] } : { j: [spine, hips, 0, 0], w: [Math.max(0, (p[1] - 0.05) / 0.06), 1 - Math.max(0, (p[1] - 0.05) / 0.06), 0, 0] })
      }
      parts.push({ name: `part${n}`, channel, pos, idx: g.idx, jw })
    })
    const method: AssetDef['method'] = spec.bind.kind === 'rigid' ? 'rigid_bone' : spec.bind.kind === 'pair' ? 'rigid_multi_bone' : spec.bind.kind === 'cape' ? 'hybrid' : 'weight_transfer'
    out.push({
      id: spec.id, name: spec.name, category: spec.category, slot: spec.slot, method, source: 'provided_blockout' as const, colors, parts,
      sourceFile: file, sourceVertices: new Set(pts.map(key)).size,
      attachBones: spec.bind.kind === 'rigid' ? [spec.bind.bone] : spec.bind.kind === 'pair' ? [spec.bind.right, spec.bind.left, J.rShoulder, J.lShoulder] : undefined,
      notes: [...notes, `Fit rule: ${spec.rule.fit}; binding: ${spec.bind.kind}; ${moved} vertices pushed out of the body.`],
    })
  }
  return out
}
