import { useEffect, useState } from 'react'
import { errorText, getBackend, type AdminSession, type Entry, type ImportSummary, type RecruitEvent } from '../backend'
import { syncGuild } from '../backend/sync'
import { CLASSES, RANKS, parseCommentsCsv, rankName, validPostUrl, type CommentRow, type GuildClass } from '../game/recruitment'
import { QUESTS, goodsText, guild, partyProblem, questBoard, startQuest, successChance } from '../game/guild'
import { RESIDENTS } from '../game/residents.mock'
import { clock, dayOf, useGame } from '../game/store'

type Tab = 'overview' | 'members' | 'quests' | 'recruit' | 'records'
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)
const nextRank = (renown: number, rank: number) => RANKS.find((r) => r.rank === rank + 1)
const pct = (x: number) => `${Math.round(x * 100)}%`

/** Guild Headquarters: members, quests, recruitment and the adventure log. */
export function GuildPanel({ close }: { close: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [session, setSession] = useState<AdminSession | null>(null)
  useGame((s) => s.rev)
  useEffect(() => { getBackend().then((b) => b.session()).then(setSession); syncGuild() }, [])
  const gm = !!session?.isGuildMaster

  return (
    <div className="panel wide-panel">
      <header><h2>⚔️ Guild Hall</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
      <div className="seg tabs">
        {([['overview', 'Overview'], ['members', `Members (${guild.members.length})`], ['quests', `Quests${guild.active.length ? ` (${guild.active.length})` : ''}`], ['recruit', 'Recruitment'], ['records', 'Records']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {!gm && session && <p className="note">View only — sign in as Guild Master in 🏘️ Community to manage the guild.</p>}
      {tab === 'overview' && <Overview />}
      {tab === 'members' && <Members gm={gm} />}
      {tab === 'quests' && <Quests gm={gm} />}
      {tab === 'recruit' && <Recruitment gm={gm} />}
      {tab === 'records' && <Records />}
    </div>
  )
}

function Overview() {
  return (
    <div>
      <dl>
        <dt>Reputation</dt><dd>🏅 {guild.reputation}</dd>
        <dt>Members</dt><dd>{guild.members.length}</dd>
        <dt>On adventure</dt><dd>{guild.active.length} quest{guild.active.length === 1 ? '' : 's'}</dd>
        <dt>Treasury</dt><dd>🪙 {guild.questGold} earned from quests (goes to the town treasury)</dd>
        <dt>Adventures</dt><dd>{guild.records.filter((r) => r.success).length} won · {guild.records.filter((r) => !r.success).length} failed</dd>
      </dl>
      <h3>Ranks</h3>
      <div className="ranks">{RANKS.map((r) => <span key={r.rank}><b>{r.name}</b><small>{r.minRenown}+ renown</small></span>)}</div>
      <p className="note">Guild Members are residents who won a recruitment event. They still live and work in town, and can be sent on quests from this hall. Ranks rise automatically with renown.</p>
    </div>
  )
}

function Members({ gm }: { gm: boolean }) {
  const notify = useGame((s) => s.notify)
  const act = (fn: () => Promise<unknown>, ok: string) => fn().then(() => { notify(ok); return syncGuild() }, (e) => notify(errorText(e)))
  if (!guild.members.length) return <p className="note">No Guild Members yet. Run a recruitment event to find your first adventurers.</p>
  return (
    <div className="list">
      {guild.members.map((m) => {
        const next = nextRank(m.renown, m.rank), away = guild.active.find((a) => a.members.includes(m.id))
        const inTown = RESIDENTS.some((r) => r.id === m.residentId)
        return (
          <div key={m.id} className="member">
            <div className="member-head">
              <b>{m.displayName}</b>
              <span className={`rank r${m.rank}`}>{m.rankName}</span>
              <span className="cls">{m.cls}</span>
            </div>
            <div className="bar"><span>Renown {m.renown}{next ? ` / ${next.minRenown}` : ' (max)'}</span>
              <div><i style={{ width: next ? `${Math.min(100, (m.renown / next.minRenown) * 100)}%` : '100%', background: '#b07ce0' }} /></div></div>
            <small>{away ? `⚔️ On a quest until ${clock(away.end)} (day ${dayOf(away.end)})` : inTown ? 'In town' : 'Not in town yet (waiting for a home)'}</small>
            {gm && (
              <div className="actions">
                <select value={m.cls} onChange={(e) => act(() => getBackend().then((b) => b.updateMember(m.id, null, e.target.value as GuildClass)), `${m.displayName} is now a ${e.target.value}`)}>
                  {CLASSES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button disabled={m.rank >= 6} onClick={() => act(() => getBackend().then((b) => b.updateMember(m.id, m.rank + 1, null)), `${m.displayName} promoted to ${rankName(m.rank + 1)}`)}>▲ Promote</button>
                <button disabled={m.rank <= 1} onClick={() => act(() => getBackend().then((b) => b.updateMember(m.id, m.rank - 1, null)), `${m.displayName} is now ${rankName(m.rank - 1)}`)}>▼</button>
                <button onClick={() => { if (confirm(`Remove ${m.displayName} from the guild? They stay a resident.`)) act(() => getBackend().then((b) => b.removeMember(m.id)), `${m.displayName} left the guild`) }}>✕</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Quests({ gm }: { gm: boolean }) {
  const minute = useGame((s) => Math.floor(s.time))
  const notify = useGame((s) => s.notify)
  const [party, setParty] = useState<Record<string, string[]>>({})
  const day = dayOf(minute)
  const free = guild.members.filter((m) => !guild.active.some((a) => a.members.includes(m.id)) && RESIDENTS.some((r) => r.id === m.residentId))
  return (
    <div>
      {guild.active.length > 0 && <h3>On adventure</h3>}
      {guild.active.map((a) => {
        const q = QUESTS.find((x) => x.key === a.key)!
        const names = a.members.map((id) => guild.members.find((m) => m.id === id)?.displayName ?? '?')
        return (
          <div key={a.id} className="quest active">
            <b>{q.name}</b> <small>{names.join(', ')} · {pct(a.chance)} chance</small>
            <div className="bar"><span>Back at {clock(a.end)}</span><div><i style={{ width: `${Math.min(100, ((minute - a.start) / (a.end - a.start)) * 100)}%`, background: '#e0b04a' }} /></div></div>
          </div>
        )
      })}
      <h3>Quest board — day {day}</h3>
      {questBoard(day).map(({ id, q }) => {
        const taken = guild.taken.includes(id)
        const chosen = (party[id] ?? []).map((mid) => guild.members.find((m) => m.id === mid)!).filter(Boolean)
        const problem = partyProblem(q, chosen)
        return (
          <div key={id} className={`quest ${taken ? 'done' : ''}`}>
            <b>{q.name}</b> <span className="stars" title={`Difficulty ${q.difficulty}`}>{stars(q.difficulty)}</span>
            <p className="desc">{q.desc}</p>
            <small>⏱ {q.hours} h · party {q.party[0]}–{q.party[1]} · reward 🪙 {q.gold}{goodsText(q.goods) ? ` + ${goodsText(q.goods)}` : ''} · ✨ {q.renown} renown each</small>
            {taken ? <p className="note">Taken today.</p> : gm && (
              <>
                <div className="party">
                  {free.length ? free.map((m) => (
                    <label key={m.id} className="check">
                      <input type="checkbox" checked={(party[id] ?? []).includes(m.id)}
                        onChange={(e) => setParty({ ...party, [id]: e.target.checked ? [...(party[id] ?? []), m.id] : (party[id] ?? []).filter((x) => x !== m.id) })} />
                      {m.displayName} <small>{m.rankName} {m.cls}</small>
                    </label>
                  )) : <p className="note">No members free right now.</p>}
                </div>
                <div className="actions">
                  <button disabled={!!problem} title={problem ?? ''} onClick={() => {
                    const err = startQuest(id, q, chosen, minute)
                    notify(err ?? `${chosen.map((m) => m.displayName).join(', ')} set out on “${q.name}”!`)
                    useGame.setState((s) => ({ rev: s.rev + 1 }))
                  }}>Send party {chosen.length ? `(${pct(successChance(q, chosen))} success)` : ''}</button>
                </div>
                {problem && chosen.length > 0 && <p className="note warn">{problem}</p>}
              </>
            )}
          </div>
        )
      })}
      <p className="note">Success chance grows with rank vs. difficulty, party size, a Healer, and mixing 3+ classes. Failed parties come home hurt. New quests appear each day.</p>
    </div>
  )
}

function Records() {
  if (!guild.records.length) return <p className="note">No adventures yet.</p>
  return (
    <ul className="ledger">
      {guild.records.map((r, i) => (
        <li key={i}>
          <small>Day {dayOf(r.t)} {clock(r.t)}</small> {r.success ? '🏆' : '💢'} <b>{r.quest}</b> — {r.members.join(', ')}
          {r.success ? ` · +${r.gold} gold${goodsText(r.goods) ? `, ${goodsText(r.goods)}` : ''}` : ' · failed'} · +{r.renown} renown
        </li>
      ))}
    </ul>
  )
}

// ---------- recruitment ----------

const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

function Recruitment({ gm }: { gm: boolean }) {
  const [events, setEvents] = useState<RecruitEvent[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const load = () => getBackend().then((b) => b.listEvents()).then((l) => { setEvents(l); setSelected((s) => s ?? l[0]?.id ?? null) }, (e) => setErr(errorText(e)))
  useEffect(() => { load() }, [])
  const ev = events.find((e) => e.id === selected)
  return (
    <div>
      {err && <p className="note warn">{err}</p>}
      <div className="actions">
        <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {!events.length && <option value="">No events yet</option>}
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}{e.status === 'closed' ? ' (closed)' : ''}</option>)}
        </select>
        {gm && <button onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : '+ New event'}</button>}
      </div>
      {creating && gm && <NewEvent onDone={(id) => { setCreating(false); setSelected(id); load() }} />}
      {ev && <EventView ev={ev} gm={gm} onChange={load} />}
    </div>
  )
}

function NewEvent({ onDone }: { onDone: (id: string) => void }) {
  const now = new Date()
  const [f, setF] = useState({ title: 'Guild Recruitment', postUrl: '', start: isoLocal(now), end: isoLocal(new Date(now.getTime() + 7 * 864e5)), minComments: 5, slots: 3, minChars: 5, maxPerDay: 10 })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v })
  const submit = () => {
    if (!validPostUrl(f.postUrl)) return setErr('Paste the Instagram post link, e.g. https://www.instagram.com/p/ABC123/')
    getBackend().then((b) => b.createEvent({ title: f.title, postUrl: f.postUrl.trim(), startsAt: new Date(f.start).toISOString(), endsAt: new Date(f.end).toISOString(),
      minComments: f.minComments, slots: f.slots, minChars: f.minChars, maxPerDay: f.maxPerDay })).then(onDone, (e) => setErr(errorText(e)))
  }
  return (
    <div className="form card-in">
      <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Event title" maxLength={60} />
      <input value={f.postUrl} onChange={(e) => set('postUrl', e.target.value)} placeholder="https://www.instagram.com/p/…" />
      <div className="grid2">
        <label>Starts<input type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} /></label>
        <label>Ends<input type="datetime-local" value={f.end} onChange={(e) => set('end', e.target.value)} /></label>
        <label>Comments needed<input type="number" min={1} value={f.minComments} onChange={(e) => set('minComments', Number(e.target.value))} /></label>
        <label>Recruit slots<input type="number" min={1} max={50} value={f.slots} onChange={(e) => set('slots', Number(e.target.value))} /></label>
        <label>Min letters per comment<input type="number" min={0} value={f.minChars} onChange={(e) => set('minChars', Number(e.target.value))} /></label>
        <label>Max counted per day<input type="number" min={1} value={f.maxPerDay} onChange={(e) => set('maxPerDay', Number(e.target.value))} /></label>
      </div>
      {err && <p className="note warn">{err}</p>}
      <button onClick={submit}>Create event</button>
    </div>
  )
}

function EventView({ ev, gm, onChange }: { ev: RecruitEvent; gm: boolean; onChange: () => void }) {
  const [board, setBoard] = useState<Entry[]>([])
  const [rows, setRows] = useState<CommentRow[] | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [cls, setCls] = useState<Record<string, GuildClass>>({})
  const notify = useGame((s) => s.notify)
  const load = () => getBackend().then((b) => b.leaderboard(ev.id)).then(setBoard, (e) => notify(errorText(e)))
  useEffect(() => { load(); setRows(null); setSummary(null) }, [ev.id])
  const approved = board.filter((e) => e.status === 'approved').length

  const readFile = async (text: string) => { const r = await parseCommentsCsv(text); setRows(r.rows); setProblems(r.problems); setSummary(null) }
  const doImport = () => getBackend().then((b) => b.importComments(ev.id, rows!)).then((s) => { setSummary(s); setRows(null); load() }, (e) => notify(errorText(e)))
  const review = (e: Entry, ok: boolean) => getBackend().then((b) => b.reviewEntry(ev.id, e.instagram, ok, cls[e.instagram] ?? 'Warrior'))
    .then(() => { notify(ok ? `@${e.instagram} joined the guild! ⚔️` : `@${e.instagram} rejected`); load(); syncGuild() }, (x) => notify(errorText(x)))

  return (
    <div>
      <p className="note">
        <a href={ev.postUrl} target="_blank" rel="noreferrer">Instagram post ↗</a> · {new Date(ev.startsAt).toLocaleString()} → {new Date(ev.endsAt).toLocaleString()} ·
        {' '}{ev.minComments} valid comments needed · {approved}/{ev.slots} recruited · {ev.status === 'open' ? '🟢 open' : '🔒 closed'}
      </p>
      <p className="note">Anti-spam: comments outside the dates don’t count; comments under {ev.minChars} letters (emoji/mention-only) don’t count; the same text counts once; at most {ev.maxPerDay} per person per day. Only registered residents can be recruited.</p>
      {gm && ev.status === 'open' && (
        <div className="form card-in">
          <b>Import comments</b>
          <small>CSV with columns <code>username, text, timestamp</code> (from any comment export tool, or typed by hand). Comment text is hashed in your browser and never uploaded.</small>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0]?.text().then(readFile)} />
          {rows && <p className="note">{rows.length} comments ready{problems.length ? ` · ${problems.length} lines skipped (${problems.slice(0, 2).join('; ')}${problems.length > 2 ? '…' : ''})` : ''}</p>}
          <button disabled={!rows?.length} onClick={doImport}>Import {rows?.length ?? ''} comments & recount</button>
          {summary && <p className="note">Added {summary.added} · {summary.duplicates} duplicates skipped · {summary.invalid} invalid</p>}
        </div>
      )}
      <h3>Leaderboard</h3>
      {!board.length ? <p className="note">No comments imported yet.</p> : (
        <table className="stock">
          <thead><tr><th>#</th><th>Instagram</th><th>Valid</th><th>Status</th></tr></thead>
          <tbody>
            {board.map((e) => (
              <tr key={e.instagram}>
                <td>{e.place}</td>
                <td>@{e.instagram}</td>
                <td title={`${e.totalComments} comments in total`}>{e.validComments}/{e.totalComments}</td>
                <td>
                  {e.status === 'approved' ? <span className="pos">✓ Recruited</span> : e.status === 'rejected' ? <span className="neg">Rejected</span>
                    : e.eligible ? (gm ? (
                      <span className="trade">
                        <select value={cls[e.instagram] ?? 'Warrior'} onChange={(x) => setCls({ ...cls, [e.instagram]: x.target.value as GuildClass })}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
                        <button disabled={approved >= ev.slots} onClick={() => review(e, true)}>Recruit</button>
                        <button onClick={() => review(e, false)}>✕</button>
                      </span>
                    ) : <span className="pos">Eligible</span>) : <small>{e.reason}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {gm && ev.status === 'open' && <div className="actions"><button onClick={() => { if (confirm('Close this event? No more comments can be imported.')) getBackend().then((b) => b.closeEvent(ev.id)).then(onChange) }}>🔒 Close event</button></div>}
    </div>
  )
}
