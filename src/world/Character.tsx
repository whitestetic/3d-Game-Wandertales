import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { geo, mat } from './materials'
import type { Appearance } from '../game/residents.mock'

export interface Anim { speed: number; mode: 'idle' | 'walk' | 'work' }

/**
 * Modular chibi character built from shared primitives.
 * Swap parts by changing Appearance — later this is where GLB cosmetic parts plug in.
 */
export function Character({ look, anim, cape }: { look: Appearance; anim: RefObject<Anim>; cape?: string }) {
  const body = useRef<Group>(null!)
  const legL = useRef<Group>(null!), legR = useRef<Group>(null!)
  const armL = useRef<Group>(null!), armR = useRef<Group>(null!)
  const phase = useRef(Math.random() * 10)

  useFrame(({ camera }, dt) => {
    // distance tier: far-away characters are a few pixels tall, skip limb animation
    const e = body.current.matrixWorld.elements
    if ((camera.position.x - e[12]) ** 2 + (camera.position.z - e[14]) ** 2 > 90 * 90) return
    const a = anim.current
    const walking = a.mode === 'walk'
    phase.current += dt * (walking ? 3 + a.speed * 2.2 : a.mode === 'work' ? 7 : 1.6)
    const p = phase.current
    const swing = walking ? Math.min(0.75, 0.25 + a.speed * 0.12) : 0
    legL.current.rotation.x = Math.sin(p) * swing
    legR.current.rotation.x = -Math.sin(p) * swing
    if (a.mode === 'work') {
      armR.current.rotation.x = -1.2 + Math.sin(p) * 0.7
      armL.current.rotation.x = -0.4
    } else {
      armL.current.rotation.x = -Math.sin(p) * swing
      armR.current.rotation.x = Math.sin(p) * swing
    }
    body.current.position.y = walking ? Math.abs(Math.sin(p)) * 0.07 : Math.sin(p) * 0.015
  })

  const skin = mat(look.skin), hair = mat(look.hair), shirt = mat(look.shirt), pants = mat(look.pants)
  const bw = look.build === 'slim' ? 0.86 : look.build === 'sturdy' ? 1.18 : 1 // body width
  return (
    <group scale={look.height}>
      <group ref={body}>
        {/* legs pivot at the hip */}
        <group ref={legL} position={[-0.12, 0.42, 0]}>
          <mesh geometry={geo.box} material={pants} position={[0, -0.2, 0]} scale={[0.17, 0.42, 0.18]} castShadow />
        </group>
        <group ref={legR} position={[0.12, 0.42, 0]}>
          <mesh geometry={geo.box} material={pants} position={[0, -0.2, 0]} scale={[0.17, 0.42, 0.18]} castShadow />
        </group>
        <mesh geometry={geo.cyl} material={shirt} position={[0, 0.66, 0]} scale={[0.27 * bw, 0.5, 0.22 * bw]} castShadow />
        {look.accessory === 'scarf' && <mesh geometry={geo.cyl} material={mat(look.hat ?? '#c94f4f')} position={[0, 0.92, 0]} scale={[0.25 * bw, 0.1, 0.22 * bw]} />}
        {cape && <mesh geometry={geo.box} material={mat(cape)} position={[0, 0.62, -0.25]} rotation={[0.12, 0, 0]} scale={[0.5, 0.62, 0.04]} castShadow />}
        <group ref={armL} position={[-0.34 * bw, 0.86, 0]}>
          <mesh geometry={geo.box} material={shirt} position={[0, -0.17, 0]} scale={[0.12, 0.36, 0.12]} castShadow />
          <mesh geometry={geo.sphere} material={skin} position={[0, -0.37, 0]} scale={0.075} />
        </group>
        <group ref={armR} position={[0.34 * bw, 0.86, 0]}>
          <mesh geometry={geo.box} material={shirt} position={[0, -0.17, 0]} scale={[0.12, 0.36, 0.12]} castShadow />
          <mesh geometry={geo.sphere} material={skin} position={[0, -0.37, 0]} scale={0.075} />
        </group>
        {/* big chibi head */}
        <group position={[0, 1.24, 0]}>
          <mesh geometry={geo.sphere} material={skin} scale={0.38} castShadow />
          {[-0.13, 0.13].map((x) => <Eye key={x} x={x} style={look.eyes ?? 'round'} />)}
          {look.accessory === 'glasses' && (
            <group position={[0, -0.03, 0.36]}>
              {[-0.13, 0.13].map((x) => <mesh key={x} position={[x, 0, 0]} material={mat('#3a2e26', { rough: 0.4 })}><torusGeometry args={[0.075, 0.012, 6, 16]} /></mesh>)}
              <mesh geometry={geo.box} material={mat('#3a2e26')} scale={[0.1, 0.015, 0.015]} />
            </group>
          )}
          {look.accessory === 'flower' && (
            <group position={[0.27, 0.22, 0.16]}>
              {[0, 1, 2, 3, 4].map((i) => <mesh key={i} geometry={geo.sphere} material={mat('#f6a5c0')} position={[Math.cos(i * 1.26) * 0.05, Math.sin(i * 1.26) * 0.05, 0]} scale={0.04} />)}
              <mesh geometry={geo.sphere} material={mat('#f4d35e')} scale={0.035} />
            </group>
          )}
          <mesh geometry={geo.sphere} material={mat('#f2a0a0')} position={[-0.22, -0.08, 0.29]} scale={[0.06, 0.035, 0.02]} />
          <mesh geometry={geo.sphere} material={mat('#f2a0a0')} position={[0.22, -0.08, 0.29]} scale={[0.06, 0.035, 0.02]} />
          <Hair style={look.hairStyle} m={hair} />
          {look.hat && (
            <group position={[0, 0.3, 0]}>
              <mesh geometry={geo.cyl} material={mat(look.hat)} scale={[0.5, 0.04, 0.5]} castShadow />
              <mesh geometry={geo.cyl} material={mat(look.hat)} position={[0, 0.12, 0]} scale={[0.26, 0.22, 0.26]} castShadow />
            </group>
          )}
        </group>
      </group>
    </group>
  )
}

