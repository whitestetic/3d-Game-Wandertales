import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { ChibiCharacter, type ChibiMotion } from '../threejs/ChibiCharacter'
import { loadCatalog, type CatalogAsset, type Catalog, type Channel } from '../threejs/characterKit'
import { ROLES, generateNpcAppearance, type Role } from '../npc-generator/npcGenerator'
import {
  EYE_COLORS, HAIR_COLORS, PALETTE, PLAYER_KEY, SKIN_TONES, defaultAppearance, deleteCharacter, listCharacters, loadCharacter, saveCharacter, validateAppearance,
  type CharacterAppearance, type SavedCharacter, type Slot,
} from './appearance'

type Tab = 'hair' | 'head' | 'clothing' | 'armor' | 'feet' | 'accessories' | 'body' | 'colors'
const TABS: [Tab, string, Slot[]][] = [
  ['hair', 'Hair', ['hair', 'hair_ornament']], ['head', 'Headwear', ['headwear', 'ears']], ['clothing', 'Clothing', ['torso', 'apron']],
  ['armor', 'Armor', ['chest_armor', 'shoulders', 'hands', 'legs']], ['feet', 'Footwear', ['feet']], ['accessories', 'Accessories', ['back', 'neck', 'waist', 'waist_side']],
  ['body', 'Body', []], ['colors', 'Colors', []],
]
const SLOT_LABEL: Record<Slot, string> = {
  hair: 'Hairstyle', headwear: 'Hat / Helmet', hair_ornament: 'Hair ornament', ears: 'Earrings', torso: 'Outfit', apron: 'Apron', chest_armor: 'Chest armor',
  shoulders: 'Shoulders', hands: 'Gloves', legs: 'Leg armor', feet: 'Shoes', back: 'Back', neck: 'Neck', waist: 'Belt', waist_side: 'Hip accessory',
}
const QC_COLOR: Record<string, string> = { PASS: '#2e7d32', WARNING: '#b26a00', NEEDS_REVIEW: '#8e24aa', FAILED: '#c62828' }

const Swatches = ({ colors, value, onPick }: { colors: string[]; value?: string; onPick: (c: string) => void }) => (
  <div className="cc-swatches">
    {colors.map((c) => <button key={c} className={value?.toLowerCase() === c.toLowerCase() ? 'on' : ''} style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />)}
    <input type="color" value={value ?? '#cccccc'} onChange={(e) => onPick(e.target.value)} aria-label="custom color" />
  </div>
)

