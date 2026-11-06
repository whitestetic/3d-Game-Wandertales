import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { cam, key, player } from '../game/live'
import { useGame } from '../game/store'
import { ROOM } from '../game/interior'

const ISO_PITCH = 0.92 // ~53° down
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const desired = new Vector3(), target = new Vector3()

/**
 * One camera, two modes. Both modes just compute a desired position + look target;
 * the camera eases toward them every frame, which also gives the smooth mode transition.
 */
export function CameraRig() {
  const { camera, gl } = useThree()
  const look = useRef(new Vector3(0, 0, 0))

  // keep camera state coherent when the mode flips
  useEffect(() => useGame.subscribe((s, prev) => {
    if (s.mode === prev.mode) return
    if (s.mode === 'iso') {
      cam.isoTarget.set(player.pos.x, 0, player.pos.z)
    } else {
      cam.tpYaw = Math.atan2(camera.position.x - player.pos.x, camera.position.z - player.pos.z)
    }
  }), [camera])

  useEffect(() => {
    const el = gl.domElement
    const pts = new Map<number, { x: number; y: number; button: number }>()
    let pinch = 0
    const zoom = (f: number) => {
      if (useGame.getState().mode === 'iso') cam.isoDist = clamp(cam.isoDist * f, 14, 85)
      else cam.tpDist = clamp(cam.tpDist * f, 3, 14)
    }
    const down = (e: PointerEvent) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button }); pinch = 0 }
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch) zoom(pinch / d)
        pinch = d
        return
      }
      if (useGame.getState().mode === 'iso') {
        if (p.button === 2) { cam.isoYaw -= dx * 0.006; return }
        const s = cam.isoDist * 0.0022, y = cam.isoYaw
        cam.isoTarget.x += -Math.cos(y) * dx * s - Math.sin(y) * dy * s
        cam.isoTarget.z += Math.sin(y) * dx * s - Math.cos(y) * dy * s
      } else {
        cam.tpYaw -= dx * 0.006
        cam.tpPitch = clamp(cam.tpPitch + dy * 0.004, 0.05, 1.2)
      }
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0 }
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoom(1 + clamp(e.deltaY, -100, 100) * 0.0012) }
    const menu = (e: Event) => e.preventDefault()
    el.addEventListener('pointerdown', down)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', menu)
    return () => {
      el.removeEventListener('pointerdown', down)
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', menu)
    }
  }, [gl])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = useGame.getState()
    if (s.focus) {
      cam.isoTarget.set(s.focus[0], 0, s.focus[1])
      useGame.setState({ focus: null })
    }
    if (s.mode === 'iso') {
      const y = cam.isoYaw
      const f = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown')
      const r = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft')
      const sp = cam.isoDist * 0.9 * dt
      cam.isoTarget.x += (-Math.sin(y) * f + Math.cos(y) * r) * sp
      cam.isoTarget.z += (-Math.cos(y) * f - Math.sin(y) * r) * sp
      cam.isoYaw += (key('KeyE') - key('KeyQ')) * 1.6 * dt
      cam.isoTarget.x = clamp(cam.isoTarget.x, -55, 55)
      cam.isoTarget.z = clamp(cam.isoTarget.z, -55, 55)
      target.copy(cam.isoTarget)
      desired.set(Math.sin(y) * Math.cos(ISO_PITCH), Math.sin(ISO_PITCH), Math.cos(y) * Math.cos(ISO_PITCH)).multiplyScalar(cam.isoDist).add(target)
    } else {
      const { tpYaw: y, tpPitch: p, tpDist: d } = cam
      target.set(player.pos.x, 1.3, player.pos.z)
      desired.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(d).add(target)
      desired.y = Math.max(desired.y, 0.6)
      if (s.interior) { // never let the camera leave the room or poke through the ceiling
        desired.x = clamp(desired.x, ROOM.cx - ROOM.hx + 0.7, ROOM.cx + ROOM.hx - 0.7)
        desired.z = clamp(desired.z, ROOM.cz - ROOM.hz + 0.7, ROOM.cz + ROOM.hz + 6) // may sit outside the door: the front wall is hidden then
        desired.y = clamp(desired.y, 0.8, ROOM.ceiling - 0.5)
      }
    }
    const k = 1 - Math.exp(-dt * (s.mode === 'iso' ? 6 : 10))
    camera.position.lerp(desired, k)
    look.current.lerp(target, k)
    camera.lookAt(look.current)
  })
  return null
}
