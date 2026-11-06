import { useState } from 'react'
import { enterInterior, leaveInterior, roomKindOf } from '../game/interior'
import { NODES, getBuilding, type BuildingKind } from '../game/map'
import { RESIDENTS } from '../game/residents.mock'
import { player } from '../game/live'
import { PROFESSIONS, RESOURCES, professionsAt, type Bundle, type Recipe, type Resource } from '../game/professions'
import { assignWorker, openBuilding, sim, unassignWorker } from '../game/sim'
import { demolishBuilding } from '../game/community'
import {
  RESOURCE_ICON, TYPES, activeSite, beds, buyFromMerchant, buyQuote, canAfford, cancelJob, checkPlacement, levelOf, missing,
  price, sellQuote, sellToMerchant, slotsOf, startUpgrade, storageCap, town, upgradeCost, workersOf,
} from '../game/town'
import { clock, dayOf, useGame } from '../game/store'
import { confirmPlacement, rotatePlacement } from '../world/Placement'

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
export const Cost = ({ cost, gold }: { cost: Bundle; gold: number }) => (
  <span className="cost">
    {gold > 0 && <span className={town.gold < gold ? 'short' : ''}>🪙 {gold}</span>}
    {Object.entries(cost).map(([k, v]) => (
      <span key={k} className={town.stock[k as Resource] < (v ?? 0) ? 'short' : ''} title={k}>{RESOURCE_ICON[k as Resource]} {v}</span>
    ))}
  </span>
)
const recipeText = (r: Recipe) => {
  const side = (b: Bundle) => Object.entries(b).map(([k, v]) => `${v} ${RESOURCE_ICON[k as Resource]}`).join(' + ')
  return `${Object.keys(r.input).length ? `${side(r.input)} → ` : ''}${side(r.output)} / ${r.minutes} min`
}
const Progress = ({ value, label }: { value: number; label: string }) => (
  <div className="bar"><span>{label}</span><div><i style={{ width: `${Math.min(100, value)}%`, background: '#e0b04a' }} /></div></div>
)

function walkTo(buildingId: string) {
  leaveInterior()
  const [x, z] = NODES[getBuilding(buildingId)!.door]
  player.pos.set(x, 0, z)
  useGame.setState({ mode: 'third', selection: null })
}