export function CharacterCreator() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [app, setApp] = useState<CharacterAppearance>(defaultAppearance)
  const [tab, setTab] = useState<Tab>('hair')
  const [preview, setPreview] = useState<ChibiMotion['mode']>('idle')
  const [spin, setSpin] = useState(true)
  const [saved, setSaved] = useState<SavedCharacter[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const motion = useRef<ChibiMotion>({ speed: 1, mode: 'idle' })
  motion.current.mode = preview

  const refreshSaved = () => listCharacters().then(setSaved).catch(() => setSaved([]))
  useEffect(() => {
    loadCatalog().then(setCatalog)
    loadCharacter(PLAYER_KEY).then((s) => { if (s) setApp(s.appearance) }).catch(() => {})
    refreshSaved()
  }, [])

  const ready = useMemo(() => catalog?.assets.filter((a) => a.readyForPlayer) ?? [], [catalog])
  const notReady = useMemo(() => catalog?.assets.filter((a) => !a.readyForPlayer) ?? [], [catalog])
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3000) }
  const equip = (slot: Slot, id: string | null) => { setLoading(true); setApp((a) => ({ ...a, equipment: { ...a.equipment, [slot]: id } })) }
  const setColor = (slot: Slot, ch: Channel, c: string) => setApp((a) => ({ ...a, colors: { ...a.colors, [slot]: { ...(a.colors[slot] ?? {}), [ch]: c } } }))

  const randomize = (role?: Role) => {
    const r = role ?? ROLES[Math.floor(Math.random() * ROLES.length)]
    const next = generateNpcAppearance(`random-${Date.now()}`, r, { available: new Set(ready.map((a) => a.id)) })
    setLoading(true)
    setApp({ ...next, name: app.name })
    say(`Randomized as ${r}`)
  }
  const save = async (key: string) => { await saveCharacter(key, app); refreshSaved(); say(key === PLAYER_KEY ? 'Saved as your Guild Master — it appears in town' : 'Character saved') }
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(app, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(app.name || 'character').replace(/\W+/g, '_')}.json`; a.click()
  }
  const importJson = async (file: File) => {
    try { setApp(validateAppearance(JSON.parse(await file.text()), catalog!.assets)); say('Imported') } catch (e) { say(`Import failed: ${(e as Error).message}`) }
  }

  const slotItems = (slot: Slot) => ready.filter((a) => a.slot === slot)
  const equipped = (Object.entries(app.equipment).filter(([, id]) => id) as [Slot, string][]).map(([slot, id]) => ({ slot, a: catalog?.assets.find((x) => x.id === id) })).filter((x) => x.a) as { slot: Slot; a: CatalogAsset }[]

  return (
    <div className="cc">
      <div className="cc-stage">
        <Canvas camera={{ position: [0, 1.0, 3.2], fov: 35 }} dpr={[1, 2]} shadows>
          <color attach="background" args={['#efe4cc']} />
          <hemisphereLight args={['#fff4e0', '#8a9a6a', 1.1]} />
          <directionalLight position={[2, 4, 3]} intensity={1.8} castShadow />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[0.9, 40]} /><meshStandardMaterial color="#9cc27a" /></mesh>
          <Suspense fallback={null}>
            <ChibiCharacter appearance={app} motion={motion} scale={3.4} onReady={() => setLoading(false)} />
          </Suspense>
          <OrbitControls target={[0, 0.8, 0]} enablePan={false} minDistance={1.2} maxDistance={6} autoRotate={spin} autoRotateSpeed={1.5} maxPolarAngle={Math.PI * 0.55} />
        </Canvas>
        {loading && <div className="cc-loading">Loading…</div>}
        <div className="cc-stage-bar">
          {(['idle', 'walk', 'work'] as const).map((m) => <button key={m} className={preview === m ? 'on' : ''} onClick={() => setPreview(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
          <button className={spin ? 'on' : ''} onClick={() => setSpin(!spin)}>⟳ Turntable</button>
        </div>
        <p className="cc-hint">Drag to rotate 360° · scroll / pinch to zoom</p>
      </div>

      <div className="cc-panel">
        <header className="cc-head">
          <h1>Character Creator</h1>
          <a href="#/">← Back to town</a>
        </header>
        <input className="cc-name" value={app.name ?? ''} maxLength={40} placeholder="Character name" onChange={(e) => setApp({ ...app, name: e.target.value })} />
        <div className="cc-actions">
          <button onClick={() => randomize()}>🎲 Randomize</button>
          <select value="" onChange={(e) => e.target.value && randomize(e.target.value as Role)}>
            <option value="">Random by role…</option>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="primary" onClick={() => save(PLAYER_KEY)}>✓ Use as my Guild Master</button>
        </div>
        <nav className="cc-tabs">{TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</nav>

        <div className="cc-body">
          {TABS.find((t) => t[0] === tab)![2].map((slot) => (
            <section key={slot}>
              <h3>{SLOT_LABEL[slot]}</h3>
              <div className="cc-items">
                <button className={!app.equipment[slot] ? 'cc-item on' : 'cc-item'} onClick={() => equip(slot, null)}><span className="cc-none">∅</span><small>None</small></button>
                {slotItems(slot).map((a) => (
                  <button key={a.id} className={app.equipment[slot] === a.id ? 'cc-item on' : 'cc-item'} onClick={() => equip(slot, a.id)} title={`${a.name} · QC ${a.qc} · ${a.triangles} triangles`}>
                    <img src={`${import.meta.env.BASE_URL}${a.thumbnail}`} alt="" loading="lazy" />
                    <small>{a.name}</small>
                    {a.qc !== 'PASS' && <i style={{ background: QC_COLOR[a.qc] }}>{a.qc === 'WARNING' ? '!' : '?'}</i>}
                  </button>
                ))}
              </div>
              {slot === 'hair' && app.equipment.hair && <><h3>Hair color</h3><Swatches colors={HAIR_COLORS} value={app.colors.hair?.hair} onPick={(c) => setColor('hair', 'hair', c)} /></>}
            </section>
          ))}
          {tab === 'body' && (
            <section>
              <h3>Skin tone</h3><Swatches colors={SKIN_TONES} value={app.skin} onPick={(skin) => setApp({ ...app, skin })} />
              <h3>Eye color</h3><Swatches colors={EYE_COLORS} value={app.eyes} onPick={(eyes) => setApp({ ...app, eyes })} />
              <h3>Height <small>{Math.round(app.height * 100)}%</small></h3>
              <input type="range" min={0.9} max={1.1} step={0.01} value={app.height} onChange={(e) => setApp({ ...app, height: Number(e.target.value) })} />
            </section>
          )}
          {tab === 'colors' && (
            <section>
              {!equipped.length && <p className="cc-note">Equip something first.</p>}
              {equipped.map(({ slot, a }) => (
                <div key={slot} className="cc-colorset">
                  <h3>{a.name}</h3>
                  {(Object.keys(a.channels) as Channel[]).map((ch) => (
                    <div key={ch} className="cc-channel"><span>{ch}</span><Swatches colors={ch === 'hair' ? HAIR_COLORS : PALETTE} value={app.colors[slot]?.[ch] ?? a.channels[ch]} onPick={(c) => setColor(slot, ch, c)} /></div>
                  ))}
                </div>
              ))}
            </section>
          )}
          {tab !== 'body' && tab !== 'colors' && notReady.some((a) => TABS.find((t) => t[0] === tab)![2].includes(a.slot)) && (
            <p className="cc-note">Not available yet (failed automatic QC): {notReady.filter((a) => TABS.find((t) => t[0] === tab)![2].includes(a.slot)).map((a) => `${a.name} — ${a.qc}`).join(', ')}.</p>
          )}
        </div>

        <footer className="cc-foot">
          <div className="cc-actions">
            <button onClick={() => save(`char-${Date.now()}`)}>💾 Save as new</button>
            <button onClick={exportJson}>⬇ Export JSON</button>
            <label className="cc-file">⬆ Import JSON<input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} /></label>
          </div>
          {saved.length > 0 && (
            <div className="cc-saved">
              <h3>Saved characters</h3>
              {saved.map((s) => (
                <div key={s.key} className="cc-saved-row">
                  <button onClick={() => { setLoading(true); setApp(s.appearance); say(`Loaded ${s.appearance.name || s.key}`) }}>{s.key === PLAYER_KEY ? '⭐ Guild Master' : s.appearance.name || 'Unnamed'} <small>{new Date(s.savedAt).toLocaleString()}</small></button>
                  {s.key !== PLAYER_KEY && <button className="x" aria-label="Delete" onClick={() => deleteCharacter(s.key).then(refreshSaved)}>✕</button>}
                </div>
              ))}
            </div>
          )}
        </footer>
        {msg && <div className="cc-toast" role="status">{msg}</div>}
      </div>
    </div>
  )
}
