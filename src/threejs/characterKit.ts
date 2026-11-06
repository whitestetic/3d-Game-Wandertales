// Runtime character assembly on the master chibi rig (three.js).
// Every equipment GLB carries the master's exact skeleton (same joints, same bind matrices), so each item is
// re-bound to the character's single skeleton — one rig drives body + all equipment.
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { CharacterAppearance, Slot } from '../character-creator/appearance'

export type Channel = 'primary' | 'secondary' | 'trim' | 'leather' | 'metal' | 'hair' | 'gem' | 'cloth' | 'dark'
export interface CatalogAsset {
  id: string; name: string; category: string; slot: Slot; file: string; thumbnail: string
  method: string; source: string; channels: Partial<Record<Channel, string>>
  vertices: number; triangles: number; bytes: number; qc: 'PASS' | 'WARNING' | 'NEEDS_REVIEW' | 'FAILED'; readyForPlayer: boolean
}
export interface Catalog { master: { file: string; height: number }; channels: Channel[]; assets: CatalogAsset[] }

const BASE = import.meta.env.BASE_URL ?? '/'
const loader = new GLTFLoader()
const gltfCache = new Map<string, Promise<GLTF>>()
const load = (file: string) => {
  let p = gltfCache.get(file)
  if (!p) { p = loader.loadAsync(BASE + file); gltfCache.set(file, p) }
  return p
}

let catalogP: Promise<Catalog> | null = null
export const loadCatalog = () => (catalogP ??= fetch(`${BASE}characters/manifest.json`).then((r) => r.json() as Promise<Catalog>))

/** Headwear that covers the hair entirely. */
const HIDES_HAIR = new Set(['hood', 'helmet_iron'])

/** World units: the master is 0.475 m tall; in town a character is about 1.7 units. */
export const GAME_SCALE = 3.6

export interface CharacterRig {
  root: THREE.Group
  bones: Record<string, THREE.Bone>
  rest: Record<string, THREE.Quaternion>
  restWorldInv: Record<string, THREE.Quaternion>
  dispose: () => void
}

const linear = (hex: string) => new THREE.Color(hex)

function styleMaterial(m: THREE.Material, color?: string) {
  const mat = (m as THREE.MeshStandardMaterial).clone()
  if (color) mat.color = linear(color)
  mat.flatShading = true // low-poly look
  mat.side = THREE.DoubleSide
  mat.needsUpdate = true
  return mat
}