export function BuildingPanel({ id }: { id: string }) {
  useGame((s) => s.rev)
  const minute = useGame((s) => Math.floor(s.time))
  const [hiring, setHiring] = useState(false)
  const g = useGame.getState()
  const b = getBuilding(id)
  if (!b) return null
  const st = town.b[id], type = TYPES[b.kind], job = st?.job
  const built = (st?.level ?? 1) > 0
  const workers = workersOf(id), slots = slotsOf(id), profs = professionsAt(b.kind)
  const up = st && st.level < type.maxLevel ? upgradeCost(b.kind, st.level) : null
  const builders = RESIDENTS.filter((r) => r.profession === 'Builder' && r.work)
  const act = (err: string | null | undefined, ok?: string) => (err ? g.notify(err) : ok && g.notify(ok))

  return (
    <div className="panel">
      <header><h2>{b.name}</h2><button className="x" onClick={() => g.select(null)} aria-label="Close">✕</button></header>
      <p className="desc">{b.description}</p>
      <dl>
        <dt>Level</dt><dd>{built ? `${st?.level ?? 1} / ${type.maxLevel}` : 'Under construction'}</dd>
        {profs.map((p) => PROFESSIONS[p].recipe && <span key={p} style={{ display: 'contents' }}><dt>{p}</dt><dd>{recipeText(PROFESSIONS[p].recipe!)}</dd></span>)}
        {(b.kind === 'tavern' || b.kind === 'market') && built && <><dt>Now</dt><dd>{openBuilding(b.kind) === id ? '🟢 Open' : '🔴 Closed (no staff on duty)'}</dd></>}
        {b.kind === 'house' && built && <><dt>Beds</dt><dd>{(type.beds ?? 0) + levelOf(id) - 1} · {RESIDENTS.filter((r) => r.home === id).length} living here</dd></>}
        {b.kind === 'guild' && <><dt>Storage</dt><dd>{storageCap()} per resource</dd></>}
        {b.kind === 'construction' && <><dt>Working on</dt><dd>{activeSite() ? getBuilding(activeSite()!)!.name : 'Nothing queued'}</dd></>}
      </dl>
      {job && (
        <>
          <Progress value={(job.progress / job.needed) * 100} label={job.type === 'build' ? '🏗️ Construction' : `⬆️ Upgrade to Lv ${st.level + 1}`} />
          {activeSite() !== id ? <p className="note">Queued: builders finish {getBuilding(activeSite()!)?.name} first.</p>
            : !builders.length ? <p className="note warn">No builders! Hire one at the Builders' Yard.</p>
              : <p className="note">Builders work {PROFESSIONS.Builder.shift[0]}:00–{PROFESSIONS.Builder.shift[1]}:00 · {Math.ceil(job.needed - job.progress)} builder-minutes left</p>}
        </>
      )}

      {profs.length > 0 && built && (
        <div className="people">
          <h3>Workers {workers.length} / {slots}</h3>
          {workers.map((r) => (
            <div key={r.id} className="person row">
              <button onClick={() => g.select({ type: 'resident', id: r.id })}>
                {r.name}<small>{r.profession} Lv {sim[r.id].level} · {sim[r.id].workStatus || 'Off duty'}</small>
              </button>
              <button className="x" title="Remove from job" onClick={() => { unassignWorker(r.id); g.notify(`${r.name} is now unemployed`); useGame.setState((s) => ({ rev: s.rev + 1 })) }}>✕</button>
            </div>
          ))}
          {workers.length < slots && (hiring ? (
            <div className="hire">
              <h3>Hire a resident</h3>
              {[...RESIDENTS].filter((r) => r.work !== id).sort((a) => (a.work ? 1 : -1)).map((r) => (
                <div key={r.id} className="person row">
                  <span>{r.name}<small>{r.work ? `${r.profession} at ${getBuilding(r.work)?.name}` : 'Unemployed'}</small></span>
                  {profs.map((p) => (
                    <button key={p} onClick={() => { act(assignWorker(r.id, id, p), `${r.name} now works here as ${p}`); setHiring(false); useGame.setState((s) => ({ rev: s.rev + 1 })) }}>{p}</button>
                  ))}
                </div>
              ))}
            </div>
          ) : <button className="wide" onClick={() => setHiring(true)}>+ Hire worker</button>)}
          {workers.length >= slots && <p className="note">All slots filled — upgrade for +1 slot.</p>}
        </div>
      )}

      <div className="actions col">
        {up && !job && built && (
          <button disabled={!canAfford(up.cost, up.gold)} onClick={() => act(startUpgrade(id, minute))}>
            ⬆️ Upgrade to Lv {st.level + 1} <Cost cost={up.cost} gold={up.gold} />
          </button>
        )}
        {job && <button onClick={() => { if (confirm(job.progress > 0 ? 'Cancel? Work has started, so only half the cost is refunded.' : 'Cancel? You get a full refund.')) cancelJob(id, minute) }}>✕ Cancel {job.type === 'build' ? 'construction' : 'upgrade'}</button>}
        {b.kind === 'guild' && <button onClick={() => useGame.setState({ openPanel: 'guild' })}>⚔️ Open Guild Hall</button>}
        {roomKindOf(id) && <button onClick={() => enterInterior(id)}>🚪 Go inside</button>}
        <button onClick={() => walkTo(id)}>🚶 Explore here</button>
        {!job && built && town.placed.some((p) => p.id === id) && (
          <button onClick={() => {
            if (!confirm(`Demolish ${b.name}? This cannot be undone and nothing is refunded.`)) return
            const err = demolishBuilding(id, minute)
            if (err) g.notify(err); else g.select(null)
          }}>🧨 Demolish</button>
        )}
      </div>
    </div>
  )
}

