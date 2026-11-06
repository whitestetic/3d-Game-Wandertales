import { useState } from 'react'
import { chronicle, type ChronKind } from '../game/chronicle'
import { FESTIVALS, SEASONS, SEASON_DAYS, SEASON_INFO, WEATHER_INFO, dayInSeason, seasonOf, weatherAt, yearOf } from '../game/calendar'
import { clock, dayOf, useGame } from '../game/store'

const FILTERS: [string, string, ChronKind[] | null][] = [
  ['all', 'All', null],
  ['nature', 'Nature', ['season', 'weather', 'festival']],
  ['town', 'Town', ['build', 'people', 'milestone']],
  ['guild', 'Guild', ['quest']],
]

/** Town Chronicle: the calendar and a diary of everything that happened. */
export function ChroniclePanel({ close }: { close: () => void }) {
  const t = useGame((s) => Math.floor(s.time / 10) * 10)
  const [filter, setFilter] = useState('all')
  const kinds = FILTERS.find((f) => f[0] === filter)![2]
  const list = chronicle.entries.filter((e) => !kinds || kinds.includes(e.kind))
  const season = seasonOf(t), info = SEASON_INFO[season], w = WEATHER_INFO[weatherAt(t)]
  const dayNo = dayInSeason(t)
  const daysLeft = SEASON_DAYS - dayNo
  let lastDay = -1
  return (
    <div className="panel wide-panel">
      <header><h2>📜 Town Chronicle</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
      <div className="calendar">
        <b>{info.icon} {info.name}, year {yearOf(t)}</b>
        <small>Day {dayNo} of {SEASON_DAYS} · {w.icon} {w.name} now</small>
        <div className="season-row" aria-label="Seasons">
          {SEASONS.map((s) => <span key={s} className={s === season ? 'on' : ''} title={SEASON_INFO[s].name}>{SEASON_INFO[s].icon}</span>)}
        </div>
        <small>{FESTIVALS[season].icon} {FESTIVALS[season].name} {daysLeft === 0 ? 'is today (14:00)' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</small>
      </div>
      <div className="seg tabs">
        {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {list.length === 0 && <p className="note">Nothing written yet. The Chronicle fills as the town grows.</p>}
      <div className="chronicle">
        {list.map((e, i) => {
          const d = dayOf(e.t), head = d !== lastDay
          lastDay = d
          return (
            <div key={`${e.t}-${i}`}>
              {head && <h4>Day {d} · {SEASON_INFO[seasonOf(e.t)].icon} {SEASON_INFO[seasonOf(e.t)].name}</h4>}
              <p><time>{clock(e.t)}</time> {e.icon} {e.text}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
