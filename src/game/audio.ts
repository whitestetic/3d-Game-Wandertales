// Sound: rain, wind, birds and thunder are made with Web Audio (no sound files); the music is public/audio/bgm.mp3. Browsers only allow sound after a click or key press, so nothing starts before that.
import { seasonOf } from './calendar.ts'
import { audioMix } from './audiomix.ts'
import { env } from './live.ts'
import { useGame } from './store.ts'

const KEY = 'wt.audio'
const unit = (x: unknown, fallback: number) => (typeof x === 'number' ? Math.max(0, Math.min(1, x)) : fallback)
/** on/off, master volume, and the music (BGM) volume on top of it. */
const load = (): { on: boolean; vol: number; music: number } => {
  try { const d = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (d) return { on: d.on !== false, vol: unit(d.vol, 0.6), music: unit(d.music, 0.6) } } catch { /* default */ }
  return { on: true, vol: 0.6, music: 0.6 }
}
export const audioState = load()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(audioState)) } catch { /* blocked */ } }

// loudness ceiling of each layer (before the master volume)
const MAX = { rain: 0.32, wind: 0.28, birds: 0.5, music: 0.3 } // music slider 60% (the default) = 0.18: a quiet, cozy background
const BGM_URL = `${import.meta.env.BASE_URL ?? '/'}audio/bgm.mp3`

interface Graph { bgm: HTMLAudioElement; ctx: AudioContext; master: GainNode; layer: Record<keyof typeof MAX, GainNode>; noise: AudioBuffer }
let g: Graph | null = null

function noiseBuffer(c: AudioContext) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return b
}

/** Create the audio graph (once). Must run from a user gesture. */
export function startAudio() {
  if (g) { void g.ctx.resume(); return }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  const ctx = new AC(), master = ctx.createGain()
  master.gain.value = audioState.on ? audioState.vol : 0
  master.connect(ctx.destination)
  const layer = {} as Graph['layer']
  for (const k of Object.keys(MAX) as (keyof typeof MAX)[]) { layer[k] = ctx.createGain(); layer[k].gain.value = 0; layer[k].connect(master) }
  const noise = noiseBuffer(ctx)
  const loop = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s }

  const rainF = ctx.createBiquadFilter(); rainF.type = 'bandpass'; rainF.frequency.value = 1500; rainF.Q.value = 0.4
  loop().connect(rainF).connect(layer.rain)

  const windF = ctx.createBiquadFilter(); windF.type = 'lowpass'; windF.frequency.value = 500
  const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain()
  lfo.frequency.value = 0.15; lfoAmt.gain.value = 250
  lfo.connect(lfoAmt).connect(windF.frequency); lfo.start()
  loop().connect(windF).connect(layer.wind)

  // background music: looped, with the highs rolled off for a warmer, softer feel
  const bgm = new Audio(BGM_URL), warm = ctx.createBiquadFilter()
  bgm.loop = true; warm.type = 'lowpass'; warm.frequency.value = 4200; warm.Q.value = 0.5
  ctx.createMediaElementSource(bgm).connect(warm).connect(layer.music)
  if (audioState.on) void bgm.play().catch(() => {})

  g = { bgm, ctx, master, layer, noise }
  document.addEventListener('visibilitychange', () => {
    if (!g) return
    if (document.hidden) { g.bgm.pause(); void g.ctx.suspend() } else { void g.ctx.resume(); if (audioState.on) void g.bgm.play().catch(() => {}) }
  })
}

/** Start sound on the first click or key press (browser autoplay rule). */
export function initAudioOnGesture() {
  const go = () => { startAudio(); removeEventListener('pointerdown', go); removeEventListener('keydown', go) }
  addEventListener('pointerdown', go)
  addEventListener('keydown', go)
}

/** Music (BGM) volume, 0..1. */
export function setMusicVolume(v: number) { audioState.music = unit(v, audioState.music); save() }

export function setSound(on: boolean, vol = audioState.vol) {
  audioState.on = on; audioState.vol = Math.max(0, Math.min(1, vol)); save()
  if (g) {
    g.master.gain.setTargetAtTime(on ? audioState.vol : 0, g.ctx.currentTime, 0.1)
    if (on) void g.bgm.play().catch(() => {}); else g.bgm.pause()
  }
}

function chirp() {
  if (!g) return
  const { ctx, layer } = g, t = ctx.currentTime, o = ctx.createOscillator(), e = ctx.createGain()
  const f = 1900 + Math.random() * 1400
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.45, t + 0.1)
  e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.35, t + 0.02); e.gain.linearRampToValueAtTime(0, t + 0.14)
  o.connect(e).connect(layer.birds); o.start(t); o.stop(t + 0.16)
}

/** A low rumble a moment after the lightning flash. */
export function thunder() {
  if (!g || !audioState.on || useGame.getState().interior) return
  const { ctx, master, noise } = g, t = ctx.currentTime + 0.25 + Math.random() * 1.4
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), e = ctx.createGain()
  s.buffer = noise; f.type = 'lowpass'; f.frequency.value = 170
  e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.9, t + 0.15); e.gain.exponentialRampToValueAtTime(0.001, t + 2.6)
  s.connect(f).connect(e).connect(master); s.start(t); s.stop(t + 2.7)
}

let birdTimer = 0
/** Call every frame (real seconds): moves each layer toward what the weather and clock call for. */
export function updateAudio(dt: number) {
  if (!g || !audioState.on || g.ctx.state !== 'running') return
  const t = useGame.getState().time
  const lv = audioMix(env, seasonOf(t))
  const muffle = useGame.getState().interior ? 0.25 : 1 // walls hush rain, wind and birds; the music stays
  for (const k of Object.keys(MAX) as (keyof typeof MAX)[]) g.layer[k].gain.setTargetAtTime(lv[k] * MAX[k] * (k === 'music' ? audioState.music : muffle), g.ctx.currentTime, 0.6)
  if ((birdTimer -= dt) <= 0) { birdTimer = 1.2 + Math.random() * 3.5; if (lv.birds > 0.05) chirp() }
}

/** For checking in the browser console: is sound running and how loud is each layer? */
export const audioDebug = () => g && { state: g.ctx.state, master: +g.master.gain.value.toFixed(2), ...Object.fromEntries(Object.entries(g.layer).map(([k, n]) => [k, +n.gain.value.toFixed(3)])) }
