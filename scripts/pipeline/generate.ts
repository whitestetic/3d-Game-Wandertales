// Automatic modular asset production: low-poly fantasy items built directly on the master body.
// Each item declares HOW it follows the rig (shell_copy_weights / rigid_bone / rigid_multi_bone / hybrid).
import {
  J, Surface, conform, add, box, cylinder, ji, merge, norm, panel, rigidWeights, rotX, rotZ, shell, sphere, torus, transferWeights, xform, move,
  type AssetDef, type Body, type Channel, type Geo, type Part, type V3,
} from './lib.ts'

const TORSO = [J.spine, J.spine1, J.chest, J.hips]
const SHOULDERS = [J.rShoulder, J.lShoulder]
const UPPER_ARMS = [J.rArm, J.lArm]
const FOREARMS = [J.rForeArm, J.lForeArm]
const HANDS = [J.rHand, J.lHand, 'RightHandIndex1_012', 'RightHandIndex3_014', 'Left_HandIndex1_020', 'Left_HandIndex3_022']
const LEGS = [J.rUpLeg, J.lUpLeg, J.rLeg, J.lLeg]
const FEET = [J.rFoot, J.lFoot, J.rToe, J.lToe]

const hashN = (i: number, s = 1) => { let h = (i * 2654435761 + s * 97) >>> 0; h ^= h >>> 15; return (h % 1000) / 1000 }

export interface SkirtInfo { y0: number; y1: number; r0: number; r1: number }
export type GenDef = AssetDef & { skirt?: SkirtInfo }

// ---------- part helpers ----------
const rigid = (b: Body, name: string, channel: Channel, g: Geo, bone: string): Part => ({ name, channel, pos: g.pos, idx: g.idx, jw: rigidWeights(b, bone, g.pos.length) })
const skinned = (b: Body, name: string, channel: Channel, g: Geo, allowed?: string[]): Part => ({ name, channel, pos: g.pos, idx: g.idx, jw: transferWeights(b, g.pos, allowed) })
/** Shell part: body surface copy that keeps the body's exact weights (deforms identically). */
function shellPart(b: Body, name: string, channel: Channel, keep: (i: number, p: V3) => boolean, offset: number | ((i: number, p: V3) => number), rigidBone?: string): Part {
  const g = shell(b, (i) => keep(i, b.verts[i]), typeof offset === 'number' ? () => offset : offset)
  return { name, channel, pos: g.pos, idx: g.idx, jw: rigidBone ? rigidWeights(b, rigidBone, g.pos.length) : g.src.map((i) => ({ j: [...b.jw[i].j], w: [...b.jw[i].w] })) }
}
/** Skirt/robe tail: open cone around the hips, weights blend hips → upper legs by height so strides bend it. */
function skirtPart(b: Body, name: string, channel: Channel, y0: number, y1: number, r0: number, r1: number, seg = 10): Part {
  const zc = 0.008
  const g = cylinder([0, y1, zc], r1, r0, y0 - y1, seg, false, 1, 0.85)
  const hips = ji(b, J.hips), rl = ji(b, J.rUpLeg), ll = ji(b, J.lUpLeg)
  const jw = g.pos.map((p) => {
    const t = Math.max(0, Math.min(1, (y0 - p[1]) / (y0 - y1))) * 0.45 // bottom edge: up to 45% leg influence
    const leg = p[0] < 0 ? rl : ll
    return Math.abs(p[0]) < 0.01 ? { j: [hips, 0, 0, 0], w: [1, 0, 0, 0] } : { j: [hips, leg, 0, 0], w: [1 - t, t, 0, 0] }
  })
  return { name, channel, pos: g.pos, idx: g.idx, jw }
}
/** Gradient weights down the back (cape). */
function capePart(b: Body, name: string, channel: Channel, g: Geo): Part {
  const chest = ji(b, J.chest), spine = ji(b, J.spine1), hips = ji(b, J.hips)
  return {
    name, channel, pos: g.pos, idx: g.idx, jw: g.pos.map((p) => {
      if (p[1] > 0.16) return { j: [chest, 0, 0, 0], w: [1, 0, 0, 0] }
      if (p[1] > 0.11) { const t = (0.16 - p[1]) / 0.05; return { j: [chest, spine, 0, 0], w: [1 - t, t, 0, 0] } }
      const t = Math.min(1, (0.11 - p[1]) / 0.06); return { j: [spine, hips, 0, 0], w: [1 - t, t, 0, 0] }
    }),
  }
}

