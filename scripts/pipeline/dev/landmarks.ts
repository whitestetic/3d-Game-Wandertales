import { loadBody, regionBox, boxOf } from '../lib.ts'
const b = await loadBody()
const r = (v: number[]) => v.map((x) => x.toFixed(3)).join(',')
console.log('eyes', r(b.eyeBox.min), '→', r(b.eyeBox.max))
for (const n of ['Head_06', 'Neck_05', 'Spine2_04', 'Spine1_03', 'Hips_01']) { const bb = regionBox(b, [n]); console.log(n, r(bb.min), '→', r(bb.max)) }
const head = b.verts.filter((_, i) => b.dominant[i] === 'Head_06')
for (let y = 0.21; y <= 0.48; y += 0.02) {
  const sl = head.filter((p) => Math.abs(p[1] - y) < 0.01)
  if (!sl.length) continue
  const bb = boxOf(sl)
  console.log('head slice y', y.toFixed(2), 'x', r([bb.min[0], bb.max[0]]), 'z', r([bb.min[2], bb.max[2]]), 'n', sl.length)
}
const torso = b.verts.filter((_, i) => ['Spine2_04', 'Spine1_03', 'Hips_01', 'Spine_02'].includes(b.dominant[i]))
for (let y = 0.05; y <= 0.21; y += 0.02) { const sl = torso.filter((p) => Math.abs(p[1] - y) < 0.01); if (sl.length) { const bb = boxOf(sl); console.log('torso y', y.toFixed(2), 'x', r([bb.min[0], bb.max[0]]), 'z', r([bb.min[2], bb.max[2]])) } }
console.log('joints', Object.entries(b.jointPos).map(([k, v]) => `${k}:${r(v)}`).join(' | '))
