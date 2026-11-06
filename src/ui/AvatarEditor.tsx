import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Character, type Anim } from '../world/Character'
import { ACCESSORIES, BUILDS, CLOTH_COLORS, EYES, HAIR_COLORS, HAIR_STYLES, HAT_COLORS, SKIN_TONES, randomAppearance } from '../game/avatar'
import type { Appearance } from '../game/residents.mock'

function Spinner({ look }: { look: Appearance }) {
  const g = useRef<Group>(null!)
  const anim = useRef<Anim>({ speed: 0, mode: 'idle' })
  useFrame((_, dt) => { g.current.rotation.y += dt * 0.6 })
  return <group ref={g} position={[0, -0.9, 0]}><Character look={look} anim={anim} /></group>
}

/** Small turntable preview of an avatar. */
export function AvatarPreview({ look, size = 220 }: { look: Appearance; size?: number }) {
  return (
    <div className="avatar-preview" style={{ height: size }}>
      <Canvas camera={{ position: [0, 0.1, 4.4], fov: 30 }} dpr={[1, 2]}>
        <hemisphereLight args={['#fff4e0', '#7a9a5a', 1.2]} />
        <directionalLight position={[2, 3, 2]} intensity={1.6} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
          <circleGeometry args={[0.8, 32]} />
          <meshStandardMaterial color="#8fbf6a" />
        </mesh>
        <Spinner look={look} />
      </Canvas>
    </div>
  )
}

const Swatches = ({ colors, value, onPick, none }: { colors: string[]; value: string | undefined; onPick: (c: string | undefined) => void; none?: boolean }) => (
  <div className="swatches">
    {none && <button className={`swatch none ${value === undefined ? 'on' : ''}`} onClick={() => onPick(undefined)} aria-label="None">✕</button>}
    {colors.map((c) => <button key={c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />)}
  </div>
)
const Choice = <T extends string,>({ options, value, onPick }: { options: readonly T[]; value: T; onPick: (v: T) => void }) => (
  <div className="seg wrap">{options.map((o) => <button key={o} type="button" className={value === o ? 'on' : ''} onClick={() => onPick(o)}>{o[0].toUpperCase() + o.slice(1)}</button>)}</div>
)

/** Avatar customization controls (registration page + Guild Master tools). */
export function AvatarEditor({ value, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  const set = (patch: Partial<Appearance>) => onChange({ ...value, ...patch })
  return (
    <div className="avatar-editor">
      <button type="button" className="wide" onClick={() => onChange(randomAppearance((Math.random() * 2 ** 32) >>> 0))}>🎲 Randomize</button>
      <label>Skin tone</label><Swatches colors={SKIN_TONES} value={value.skin} onPick={(skin) => set({ skin: skin! })} />
      <label>Hair style</label><Choice options={HAIR_STYLES} value={value.hairStyle} onPick={(hairStyle) => set({ hairStyle })} />
      <label>Hair color</label><Swatches colors={HAIR_COLORS} value={value.hair} onPick={(hair) => set({ hair: hair! })} />
      <label>Eyes</label><Choice options={EYES} value={value.eyes ?? 'round'} onPick={(eyes) => set({ eyes })} />
      <label>Shirt</label><Swatches colors={CLOTH_COLORS} value={value.shirt} onPick={(shirt) => set({ shirt: shirt! })} />
      <label>Trousers</label><Swatches colors={CLOTH_COLORS} value={value.pants} onPick={(pants) => set({ pants: pants! })} />
      <label>Hat</label><Swatches colors={HAT_COLORS} value={value.hat} none onPick={(hat) => { const { hat: _, ...rest } = value; onChange(hat ? { ...rest, hat } : rest) }} />
      <label>Accessory</label><Choice options={ACCESSORIES} value={value.accessory ?? 'none'} onPick={(accessory) => set({ accessory })} />
      <label>Build</label><Choice options={BUILDS} value={value.build ?? 'regular'} onPick={(build) => set({ build })} />
      <label>Height <small>{Math.round(value.height * 100)}%</small></label>
      <input type="range" min={0.9} max={1.1} step={0.01} value={value.height} onChange={(e) => set({ height: Number(e.target.value) })} />
    </div>
  )
}
