// Headless thumbnail renderer: projects triangles to a 3/4 view and writes a flat-shaded SVG (painter's algorithm).
import { add, cross, dot, norm, sub, type Body, type Part, type V3 } from './lib.ts'

const VIEW_YAW = -0.55, VIEW_PITCH = 0.18
const LIGHT = norm([0.4, 0.8, 0.6])

function project(p: V3): V3 {
  const cy = Math.cos(VIEW_YAW), sy = Math.sin(VIEW_YAW), cp = Math.cos(VIEW_PITCH), sp = Math.sin(VIEW_PITCH)
  const x = p[0] * cy + p[2] * sy, z0 = -p[0] * sy + p[2] * cy
  const y = p[1] * cp - z0 * sp, z = p[1] * sp + z0 * cp
  return [x, y, z]
}
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16)
  const ch = (s: number) => Math.round(Math.min(255, ((n >> s) & 255) * k)).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

export interface DrawItem { pos: V3[]; idx: number[]; color: string }

export function renderSvg(items: DrawItem[], opts: { size?: number; focus?: { min: V3; max: V3 } } = {}): string {
  const size = opts.size ?? 160
  const tris: { pts: V3[]; depth: number; fill: string }[] = []
  for (const it of items) for (let i = 0; i < it.idx.length; i += 3) {
    const w = [it.pos[it.idx[i]], it.pos[it.idx[i + 1]], it.pos[it.idx[i + 2]]]
    const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])))
    const pr = w.map(project)
    // double-sided lighting so thin cloth reads correctly
    const k = 0.45 + 0.55 * Math.abs(dot(n, LIGHT))
    tris.push({ pts: pr, depth: (pr[0][2] + pr[1][2] + pr[2][2]) / 3, fill: shade(it.color, k) })
  }
  const all = tris.flatMap((t) => t.pts)
  const f = opts.focus ? [opts.focus.min, opts.focus.max, [opts.focus.min[0], opts.focus.max[1], opts.focus.max[2]] as V3, [opts.focus.max[0], opts.focus.min[1], opts.focus.min[2]] as V3].map(project) : all
  const minX = Math.min(...f.map((p) => p[0])), maxX = Math.max(...f.map((p) => p[0])), minY = Math.min(...f.map((p) => p[1])), maxY = Math.max(...f.map((p) => p[1]))
  const s = (size * 0.86) / Math.max(maxX - minX, maxY - minY, 1e-6)
  const ox = size / 2 - ((minX + maxX) / 2) * s, oy = size / 2 + ((minY + maxY) / 2) * s
  tris.sort((a, b) => a.depth - b.depth)
  const poly = tris.map((t) => `<polygon points="${t.pts.map((p) => `${(ox + p[0] * s).toFixed(1)},${(oy - p[1] * s).toFixed(1)}`).join(' ')}" fill="${t.fill}" stroke="${t.fill}" stroke-width="0.4"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#f5ead3"/>${poly}</svg>`
}

export const bodyItems = (b: Body, skin = '#f1c9a5'): DrawItem[] => [
  { pos: b.verts, idx: b.tris.flat(), color: skin },
  { pos: b.eyeVerts.map((p) => [p[0], p[1], p[2] + 0.0015] as V3), idx: b.eyeTris, color: '#2a1f1a' },
]
export const partItems = (parts: Part[], colors: Record<string, string | undefined>): DrawItem[] => parts.map((p) => ({ pos: p.pos, idx: p.idx, color: colors[p.channel] ?? '#cccccc' }))
void add