/** Build a complete character from an appearance. Async: GLBs are loaded once and cached. */
export async function buildCharacter(app: CharacterAppearance): Promise<CharacterRig> {
  const catalog = await loadCatalog()
  const master = await load(catalog.master.file)
  const root = cloneSkeleton(master.scene) as THREE.Group
  let body: THREE.SkinnedMesh | null = null
  const disposables: THREE.Material[] = []
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    m.castShadow = true
    m.frustumCulled = false // skinned bounds don't follow animation
    const name = (m.material as THREE.Material).name
    const mat = styleMaterial(m.material as THREE.Material, name === 'wt_skin' ? app.skin : name === 'wt_eyes' ? app.eyes : undefined)
    if (name === 'wt_eyes') mat.flatShading = false
    m.material = mat
    disposables.push(mat)
    if (name === 'wt_skin') body = m
  })
  if (!body) throw new Error('master body mesh not found')
  const bodyMesh = body as THREE.SkinnedMesh

  // equipment
  const equipped = Object.entries(app.equipment).filter(([, id]) => id) as [Slot, string][]
  const hideHair = equipped.some(([slot, id]) => slot === 'headwear' && HIDES_HAIR.has(id))
  const assets = await Promise.all(equipped.map(async ([slot, id]) => {
    const a = catalog.assets.find((x) => x.id === id)
    if (!a || (slot === 'hair' && hideHair)) return null
    return { a, gltf: await load(a.file), slot }
  }))
  for (const item of assets) {
    if (!item) continue
    const colors = { ...item.a.channels, ...(app.colors[item.slot] ?? {}) }
    item.gltf.scene.traverse((o) => {
      const src = o as THREE.SkinnedMesh
      if (!src.isSkinnedMesh) return
      const mats = (Array.isArray(src.material) ? src.material : [src.material]).map((mm) => {
        const ch = mm.name.replace(/^wt_/, '') as Channel
        const m = styleMaterial(mm, colors[ch])
        disposables.push(m)
        return m
      })
      const mesh = new THREE.SkinnedMesh(src.geometry, Array.isArray(src.material) ? mats : mats[0])
      mesh.name = item.a.id
      mesh.castShadow = true
      mesh.frustumCulled = false
      // same parent + transform as the body, bound to the body's skeleton
      bodyMesh.parent!.add(mesh)
      mesh.position.copy(bodyMesh.position); mesh.quaternion.copy(bodyMesh.quaternion); mesh.scale.copy(bodyMesh.scale)
      mesh.bind(bodyMesh.skeleton, bodyMesh.bindMatrix)
    })
  }

  root.scale.setScalar(app.height)
  const bones: Record<string, THREE.Bone> = {}, rest: Record<string, THREE.Quaternion> = {}, restWorldInv: Record<string, THREE.Quaternion> = {}
  root.updateMatrixWorld(true)
  const rootInv = new THREE.Quaternion()
  root.getWorldQuaternion(rootInv).invert()
  for (const b of bodyMesh.skeleton.bones) {
    bones[b.name] = b
    rest[b.name] = b.quaternion.clone()
    const wq = new THREE.Quaternion()
    b.getWorldQuaternion(wq)
    restWorldInv[b.name] = rootInv.clone().multiply(wq).invert() // rest orientation relative to the character
  }
  return { root, bones, rest, restWorldInv, dispose: () => disposables.forEach((m) => m.dispose()) }
}

// ---------- procedural animation (the master ships without clips) ----------
const tmpQ = new THREE.Quaternion(), tmpAxis = new THREE.Vector3()

/** Set a bone to rest × rotations given around CHARACTER-space axes (x right, y up, z forward). */
export function poseBone(rig: CharacterRig, name: string, rots: [THREE.Vector3Like, number][]) {
  const bone = rig.bones[name]
  if (!bone) return
  bone.quaternion.copy(rig.rest[name])
  for (const [axis, deg] of rots) {
    tmpAxis.set(axis.x, axis.y, axis.z).applyQuaternion(rig.restWorldInv[name]).normalize()
    bone.quaternion.multiply(tmpQ.setFromAxisAngle(tmpAxis, THREE.MathUtils.degToRad(deg)))
  }
}

const X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 }
export type Motion = 'idle' | 'walk' | 'work'

/** Drive the rig: arms down from the T-pose, then walk / work / idle on top. */
export function animate(rig: CharacterRig, motion: Motion, phase: number, amount = 1) {
  const s = Math.sin(phase), swing = motion === 'walk' ? 32 * amount : 0
  const breathe = Math.sin(phase * 0.5) * 2
  // swing (X) listed before drop (Z): rotations compose in the bone frame, so this order swings the lowered arm.
  // Z first would make X spin the arm around its own length — a twist that looks like no motion.
  poseBone(rig, 'RightArm_09', [[X, motion === 'work' ? -70 + s * 35 : -s * swing * 0.8], [Z, 70]])
  poseBone(rig, 'Left_Arm_017', [[X, motion === 'work' ? -20 : s * swing * 0.8], [Z, -70]])
  poseBone(rig, 'RightForeArm_010', [[Y, motion === 'work' ? 30 : 0]]) // T-pose Y = elbow bend
  poseBone(rig, 'RightUpLeg_024', [[X, -s * swing]])
  poseBone(rig, 'Left_UpLeg_00', [[X, s * swing]])
  poseBone(rig, 'Spine2_04', [[X, breathe * 0.5], [Y, motion === 'walk' ? s * 4 : 0]])
  poseBone(rig, 'Head_06', [[Y, motion === 'idle' ? Math.sin(phase * 0.3) * 6 : 0], [X, motion === 'work' ? 8 : 0]])
  rig.root.position.y = motion === 'walk' ? Math.abs(s) * 0.012 * amount : 0
}
