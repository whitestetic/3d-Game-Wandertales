// ⚠ MOCK DATA — development placeholders, NOT real @wandertales.guild community members.
// Phase 4 replaces this file with residents loaded from the database after voluntary registration.

export type Personality = 'Cheerful' | 'Shy' | 'Hardworking' | 'Social' | 'Greedy' | 'Kind' | 'Adventurous' | 'Lazy'
export type HairStyle = 'short' | 'long' | 'bun' | 'spiky'

export interface Appearance {
  skin: string
  hair: string
  hairStyle: HairStyle
  shirt: string
  pants: string
  hat?: string
  eyes?: 'round' | 'happy' | 'sleepy' | 'wide'
  accessory?: 'none' | 'glasses' | 'scarf' | 'flower'
  build?: 'slim' | 'regular' | 'sturdy'
  height: number
}

export interface Resident {
  id: string
  name: string
  /** only stored with consent; always null for mock residents */
  instagram: string | null
  profession: string
  personality: Personality
  home: string // building id
  /** workplace building id; null = unemployed. Changed by worker assignment. */
  work: string | null
  appearance: Appearance
  /** true = development placeholder, false = registered community member */
  mock: boolean
  originalWork: string | null
  originalProfession: string
}

const r = (id: string, name: string, profession: string, personality: Personality, home: string, work: string, appearance: Appearance): Resident =>
  ({ id, name, instagram: null, profession, personality, home, work, appearance, mock: true, originalWork: work, originalProfession: profession })

export const MOCK_RESIDENTS: Resident[] = [
  r('m01', 'Pip Butterbloom', 'Baker', 'Cheerful', 'h1', 'bakery', { skin: '#f6d2b8', hair: '#8a4b2a', hairStyle: 'bun', shirt: '#f2e3c6', pants: '#7a5a3a', height: 1 }),
  r('m02', 'Bram Ironhand', 'Blacksmith', 'Hardworking', 'h2', 'blacksmith', { skin: '#c99a76', hair: '#2b2220', hairStyle: 'short', shirt: '#5b4636', pants: '#3a3a44', height: 1.08 }),
  r('m03', 'Wren Thistle', 'Farmer', 'Kind', 'h3', 'farm', { skin: '#efc6a4', hair: '#d7a64a', hairStyle: 'long', shirt: '#7fa65a', pants: '#5c4a32', hat: '#d9b45a', height: 0.96 }),
  r('m04', 'Oli Fennick', 'Farmer', 'Lazy', 'h4', 'farm', { skin: '#a8754f', hair: '#3a2416', hairStyle: 'spiky', shirt: '#c98a4b', pants: '#4b5a3a', hat: '#d9b45a', height: 1 }),
  r('m05', 'Marigold Vane', 'Bartender', 'Social', 'h1', 'tavern', { skin: '#f3cfb0', hair: '#b8442e', hairStyle: 'long', shirt: '#9c3d3d', pants: '#3b2b2b', height: 0.98 }),
  r('m06', 'Tobias Quill', 'Librarian', 'Shy', 'h2', 'guild', { skin: '#e7b893', hair: '#5a5a5a', hairStyle: 'short', shirt: '#3e5c8a', pants: '#2f3348', height: 1.04 }),
  r('m07', 'Juniper Lark', 'Merchant', 'Greedy', 'h3', 'market', { skin: '#8d5a3b', hair: '#1d1714', hairStyle: 'bun', shirt: '#d6a03c', pants: '#5b3d6e', height: 0.97 }),
  r('m08', 'Finn Rowe', 'Fisherman', 'Adventurous', 'h4', 'dock', { skin: '#d9a582', hair: '#c9b28a', hairStyle: 'spiky', shirt: '#3f7a8c', pants: '#4a4234', hat: '#6b5a3a', height: 1.02 }),
  r('m09', 'Hazel Moss', 'Builder', 'Hardworking', 'h1', 'construction', { skin: '#f0c9a8', hair: '#6b3e22', hairStyle: 'short', shirt: '#c96f3b', pants: '#4a4a4a', hat: '#e0b23a', height: 1 }),
  r('m10', 'Rosie Plum', 'Shopkeeper', 'Cheerful', 'h2', 'market', { skin: '#b67e5c', hair: '#e5c06e', hairStyle: 'long', shirt: '#cf7fa3', pants: '#5a4a6a', height: 0.95 }),
  r('m11', 'Corwin Ash', 'Cook', 'Social', 'h3', 'tavern', { skin: '#e2b08a', hair: '#7a2f1d', hairStyle: 'spiky', shirt: '#eeeeee', pants: '#3d3d3d', height: 1.06 }),
  r('m12', 'Ivy Brightwater', 'Herbalist', 'Kind', 'h4', 'farm', { skin: '#f7d8c0', hair: '#2f5a3a', hairStyle: 'bun', shirt: '#6aa38a', pants: '#4a3a2a', height: 0.94 }),
]

/** Everyone living in town right now: placeholders (if enabled) + registered residents. Mutated in place. */
export const RESIDENTS: Resident[] = [...MOCK_RESIDENTS]
