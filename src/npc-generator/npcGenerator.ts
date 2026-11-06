// Seeded, profession-based NPC appearance generator. Pure (no DOM) — runs in the game, in tests and in Node.
// Same id + role + version → the same look, every time.
import type { CharacterAppearance, ChannelColors, Slot } from '../character-creator/appearance.ts'
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES } from '../character-creator/appearance.ts'

export const GENERATOR_VERSION = 1

export const ROLES = ['Blacksmith', 'Merchant', 'Farmer', 'Knight', 'Guard', 'Mage', 'Healer', 'Ranger', 'Adventurer', 'Villager', 'Guild Master', 'Innkeeper',
  'Baker', 'Scholar', 'Worker', 'Fisher', 'Rogue', 'Paladin'] as const
export type Role = (typeof ROLES)[number]

interface Loadout {
  /** per slot: candidate asset ids; null = "leave empty" is a valid pick. Missing slot = always empty. */
  slots: Partial<Record<Slot, (string | null)[]>>
  /** per slot: candidate colors for each channel */
  colors?: Partial<Record<Slot, Partial<Record<keyof ChannelColors, string[]>>>>
  hair?: boolean // default true: pick a hairstyle
}

const HAIRS = ['hair_short', 'hair_long', 'hair_ponytail', 'hair_twin_tails', 'hair_braided', 'hair_messy', 'hair_curly', 'hair_messy_brown', 'hair_short_black', 'hair_long_braid', 'hair_twin_buns', 'hair_mage_swept']
const EARTH = ['#4f7a45', '#7a5434', '#8a6f5a', '#c98a4b', '#3f6b3a', '#6b4a2e', '#9c3d3d', '#3e5c8a']
const LEATHER = ['#6b4a2e', '#5c4430', '#7a4e2c', '#3a2e26']
const NOBLE = ['#3e5c8a', '#9c3d3d', '#5b3d8a', '#2f4f7f']

