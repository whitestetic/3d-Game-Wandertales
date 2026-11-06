// Per-frame mutable state shared between systems. Kept outside React/zustand
// so 60fps updates don't trigger re-renders.
import { Vector3 } from 'three'

export const input = {
  keys: new Set<string>(),
  joy: { x: 0, y: 0 },
  sprint: false,
}

export const player = { pos: new Vector3(2, 0, 9), facing: Math.PI }

export const npcLive: Record<string, { x: number; z: number; activity: string; visible: boolean }> = {}

/**
 * Live look of the world, written by the day/night and weather systems (all 0..1).
 * night: 0 = full day, 1 = deep night. The rest ease toward what game/calendar.ts says.
 */
export const env = { night: 0, cloud: 0, rain: 0, snow: 0, fog: 0, wet: 0, snowCover: 0, leaves: 0, petals: 0 }

const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
addEventListener('keydown', (e) => { if (!typing(e)) input.keys.add(e.code) })
addEventListener('keyup', (e) => input.keys.delete(e.code))
addEventListener('blur', () => input.keys.clear())

export const key = (c: string) => (input.keys.has(c) ? 1 : 0)

/** Camera rig parameters, shared by CameraRig (writes) and Player (reads yaw). */
export const cam = {
  isoTarget: new Vector3(0, 0, 2),
  isoYaw: Math.PI / 4,
  isoDist: 58,
  tpYaw: 0,
  tpPitch: 0.35,
  tpDist: 7,
}

export function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + d * t
}
