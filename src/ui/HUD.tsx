import { useEffect, useState } from 'react'
import { BUILDINGS, getBuilding } from '../game/map'
import { RESIDENTS } from '../game/residents.mock'
import { cam, env, npcLive } from '../game/live'
import { byId, friendLevel, friendsOf, moodEmoji, sim, type NeedKey } from '../game/sim'
import { PROFESSIONS, MAX_LEVEL, wagePerHour, xpToNext } from '../game/professions'
import { town } from '../game/town'
import { BuildMenu, BuildingPanel, PlacementBar, StockChips, StoragePanel } from './TownPanels'
import { CommunityPanel } from './Community'
import { GuildPanel } from './Guild'
import { gmLine } from '../game/dialogue'
import { resetWorld } from '../game/persist'
import { clock, dayOf, hourOf, useGame } from '../game/store'
import { interact } from '../world/Player'
import { MobileControls } from './MobileControls'

import { ChroniclePanel } from './Chronicle'
import { CloudSaveBox } from './CloudSave'
import { SoundBox } from './Sound'
import { ROOMS, isSpot, roomKindOf, type RoomId } from '../game/interior'
import { SEASON_DAYS, SEASON_INFO, WEATHER_INFO, dayInSeason, festivalAt, seasonOf, weatherAt } from '../game/calendar'

type Panel = 'residents' | 'buildings' | 'build' | 'storage' | 'guild' | 'chronicle' | 'community' | 'settings' | null
const SPEEDS = [2, 10, 60]
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

function TopBar({ openStorage }: { openStorage: () => void }) {
  const name = useGame((s) => s.playerName)
  const minute = useGame((s) => Math.floor(s.time))
  const scale = useGame((s) => s.timeScale)
  const h = hourOf(minute)
  const weather = weatherAt(minute)
  const icon = weather !== 'clear' && h >= 6 && h < 18 ? WEATHER_INFO[weather].icon : h >= 6 && h < 18 ? '☀️' : h >= 18 && h < 20 ? '🌇' : '🌙'
  const season = SEASON_INFO[seasonOf(minute)]
  const fest = festivalAt(minute)
  return (
    <div className="topbar">
      <div className="card profile">
        <div className="avatar">{(name || 'G')[0].toUpperCase()}</div>
        <div><b>{name || 'Guild Master'}</b><small>Guild Master</small></div>
      </div>
      {fest && <div className="festival-banner" role="status">{fest.icon} {fest.name} on the square!</div>}
      <div className="card clock">
        <small>{season.icon} {season.name} {dayInSeason(minute)}/{SEASON_DAYS} · {WEATHER_INFO[weather].name}</small>
        <b>{icon} Day {dayOf(minute)} · {clock(minute)}</b>
        <button className="chip" title="Game speed" onClick={() => useGame.getState().setTimeScale(SPEEDS[(SPEEDS.indexOf(scale) + 1) % SPEEDS.length])}>
          ⏩ {scale / 2}×
        </button>
      </div>
      <div className="statwrap">
        <StockChips onClick={openStorage} />
        <div className="card stats mood"><TownMood /></div>
      </div>
    </div>
  )
}

function TownMood() {
  useGame((s) => Math.floor(s.time / 10))
  const avg = Math.round(RESIDENTS.reduce((a, r) => a + sim[r.id].needs.happiness, 0) / RESIDENTS.length)
  return <span title="Average resident happiness">{moodEmoji(avg)} {avg}%</span>
}

const NEEDS: [NeedKey, string, string][] = [
  ['hunger', '🍞', 'Fullness'], ['energy', '⚡', 'Energy'], ['social', '💬', 'Social'], ['health', '❤️', 'Health'], ['happiness', '😊', 'Happiness'],
]
const Bar = ({ value, label, icon }: { value: number; label: string; icon: string }) => (
  <div className="bar" title={`${label} ${Math.round(value)}`}>
    <span>{icon} {label}</span>
    <div><i style={{ width: `${value}%`, background: value < 25 ? '#c94f4f' : value < 50 ? '#e0a64a' : '#6aa35a' }} /></div>
  </div>
)

