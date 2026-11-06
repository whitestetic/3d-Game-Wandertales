import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { useGame } from './game/store'
import { Environment } from './world/Environment'
import { InteriorScene } from './world/Interior'
import { Buildings } from './world/Buildings'
import { NPCs } from './world/NPCs'
import { Player } from './world/Player'
import { CameraRig } from './world/CameraRig'
import { Placement } from './world/Placement'
import { HUD } from './ui/HUD'
import { MainMenu } from './ui/MainMenu'
import { RegisterPage } from './ui/Register'
import { CharacterCreator } from './character-creator/CharacterCreator'

const page = () => (location.hash === '#/register' ? 'register' : location.hash === '#/creator' ? 'creator' : 'game')

export function App() {
  const [route] = useState(page)
  useEffect(() => {
    // switch pages with a clean reload: tearing down the 3D scene mid-render breaks its HTML labels
    const on = () => { if (page() !== route) location.reload() }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [route])
  return route === 'register' ? <RegisterPage /> : route === 'creator' ? <CharacterCreator /> : <Game />
}

/** Applies the graphics quality live. (Remounting the Canvas on change breaks its HTML labels and can blank the screen.) */
function Quality() {
  const quality = useGame((s) => s.quality)
  const { gl, scene } = useThree()
  useEffect(() => {
    gl.shadowMap.enabled = quality === 'high'
    scene.traverse((o) => { // shaders must be rebuilt when shadows switch on or off
      const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true
    })
  }, [quality, gl, scene])
  return null
}

function Game() {
  const screen = useGame((s) => s.screen)
  const quality = useGame((s) => s.quality)
  const high = quality === 'high'
  const antialias = useRef(high).current // fixed when the GPU context is created; a change applies after a reload
  return (
    <>
      <Canvas shadows={high} dpr={high ? [1, 2] : 1} gl={{ antialias }}
        camera={{ fov: 42, near: 0.5, far: 400, position: [30, 34, 30] }}>
        <Suspense fallback={null}>
          <Quality />
          <Environment />
          <Buildings />
          <NPCs />
          <Player />
          <InteriorScene />
          <Placement />
          <CameraRig />
        </Suspense>
      </Canvas>
      {screen === 'menu' ? <MainMenu /> : <HUD />}
    </>
  )
}
