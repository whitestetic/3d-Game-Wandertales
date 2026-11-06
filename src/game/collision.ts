export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

export function circleHitsBox(x: number, z: number, r: number, b: Box): boolean {
  const cx = Math.max(b.minX, Math.min(x, b.maxX))
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r
}

export function collides(x: number, z: number, r: number, boxes: Box[], half: number): boolean {
  if (Math.abs(x) > half - r || Math.abs(z) > half - r) return true
  for (const b of boxes) if (circleHitsBox(x, z, r, b)) return true
  return false
}

/** Move a circle by (dx, dz), sliding along walls axis by axis. */
export function slide(x: number, z: number, dx: number, dz: number, r: number, boxes: Box[], half: number): [number, number] {
  if (!collides(x + dx, z, r, boxes, half)) x += dx
  if (!collides(x, z + dz, r, boxes, half)) z += dz
  return [x, z]
}
