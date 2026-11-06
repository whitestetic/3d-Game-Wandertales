import { NodeIO } from '@gltf-transform/core'
const io = new NodeIO()
const doc = await io.read(process.argv[2])
const skin = doc.getRoot().listSkins()[0]
const ibm = skin.getInverseBindMatrices()!
const mul = (a: ArrayLike<number>, b: ArrayLike<number>) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r]*b[c*4+k]; return o }
const body = doc.getRoot().listNodes().find((n) => n.getName() === 'Object_7')!
console.log('body node world', Array.from(body.getWorldMatrix()).map((x) => +x.toFixed(4)).join(' '))
console.log('skin skeleton', skin.getSkeleton()?.getName())
let maxDiff = 0
const ms = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), ibm.getElement(i, [])))
for (const m of ms) for (let k = 0; k < 16; k++) maxDiff = Math.max(maxDiff, Math.abs(m[k] - ms[0][k]))
console.log('J*IBM joint0', ms[0].map((x) => +x.toFixed(4)).join(' '), 'max diff across joints', maxDiff)
for (const n of ['Sketchfab_model', 'RootNode', 'BaseMesh_Chibi', 'Object_4', 'Object_7']) { const nd = doc.getRoot().listNodes().find((x) => x.getName().startsWith(n))!; console.log(n, 'T', nd.getTranslation().map(v=>+v.toFixed(3)), 'R', nd.getRotation().map(v=>+v.toFixed(3)), 'S', nd.getScale().map(v=>+v.toFixed(3))) }
const wm = Array.from(body.getWorldMatrix())
skin.listJoints().forEach((j, i) => { const d = Math.max(...ms[i].map((x, k) => Math.abs(x - wm[k]))); if (d > 1e-4) console.log('joint', i, j.getName(), 'diff', d.toFixed(4), 'J*IBM', ms[i].map((x) => +x.toFixed(3)).join(' ')) })
// rendered (skinned) bounds vs bind-space bounds
const prim = body.getMesh()!.listPrimitives()[0]
const P = prim.getAttribute('POSITION')!, J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!
const ap = (m: number[], p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], moved = 0
for (let i = 0; i < P.getCount(); i++) {
  const p = P.getElement(i, []), j = J.getElement(i, []), w = W.getElement(i, [])
  const s = [0, 0, 0]
  for (let k = 0; k < 4; k++) if (w[k]) { const q = ap(ms[j[k]], p); for (let a = 0; a < 3; a++) s[a] += w[k] * q[a] }
  const b = ap(wm, p)
  if (Math.hypot(s[0] - b[0], s[1] - b[1], s[2] - b[2]) > 1e-4) moved++
  for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], s[a]); mx[a] = Math.max(mx[a], s[a]) }
}
console.log('skinned bounds', mn.map((x) => x.toFixed(4)), mx.map((x) => x.toFixed(4)), 'vertices that move when skinned', moved)
