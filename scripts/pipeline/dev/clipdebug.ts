import { loadBody, Surface, add, scl, norm, dot, sub } from '../lib.ts'
import { generateAll } from '../generate.ts'
const b = await loadBody()
const surf = new Surface(b.verts, b.tris, b.normals)
// 1) body vertices pushed out by 9 mm along their own normal should all read ~+9 mm
let wrong = 0
const examples: string[] = []
b.verts.forEach((v, i) => { const s = surf.signed(add(v, scl(b.normals[i], 0.009))); if (s.d < 0) { wrong++; if (examples.length < 6) examples.push(`${b.dominant[i]} v=${v.map(x=>x.toFixed(3))} n=${b.normals[i].map(x=>x.toFixed(2))} d=${s.d.toFixed(4)} triN=${s.n.map(x=>x.toFixed(2))}`) } })
console.log('body+9mm read as inside:', wrong, '/', b.verts.length); examples.forEach((e) => console.log('  ', e))
// 2) normals: do the file normals point outward? compare with direction from body center for head verts
const hc = [0, 0.34, 0] as [number, number, number]
let inward = 0, head = 0
b.verts.forEach((v, i) => { if (b.dominant[i] !== 'Head_06') return; head++; if (dot(norm(sub(v, hc)), b.normals[i]) < 0) inward++ })
console.log('head vertices whose normal points toward the head centre:', inward, '/', head)
// 3) which hair_short vertices are inside?
const hair = generateAll(b).find((d) => d.id === 'hair_short')!
for (const p of hair.parts) { let n = 0; p.pos.forEach((v) => { const s = surf.signed(v); if (s.d < -0.0015) { n++; if (n < 4) console.log('  hair', p.name, v.map(x=>x.toFixed(3)), 'd', s.d.toFixed(4), 'cp', s.cp.map(x=>x.toFixed(3))) } }); console.log(p.name, 'inside', n, '/', p.pos.length) }