function ResidentPanel({ id }: { id: string }) {
  const r = RESIDENTS.find((x) => x.id === id)
  if (!r) return null // left town
  const minute = useGame((s) => Math.floor(s.time)) // refresh live activity each game minute
  const select = useGame((s) => s.select)
  const live = npcLive[id]
  const s = sim[id]
  const prof = PROFESSIONS[r.profession]
  const friends = friendsOf(id).slice(0, 4)
  return (
    <div className="panel">
      <header><h2>{moodEmoji(s.needs.happiness)} {r.name}</h2><button className="x" onClick={() => select(null)} aria-label="Close">✕</button></header>
      {r.mock ? <span className="badge">Placeholder resident · mock data</span> : <span className="badge ok">Community member{r.instagram ? ` · @${r.instagram}` : ''}</span>}
      <blockquote>“{gmLine(r, s.needs, live?.activity ?? '', s.level, dayOf(minute))}”</blockquote>
      <dl>
        <dt>Activity</dt><dd>{live?.activity ?? '—'}</dd>
        <dt>Personality</dt><dd>{r.personality}</dd>
        <dt>Profession</dt><dd>{r.profession}{r.work ? ` · Lv ${s.level}${s.level < MAX_LEVEL ? '' : ' (max)'}` : ''}</dd>
        {r.work && prof && <><dt>Shift</dt><dd>{prof.shift[0]}:00–{prof.shift[1]}:00 · 🪙 {wagePerHour(r.profession, s.level).toFixed(1)}/h</dd></>}
        {r.work && s.workStatus && <><dt>At work</dt><dd>{s.workStatus}{s.unpaid ? ' · ⚠️ unpaid (treasury empty)' : ''}</dd></>}
        <dt>Wealth</dt><dd>🪙 {Math.floor(s.wealth)}</dd>
        <dt>Home</dt><dd><a onClick={() => select({ type: 'building', id: r.home })}>{getBuilding(r.home)!.name}</a></dd>
        <dt>Workplace</dt><dd>{r.work ? <a onClick={() => select({ type: 'building', id: r.work! })}>{getBuilding(r.work)?.name}</a> : 'None — hire them at a building'}</dd>
      </dl>
      {r.work && s.level < MAX_LEVEL && <Bar value={(s.xp / xpToNext(s.level)) * 100} label={`XP to Lv ${s.level + 1}`} icon="⭐" />}
      <h3>Needs</h3>
      {NEEDS.map(([k, icon, label]) => <Bar key={k} value={s.needs[k]} label={label} icon={icon} />)}
      <h3>Relationships</h3>
      {friends.length === 0 ? <p className="note">No friends yet.</p> : (
        <div className="people">
          {friends.map((f) => (
            <button key={f.id} className="person" onClick={() => select({ type: 'resident', id: f.id })}>
              {byId(f.id).name}<small>{friendLevel(f.value)} · {Math.round(f.value)}</small>
            </button>
          ))}
        </div>
      )}
      <p className="note">Guild Master friendship: {s.gmFriendship}</p>
      {s.lastChat && <><h3>Last conversation</h3><p className="desc chat">{s.lastChat}</p></>}
      <div className="actions">
        {live?.visible && <button onClick={() => useGame.getState().focusOn(live.x, live.z)}>🔍 Find in town</button>}
      </div>
    </div>
  )
}

function ListPanel({ panel, close }: { panel: 'residents' | 'buildings' | 'settings'; close: () => void }) {
  const s = useGame.getState()
  const quality = useGame((st) => st.quality)
  useGame((st) => Math.floor(st.time)) // live activity in the list
  if (panel === 'settings') {
    return (
      <div className="panel">
        <header><h2>Settings</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
        <h3>Graphics quality</h3>
        <div className="seg">
          {(['high', 'low'] as const).map((q) => <button key={q} className={quality === q ? 'on' : ''} onClick={() => s.setQuality(q)}>{q === 'high' ? 'High (shadows)' : 'Low (faster)'}</button>)}
        </div>
        <h3>Sound</h3>
        <SoundBox />
        <h3>Controls</h3>
        <ul className="help">
          <li><b>V</b> switch Town View / Explore</li>
          <li><b>Town View:</b> drag or WASD to pan, wheel/pinch zoom, right-drag or Q/E rotate, click buildings & residents</li>
          <li><b>Explore:</b> WASD move, Shift sprint, drag to look, E interact</li>
          <li><b>Build:</b> move to preview, click to place, <b>R</b> rotate, <b>Esc</b> cancel</li>
          <li><b>Esc</b> close panels</li>
        </ul>
        <h3>Appearance</h3>
        <div className="actions"><a className="btn-link" href="#/creator">🎨 Open Character Creator</a></div>
        <h3>Cloud save</h3>
        <CloudSaveBox />
        <h3>World</h3>
        <p className="note">The town saves automatically in this browser every 15 seconds.</p>
        <div className="actions">
          <button onClick={() => { if (confirm('Reset the town? Buildings, storage, needs, skills and friendships start over.')) { resetWorld(); close() } }}>↺ Reset world</button>
        </div>
      </div>
    )
  }
  const goTo = (type: 'building' | 'resident', id: string, x: number, z: number) => { s.select({ type, id }); s.focusOn(x, z); close() }
  return (
    <div className="panel">
      <header><h2>{panel === 'residents' ? 'Residents' : 'Buildings'}</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
      {panel === 'residents' && RESIDENTS.some((r) => r.mock) && <span className="badge">Includes placeholder residents (mock data)</span>}
      <div className="list">
        {panel === 'residents'
          ? RESIDENTS.map((r) => {
              const l = npcLive[r.id]
              return <button key={r.id} className="person" onClick={() => goTo('resident', r.id, l?.x ?? 0, l?.z ?? 0)}>{moodEmoji(sim[r.id].needs.happiness)} {r.name}{r.mock ? '' : ' ★'}<small>{r.profession} Lv {sim[r.id].level} · {l?.activity ?? ''}</small></button>
            })
          : BUILDINGS.map((b) => {
              const st = town.b[b.id]
              return <button key={b.id} className="person" onClick={() => goTo('building', b.id, b.x, b.z)}>{b.name}<small>{st?.level ? `Level ${st.level}` : 'Under construction'}{st?.job?.type === 'upgrade' ? ' · upgrading' : ''}</small></button>
            })}
      </div>
    </div>
  )
}

