// What should be audible right now. Pure (no Web Audio here), so it can be tested headless.
import type { Season } from './calendar.ts'

export interface Levels { rain: number; wind: number; birds: number; music: number }
export interface WorldLook { night: number; rain: number; snow: number; cloud: number }

const clamp = (x: number) => Math.max(0, Math.min(1, x))

/** Every level is 0..1. Nature sounds follow the weather and the time of day; the background music is always on. */
export function audioMix(e: WorldLook, season: Season): Levels {
  const calm = 1 - Math.max(e.rain, e.snow) // birds go quiet in rain and snow
  const warm = season === 'winter' ? 0 : season === 'autumn' ? 0.5 : 1
  return {
    rain: clamp(e.rain),
    wind: clamp(e.snow * 0.6 + (e.rain > 0.9 ? 0.7 : e.rain * 0.25) + e.cloud * 0.1),
    birds: clamp(1 - e.night * 2) * calm * (1 - e.cloud * 0.5) * warm,
    music: 1,
  }
}
