import * as THREE from 'three'

// Shared geometries/materials keep draw-state changes and GPU memory low.
const cache = new Map<string, THREE.MeshStandardMaterial>()
export function mat(color: string, opts: { rough?: number; emissive?: string } = {}) {
  const k = `${color}|${opts.rough ?? 0.85}|${opts.emissive ?? ''}`
  let m = cache.get(k)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, flatShading: true })
    if (opts.emissive) m.emissive = new THREE.Color(opts.emissive)
    cache.set(k, m)
  }
  return m
}

/** Materials that glow at night; DayNight updates their intensity. */
export const glow = {
  window: new THREE.MeshStandardMaterial({ color: '#3b3226', emissive: '#ffb35a', emissiveIntensity: 0, roughness: 0.6 }),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffbf5e', emissiveIntensity: 0.2, roughness: 0.4 }),
  forge: new THREE.MeshStandardMaterial({ color: '#ff7a2a', emissive: '#ff5a10', emissiveIntensity: 1.6, roughness: 0.5 }),
}

export const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  dome: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone: new THREE.ConeGeometry(1, 1, 8),
  /** triangular prism roof: ridge along x, 1 long × 1 wide × 1 tall, base at y=0 */
  prism: (() => {
    const g = new THREE.CylinderGeometry(0.5774, 0.5774, 1, 3)
    g.rotateZ(Math.PI / 2)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0.2887, 0)
    g.scale(1, 1.155, 1)
    return g
  })(),
}
