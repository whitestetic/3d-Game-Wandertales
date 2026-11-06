import { useEffect, useState } from 'react'
import { backendMode, errorText, getBackend, type AdminSession, type FollowerListInfo, type ImportResult, type Registration } from '../backend'
import { syncCommunity, syncState, togglePlaceholders } from '../backend/sync'
import { community } from '../game/community'
import { PERSONALITIES, normalizeInstagram, randomAppearance, validName } from '../game/avatar'
import { previewImport, type PreviewRow } from '../game/csv'
import { hashHandle, parseFollowerExport } from '../game/followers'
import { RESIDENTS, type Appearance, type Personality } from '../game/residents.mock'
import { beds } from '../game/town'
import { npcLive } from '../game/live'
import { getBuilding } from '../game/map'
import { useGame } from '../game/store'
import { AvatarEditor, AvatarPreview } from './AvatarEditor'

type Tab = 'pending' | 'followers' | 'residents' | 'add' | 'import'
const registerUrl = () => `${location.origin}${location.pathname}#/register`

/** Guild Master tools: review registrations, manage residents, manual add, CSV import. */
export function CommunityPanel({ close }: { close: () => void }) {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [tab, setTab] = useState<Tab>('pending')
  const [pending, setPending] = useState<Registration[]>([])
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  useGame((s) => s.rev)
  const notify = useGame((s) => s.notify)

  const load = async () => {
    try {
      const b = await getBackend()
      const s = await b.session()
      setSession(s)
      if (s.isGuildMaster) setPending(await b.listRegistrations('pending'))
    } catch (e) { setError(errorText(e)) }
  }
  useEffect(() => { load() }, [])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null)
    try { await fn(); notify(ok); await load(); await syncCommunity() } catch (e) { setError(errorText(e)) }
  }

  return (
    <div className="panel wide-panel">
      <header><h2>Community</h2><button className="x" onClick={close} aria-label="Close">✕</button></header>
      <p className={`badge ${backendMode === 'local' ? '' : 'ok'}`}>{backendMode === 'local' ? 'Local dev backend — data stays in this browser' : 'Connected to Supabase'}</p>
      <div className="share">
        <small>Registration link for your followers:</small>
        <code>{registerUrl()}</code>
        <button onClick={() => navigator.clipboard?.writeText(registerUrl()).then(() => notify('Link copied'))}>Copy</button>
        <a href="#/register">Open</a>
      </div>
      {error && <p className="note warn">{error}</p>}
      {syncState.error && <p className="note warn">Could not load residents: {syncState.error}</p>}

      {!session ? <p>Loading…</p> : !session.isGuildMaster ? (
        <div>
          {session.signedIn ? <p className="note warn">Signed in as {session.email}, but this account isn’t the Guild Master. Grant the role in Supabase (see README).</p>
            : sent ? <p className="note">Check {email} for a sign-in link, then come back here.</p> : (
              <form onSubmit={(e) => { e.preventDefault(); getBackend().then((b) => b.signIn(email)).then(() => setSent(true), (er) => setError(errorText(er))) }}>
                <p className="note">Sign in as the Guild Master to review registrations.</p>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <button type="submit">Send sign-in link</button>
              </form>
            )}
          {session.signedIn && <button onClick={() => getBackend().then((b) => b.signOut()).then(load)}>Sign out</button>}
        </div>
      ) : (
        <>
          <div className="seg tabs">
            {([['pending', `Pending (${pending.length})`], ['followers', 'Followers'], ['residents', `Residents (${community.members.length})`], ['add', 'Add'], ['import', 'Import CSV']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'pending' && <Pending list={pending} onReview={(r, ok) => run(() => getBackend().then((b) => b.review(r.id, ok, ok ? 'Code confirmed' : 'Code not received')), ok ? `${r.displayName} approved!` : `${r.displayName} rejected`)} />}
          {tab === 'followers' && <Followers />}
          {tab === 'residents' && <Residents onRemove={(id, name) => run(() => getBackend().then((b) => b.removeResident(id)), `${name} removed`)} />}
          {tab === 'add' && <AddResident onAdd={(input) => run(() => getBackend().then((b) => b.addResident(input)), `${input.displayName} added`)} />}
          {tab === 'import' && <ImportCsv done={() => { load(); syncCommunity() }} />}
          {backendMode === 'supabase' && <p className="note">Signed in as {session.email} · <a onClick={() => getBackend().then((b) => b.signOut()).then(load)}>sign out</a></p>}
        </>
      )}
    </div>
  )
}

function Pending({ list, onReview }: { list: Registration[]; onReview: (r: Registration, approve: boolean) => void }) {
  if (!list.length) return <p className="note">No registrations waiting. Share the link above!</p>
  return (
    <div className="list">
      <p className="note">Approve only after you received the code as a DM from that exact Instagram account.</p>
      {list.map((r) => (
        <div key={r.id} className="pending">
          <AvatarPreview look={r.appearance} size={90} />
          <div>
            <b>{r.displayName}</b> <small>@{r.instagram} · {r.personality}</small>{' '}
            {r.follows ? <span className="follows">✓ Follows</span> : <span className="follows unknown">Follow not checked</span>}
            <p className="code small">{r.verificationCode}</p>
            <small>{new Date(r.createdAt).toLocaleString()} · {r.showInstagram ? 'shows Instagram' : 'Instagram hidden'}</small>
            <div className="actions">
              <button onClick={() => onReview(r, true)}>✓ Approve (code received)</button>
              <button onClick={() => onReview(r, false)}>✕ Reject</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Residents({ onRemove }: { onRemove: (id: string, name: string) => void }) {
  const placeholders = RESIDENTS.some((r) => r.mock)
  const g = useGame.getState()
  return (
    <div>
      <p className="note">Population {RESIDENTS.length} / {beds()} beds · {community.waiting.length} waiting for a home{community.waiting.length ? ' — build Cottages!' : ''}</p>
      <label className="check"><input type="checkbox" checked={placeholders} onChange={(e) => togglePlaceholders(e.target.checked)} /> Show the 12 placeholder residents (turn off to free their beds)</label>
      <div className="list">
        {community.members.map((m) => {
          const r = RESIDENTS.find((x) => x.id === m.id), live = npcLive[m.id]
          return (
            <div key={m.id} className="person row">
              <span>{m.displayName}<small>{m.instagram ? `@${m.instagram} · ` : ''}{r ? `${getBuilding(r.home)?.name} · ${r.profession}` : '⏳ waiting for a free bed'}</small></span>
              {r && <button onClick={() => { g.select({ type: 'resident', id: m.id }); if (live) g.focusOn(live.x, live.z) }}>Find</button>}
              <button onClick={() => { if (confirm(`Remove ${m.displayName} from the town? Their registration is deleted.`)) onRemove(m.id, m.displayName) }}>Remove</button>
            </div>
          )
        })}
        {!community.members.length && <p className="note">No registered residents yet.</p>}
      </div>
    </div>
  )
}

function AddResident({ onAdd }: { onAdd: (i: { instagram: string; displayName: string; personality: Personality; appearance: Appearance; consentData: boolean; showInstagram: boolean }) => void }) {
  const [ig, setIg] = useState(''), [name, setName] = useState(''), [pers, setPers] = useState<Personality>('Kind')
  const [look, setLook] = useState<Appearance>(() => randomAppearance(Date.now() >>> 0))
  const [consent, setConsent] = useState(false), [show, setShow] = useState(false)
  const ok = !!normalizeInstagram(ig) && validName(name) && consent
  return (
    <div className="form">
      <p className="note">Add someone who agreed to join outside the game (e.g. in DMs).</p>
      <input placeholder="Instagram username" value={ig} onChange={(e) => setIg(e.target.value)} />
      <input placeholder="Name in town" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
      <select value={pers} onChange={(e) => setPers(e.target.value as Personality)}>{PERSONALITIES.map((p) => <option key={p}>{p}</option>)}</select>
      <AvatarPreview look={look} size={150} />
      <AvatarEditor value={look} onChange={setLook} />
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> This person gave consent to be a resident</label>
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> They agreed to show their Instagram in game</label>
      <button disabled={!ok} onClick={() => onAdd({ instagram: ig, displayName: name, personality: pers, appearance: look, consentData: consent, showInstagram: show })}>Add resident</button>
    </div>
  )
}

function ImportCsv({ done }: { done: () => void }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  useEffect(() => { getBackend().then((b) => b.listResidents()).then((l) => setExisting(new Set(l.map((r) => r.instagram).filter(Boolean) as string[]))) }, [])
  const preview: PreviewRow[] = text.trim() ? previewImport(text, existing) : []
  const good = preview.filter((p) => p.row)
  const go = async () => {
    setBusy(true)
    try { setResults(await (await getBackend()).importResidents(good.map((p) => p.row!))); done() } catch (e) { setResults([{ row: 0, ok: false, error: errorText(e) }]) } finally { setBusy(false) }
  }
  return (
    <div className="form">
      <p className="note">Columns: <code>instagram, display_name, consent</code> (+ optional <code>personality</code>, <code>show_instagram</code>). Only rows with consent = yes are imported. Avatars are generated and can be changed later by re-registering.</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0]?.text().then(setText)} />
      <textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setResults(null) }} placeholder={'instagram,display_name,consent\n@pip.bakes,Pip,yes'} />
      {preview.length > 0 && (
        <table className="stock">
          <thead><tr><th>Line</th><th>Instagram</th><th>Name</th><th>Status</th></tr></thead>
          <tbody>{preview.map((p) => <tr key={p.line}><td>{p.line}</td><td>{p.row?.instagram ?? '—'}</td><td>{p.row?.display_name ?? ''}</td><td className={p.problem ? 'neg' : 'pos'}>{p.problem ?? 'OK'}</td></tr>)}</tbody>
        </table>
      )}
      <button disabled={!good.length || busy} onClick={go}>Import {good.length} resident{good.length === 1 ? '' : 's'}</button>
      {results && <p className="note">{results.filter((r) => r.ok).length} imported{results.some((r) => !r.ok) ? ` · ${results.filter((r) => !r.ok).map((r) => `row ${r.row}: ${errorText(r.error)}`).join('; ')}` : ''}</p>}
    </div>
  )
}

function Followers() {
  const [info, setInfo] = useState<FollowerListInfo | null | undefined>(undefined)
  const [found, setFound] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const loadInfo = () => getBackend().then((b) => b.followerListInfo()).then(setInfo, (e) => setMsg(errorText(e)))
  useEffect(() => { loadInfo() }, [])

  const read = async (files: FileList | null) => {
    if (!files?.length) return
    const all = new Set<string>()
    for (const f of [...files]) for (const h of parseFollowerExport(await f.text())) all.add(h)
    setFound(all)
    setMsg(all.size ? null : 'No usernames found — pick the followers_1.json (or .html) file from the export.')
  }
  const upload = async () => {
    if (!found?.size) return
    setBusy(true); setMsg(null)
    try {
      const hashes = await Promise.all([...found].map(hashHandle))
      const n = await (await getBackend()).setFollowers(hashes)
      setMsg(`Follower list updated: ${n} followers. Only followers on this list can register.`)
      setFound(null)
      loadInfo()
    } catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="form">
      <p className="note">
        {info === undefined ? 'Loading…' : info ? <>Current list: <b>{info.count}</b> followers, uploaded {new Date(info.uploadedAt).toLocaleString()}. Only these accounts can register.</>
          : <><b>No follower list yet</b> — anyone can register until you upload one.</>}
      </p>
      <p className="note">How to get the list from Instagram (no API needed):</p>
      <ol className="steps-list">
        <li>Instagram app → Settings → <b>Accounts Center</b> → Your information and permissions → <b>Download your information</b>.</li>
        <li>Choose <b>@wandertales.guild</b> → Some of your information → <b>Followers and following</b>.</li>
        <li>Download to device, format <b>JSON</b> (HTML also works), date range <b>All time</b>.</li>
        <li>When Instagram emails you, unzip and pick <code>followers_1.json</code> (and followers_2… if there are more). Not the “following” file.</li>
      </ol>
      <input type="file" multiple accept=".json,.html,.htm,.txt,.csv" onChange={(e) => read(e.target.files)} />
      {found && found.size > 0 && <p className="note">Found <b>{found.size}</b> followers in the file{found.size > 1 ? 's' : ''}, e.g. {[...found].slice(0, 3).map((h) => `@${h}`).join(', ')}.</p>}
      <button disabled={!found?.size || busy} onClick={upload}>{busy ? 'Uploading…' : 'Replace follower list'}</button>
      {msg && <p className="note">{msg}</p>}
      <p className="note">Privacy: usernames are turned into one-way fingerprints (SHA-256) in your browser before upload, so the database never stores a readable follower list. New followers can register after your next upload.</p>
    </div>
  )
}
