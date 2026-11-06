// Writes data/npc_appearances.json: the saved looks of the placeholder residents + one sample per role.
// Run: node scripts/data/npc-appearances.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { MOCK_RESIDENTS } from '../../src/game/residents.mock.ts'
import { GENERATOR_VERSION, ROLES, auditLoadouts, generateNpcAppearance, roleFor } from '../../src/npc-generator/npcGenerator.ts'

const catalog = JSON.parse(readFileSync(new URL('../../data/character_assets.json', import.meta.url), 'utf8'))
const available = new Set<string>(catalog.assets.filter((a: { readyForPlayer: boolean }) => a.readyForPlayer).map((a: { id: string }) => a.id))
const problems = auditLoadouts(new Map(catalog.assets.map((a: { id: string; slot: string }) => [a.id, a.slot])))
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
const out = {
  generatorVersion: GENERATOR_VERSION,
  generatedAt: new Date().toISOString(),
  residents: MOCK_RESIDENTS.map((r) => ({ id: r.id, name: r.name, profession: r.profession, role: roleFor(r.profession), appearance: generateNpcAppearance(r.id, roleFor(r.profession), { available }) })),
  roleSamples: ROLES.map((role) => ({ role, appearance: generateNpcAppearance(`sample-${role}`, role, { available }) })),
}
writeFileSync(new URL('../../data/npc_appearances.json', import.meta.url), JSON.stringify(out, null, 2))
console.log('npc appearances:', out.residents.length, 'residents,', out.roleSamples.length, 'role samples; skipped (not QC-ready):', [...new Set(catalog.assets.filter((a: { readyForPlayer: boolean }) => !a.readyForPlayer).map((a: { id: string }) => a.id))].join(', '))
