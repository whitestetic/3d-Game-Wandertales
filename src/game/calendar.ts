// Seasons, weather and festivals. Everything is a pure function of the game clock, so it needs no
// saving, stays identical after a reload, and can be tested headless.
import { hash } from './dialogue.ts'
import type { BuildingKind } from './map.ts'
import { town } from './town.ts'
import { RESIDENTS } from './residents.mock.ts'
import { chron, chronicle } from './chronicle.ts'

export const SEASON_DAYS = 7 // 4 seasons → a 28-day year
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
export const SEASON_INFO: Record<Season, { name: string; icon: string; blurb: string }> = {
  spring: { name: 'Spring', icon: '🌸', blurb: 'Blossoms and showers. Crops wake up.' },
  summer: { name: 'Summer', icon: '☀️', blurb: 'Long warm days. Farms grow faster.' },
  autumn: { name: 'Autumn', icon: '🍂', blurb: 'Harvest time, falling leaves, more rain.' },
  winter: { name: 'Winter', icon: '❄️', blurb: 'Snow and short days. Farms slow down.' },
}

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog'
export const WEATHER_INFO: Record<Weather, { name: string; icon: string }> = {
  clear: { name: 'Clear', icon: '☀️' }, cloudy: { name: 'Cloudy', icon: '☁️' }, rain: { name: 'Rain', icon: '🌧️' },
  storm: { name: 'Thunderstorm', icon: '⛈️' }, snow: { name: 'Snow', icon: '❄️' }, fog: { name: 'Fog', icon: '🌫️' },
}

const dayIndex = (t: number) => Math.floor(t / 1440) // 0-based
export const seasonOf = (t: number): Season => SEASONS[Math.floor(dayIndex(t) / SEASON_DAYS) % 4]
export const dayInSeason = (t: number) => (dayIndex(t) % SEASON_DAYS) + 1
export const yearOf = (t: number) => Math.floor(dayIndex(t) / (SEASON_DAYS * 4)) + 1

// weighted weather table per season
const TABLE: Record<Season, [Weather, number][]> = {
  spring: [['clear', 4], ['cloudy', 2], ['rain', 3], ['fog', 1]],
  summer: [['clear', 6], ['cloudy', 2], ['rain', 1], ['storm', 1]],
  autumn: [['clear', 3], ['cloudy', 3], ['rain', 3], ['fog', 2], ['storm', 1]],
  winter: [['clear', 3], ['cloudy', 2], ['snow', 4], ['fog', 1]],
}

export interface DayWeather { type: Weather; /** hours of the day it lasts */ from: number; to: number }
/** The weather event of a day: the first day is always clear; a cloudy day lasts all day, others come and go. */
export function weatherOfDay(day: number): DayWeather {
  const season = SEASONS[Math.floor(day / SEASON_DAYS) % 4]
  if (day === 0) return { type: 'clear', from: 0, to: 24 }
  const rows = TABLE[season], total = rows.reduce((a, [, w]) => a + w, 0)
  let roll = hash('wx', day) % total, type: Weather = 'clear'
  for (const [w, n] of rows) { if (roll < n) { type = w; break } roll -= n }
  if (type === 'clear' || type === 'cloudy') return { type, from: 0, to: 24 }
  const from = 4 + (hash('wxs', day) % 10), len = 4 + (hash('wxd', day) % 7)
  return { type, from, to: Math.min(24, from + len) }
}
export function weatherAt(t: number): Weather {
  const w = weatherOfDay(dayIndex(t)), h = (t % 1440) / 60
  return h >= w.from && h < w.to ? w.type : 'clear'
}

// ---------- festivals: the last day of every season, in the evening ----------
export interface Festival { key: string; name: string; icon: string; blurb: string; colors: string[] }
export const FESTIVALS: Record<Season, Festival> = {
  spring: { key: 'blossom', name: 'Blossom Festival', icon: '🌸', blurb: 'Flower crowns and dancing on the square.', colors: ['#f6a5c0', '#fbd5e2', '#ffffff', '#b8e0a0'] },
  summer: { key: 'midsummer', name: 'Midsummer Fair', icon: '🎆', blurb: 'Games, music and lanterns until late.', colors: ['#f4d35e', '#ee6c9a', '#6ec6e8', '#ff8a5b'] },
  autumn: { key: 'harvest', name: 'Harvest Festival', icon: '🌾', blurb: 'A feast to thank the farms.', colors: ['#d9a04a', '#c2562f', '#8a5a2b', '#e8c27a'] },
  winter: { key: 'lights', name: 'Winter Lights', icon: '✨', blurb: 'Lanterns glowing in the snow.', colors: ['#9fd0ff', '#ffffff', '#ffd27a', '#c9a7ff'] },
}
export const FESTIVAL_START = 14, FESTIVAL_END = 23
export const isFestivalDay = (t: number) => dayInSeason(t) === SEASON_DAYS
export function festivalAt(t: number): Festival | null {
  const h = (t % 1440) / 60
  return isFestivalDay(t) && h >= FESTIVAL_START && h < FESTIVAL_END ? FESTIVALS[seasonOf(t)] : null
}

