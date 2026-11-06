import { useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { NODES } from '../game/map'
import { checkPlacement, footprint, placeBuilding } from '../game/town'
import { useGame } from '../game/store'
import { Model } from './Buildings'

const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** Confirm the current placement. Used by click (desktop) and the Build button. */
export function confirmPlacement() {
  const s = useGame.getState(), p = s.placing
  if (!p || p.x === null || p.z === null) return
  const res = placeBuilding(p.kind, p.x, p.z, p.rot, s.time)
  if (res.error) return s.notify(res.error)
  s.notify('Construction started — builders are on their way')
  useGame.setState({ placing: null })
}

export const rotatePlacement = () => useGame.setState((s) => (s.placing ? { placing: { ...s.placing, rot: (s.placing.rot + Math.PI / 2) % (Math.PI * 2) } } : s))

/** Ghost building that follows the pointer, green when the spot is valid. */
export function Placement() {
  const placing = useGame((s) => s.placing)
  useGame((s) => s.rev)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useGame.getState().placing) return
      if (e.code === 'KeyR') rotatePlacement()
      if (e.code === 'Escape') useGame.setState({ placing: null })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const check = useMemo(() => placing && placing.x !== null && placing.z !== null ? checkPlacement(placing.kind, placing.x, placing.z, placing.rot) : null, [placing])
  if (!placing) return null

  const move = (e: ThreeEvent<PointerEvent>) => {
    const x = Math.round(e.point.x), z = Math.round(e.point.z)
    const p = useGame.getState().placing
    if (p && (p.x !== x || p.z !== z)) useGame.setState({ placing: { ...p, x, z } })
  }
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return
    e.stopPropagation()
    const p = useGame.getState().placing!
    const x = Math.round(e.point.x), z = Math.round(e.point.z)
    // touch: first tap previews, the Build button confirms. Mouse: click on a valid spot builds.
    if (touch || p.x !== x || p.z !== z) return useGame.setState({ placing: { ...p, x, z } })
    if (check?.ok) confirmPlacement()
    else if (check) useGame.getState().notify(check.reason)
  }

  const { w, d } = footprint(placing.kind, placing.rot)
  const sideways = Math.abs(Math.sin(placing.rot)) > 0.5
  const color = check?.ok ? '#5fd17a' : '#e05a4f'
  const road = check?.ok && check.connect ? NODES[check.connect] : null
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} onPointerMove={move} onClick={click}>
        <planeGeometry args={[240, 240]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {placing.x !== null && placing.z !== null && (
        <group position={[placing.x, 0, placing.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
            <planeGeometry args={[w + 0.4, d + 0.4]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
          </mesh>
          <group rotation={[0, placing.rot, 0]}>
            <Model b={{ id: 'ghost', kind: placing.kind }} W={sideways ? d : w} D={sideways ? w : d} />
          </group>
        </group>
      )}
      {check && (
        <mesh position={[check.door[0], 0.1, check.door[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.6, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
      {road && check && (
        <mesh position={[(check.door[0] + road[0]) / 2, 0.07, (check.door[1] + road[1]) / 2]}
          rotation={[0, Math.atan2(road[0] - check.door[0], road[1] - check.door[1]), 0]}>
          <boxGeometry args={[2.4, 0.04, Math.hypot(road[0] - check.door[0], road[1] - check.door[1])]} />
          <meshBasicMaterial color="#e6d5a8" transparent opacity={0.8} />
        </mesh>
      )}
    </>
  )
}