export const LOADOUTS: Record<Role, Loadout> = {
  Blacksmith: {
    slots: { torso: ['shirt_linen', 'tunic_green'], apron: ['apron_leather_work'], hands: ['gloves_leather'], feet: ['boots_heavy'], waist_side: ['pouch', null], headwear: [null, null, 'hat_adventurer'] },
    colors: { torso: { primary: ['#f2e3c6', '#8a6f5a', '#5c4430'] }, apron: { leather: LEATHER } },
  },
  Merchant: {
    slots: { torso: ['outfit_merchant', 'coat_traveler'], waist_side: ['pouch'], feet: ['boots_leather', 'sandals'], neck: ['necklace_beads', 'medallion_guild', null], headwear: ['hat_adventurer', null], ears: ['earrings_gold', null] },
    colors: { torso: { primary: ['#f2e3c6', '#e8dcc8'], secondary: ['#9c3d3d', '#3e5c8a', '#4f7a45', '#d9b45a'] } },
  },
  Farmer: {
    slots: { torso: ['tunic_green', 'shirt_linen', 'outfit_adventurer'], headwear: ['hat_farmer', 'hat_farmer_straw', null], feet: ['boots_leather', 'sandals'], waist: ['belt_leather', null] },
    colors: { torso: { primary: EARTH } },
  },
  Knight: {
    slots: { torso: ['shirt_linen'], chest_armor: ['armor_knight', 'armor_iron'], headwear: ['helmet_iron', null], shoulders: ['shoulder_guards_iron', 'accessory_bronze_pauldron_pair'], hands: ['gloves_leather'], legs: ['leg_armor_iron'], feet: ['boots_knight'], back: ['cape_hero', null] },
    colors: { chest_armor: { primary: NOBLE }, back: { primary: ['#b8392f', '#3e5c8a', '#5b3d8a'] } },
  },
  Guard: {
    slots: { torso: ['tunic_green', 'outfit_knight_surcoat'], chest_armor: ['armor_iron', 'armor_leather'], headwear: ['helmet_iron'], feet: ['boots_heavy', 'boots_knight'], waist: ['belt_leather'], shoulders: ['shoulder_guard_pair', null] },
    colors: { torso: { primary: NOBLE } },
  },
  Mage: {
    slots: { torso: ['outfit_mage', 'robe_plain', 'outfit_mage_robe'], headwear: ['hat_wizard', 'circlet_silver', 'accessory_circlet'], feet: ['shoes_mage'], neck: ['accessory_crystal_pendant', 'necklace_beads', null], hair_ornament: ['ornament_star_pin', null], waist_side: ['ornament_crystal_charm', null] },
    colors: { torso: { primary: ['#5b3d8a', '#4f3d8a', '#3e5c8a', '#2f2a55', '#8a3d9c'] }, headwear: { primary: ['#5b3d8a', '#2f2a55', '#3e5c8a'] } },
  },
  Healer: {
    slots: { torso: ['robe_plain', 'dress_simple', 'outfit_mage'], headwear: ['circlet_silver', 'hood', null], feet: ['sandals', 'shoes_mage'], neck: ['accessory_crystal_pendant', 'necklace_beads'], waist_side: ['pouch', null] },
    colors: { torso: { primary: ['#eeeeee', '#e8dcc8', '#9fd0c8', '#f2e3c6'], trim: ['#d9b45a', '#3f7a8c'] } },
  },
  Ranger: {
    slots: { torso: ['outfit_ranger', 'outfit_ranger_vest'], headwear: ['hood', null], hands: ['gloves_leather'], feet: ['boots_leather'], back: ['backpack', 'accessory_adventurer_pack', null], waist: ['belt_leather'] },
    colors: { torso: { primary: ['#3f6b3a', '#4f7a45', '#5c4430'] }, headwear: { primary: ['#3f6b3a', '#2f4a2a', '#5c4430'] } },
  },
  Adventurer: {
    slots: { torso: ['outfit_adventurer', 'coat_traveler', 'outfit_traveler_coat'], chest_armor: ['armor_leather', null], headwear: ['hat_adventurer', null], back: ['backpack', 'accessory_adventurer_pack'], feet: ['boots_leather', 'boots_heavy'], waist_side: ['pouch'], neck: ['scarf_red', 'accessory_scarf', null] },
    colors: { torso: { primary: EARTH } },
  },
  Villager: {
    slots: { torso: ['shirt_linen', 'tunic_green', 'dress_simple', 'vest_leather'], feet: ['boots_leather', 'sandals'], waist: ['belt_leather', null], neck: ['scarf_red', null, null] },
    colors: { torso: { primary: [...EARTH, '#cf7fa3', '#f2e3c6'] } },
  },
  'Guild Master': {
    slots: { torso: ['coat_traveler'], chest_armor: ['armor_leather', null], back: ['cape_hero'], neck: ['medallion_guild'], feet: ['boots_heavy'], waist: ['belt_leather'], shoulders: ['mantle_fur', null] },
    colors: { torso: { primary: ['#2f4f7f', '#3e5c8a'] }, back: { primary: ['#b8392f'] } },
  },
  Innkeeper: {
    slots: { torso: ['shirt_linen', 'outfit_merchant'], apron: ['apron_cloth'], feet: ['boots_leather'], neck: ['scarf_red', null], headwear: [null, null, 'hood'] },
    colors: { torso: { primary: ['#f2e3c6', '#e8dcc8'], secondary: ['#9c3d3d', '#6b4a2e'] } },
  },
  Baker: {
    slots: { torso: ['shirt_linen', 'dress_simple'], apron: ['apron_cloth'], headwear: ['hat_baker_cream', null], feet: ['sandals', 'boots_leather'] },
    colors: { torso: { primary: ['#f2e3c6', '#cf7fa3', '#c9b28a'] } },
  },
  Scholar: {
    slots: { torso: ['robe_plain', 'coat_traveler'], headwear: [null, 'circlet_silver'], neck: ['medallion_guild', 'necklace_beads'], feet: ['shoes_mage', 'boots_leather'] },
    colors: { torso: { primary: ['#3e5c8a', '#5c4430', '#2f2a35'] } },
  },
  Worker: {
    slots: { torso: ['shirt_linen', 'vest_leather', 'tunic_green'], hands: ['gloves_leather'], feet: ['boots_heavy'], waist: ['belt_leather'], headwear: [null, 'hat_adventurer'], back: [null, 'backpack'] },
    colors: { torso: { primary: EARTH, leather: LEATHER } },
  },
  Fisher: {
    slots: { torso: ['vest_leather', 'shirt_linen', 'tunic_green'], headwear: ['hat_farmer', 'hat_farmer_straw', null], feet: ['boots_heavy', 'sandals'], waist_side: ['pouch', null] },
    colors: { torso: { primary: ['#3f7a8c', '#3e5c8a', '#f2e3c6'] } },
  },
  Rogue: {
    slots: { torso: ['outfit_ranger', 'vest_leather'], headwear: ['hood'], hands: ['gloves_leather'], feet: ['boots_leather'], back: ['cape_hero', null], waist_side: ['pouch'] },
    colors: { torso: { primary: ['#2f2a35', '#3a2e26', '#2f4a2a'] }, headwear: { primary: ['#2f2a35', '#3a2e26'] }, back: { primary: ['#2f2a35', '#5b3d8a'] } },
  },
  Paladin: {
    slots: { torso: ['outfit_knight_surcoat', 'shirt_linen'], chest_armor: ['armor_knight', 'armor_mage'], headwear: ['crown_gold', 'circlet_silver', 'helmet_iron'], shoulders: ['shoulder_guards_iron'], feet: ['boots_knight'], back: ['cape_hero'], neck: ['medallion_guild'] },
    colors: { back: { primary: ['#eeeeee', '#d9b45a', '#3e5c8a'] } },
  },
}

