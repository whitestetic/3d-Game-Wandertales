// Profession catalogue. `workplace` is a building kind; null = workplace not built yet
// (those professions become assignable once Phase 3 construction adds the building).
import type { BuildingKind } from './map.ts'

export const RESOURCES = ['wood', 'stone', 'iron', 'wheat', 'vegetables', 'bread', 'fish', 'herbs', 'potion', 'furniture', 'weapons'] as const
export type Resource = (typeof RESOURCES)[number]
export type Bundle = Partial<Record<Resource, number>>

/** One production cycle: consumes `input` from town storage, adds `output`. Minutes at skill level 1. */
export interface Recipe { input: Bundle; output: Bundle; minutes: number }

export type ProfessionGroup = 'Agriculture' | 'Crafting' | 'Commerce' | 'Services'

export interface Profession {
  group: ProfessionGroup
  workplace: BuildingKind | null
  /** shift in game hours, start inclusive, end exclusive */
  shift: [number, number]
  /** base wage per worked hour at level 1 (each level adds +1) */
  wage: number
  /** what the job will produce once the Phase 3 economy is on */
  output: string
  recipe?: Recipe
}

const p = (group: ProfessionGroup, workplace: BuildingKind | null, shift: [number, number], wage: number, output: string, recipe?: Recipe): Profession =>
  ({ group, workplace, shift, wage, output, recipe })
const r = (input: Bundle, output: Bundle, minutes: number): Recipe => ({ input, output, minutes })

export const PROFESSIONS: Record<string, Profession> = {
  Farmer: p('Agriculture', 'farm', [6, 15], 3, 'Wheat, Vegetables', r({}, { wheat: 2, vegetables: 1 }, 60)),
  Rancher: p('Agriculture', null, [6, 15], 3, 'Milk, Wool'),
  Fisherman: p('Agriculture', 'dock', [5, 12], 3, 'Fish', r({}, { fish: 2 }, 60)),
  Herbalist: p('Agriculture', 'farm', [7, 14], 4, 'Herbs', r({}, { herbs: 2 }, 60)),
  Blacksmith: p('Crafting', 'blacksmith', [8, 17], 5, 'Weapons', r({ iron: 1, wood: 1 }, { weapons: 1 }, 90)),
  Carpenter: p('Crafting', 'workshop', [8, 17], 4, 'Furniture', r({ wood: 3 }, { furniture: 1 }, 90)),
  Tailor: p('Crafting', null, [9, 17], 4, 'Clothing'),
  Alchemist: p('Crafting', 'alchemist', [10, 18], 5, 'Potions', r({ herbs: 2 }, { potion: 1 }, 60)),
  Baker: p('Crafting', 'bakery', [5, 13], 4, 'Bread', r({ wheat: 2 }, { bread: 3 }, 45)),
  Merchant: p('Commerce', 'market', [11, 20], 4, 'Opens the market'),
  Shopkeeper: p('Commerce', 'market', [8, 17], 3, 'Opens the market'),
  Bartender: p('Commerce', 'tavern', [14, 23], 3, 'Opens the tavern'),
  Cook: p('Commerce', 'tavern', [11, 20], 4, 'Opens the tavern'),
  Innkeeper: p('Commerce', null, [10, 22], 4, 'Lodging'),
  Guard: p('Services', null, [8, 20], 4, 'Safety'),
  Builder: p('Services', 'construction', [7, 16], 4, 'Construction progress'),
  Woodcutter: p('Agriculture', 'lumber', [7, 16], 3, 'Wood', r({}, { wood: 3 }, 60)),
  Stonecutter: p('Agriculture', 'quarry', [7, 16], 3, 'Stone', r({}, { stone: 2 }, 60)),
  Miner: p('Agriculture', 'mine', [7, 16], 4, 'Iron', r({}, { iron: 1 }, 60)),
  Healer: p('Services', null, [8, 17], 5, 'Health'),
  Librarian: p('Services', 'guild', [9, 17], 3, 'Knowledge'),
  Courier: p('Services', null, [7, 15], 3, 'Deliveries'),
}

export const MAX_LEVEL = 10
/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => 150 * level
/** Work speed multiplier from skill: level 10 works 1.9× as fast as level 1. */
/** Gold per worked hour, paid from the town treasury. */
export const wagePerHour = (prof: string, level: number) => ((PROFESSIONS[prof]?.wage ?? 3) + level - 1) * 0.5

export const skillSpeed = (level: number) => 1 + (level - 1) * 0.1

export const professionsAt = (kind: BuildingKind) => Object.keys(PROFESSIONS).filter((k) => PROFESSIONS[k].workplace === kind)

export const onShift = (prof: string, hour: number) => {
  const [a, b] = PROFESSIONS[prof]?.shift ?? [9, 17]
  return hour >= a && hour < b
}
