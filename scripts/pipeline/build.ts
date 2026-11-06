// Full character asset build: generate + fit → export GLB → QC → thumbnails → manifest → reports.
// Run: npm run characters   (node scripts/pipeline/build.ts)
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { MASTER, ROOT, listAssetFiles } from './inspect.ts'
import { io, loadBody, writeAssetGlb, type AssetDef } from './lib.ts'
import { generateAll, validateDefs, type GenDef } from './generate.ts'
import { fitProvided } from './fit.ts'
import { qcAsset, type QcResult } from './qc.ts'
import { bodyItems, partItems, renderSvg } from './thumbnail.ts'

const FOLDER: Record<AssetDef['category'], string> = { hair: 'hair', headwear: 'headwear', clothing: 'clothing', armor: 'armor', footwear: 'footwear', accessory: 'accessories' }
const OUT = join(ROOT, 'public/characters')
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/')

async function buildMaster() {
  // runtime copy: rename materials to stable channel names, give the placeholder pink a real skin tone
  const doc = await io.read(MASTER)
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getName() === 'BaseMesh_Chibi_M') m.setName('wt_skin').setBaseColorFactor([0.88, 0.58, 0.42, 1]).setRoughnessFactor(0.8)
    if (m.getName() === 'lambert1') m.setName('wt_eyes').setRoughnessFactor(0.3)
  }
  doc.getRoot().getAsset().extras = { wtMaster: { source: 'chibi_base_mesh_rigged.glb', note: 'materials renamed for runtime recoloring; geometry, rig and weights unchanged' } }
  mkdirSync(join(OUT, 'base'), { recursive: true })
  writeFileSync(join(OUT, 'base/chibi_master.glb'), await io.writeBinary(doc))
  mkdirSync(join(ROOT, 'assets/characters/base'), { recursive: true })
  copyFileSync(join(OUT, 'base/chibi_master.glb'), join(ROOT, 'assets/characters/base/chibi_master.glb'))
}

const t0 = Date.now()
const b = await loadBody()
await buildMaster()
const generated: GenDef[] = generateAll(b)
const fitted = await fitProvided(b, listAssetFiles())
const all: (GenDef & { sourceFile?: string; sourceVertices?: number })[] = [...generated, ...fitted]
validateDefs(b, all)
console.log(`building ${generated.length} generated + ${fitted.length} fitted assets`)

mkdirSync(join(OUT, 'thumbnails'), { recursive: true })
writeFileSync(join(OUT, 'thumbnails/_master.svg'), renderSvg(bodyItems(b), { size: 220 }))

const results: (QcResult & { def: typeof all[number]; file: string; thumb: string })[] = []
for (const def of all) {
  const file = join(OUT, FOLDER[def.category], `${def.id}.glb`)
  const bytes = await writeAssetGlb(def, file)
  // mirror into assets/characters/<category>/ as the library copy
  const lib = join(ROOT, 'assets/characters', FOLDER[def.category], `${def.id}.glb`)
  mkdirSync(join(ROOT, 'assets/characters', FOLDER[def.category]), { recursive: true })
  copyFileSync(file, lib)
  const qc = await qcAsset(b, def, file, bytes)
  const thumb = join(OUT, 'thumbnails', `${def.id}.svg`)
  writeFileSync(thumb, renderSvg([...bodyItems(b), ...partItems(def.parts, def.colors)], { size: 160 }))
  results.push({ ...qc, def, file, thumb })
  process.stdout.write(`${qc.status.padEnd(12)} ${def.id}\n`)
}

// ---------- manifest (consumed by the game) ----------
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  master: { file: 'characters/base/chibi_master.glb', height: 0.475, joints: b.joints, materials: { skin: 'wt_skin', eyes: 'wt_eyes' } },
  channels: ['primary', 'secondary', 'trim', 'leather', 'metal', 'hair', 'gem', 'cloth', 'dark'],
  assets: results.map((r) => ({
    id: r.def.id, name: r.def.name, category: r.def.category, slot: r.def.slot,
    file: rel(r.file).replace(/^public\//, ''), thumbnail: rel(r.thumb).replace(/^public\//, ''),
    method: r.def.method, source: r.def.source, sourceFile: r.def.sourceFile ? rel(r.def.sourceFile) : undefined,
    channels: r.def.colors, vertices: r.metrics.vertices, triangles: r.metrics.triangles, bytes: r.metrics.bytes,
    qc: r.status, readyForPlayer: r.status === 'PASS' || r.status === 'WARNING',
  })),
}
mkdirSync(join(ROOT, 'data'), { recursive: true })
writeFileSync(join(ROOT, 'data/character_assets.json'), JSON.stringify(manifest, null, 2))
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))

// ---------- QC reports ----------
const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>)
const report = { generatedAt: manifest.generatedAt, tool: 'Node + glTF-Transform + three.js GLTFLoader (Blender not available on this machine)', poses: ['rest', 'arms_down', 'walk', 'head_turn', 'arms_up', 'crouch'], counts, assets: results.map(({ def, file, thumb, ...r }) => ({ ...r, name: def.name, category: def.category, source: def.source, method: def.method, notes: def.notes ?? [], file: rel(file), thumbnail: rel(thumb) })) }
mkdirSync(join(ROOT, 'reports'), { recursive: true })
writeFileSync(join(ROOT, 'reports/qc_report.json'), JSON.stringify(report, null, 2))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const color = { PASS: '#2e7d32', WARNING: '#b26a00', NEEDS_REVIEW: '#8e24aa', FAILED: '#c62828' } as Record<string, string>
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Character QC Report</title>
<style>:root{--bg:#faf6ee;--ink:#2b2118;--card:#fff;--line:#e6dccb}@media(prefers-color-scheme:dark){:root{--bg:#1d1915;--ink:#efe6d6;--card:#2a241e;--line:#3d342b}}
body{font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:16px}h1{margin:0 0 4px}.sum span{display:inline-block;margin:6px 10px 6px 0;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;margin-top:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;display:grid;grid-template-columns:110px 1fr;gap:10px}
.card img{width:110px;height:110px;border-radius:8px}.st{font-weight:800;font-size:12px;padding:1px 8px;border-radius:6px;color:#fff}ul{margin:4px 0 0;padding-left:16px;font-size:12px}li.bad{font-weight:700}small{opacity:.75}</style></head><body>
<h1>WanderTales character assets — QC report</h1><small>${esc(report.generatedAt)} · ${esc(report.tool)} · test poses: ${report.poses.join(', ')}</small>
<div class="sum">${Object.entries(counts).map(([k, v]) => `<span style="color:${color[k]}">${k}: ${v}</span>`).join('')}</div>
<div class="grid">${results.map((r) => `<div class="card"><img src="../public/characters/thumbnails/${r.def.id}.svg" alt="${esc(r.def.name)}"><div>
<b>${esc(r.def.name)}</b> <span class="st" style="background:${color[r.status]}">${r.status}</span><br><small>${r.def.id} · ${r.def.category} · ${r.def.source.replace('_', ' ')} · ${r.def.method}</small>
<ul>${r.checks.map((c) => `<li class="${c.ok ? '' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.name)}: ${esc(c.detail)}</li>`).join('')}${(r.def.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div></div>`).join('')}</div></body></html>`
writeFileSync(join(ROOT, 'reports/qc_report.html'), html)
console.log('\n', counts, `in ${((Date.now() - t0) / 1000).toFixed(1)} s`, '· master', statSync(join(OUT, 'base/chibi_master.glb')).size, 'bytes')