/** Map game professions / guild classes to a look. */
export const ROLE_FOR: Record<string, Role> = {
  Farmer: 'Farmer', Herbalist: 'Healer', Fisherman: 'Fisher', Rancher: 'Farmer', Blacksmith: 'Blacksmith', Carpenter: 'Worker', Tailor: 'Merchant',
  Alchemist: 'Mage', Baker: 'Baker', Merchant: 'Merchant', Shopkeeper: 'Merchant', Bartender: 'Innkeeper', Cook: 'Innkeeper', Innkeeper: 'Innkeeper',
  Guard: 'Guard', Builder: 'Worker', Healer: 'Healer', Librarian: 'Scholar', Courier: 'Adventurer', Woodcutter: 'Worker', Stonecutter: 'Worker', Miner: 'Worker',
  Unemployed: 'Villager',
  // guild classes
  Warrior: 'Knight', Mage: 'Mage', Archer: 'Ranger', Rogue: 'Rogue', Paladin: 'Paladin',
}
export const roleFor = (professionOrClass: string): Role => ROLE_FOR[professionOrClass] ?? ((ROLES as readonly string[]).includes(professionOrClass) ? professionOrClass as Role : 'Villager')

function seeded(text: string) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export interface GenerateOptions {
  /** asset ids that passed QC; anything else is skipped */
  available: Set<string>
  version?: number
  /** keep these choices (e.g. a resident's registered skin/hair) */
  fixed?: Partial<Pick<CharacterAppearance, 'skin' | 'eyes' | 'height'>> & { hairAsset?: string; hairColor?: string }
}

export function generateNpcAppearance(npcId: string, role: Role, opts: GenerateOptions): CharacterAppearance {
  const rnd = seeded(`${npcId}|${role}|v${opts.version ?? GENERATOR_VERSION}`)
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)]
  const ok = (id: string | null) => id === null || opts.available.has(id)
  const L = LOADOUTS[role]
  const equipment: CharacterAppearance['equipment'] = {}
  const colors: CharacterAppearance['colors'] = {}
  for (const [slot, choices] of Object.entries(L.slots) as [Slot, (string | null)[]][]) {
    const usable = choices.filter(ok)
    if (!usable.length) continue
    const id = pick(usable)
    if (id) equipment[slot] = id
  }
  if (L.hair !== false) {
    const hair = opts.fixed?.hairAsset && opts.available.has(opts.fixed.hairAsset) ? opts.fixed.hairAsset : pick(HAIRS.filter((h) => opts.available.has(h)))
    if (hair) equipment.hair = hair
    colors.hair = { hair: opts.fixed?.hairColor ?? pick(HAIR_COLORS) }
  }
  for (const [slot, chans] of Object.entries(L.colors ?? {}) as [Slot, Record<string, string[]>][]) {
    if (!equipment[slot]) continue
    colors[slot] = { ...(colors[slot] ?? {}), ...Object.fromEntries(Object.entries(chans).map(([ch, list]) => [ch, pick(list)])) }
  }
  return {
    schemaVersion: 1, name: undefined,
    skin: opts.fixed?.skin ?? pick(SKIN_TONES), eyes: opts.fixed?.eyes ?? pick(EYE_COLORS),
    height: opts.fixed?.height ?? Math.round((0.94 + rnd() * 0.12) * 100) / 100,
    equipment, colors,
  }
}

/** Every loadout must only reference assets that exist; returns problems for the test suite. */
export function auditLoadouts(slotOf: Map<string, string>) {
  const problems: string[] = []
  for (const [role, L] of Object.entries(LOADOUTS)) for (const [slot, list] of Object.entries(L.slots)) for (const id of list ?? []) {
    if (!id) continue
    if (!slotOf.has(id)) problems.push(`${role}.${slot}: unknown asset ${id}`)
    else if (slotOf.get(id) !== slot) problems.push(`${role}.${slot}: ${id} belongs in slot ${slotOf.get(id)}`)
  }
  for (const h of HAIRS) if (slotOf.get(h) !== 'hair') problems.push(`hair list: ${h} is not a hair asset`)
  return problems
}