export function BuildMenu({ close }: { close: () => void }) {
  useGame((s) => s.rev)
  const kinds = (Object.keys(TYPES) as BuildingKind[]).filter((k) => TYPES[k].buildable)
  const start = (kind: BuildingKind) => {
    useGame.setState({ placing: { kind, rot: 0, x: null, z: null }, mode: 'iso', selection: null })
    useGame.getState().notify('Pick a spot — green means you can build there')
    close()
  }
  return (
    <div className="panel">
      <header><h2>Build</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
      <p className="note">Builders construct new buildings during their shift. Trees on the plot are cut for wood.</p>
      <div className="list">
        {kinds.map((k) => {
          const t = TYPES[k], ok = canAfford(t.cost, t.gold)
          return (
            <button key={k} className="person build" disabled={!ok} onClick={() => start(k)} title={ok ? '' : `Need ${missing(t.cost, t.gold).join(', ')}`}>
              {t.name}<small>{t.description}</small><Cost cost={t.cost} gold={t.gold} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PlacementBar() {
  const p = useGame((s) => s.placing)
  if (!p) return null
  const t = TYPES[p.kind]
  const check = p.x !== null && p.z !== null ? checkPlacement(p.kind, p.x, p.z, p.rot) : null
  return (
    <div className="placebar">
      <div><b>{t.name}</b> <Cost cost={t.cost} gold={t.gold} /></div>
      <small className={check && !check.ok ? 'warn' : ''}>{check ? (check.ok ? check.reason || 'Good spot!' : check.reason) : 'Tap or move over the ground'}</small>
      <div className="actions">
        <button onClick={rotatePlacement}>⟳ Rotate <kbd>R</kbd></button>
        <button disabled={!check?.ok} onClick={confirmPlacement}>✓ Build here</button>
        <button onClick={() => useGame.setState({ placing: null })}>✕ Cancel</button>
      </div>
    </div>
  )
}

const KEEP = 40
export function StoragePanel({ close }: { close: () => void }) {
  useGame((s) => s.rev)
  const minute = useGame((s) => Math.floor(s.time))
  const g = useGame.getState()
  const sell = (r: Resource, q: number) => { if (!sellToMerchant(r, q, minute)) g.notify(`Not enough ${r}`) }
  const buy = (r: Resource, q: number) => { if (!buyFromMerchant(r, q, minute)) g.notify(town.gold < buyQuote(r, q) ? 'Not enough gold' : 'Storage is full') }
  const surplus = RESOURCES.filter((r) => town.stock[r] > KEEP)
  const surplusGold = surplus.reduce((a, r) => a + sellQuote(r, town.stock[r] - KEEP), 0)
  const days = [town.today, ...town.days].slice(0, 7)
  const maxFlow = Math.max(1, ...days.map((d) => Math.max(d.income, d.expense)))
  return (
    <div className="panel wide-panel">
      <header><h2>Storage & Trade</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
      <p className="note">Treasury 🪙 {Math.floor(town.gold)} · storage {storageCap()} per resource · the travelling merchant buys at 80% and sells at 130% of the town price.</p>
      <table className="stock">
        <thead><tr><th>Good</th><th>Stock</th><th>Price</th><th>Trade 10</th></tr></thead>
        <tbody>
          {RESOURCES.map((r) => (
            <tr key={r}>
              <td>{RESOURCE_ICON[r]} {cap(r)}</td>
              <td>{Math.floor(town.stock[r])}</td>
              <td>{price(r)}</td>
              <td className="trade">
                <button disabled={town.stock[r] < 10} onClick={() => sell(r, 10)} title={`+${sellQuote(r, 10)} gold`}>Sell</button>
                <button disabled={town.gold < buyQuote(r, 10)} onClick={() => buy(r, 10)} title={`−${buyQuote(r, 10)} gold`}>Buy</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button disabled={!surplus.length} onClick={() => { surplus.forEach((r) => sellToMerchant(r, town.stock[r] - KEEP, minute)); g.notify(`Sold surplus for ${surplusGold} gold`) }}>
          Sell surplus above {KEEP} (+{surplusGold} 🪙)
        </button>
      </div>
      <h3>Last days</h3>
      <div className="days">
        {days.map((d) => (
          <div key={d.day} className="day" title={Object.entries(d.byKind).map(([k, v]) => `${k} ${Math.round(v ?? 0)}`).join(', ')}>
            <span>Day {d.day}{d === town.today ? ' (today)' : ''}</span>
            <div><i className="in" style={{ width: `${(d.income / maxFlow) * 100}%` }} /><i className="out" style={{ width: `${(d.expense / maxFlow) * 100}%` }} /></div>
            <b className={d.income - d.expense < 0 ? 'neg' : 'pos'}>{d.income - d.expense >= 0 ? '+' : ''}{Math.round(d.income - d.expense)}</b>
          </div>
        ))}
      </div>
      <p className="note">Green = income (rent, meals, shopping, sales) · red = spending (wages, construction, purchases). Hover a day for details.</p>
      <h3>Recent transactions</h3>
      <ul className="ledger">
        {town.ledger.slice(0, 12).map((x, i) => (
          <li key={i}><small>Day {dayOf(x.t)} {clock(x.t)}</small> {x.note} {x.gold !== 0 && <b className={x.gold < 0 ? 'neg' : 'pos'}>{x.gold > 0 ? '+' : ''}{Math.round(x.gold)}</b>}</li>
        ))}
        {!town.ledger.length && <li>No transactions yet.</li>}
      </ul>
    </div>
  )
}

/** Compact stock readout for the top bar. */
export function StockChips({ onClick }: { onClick: () => void }) {
  useGame((s) => s.rev)
  useGame((s) => Math.floor(s.time / 5))
  const food = town.stock.bread + town.stock.fish + town.stock.vegetables
  const pop = RESIDENTS.length
  return (
    <button className="card stats chips" onClick={onClick} title="Open Storage & Trade">
      <span title="Gold">🪙 {Math.floor(town.gold)}</span>
      <span className="opt" title="Wood">🪵 {town.stock.wood}</span>
      <span className="opt" title="Stone">🪨 {town.stock.stone}</span>
      <span className="opt" title="Food (bread + fish + vegetables)">🍞 {food}</span>
      <span title="Residents / beds">👥 {pop}/{beds()}</span>
    </button>
  )
}