// ---------- gameplay effects ----------
const OUTDOOR = new Set<BuildingKind>(['farm', 'lumber', 'quarry', 'dock', 'mine'])
const FARM_SEASON: Record<Season, number> = { spring: 1, summer: 1.15, autumn: 1.1, winter: 0.5 }
const OUTDOOR_WEATHER: Record<Weather, number> = { clear: 1, cloudy: 1, fog: 0.95, rain: 0.9, snow: 0.75, storm: 0.6 }

/** Production speed multiplier for a workplace right now (1 = normal). Farms love summer and gentle rain. */
export function workSpeed(kind: BuildingKind | undefined, t: number): number {
  if (!kind || !OUTDOOR.has(kind)) return 1
  const w = weatherAt(t)
  let f = OUTDOOR_WEATHER[w]
  if (kind === 'farm') { f *= FARM_SEASON[seasonOf(t)]; if (w === 'rain') f = 1.1 * FARM_SEASON[seasonOf(t)] }
  return f
}
/** Happiness pressure per hour on someone standing outside in bad weather. */
export function exposure(t: number): number {
  const w = weatherAt(t)
  return w === 'storm' ? 10 : w === 'snow' ? 6 : w === 'rain' ? 4 : 0
}

/** Live flag for the life sim (set each frame by advanceCalendar); stepNeeds itself uses the pure functions. */
export const cal = { festival: null as Festival | null }

// ---------- calendar clock: logs the Chronicle and returns announcements ----------
const GOLD_MARKS = [500, 1000, 2500, 5000, 10000]
const POP_MARKS = [15, 20, 30, 50]

/** Call every frame with the game time. Handles season changes, storms, snow, festivals and milestones. */
export function advanceCalendar(t: number): string[] {
  const msgs: string[] = []
  const today = dayIndex(t)
  if (chronicle.lastDay < 0) chronicle.lastDay = today // new game or an old save: no backfill
  for (let d = Math.max(chronicle.lastDay + 1, today - 3); d <= today; d++) {
    const t0 = d * 1440
    if (d > 0 && d % SEASON_DAYS === 0) {
      const s = seasonOf(t0), info = SEASON_INFO[s]
      chron(t0, 'season', info.icon, `${info.name} begins${s === 'spring' ? ` — year ${yearOf(t0)}` : ''}. ${info.blurb}`)
      msgs.push(`${info.icon} ${info.name} has arrived`)
    }
    const w = weatherOfDay(d)
    if (w.type === 'storm' || w.type === 'snow') {
      const info = WEATHER_INFO[w.type]
      chron(t0 + w.from * 60, 'weather', info.icon, w.type === 'storm' ? 'A thunderstorm rolls over the valley.' : 'Snow starts to fall on the town.')
    }
    if (isFestivalDay(t0)) msgs.push(`${FESTIVALS[seasonOf(t0)].icon} ${FESTIVALS[seasonOf(t0)].name} tonight at the square!`)
  }
  chronicle.lastDay = today
  const f = festivalAt(t)
  cal.festival = f
  if (f &&!chronicle.seen.includes(`fest:${today}`)) {
    chron(t, 'festival', f.icon, `The ${f.name} begins on the town square. ${f.blurb}`, `fest:${today}`)
    msgs.push(`${f.icon} The ${f.name} has begun!`)
  }
  for (const g of GOLD_MARKS) if (town.gold >= g) chron(t, 'milestone', '💰', `The treasury reached ${g} gold.`, `gold:${g}`)
  for (const p of POP_MARKS) if (RESIDENTS.length >= p) chron(t, 'milestone', '👥', `The town now has ${p} residents.`, `pop:${p}`)
  return msgs
}