export function HUD() {
  const [panel, setPanel] = useState<Panel>(null)
  const selection = useGame((s) => s.selection)
  const mode = useGame((s) => s.mode)
  const nearby = useGame((s) => s.nearby)
  const placing = useGame((s) => !!s.placing)
  const toast = useGame((s) => s.toast)
  useGame((s) => s.rev)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'KeyV') useGame.getState().toggleMode()
      if (e.code === 'Escape' && !useGame.getState().placing) { useGame.getState().select(null); setPanel(null) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (selection) setPanel(null) }, [selection])
  const openPanel = useGame((s) => s.openPanel)
  useEffect(() => { if (openPanel) { setPanel(openPanel as Panel); useGame.setState({ openPanel: null, selection: null }) } }, [openPanel])

  const interior = useGame((s) => s.interior)
  const spot = nearby && isSpot(nearby.id) ? ROOMS[nearby.id.split(':')[0] as RoomId].spots[nearby.id.split(':')[1]] : null
  const nearbyName = spot ? spot.label : nearby && (nearby.type === 'building' ? getBuilding(nearby.id)?.name : RESIDENTS.find((r) => r.id === nearby.id)?.name)
  const nav: [Exclude<Panel, null> | 'town', string, string][] = [
    ['town', '🏰', 'Town'], ['residents', '👥', 'Residents'], ['buildings', '🏠', 'Buildings'], ['build', '🔨', 'Build'], ['storage', '📦', 'Storage'], ['guild', '⚔️', 'Guild'], ['chronicle', '📜', 'Chronicle'], ['community', '🏘️', 'Community'], ['settings', '⚙️', 'Settings'],
  ]

  return (
    <div className="hud">
      <TopBar openStorage={() => { useGame.getState().select(null); setPanel('storage') }} />
      <nav className="nav">
        {nav.map(([id, icon, label]) => (
          <button key={id} className={panel === id ? 'on' : ''} onClick={() => {
            if (id === 'town') { useGame.setState({ selection: null }); cam.isoDist = 58; useGame.getState().focusOn(0, 2); setPanel(null) }
            else { useGame.setState({ selection: null, placing: null }); setPanel(panel === id ? null : id) }
          }}>
            <span>{icon}</span><small>{label}</small>
          </button>
        ))}
      </nav>
      {selection?.type === 'building' && <BuildingPanel id={selection.id} />}
      {selection?.type === 'resident' && <ResidentPanel id={selection.id} />}
      {!selection && panel === 'build' && <BuildMenu close={() => setPanel(null)} />}
      {!selection && panel === 'storage' && <StoragePanel close={() => setPanel(null)} />}
      {!selection && panel === 'community' && <CommunityPanel close={() => setPanel(null)} />}
      {!selection && panel === 'guild' && <GuildPanel close={() => setPanel(null)} />}
      {!selection && panel === 'chronicle' && <ChroniclePanel close={() => setPanel(null)} />}
      {!selection && (panel === 'residents' || panel === 'buildings' || panel === 'settings') && <ListPanel panel={panel} close={() => setPanel(null)} />}
      <PlacementBar />
      {toast && <div className="toast" role="status">{toast}</div>}

      {mode === 'third' && nearby && !selection && (
        <button className="prompt" onClick={interact}>
          {!touch && <kbd>E</kbd>} {spot ? '' : nearby.type === 'resident' ? 'Talk to' : roomKindOf(nearby.id) ? 'Enter' : 'Inspect'} {nearbyName}
        </button>
      )}
      {!placing && !interior && <button className="mode" onClick={() => useGame.getState().toggleMode()}>
        {mode === 'iso' ? '🚶 Explore' : '🗺️ Town View'}{!touch && <kbd>V</kbd>}
      </button>}
      {touch && mode === 'third' && <MobileControls />}
      <NightTint />
    </div>
  )
}

/** Subtle blue vignette at night for mood. */
function NightTint() {
  useGame((s) => Math.floor(s.time / 5))
  return <div className="tint" style={{ opacity: env.night * 0.35 }} />
}