const EYE = mat('#2a1f1a', { rough: 0.3 })
function Eye({ x, style }: { x: number; style: NonNullable<Appearance['eyes']> }) {
  if (style === 'happy') return <mesh position={[x, -0.02, 0.35]} rotation={[0, 0, 0]} material={EYE}><torusGeometry args={[0.04, 0.012, 6, 10, Math.PI]} /></mesh>
  if (style === 'sleepy') return <mesh geometry={geo.box} material={EYE} position={[x, -0.04, 0.35]} scale={[0.08, 0.015, 0.02]} />
  const big = style === 'wide'
  return (
    <group position={[x, -0.03, 0.34]}>
      <mesh geometry={geo.sphere} material={EYE} scale={big ? [0.065, 0.085, 0.04] : [0.05, 0.07, 0.04]} />
      {big && <mesh geometry={geo.sphere} material={mat('#ffffff', { rough: 0.2 })} position={[0.02, 0.03, 0.03]} scale={0.018} />}
    </group>
  )
}

function Hair({ style, m }: { style: Appearance['hairStyle']; m: ReturnType<typeof mat> }) {
  return (
    <group>
      <mesh geometry={geo.dome} material={m} position={[0, 0.06, 0]} scale={[0.41, 0.4, 0.41]} castShadow />
      <mesh geometry={geo.dome} material={m} rotation={[-Math.PI / 2, 0, 0]} scale={[0.405, 0.41, 0.405]} />
      {/* fringe */}
      <mesh geometry={geo.box} material={m} position={[0, 0.2, 0.3]} rotation={[0.6, 0, 0]} scale={[0.5, 0.12, 0.1]} />
      {style === 'long' && <mesh geometry={geo.box} material={m} position={[0, -0.22, -0.16]} scale={[0.66, 0.5, 0.3]} castShadow />}
      {style === 'bun' && <mesh geometry={geo.sphere} material={m} position={[0, 0.38, -0.18]} scale={0.15} castShadow />}
      {style === 'spiky' && [-0.18, 0, 0.18].map((x) => (
        <mesh key={x} geometry={geo.cone} material={m} position={[x, 0.42, -0.04]} rotation={[0, 0, -x * 1.5]} scale={[0.09, 0.22, 0.09]} />
      ))}
    </group>
  )
}
