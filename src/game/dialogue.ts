// Deterministic, template-based dialogue. Built from personality, profession, place,
// relationship and needs — no external AI calls.
import type { Personality, Resident } from './residents.mock.ts'

export function hash(...parts: (string | number)[]) {
  let h = 2166136261
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}
const pick = <T,>(arr: T[], h: number) => arr[h % arr.length]

const OPENERS: Record<string, string[]> = {
  Stranger: ['Hello there, I\'m {a}.', 'Oh — I don\'t think we\'ve met. I\'m {a}.', 'Nice weather, isn\'t it?'],
  Acquaintance: ['Oh, hi {b}!', 'Morning, {b}.', 'Hey {b}, how are things?'],
  Friend: ['{b}! Good to see you.', 'There you are, {b}!', 'Just the person I wanted to see.'],
  'Good Friend': ['{b}! Come sit with me.', 'I was hoping I\'d run into you, {b}.', 'You always make my day, {b}.'],
  'Best Friend': ['{b}, my dearest friend!', 'Finally! I saved you a spot, {b}.', 'Partner in crime! What\'s new?'],
}

const TOPICS: Record<string, string[]> = {
  Baker: ['The rye loaves rose perfectly today.', 'I\'m trying a honey-oat recipe next week.', 'Flour gets everywhere, I swear.'],
  Blacksmith: ['The forge ran hot all day.', 'I\'m tempering a new set of horseshoes.', 'Good iron is getting hard to find.'],
  Farmer: ['The wheat is coming in golden this year.', 'Crows keep testing my scarecrow.', 'We could use a bit of rain.'],
  Bartender: ['The new cider barrel is a hit.', 'You should hear the stories travellers tell.', 'Last night\'s crowd sang till midnight.'],
  Cook: ['I\'m perfecting a mushroom stew.', 'A pinch of thyme changes everything.', 'The tavern kitchen never sleeps.'],
  Librarian: ['I found an old map of the river in the archives.', 'The Guild records are finally sorted.', 'Have you read the tale of the Silver Griffin?'],
  Merchant: ['Business is brisk today.', 'I\'ve got a supplier from the eastern road.', 'Buy low, sell with a smile.'],
  Shopkeeper: ['My shelves need restocking.', 'A customer asked for purple ribbons — purple!', 'I love the market bustle.'],
  Fisherman: ['The trout were jumping at dawn.', 'Lost a big one by the dock again.', 'The river\'s calm today.'],
  Builder: ['That plot by the farm is ready for something new.', 'Measure twice, cut once.', 'My hands are full of splinters.'],
  Herbalist: ['The lavender is blooming early.', 'Chamomile tea fixes most things.', 'I found wild mint by the river.'],
}
const GENERIC = ['Life in WanderTales is good.', 'Did you see the Guild Master today?', 'I wonder what the Guild will build next.']

const PLACES: Record<string, string[]> = {
  tavern: ['This cider is wonderful.', 'Cozy in here, isn\'t it?'],
  market: ['Have you seen the prices today?', 'Everything smells so good here.'],
  square: ['The fountain sparkles in this light.', 'I love watching the town go by.'],
}

const FLAVOR: Partial<Record<Personality, string[]>> = {
  Shy: ['…um.', '(smiles quietly)'],
  Cheerful: ['Isn\'t that wonderful?', 'Ha ha!'],
  Greedy: ['Not that it pays much.', 'Gold doesn\'t grow on trees.'],
  Lazy: ['*yawn*', 'Anyway… nap time soon.'],
  Adventurous: ['Someday I\'ll see what\'s beyond the mountains.'],
}

export function placeKind(node: string) {
  if (node === 'tavern' || node === 'market') return node
  if (node.startsWith('s') && node.length <= 3) return 'square'
  return ''
}

/** A line `a` says to `b` during a conversation. */
export function chatLine(a: Resident, b: Resident, level: string, place: string, seed: number) {
  const h = hash(a.id, b.id, seed)
  const parts = [pick(OPENERS[level], h).replace('{a}', a.name.split(' ')[0]).replace('{b}', b.name.split(' ')[0])]
  const placeLines = PLACES[place]
  parts.push(placeLines && h % 3 === 0 ? pick(placeLines, h >>> 3) : pick(TOPICS[a.profession] ?? GENERIC, h >>> 5))
  const fl = FLAVOR[a.personality]
  if (fl && (h >>> 9) % 3 === 0) parts.push(pick(fl, h >>> 11))
  return parts.join(' ')
}

const GM_LINES: Record<Personality, string[]> = {
  Cheerful: ['What a lovely day in WanderTales!', 'Guild Master! You always brighten my day.'],
  Shy: ['Oh! H-hello, Guild Master…', 'I… I like it quiet around here.'],
  Hardworking: ['No time to chat — lots to do!', 'An honest day of work builds an honest town.'],
  Social: ['Join us at the tavern later!', 'This town needs more festivals, if you ask me.'],
  Greedy: ['Gold makes the world go round, Guild Master.', 'Got anything to trade?'],
  Kind: ['Take care of yourself, Guild Master.', 'If anyone needs help, just ask me.'],
  Adventurous: ['Someday I want to join the Guild and see the world!', 'I heard something strange in the forest last night.'],
  Lazy: ['*yawn* … is it lunch yet?', 'A nap under a tree sounds perfect.'],
}

/** What a resident says to the Guild Master, reflecting their current needs and job. */
export function gmLine(res: Resident, needs: { hunger: number; energy: number; social: number }, activity: string, level: number, day: number) {
  if (needs.hunger < 25) return 'My stomach is growling… I really need a meal.'
  if (needs.energy < 25) return '*yawn* … I can barely keep my eyes open.'
  if (needs.social < 25) return 'It\'s been a lonely day. Thanks for stopping to chat!'
  const line = pick(GM_LINES[res.personality], hash(res.id, day))
  if (activity === 'Working') return `${line} (On shift — ${res.profession.toLowerCase()}, level ${level}.)`
  return line
}
