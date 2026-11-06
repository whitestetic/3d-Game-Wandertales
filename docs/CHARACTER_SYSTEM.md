# WanderTales character system

Everything (player, NPCs, all equipment) runs on **one master rig**: `chibi_base_mesh_rigged.glb` (32 joints, 0.475 m, Y-up, T-pose, no animation clips). The original file is untouched in `assets/characters/base/source/`.

## Run it
```bash
npm run characters   # inspect master → generate + fit assets → GLB → QC → thumbnails → manifest → NPC data
npm test             # includes character tests (deterministic NPCs, loadout audit, JSON validation)
npm run dev          # Character Creator at /#/creator, town at /
```

## Pipeline (`scripts/pipeline/`, Node — this is what actually ran)
| Step | File | What it does |
|---|---|---|
| 1 | `inspect.ts` | Hierarchy, bones, weights, bounds, body regions → `reports/PHASE1_MASTER_INSPECTION.md`, `reports/inspection.json` |
| 2 | `generate.ts` | 52 new low-poly items built on the body |
| 3 | `fit.ts` | Fits the 24 provided blockouts (stretch / anchor / left-right pair rules) |
| 4 | `lib.ts` | Posing + skinning, closest-surface queries, push-out-of-body, weight transfer, GLB export with the master's exact skeleton |
| 5 | `qc.ts` | Per asset: opens, materials, rig match, weights, three.js loads it, size, silhouette, clipping in 6 poses, limb contact, stretch vs bare body, attachment, skirt/leg check, source detail |
| 6 | `build.ts` | Writes `public/characters/**` (+ copy in `assets/characters/**`), `data/character_assets.json`, `reports/qc_report.{json,html}` |

Binding is chosen per type, never one method for all:
- **shell_copy_weights** — clothing/armor/boots/gloves: copy of the body surface pushed out, keeps the body's own weights
- **weight_transfer** — fitted garments: 4 nearest body vertices, inverse-distance blend, top 4 joints
- **rigid_bone** — hair, hats, helmets, medallions, backpacks: 100% one bone (Head / chest / hips)
- **rigid_multi_bone** — pairs: left/right bones; the generated shoulder guard is flat 50% shoulder + 50% arm, the provided-blockout pair items (shoulder_guard_pair, accessory_bronze_pauldron_pair) blend shoulder→arm along that axis instead — less clipping when the arm lifts
- **hybrid** — capes (chest → spine → hips gradient), skirts (hips → legs by height)

### Status (last build)
51 PASS · 21 WARNING · 4 NEEDS_REVIEW · 0 FAILED. Only PASS/WARNING are `readyForPlayer`.
NEEDS_REVIEW (kept out of the game): `tunic_forest` (26 verts), `apron_baker`, `apron_blacksmith` (16), `cape_traveler` (5) — the source blockouts are too crude; replaced by generated equivalents.
Warnings are honest: clothing stretches a bit more than the bare body at the armpit; some items are touched by other limbs in extreme poses.

### Blender
`scripts/blender/wt_character_pipeline.py` is the Blender equivalent (Shrinkwrap, Data Transfer, bone binding, pose QC, Eevee thumbnails). **Not executed** — Blender was not installed. Run: `blender -b -P scripts/blender/wt_character_pipeline.py -- --project "<path>"`.

## Runtime (`src/threejs/`)
- `characterKit.ts` — `buildCharacter(appearance)`: clones the master (SkeletonUtils), re-binds every equipment SkinnedMesh to the one skeleton, recolors `wt_<channel>` materials, hood/helmet hide hair. `animate()` turns the T-pose into arms-down and drives idle / walk / work procedurally.
- `ChibiCharacter.tsx` — React component, rebuilds only when the appearance changes.

## Appearance JSON (`src/character-creator/appearance.ts`)
```json
{ "schemaVersion": 1, "name": "Aster", "skin": "#efc9a8", "eyes": "#2a1f1a", "height": 1,
  "equipment": { "hair": "hair_ponytail", "torso": "outfit_adventurer", "feet": "boots_leather" },
  "colors": { "hair": { "hair": "#8a4b2a" }, "torso": { "primary": "#3f7a8c" } } }
```
Imports are validated against the catalog (unknown IDs, wrong slot, or not-QC-passed assets are rejected — no file paths are trusted). Saved in IndexedDB; key `player` is the Guild Master in town.

## Character Creator (`/#/creator`)
360° orbit + zoom, idle/walk/work preview, slots for hair, headwear, ears, ornaments, outfit, apron, chest armor, shoulders, gloves, leg armor, shoes, back, neck, belt, hip; hair/skin/eye color; per-channel colors of every equipped item; randomize (any role); save, load, delete, export/import JSON; "Use as my Guild Master".

## NPC generator (`src/npc-generator/`)
`generateNpcAppearance(id, role, { available })` — seeded (`id|role|v1`), same input → same look. 18 roles with loadout rules (Blacksmith: work apron, gloves, heavy boots; Mage: robe, wizard hat/circlet, crystal; Knight: armor, helmet, pauldrons, knight boots; Merchant: merchant outfit, pouch, jewellery; …). Game professions and guild classes map to roles. In town, each NPC's generated look is stored in IndexedDB (`npc:<id>:<role>`) so it never changes unless regenerated. `data/npc_appearances.json` holds the placeholder residents + one sample per role.