// ---------- region selectors ----------
const inBones = (b: Body, bones: string[]) => (i: number) => bones.includes(b.dominant[i])
const isHead = (b: Body) => inBones(b, [J.head])
/** Hair covers the crown, sides and back of the head, never the face. */
const hairZone = (b: Body, crownY = 0.372, backY = 0.25, frontZ = 0.035) => (i: number, p: V3) => isHead(b)(i) && (p[1] > crownY || (p[2] < frontZ && p[1] > backY))
/** Fringe: a thicker shell over the forehead band just above the eyes. */
const bangs = (b: Body, channel: Channel, depth = 0.025): Part =>
  shellPart(b, 'bangs', channel, (i, p) => isHead(b)(i) && p[2] > 0.03 && p[1] > 0.345 && p[1] < 0.405, 0.006 + depth * 0.5, J.head)

// ---------- the catalog ----------
export function generateAll(b: Body): GenDef[] {
  const defs = catalog(b)
  // every generated piece sits ON the body: push any vertex that ended up inside it back out
  const surface = new Surface(b.verts, b.tris, b.normals)
  for (const d of defs) for (const p of d.parts) p.pos = conform(surface, p.pos, 0.003).pts
  return defs
}

function catalog(b: Body): GenDef[] {
  const out: GenDef[] = []
  const add1 = (d: GenDef) => out.push(d)
  const H = J.head

  // ===== HAIR (rigid on Head — hair must follow the head exactly) =====
  add1({ id: 'hair_short', name: 'Short Hair', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#4a2c1c' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.37, 0.27), 0.009, H), bangs(b, 'hair', 0.02)] })
  add1({ id: 'hair_long', name: 'Long Hair', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#8a4b2a' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.36, 0.22), 0.011, H), bangs(b, 'hair'),
      rigid(b, 'back', 'hair', xform(cylinder([0, 0.205, -0.07], 0.13, 0.15, 0.13, 10, false, 1, 0.55), (p) => p), H)] })
  add1({ id: 'hair_ponytail', name: 'Ponytail', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#2b2220', trim: '#c94f4f' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.365, 0.25), 0.01, H), bangs(b, 'hair', 0.018),
      rigid(b, 'tie', 'trim', torus([0, 0.37, -0.145], 0.018, 0.006, 8, 4), H),
      rigid(b, 'tail', 'hair', xform(cylinder([0, 0.24, -0.16], 0.012, 0.028, 0.13, 7), rotX(-18, [0, 0.37, -0.15])), H)] })
  add1({ id: 'hair_twin_tails', name: 'Twin Tails', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#e5c06e', trim: '#4f6fb0' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.365, 0.26), 0.01, H), bangs(b, 'hair'),
      ...[-1, 1].flatMap((s) => [
        rigid(b, `tie${s}`, 'trim', sphere([s * 0.15, 0.39, -0.04], 0.016, 6, 4), H),
        rigid(b, `tail${s}`, 'hair', xform(cylinder([s * 0.17, 0.22, -0.05], 0.01, 0.03, 0.16, 7), rotZ(s * 12, [s * 0.15, 0.39, -0.04])), H)])] })
  add1({ id: 'hair_braided', name: 'Braided Hair', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#6b3e22', trim: '#d9b45a' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.365, 0.25), 0.01, H), bangs(b, 'hair', 0.018),
      rigid(b, 'braid', 'hair', merge(...[0, 1, 2, 3, 4, 5].map((k) => sphere([((k % 2) - 0.5) * 0.008, 0.33 - k * 0.028, -0.15 - k * 0.006], 0.02 - k * 0.0015, 6, 4))), H),
      rigid(b, 'band', 'trim', torus([0, 0.18, -0.183], 0.012, 0.004, 8, 3), H)] })
  add1({ id: 'hair_messy', name: 'Messy Hair', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#6b3e22' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.36, 0.26), (i) => 0.008 + hashN(i) * 0.014, H), bangs(b, 'hair', 0.03),
      rigid(b, 'tufts', 'hair', merge(...[0, 1, 2, 3, 4, 5].map((k) => xform(cylinder([Math.cos(k) * 0.08, 0.44, Math.sin(k) * 0.07], 0.022, 0, 0.05, 4), rotZ((k - 2.5) * 14, [0, 0.44, 0])))), H)] })
  add1({ id: 'hair_curly', name: 'Curly Hair', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#3a2416' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.36, 0.24), 0.012, H),
      rigid(b, 'curls', 'hair', merge(...Array.from({ length: 14 }, (_, k) => {
        const a = (k / 14) * Math.PI * 2, y = 0.36 + (k % 3) * 0.035
        const r = 0.15 - (k % 3) * 0.02
        return sphere([Math.cos(a) * r, y, Math.sin(a) * r * 0.95 - 0.01], 0.03, 6, 4)
      }).filter((g) => g.pos[0][2] < 0.09 || g.pos[0][1] > 0.4)), H)] })
  add1({ id: 'hair_fantasy_spiky', name: 'Fantasy Spiky Hair', category: 'hair', slot: 'hair', method: 'rigid_bone', source: 'generated', colors: { hair: '#4f6fb0', gem: '#ffffff' },
    parts: [shellPart(b, 'cap', 'hair', hairZone(b, 0.36, 0.26), 0.01, H), bangs(b, 'hair', 0.025),
      rigid(b, 'spikes', 'hair', merge(...Array.from({ length: 9 }, (_, k) => {
        const a = -Math.PI * 0.9 + (k / 8) * Math.PI * 0.8
        return xform(cylinder([Math.cos(a) * 0.09, 0.41, Math.sin(a) * 0.09], 0.028, 0, 0.09, 4), rotX(-Math.sin(a) * 35, [0, 0.41, 0]))
      })), H),
      rigid(b, 'streak', 'gem', box([0.05, 0.42, 0.12], [0.015, 0.05, 0.012]), H)] })

  // ===== HEADWEAR (rigid on Head) =====
  add1({ id: 'hat_farmer', name: 'Farmer Hat', category: 'headwear', slot: 'headwear', method: 'rigid_bone', source: 'generated', colors: { primary: '#e0c066', trim: '#9c3d3d' },
    parts: [rigid(b, 'brim', 'primary', cylinder([0, 0.405, 0], 0.215, 0.2, 0.008, 12), H),
      rigid(b, 'crown', 'primary', cylinder([0, 0.41, 0], 0.115, 0.1, 0.075, 10), H),
      rigid(b, 'band', 'trim', cylinder([0, 0.413, 0], 0.117, 0.116, 0.016, 10, false), H)] })
  add1({ id: 'hat_wizard', name: 'Wizard Hat', category: 'headwear', slot: 'headwear', method: 'rigid_bone', source: 'generated', colors: { primary: '#5b3d8a', trim: '#e7c35b' },
    parts: [rigid(b, 'brim', 'primary', cylinder([0, 0.415, 0], 0.2, 0.19, 0.008, 12), H),
      rigid(b, 'cone', 'primary', xform(cylinder([0, 0.42, 0], 0.12, 0, 0.22, 10), rotX(-14, [0, 0.42, 0])), H),
      rigid(b, 'band', 'trim', cylinder([0, 0.422, 0], 0.118, 0.112, 0.018, 10, false), H),
      rigid(b, 'star', 'trim', sphere([0, 0.47, 0.105], 0.012, 4, 2), H)] })
  add1({ id: 'hood', name: 'Hood', category: 'headwear', slot: 'headwear', method: 'hybrid', source: 'generated', colors: { primary: '#4f6b45' },
    parts: [shellPart(b, 'hood', 'primary', (i, p) => isHead(b)(i) && (p[1] > 0.395 || p[2] < 0.06), 0.022, H),
      skinned(b, 'drape', 'primary', cylinder([0, 0.17, -0.005], 0.07, 0.11, 0.05, 10, false, 1, 0.9), [J.chest, J.neck, J.spine1])],
    notes: ['Hood shell is rigid on the head; the neck drape copies chest/neck weights.'] })
  add1({ id: 'helmet_iron', name: 'Iron Helmet', category: 'headwear', slot: 'headwear', method: 'rigid_bone', source: 'generated', colors: { metal: '#9aa0a8', trim: '#c94f4f' },
    parts: [shellPart(b, 'dome', 'metal', (i, p) => isHead(b)(i) && (p[1] > 0.375 || (p[2] < 0.05 && p[1] > 0.29)), 0.018, H),
      rigid(b, 'nose', 'metal', box([0, 0.35, 0.15], [0.016, 0.06, 0.012]), H),
      rigid(b, 'crest', 'trim', box([0, 0.5, -0.01], [0.012, 0.04, 0.16]), H)] })
  add1({ id: 'crown_gold', name: 'Royal Crown', category: 'headwear', slot: 'headwear', method: 'rigid_bone', source: 'generated', colors: { metal: '#e7c35b', gem: '#c23b3b' },
    parts: [rigid(b, 'band', 'metal', cylinder([0, 0.425, 0.005], 0.112, 0.112, 0.03, 12, false, 1, 0.98), H),
      rigid(b, 'points', 'metal', merge(...Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2; return cylinder([Math.cos(a) * 0.11, 0.455, Math.sin(a) * 0.108 + 0.005], 0.018, 0, 0.035, 4) })), H),
      rigid(b, 'gems', 'gem', merge(...[0, 2, 4, 6].map((k) => { const a = (k / 8) * Math.PI * 2 + Math.PI / 2; return sphere([Math.cos(a) * 0.115, 0.44, Math.sin(a) * 0.113 + 0.005], 0.008, 5, 3) })), H)] })
  add1({ id: 'circlet_silver', name: 'Silver Circlet', category: 'headwear', slot: 'headwear', method: 'rigid_bone', source: 'generated', colors: { metal: '#d6d9de', gem: '#5fb3d6' },
    parts: [rigid(b, 'ring', 'metal', torus([0, 0.372, 0.0], 0.14, 0.005, 16, 4, 1, 0.99), H),
      rigid(b, 'gem', 'gem', sphere([0, 0.372, 0.145], 0.012, 6, 4), H)] })
  add1({ id: 'hat_adventurer', name: 'Adventurer Hat', category: 'headwear', slot: 'headwear', method: 'rigid_bone', source: 'generated', colors: { leather: '#7a4e2c', trim: '#c94f4f' },
    parts: [rigid(b, 'brim', 'leather', cylinder([0, 0.405, 0.005], 0.19, 0.17, 0.01, 10, true, 1, 0.85), H),
      rigid(b, 'crown', 'leather', cylinder([0, 0.41, 0], 0.112, 0.085, 0.065, 8), H),
      rigid(b, 'feather', 'trim', xform(panel([0.1, 0.43, -0.03], [0.012, 0.09, -0.02], [0.02, 0, 0], 1, 3), rotZ(-25, [0.1, 0.43, 0])), H)] })

  // ===== CLOTHING (shells keep the body's own weights) =====
  const torsoBand = (lo: number, hi: number) => (i: number, p: V3) => inBones(b, TORSO)(i) && p[1] >= lo && p[1] <= hi
  const withArms = (sets: string[]) => (i: number) => inBones(b, sets)(i)
  const collar = (ch: Channel, r = 0.038) => rigid(b, 'collar', ch, torus([0, 0.205, 0.004], r, 0.006, 10, 3, 1, 1.15), J.chest)
  const beltPart = (ch: Channel, y = 0.092) => skinned(b, 'belt', ch, cylinder([0, y, 0.01], 0.088, 0.088, 0.014, 12, false, 1, 0.85), [J.hips])

  add1({ id: 'shirt_linen', name: 'Linen Shirt', category: 'clothing', slot: 'torso', method: 'shell_copy_weights', source: 'generated', colors: { primary: '#f2e3c6', trim: '#c9a36a' },
    parts: [shellPart(b, 'shirt', 'primary', (i, p) => torsoBand(0.075, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS])(i), 0.004), collar('trim')] })
  add1({ id: 'tunic_green', name: 'Tunic', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#4f7a45', trim: '#d6c49a', leather: '#6b4a2e' },
    skirt: { y0: 0.075, y1: 0.04, r0: 0.087, r1: 0.1 },
    parts: [shellPart(b, 'body', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS])(i), 0.005),
      skirtPart(b, 'skirt', 'primary', 0.075, 0.04, 0.087, 0.1), beltPart('leather'), collar('trim')] })
  add1({ id: 'robe_plain', name: 'Robe', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#8a6f5a', trim: '#e8dcc8' },
    skirt: { y0: 0.085, y1: 0.006, r0: 0.09, r1: 0.122 },
    parts: [shellPart(b, 'body', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS, ...FOREARMS])(i), 0.006),
      skirtPart(b, 'skirt', 'primary', 0.085, 0.006, 0.09, 0.122, 12), skinned(b, 'hem', 'trim', cylinder([0, 0.006, 0.008], 0.123, 0.123, 0.01, 12, false, 1, 0.85), [J.hips])] })
  add1({ id: 'coat_traveler', name: 'Traveler Coat', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#7a5434', trim: '#d9b45a', secondary: '#f2e3c6' },
    skirt: { y0: 0.08, y1: 0.028, r0: 0.09, r1: 0.108 },
    parts: [shellPart(b, 'coat', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS, ...FOREARMS])(i), 0.008),
      skirtPart(b, 'tails', 'primary', 0.08, 0.028, 0.09, 0.108), collar('secondary', 0.042),
      skinned(b, 'buttons', 'trim', merge(...[0.17, 0.145, 0.12].map((y) => sphere([0, y, y > 0.15 ? 0.064 : 0.085], 0.005, 4, 3))), [J.chest, J.spine1])] })
  add1({ id: 'vest_leather', name: 'Leather Vest', category: 'clothing', slot: 'torso', method: 'shell_copy_weights', source: 'generated', colors: { leather: '#6b4a2e', trim: '#c9a36a' },
    parts: [shellPart(b, 'vest', 'leather', (i, p) => torsoBand(0.07, 0.212)(i, p) && !(Math.abs(p[0]) < 0.014 && p[2] > 0.02), 0.008)] })
  add1({ id: 'dress_simple', name: 'Simple Dress', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#cf7fa3', trim: '#f2e3c6' },
    skirt: { y0: 0.095, y1: 0.018, r0: 0.088, r1: 0.135 },
    parts: [shellPart(b, 'bodice', 'primary', (i, p) => torsoBand(0.085, 0.215)(i, p) || withArms([...SHOULDERS])(i), 0.005),
      skirtPart(b, 'skirt', 'primary', 0.095, 0.018, 0.088, 0.135, 12), skinned(b, 'hem', 'trim', cylinder([0, 0.018, 0.008], 0.136, 0.136, 0.008, 12, false, 1, 0.85), [J.hips]), collar('trim', 0.036)] })
  add1({ id: 'outfit_adventurer', name: 'Adventurer Outfit', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#3f7a8c', leather: '#7a4e2c', trim: '#d9b45a' },
    skirt: { y0: 0.075, y1: 0.04, r0: 0.087, r1: 0.1 },
    parts: [shellPart(b, 'tunic', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS])(i), 0.005),
      skirtPart(b, 'skirt', 'primary', 0.075, 0.04, 0.087, 0.1), beltPart('leather'),
      skinned(b, 'strap', 'leather', xform(box([0, 0.15, 0.072], [0.012, 0.13, 0.008]), rotZ(38, [0, 0.15, 0.072])), [J.chest, J.spine1]),
      shellPart(b, 'bracers', 'leather', (i) => inBones(b, FOREARMS)(i), 0.006)] })
  add1({ id: 'outfit_merchant', name: 'Merchant Outfit', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#f2e3c6', secondary: '#9c3d3d', trim: '#e7c35b' },
    skirt: { y0: 0.075, y1: 0.03, r0: 0.09, r1: 0.106 },
    parts: [shellPart(b, 'shirt', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS, ...FOREARMS])(i), 0.004),
      shellPart(b, 'vest', 'secondary', (i, p) => torsoBand(0.06, 0.205)(i, p) && !(Math.abs(p[0]) < 0.012 && p[2] > 0.02), 0.009),
      skirtPart(b, 'skirt', 'secondary', 0.075, 0.03, 0.09, 0.106), skinned(b, 'sash', 'trim', cylinder([0, 0.088, 0.01], 0.092, 0.092, 0.02, 12, false, 1, 0.85), [J.hips])] })
  add1({ id: 'outfit_mage', name: 'Mage Outfit', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#4f3d8a', trim: '#e7c35b', secondary: '#2f2a55' },
    skirt: { y0: 0.085, y1: 0.006, r0: 0.09, r1: 0.125 },
    parts: [shellPart(b, 'robe', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS, ...FOREARMS])(i), 0.006),
      skirtPart(b, 'skirt', 'primary', 0.085, 0.006, 0.09, 0.125, 12),
      rigid(b, 'collar', 'secondary', cylinder([0, 0.197, 0.004], 0.045, 0.06, 0.03, 10, false, 1, 1.1), J.chest),
      skinned(b, 'sash', 'trim', cylinder([0, 0.09, 0.01], 0.092, 0.092, 0.012, 12, false, 1, 0.85), [J.hips])] })
  add1({ id: 'outfit_ranger', name: 'Ranger Outfit', category: 'clothing', slot: 'torso', method: 'hybrid', source: 'generated', colors: { primary: '#3f6b3a', leather: '#5c4430', secondary: '#2f4a2a' },
    skirt: { y0: 0.075, y1: 0.04, r0: 0.087, r1: 0.1 },
    parts: [shellPart(b, 'tunic', 'primary', (i, p) => torsoBand(0.06, 0.215)(i, p) || withArms([...SHOULDERS, ...UPPER_ARMS])(i), 0.005),
      skirtPart(b, 'skirt', 'primary', 0.075, 0.04, 0.087, 0.1),
      shellPart(b, 'mantle', 'secondary', (i, p) => torsoBand(0.165, 0.215)(i, p) || withArms(SHOULDERS)(i), 0.011),
      shellPart(b, 'bracers', 'leather', (i) => inBones(b, FOREARMS)(i), 0.006), beltPart('leather')] })

  // aprons: front of the torso as a shell + a front skirt panel that follows hips and legs
  const apron = (id: string, name: string, ch: Channel, color: string, strap: string, bottom: number) => add1({
    id, name, category: 'clothing', slot: 'apron', method: 'hybrid', source: 'generated', colors: { [ch]: color, trim: strap },
    parts: [shellPart(b, 'bib', ch, (i, p) => torsoBand(0.07, 0.19)(i, p) && p[2] > 0.025 && Math.abs(p[0]) < 0.055, 0.011),
      skinned(b, 'skirt', ch, panel([-0.06, 0.082, 0.088], [0.12, 0, 0], [0, bottom - 0.082, 0.012], 3, 3), [J.hips, J.rUpLeg, J.lUpLeg]),
      skinned(b, 'strap', 'trim', cylinder([0, 0.088, 0.01], 0.09, 0.09, 0.008, 12, false, 1, 0.85), [J.hips])] })
  apron('apron_leather_work', 'Work Apron', 'leather', '#6b4a2e', '#3a2e26', 0.03)
  apron('apron_cloth', 'Cloth Apron', 'cloth', '#f2e3c6', '#c9a36a', 0.04)

  // ===== ARMOR =====
  add1({ id: 'armor_leather', name: 'Leather Armor', category: 'armor', slot: 'chest_armor', method: 'shell_copy_weights', source: 'generated', colors: { leather: '#7a4e2c', trim: '#c9a36a' },
    parts: [shellPart(b, 'cuirass', 'leather', torsoBand(0.07, 0.212), 0.009), shellPart(b, 'pads', 'leather', (i) => inBones(b, SHOULDERS)(i), 0.012)] })
  add1({ id: 'armor_iron', name: 'Iron Armor', category: 'armor', slot: 'chest_armor', method: 'shell_copy_weights', source: 'generated', colors: { metal: '#9aa0a8', leather: '#5c4430' },
    parts: [shellPart(b, 'plate', 'metal', torsoBand(0.075, 0.212), 0.011), beltPart('leather', 0.084)] })
  add1({ id: 'armor_knight', name: 'Knight Armor', category: 'armor', slot: 'chest_armor', method: 'hybrid', source: 'generated', colors: { metal: '#c8ccd2', primary: '#3e5c8a', trim: '#e7c35b' },
    skirt: { y0: 0.08, y1: 0.04, r0: 0.092, r1: 0.104 },
    parts: [shellPart(b, 'breastplate', 'metal', torsoBand(0.075, 0.214), 0.012),
      ...[[-1, J.rArm], [1, J.lArm]].map(([s, bone]) => rigid(b, `pauldron${s}`, 'metal', sphere([(s as number) * 0.07, 0.19, -0.002], 0.032, 8, 4, 0.7), bone as string)),
      skirtPart(b, 'tassets', 'primary', 0.08, 0.04, 0.092, 0.104), skinned(b, 'trim', 'trim', cylinder([0, 0.08, 0.01], 0.093, 0.093, 0.008, 12, false, 1, 0.85), [J.hips])] })
  add1({ id: 'armor_mage', name: 'Mage Armor', category: 'armor', slot: 'chest_armor', method: 'shell_copy_weights', source: 'generated', colors: { primary: '#4f3d8a', metal: '#d6d9de', gem: '#5fb3d6' },
    parts: [shellPart(b, 'robe', 'primary', torsoBand(0.07, 0.212), 0.008),
      shellPart(b, 'plate', 'metal', (i, p) => torsoBand(0.12, 0.2)(i, p) && p[2] > 0.02, 0.013),
      rigid(b, 'gem', 'gem', sphere([0, 0.16, 0.078], 0.01, 6, 4), J.chest)] })
  add1({ id: 'shoulder_guards_iron', name: 'Shoulder Guards', category: 'armor', slot: 'shoulders', method: 'rigid_multi_bone', source: 'generated', colors: { metal: '#9aa0a8', leather: '#5c4430' },
    attachBones: [J.rArm, J.lArm],
    // half shoulder, half upper arm: the guard turns halfway when the arm lowers, like real pauldrons
    // (tried a shoulder→arm gradient here like the fit.ts pair-binding fix below: it helped arms_up but
    // made walk/arms_down clipping and deformation worse on this smaller procedural geometry — reverted)
    parts: [-1, 1].map((s) => {
      const g = merge(sphere([s * 0.068, 0.188, -0.002], 0.034, 8, 4, 0.65), sphere([s * 0.078, 0.176, -0.002], 0.028, 8, 3, 0.5))
      const sh = ji(b, s < 0 ? J.rShoulder : J.lShoulder), arm = ji(b, s < 0 ? J.rArm : J.lArm)
      return { name: `guard${s}`, channel: 'metal' as Channel, pos: g.pos, idx: g.idx, jw: g.pos.map(() => ({ j: [sh, arm, 0, 0], w: [0.5, 0.5, 0, 0] })) }
    }) })
  add1({ id: 'chest_plate', name: 'Chest Plate', category: 'armor', slot: 'chest_armor', method: 'shell_copy_weights', source: 'generated', colors: { metal: '#c8ccd2' },
    parts: [shellPart(b, 'plate', 'metal', (i, p) => torsoBand(0.1, 0.21)(i, p) && p[2] > 0.0, 0.013)] })
  add1({ id: 'gloves_leather', name: 'Gloves', category: 'armor', slot: 'hands', method: 'shell_copy_weights', source: 'generated', colors: { leather: '#6b4a2e' },
    parts: [shellPart(b, 'gloves', 'leather', (i) => inBones(b, HANDS)(i), 0.004)] })
  add1({ id: 'leg_armor_iron', name: 'Leg Armor', category: 'armor', slot: 'legs', method: 'shell_copy_weights', source: 'generated', colors: { metal: '#9aa0a8' },
    parts: [shellPart(b, 'greaves', 'metal', (i, p) => inBones(b, LEGS)(i) && p[1] > 0.02, 0.006)] })

  // ===== FOOTWEAR =====
  const feetZone = (top: number) => (i: number, p: V3) => inBones(b, [...FEET, J.rLeg, J.lLeg])(i) && p[1] <= top
  add1({ id: 'boots_leather', name: 'Leather Boots', category: 'footwear', slot: 'feet', method: 'shell_copy_weights', source: 'generated', colors: { leather: '#6b4a2e' },
    parts: [shellPart(b, 'boots', 'leather', feetZone(0.03), 0.005)] })
  add1({ id: 'boots_heavy', name: 'Heavy Boots', category: 'footwear', slot: 'feet', method: 'shell_copy_weights', source: 'generated', colors: { dark: '#3a2e26', trim: '#8a6f5a' },
    parts: [shellPart(b, 'boots', 'dark', feetZone(0.038), 0.008), shellPart(b, 'cuffs', 'trim', (i, p) => feetZone(0.038)(i, p) && p[1] > 0.028, 0.011)] })
  add1({ id: 'sandals', name: 'Sandals', category: 'footwear', slot: 'feet', method: 'shell_copy_weights', source: 'generated', colors: { leather: '#a2733f' },
    parts: [shellPart(b, 'soles', 'leather', (i, p) => feetZone(0.03)(i, p) && p[1] < 0.01, 0.006), shellPart(b, 'straps', 'leather', (i, p) => feetZone(0.03)(i, p) && ((p[1] > 0.011 && p[1] < 0.02) || (p[1] > 0.023 && p[1] < 0.032)), 0.005)] })
  add1({ id: 'shoes_mage', name: 'Mage Shoes', category: 'footwear', slot: 'feet', method: 'hybrid', source: 'generated', colors: { primary: '#4f3d8a', trim: '#e7c35b' },
    parts: [shellPart(b, 'shoes', 'primary', feetZone(0.025), 0.004),
      ...[-1, 1].map((s) => rigid(b, `curl${s}`, 'trim', xform(cylinder([s * 0.045, 0.012, 0.05], 0.009, 0, 0.03, 5), rotX(80, [s * 0.045, 0.012, 0.05])), s < 0 ? J.rToe : J.lToe))] })
  add1({ id: 'boots_knight', name: 'Knight Boots', category: 'footwear', slot: 'feet', method: 'shell_copy_weights', source: 'generated', colors: { metal: '#c8ccd2', dark: '#3a3d44' },
    parts: [shellPart(b, 'boots', 'dark', feetZone(0.04), 0.007), shellPart(b, 'caps', 'metal', (i, p) => feetZone(0.04)(i, p) && (p[2] > 0.015 || p[1] > 0.03), 0.01)] })

  // ===== ACCESSORIES =====
  add1({ id: 'backpack', name: 'Backpack', category: 'accessory', slot: 'back', method: 'rigid_bone', source: 'generated', colors: { leather: '#7a4e2c', trim: '#c9a36a' },
    attachBones: [J.chest],
    parts: [rigid(b, 'bag', 'leather', box([0, 0.14, -0.083], [0.09, 0.085, 0.045]), J.chest), rigid(b, 'flap', 'trim', box([0, 0.178, -0.083], [0.094, 0.012, 0.05]), J.chest),
      rigid(b, 'roll', 'trim', xform(cylinder([-0.05, 0.19, -0.085], 0.015, 0.015, 0.1, 6), rotZ(-90, [-0.05, 0.19, -0.085])), J.chest)] })
  add1({ id: 'belt_leather', name: 'Belt', category: 'accessory', slot: 'waist', method: 'weight_transfer', source: 'generated', colors: { leather: '#5c4430', metal: '#d9b45a' },
    parts: [beltPart('leather', 0.088), skinned(b, 'buckle', 'metal', box([0, 0.095, 0.093], [0.022, 0.018, 0.006]), [J.hips])] })
  add1({ id: 'pouch', name: 'Pouch', category: 'accessory', slot: 'waist_side', method: 'rigid_bone', source: 'generated', colors: { leather: '#8a5a33', trim: '#d9b45a' },
    attachBones: [J.hips],
    parts: [rigid(b, 'pouch', 'leather', box([0.083, 0.08, 0.035], [0.022, 0.03, 0.03]), J.hips), rigid(b, 'clasp', 'trim', sphere([0.095, 0.088, 0.035], 0.004, 4, 3), J.hips)] })
  add1({ id: 'necklace_beads', name: 'Necklace', category: 'accessory', slot: 'neck', method: 'rigid_bone', source: 'generated', colors: { trim: '#c9a36a', gem: '#5fb3d6' },
    attachBones: [J.chest],
    parts: [rigid(b, 'cord', 'trim', xform(torus([0, 0.2, 0.012], 0.042, 0.003, 14, 3, 1, 1.15), rotX(18, [0, 0.2, 0])), J.chest), rigid(b, 'gem', 'gem', sphere([0, 0.183, 0.066], 0.009, 6, 4), J.chest)] })
  add1({ id: 'earrings_gold', name: 'Earrings', category: 'accessory', slot: 'ears', method: 'rigid_bone', source: 'generated', colors: { metal: '#e7c35b', gem: '#c23b3b' },
    attachBones: [J.head],
    parts: [-1, 1].flatMap((s) => [rigid(b, `ring${s}`, 'metal', xform(torus([s * 0.148, 0.255, 0.02], 0.009, 0.0025, 8, 3), rotZ(90, [s * 0.148, 0.255, 0.02])), H), rigid(b, `gem${s}`, 'gem', sphere([s * 0.148, 0.243, 0.02], 0.006, 5, 3), H)]) })
  add1({ id: 'scarf_red', name: 'Scarf', category: 'accessory', slot: 'neck', method: 'hybrid', source: 'generated', colors: { primary: '#b8392f' },
    parts: [rigid(b, 'wrap', 'primary', torus([0, 0.198, 0.006], 0.045, 0.013, 12, 5, 1, 1.15), J.chest),
      skinned(b, 'tail', 'primary', panel([0.015, 0.19, 0.06], [0.025, 0, 0.004], [0.006, -0.06, 0.012], 1, 3), [J.chest, J.spine1])] })
  add1({ id: 'cape_hero', name: 'Hero Cape', category: 'accessory', slot: 'back', method: 'hybrid', source: 'generated', colors: { primary: '#b8392f', metal: '#e7c35b' },
    parts: [capePart(b, 'cape', 'primary', panel([-0.07, 0.205, -0.06], [0.14, 0, 0], [-0.025, -0.17, -0.024], 4, 5)),
      ...[-1, 1].map((s) => rigid(b, `clasp${s}`, 'metal', sphere([s * 0.04, 0.2, 0.02], 0.009, 6, 4), J.chest))],
    notes: ['Cape weights fade chest → spine → hips down its length.'] })
  add1({ id: 'medallion_guild', name: 'Guild Medallion', category: 'accessory', slot: 'neck', method: 'rigid_bone', source: 'generated', colors: { metal: '#e7c35b', gem: '#3f5f8f' },
    attachBones: [J.chest],
    parts: [rigid(b, 'chain', 'metal', xform(torus([0, 0.2, 0.012], 0.043, 0.0025, 14, 3, 1, 1.15), rotX(22, [0, 0.2, 0])), J.chest),
      rigid(b, 'disc', 'metal', xform(cylinder([0, 0.172, 0.068], 0.02, 0.02, 0.005, 10), rotX(90, [0, 0.172, 0.068])), J.chest),
      rigid(b, 'gem', 'gem', sphere([0, 0.172, 0.075], 0.008, 6, 4), J.chest)] })
  add1({ id: 'mantle_fur', name: 'Fur Mantle', category: 'accessory', slot: 'shoulders', method: 'rigid_bone', source: 'generated', colors: { primary: '#c9b28a' },
    attachBones: [J.chest],
    parts: [rigid(b, 'fur', 'primary', torus([0, 0.186, -0.002], 0.074, 0.024, 14, 5, 1.08, 0.95), J.chest)] })
  add1({ id: 'ornament_star_pin', name: 'Star Hairpin', category: 'accessory', slot: 'hair_ornament', method: 'rigid_bone', source: 'generated', colors: { metal: '#e7c35b', gem: '#fff2a0' },
    attachBones: [J.head],
    parts: [rigid(b, 'star', 'gem', merge(...[0, 72, 144, 216, 288].map((d) => xform(cylinder([0.14, 0.4, 0.06], 0.008, 0, 0.022, 4), rotX(d, [0.14, 0.4, 0.06])))), H), rigid(b, 'pin', 'metal', sphere([0.14, 0.4, 0.06], 0.007, 5, 3), H)] })
  add1({ id: 'ornament_crystal_charm', name: 'Crystal Charm', category: 'accessory', slot: 'waist_side', method: 'rigid_bone', source: 'generated', colors: { gem: '#b07ce0', metal: '#d6d9de' },
    attachBones: [J.hips],
    parts: [rigid(b, 'crystal', 'gem', sphere([-0.088, 0.062, 0.03], 0.013, 4, 2, 1.8), J.hips), rigid(b, 'cap', 'metal', sphere([-0.088, 0.085, 0.03], 0.005, 4, 2), J.hips)] })

  return out
}

/** sanity: every rigid part references a real bone, every weight row is normalized */
export function validateDefs(b: Body, defs: GenDef[]) {
  for (const d of defs) for (const p of d.parts) {
    if (p.jw.length !== p.pos.length) throw new Error(`${d.id}/${p.name}: weights ${p.jw.length} ≠ vertices ${p.pos.length}`)
    for (const r of p.jw) { const s = r.w.reduce((a, x) => a + x, 0); if (Math.abs(s - 1) > 1e-3 || r.j.some((j) => j >= b.joints.length)) throw new Error(`${d.id}/${p.name}: bad weights`) }
    if (p.idx.some((i) => i >= p.pos.length)) throw new Error(`${d.id}/${p.name}: bad indices`)
  }
  void add; void norm; void move
}
