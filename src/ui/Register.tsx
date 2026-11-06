import { useEffect, useState } from 'react'
import { backendMode, errorText, getBackend, type Registration } from '../backend'
import { PERSONALITIES, normalizeInstagram, randomAppearance, validName } from '../game/avatar'
import type { Appearance, Personality } from '../game/residents.mock'
import { AvatarEditor, AvatarPreview } from './AvatarEditor'

const GUILD_IG = 'wandertales.guild'
const FOLLOW_URL = `https://www.instagram.com/${GUILD_IG}/`
const BLURB: Record<Personality, string> = {
  Cheerful: 'Brightens everyone’s day', Shy: 'Quiet, prefers small groups', Hardworking: 'Learns jobs faster', Social: 'Loves the tavern crowd',
  Greedy: 'Happiest with a full purse', Kind: 'Gets along with almost everyone', Adventurous: 'Dreams of joining the Guild', Lazy: 'Fond of naps',
}

/** Public page where followers of @wandertales.guild voluntarily become residents. */
export function RegisterPage() {
  const [step, setStep] = useState(0)
  const [ig, setIg] = useState('')
  const [name, setName] = useState('')
  const [look, setLook] = useState<Appearance>(() => randomAppearance((Math.random() * 2 ** 32) >>> 0))
  const [personality, setPersonality] = useState<Personality>('Cheerful')
  const [consent, setConsent] = useState(false)
  const [showIg, setShowIg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<Registration | null | undefined>(undefined)

  const refresh = () => getBackend().then((b) => b.myRegistration()).then(setMine).catch(() => setMine(null))
  useEffect(() => { refresh() }, [])

  const handle = normalizeInstagram(ig)
  const step0ok = !!handle && validName(name)
  const [notFollowing, setNotFollowing] = useState(false)
  /** Check the follower list before the avatar step, so nobody designs an avatar for nothing. */
  const next0 = async () => {
    setBusy(true); setError(null); setNotFollowing(false)
    try {
      const follows = await (await getBackend()).isFollower(ig)
      if (follows === false) setNotFollowing(true)
      else setStep(1)
    } catch {
      setStep(1) // early check unavailable (e.g. migration not run yet); the server checks again on Join
    } finally { setBusy(false) }
  }
  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const b = await getBackend()
      await b.register({ instagram: ig, displayName: name, personality, appearance: look, consentData: consent, showInstagram: showIg })
      await refresh()
    } catch (e) {
      setError(errorText(e))
      if (String((e as Error)?.message).includes('not_following')) setNotFollowing(true)
    } finally { setBusy(false) }
  }
  const withdraw = async () => {
    if (!confirm('Withdraw your registration and delete your resident? This cannot be undone.')) return
    setBusy(true)
    try { await (await getBackend()).withdraw(); setMine(null); setStep(0) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="register">
      <div className="reg-card">
        <p className="kicker">@{GUILD_IG}</p>
        <h1>Become a Resident<span>of WanderTales Town</span></h1>
        {backendMode === 'local' && <p className="badge">Local dev backend — registrations stay in this browser only</p>}

        {mine === undefined ? <p>Loading…</p> : mine && mine.status !== 'rejected' ? (
          <Status reg={mine} onRefresh={refresh} onWithdraw={withdraw} busy={busy} />
        ) : (
          <>
            {mine?.status === 'rejected' && <p className="note warn">Your last registration was not approved{mine.reviewNote ? `: ${mine.reviewNote}` : ''}. You can try again.</p>}
            <ol className="steps">{['You', 'Look', 'Join'].map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</li>)}</ol>

            {step === 0 && (
              <div className="reg-step">
                <label htmlFor="ig">Your Instagram username</label>
                <input id="ig" value={ig} onChange={(e) => { setIg(e.target.value); setNotFollowing(false) }} placeholder="@yourname" autoComplete="off" autoCapitalize="off" />
                {ig && !handle && <small className="warn">That doesn’t look like an Instagram username.</small>}
                <label htmlFor="dn">Name in town</label>
                <input id="dn" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pip Butterbloom" />
                <p className="note">Only followers of @{GUILD_IG} can join. You’ll confirm the account is yours by sending a short code to @{GUILD_IG} by DM.</p>
                {notFollowing && <NotFollowing />}
                {error && !notFollowing && <p className="note warn">{error}</p>}
                <button className="primary" disabled={!step0ok || busy} onClick={next0}>{busy ? 'Checking…' : 'Next: your look →'}</button>
              </div>
            )}

            {step === 1 && (
              <div className="reg-step">
                <AvatarPreview look={look} />
                <AvatarEditor value={look} onChange={setLook} />
                <div className="row2"><button onClick={() => setStep(0)}>← Back</button><button className="primary" onClick={() => setStep(2)}>Next →</button></div>
              </div>
            )}

            {step === 2 && (
              <div className="reg-step">
                <div className="reg-summary"><AvatarPreview look={look} size={140} /><div><b>{name}</b><small>@{handle}</small></div></div>
                <label>Personality</label>
                <div className="pers">
                  {PERSONALITIES.map((p) => (
                    <button key={p} type="button" className={personality === p ? 'on' : ''} onClick={() => setPersonality(p)}>{p}<small>{BLURB[p]}</small></button>
                  ))}
                </div>
                <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  I agree that WanderTales Guild stores my Instagram username, town name and avatar to create my resident. I can withdraw at any time on this page, which deletes my resident.</label>
                <label className="check"><input type="checkbox" checked={showIg} onChange={(e) => setShowIg(e.target.checked)} />
                  Show my Instagram username in the game (optional).</label>
                {notFollowing ? <NotFollowing /> : error && <p className="note warn">{error}</p>}
                <div className="row2"><button onClick={() => setStep(1)}>← Back</button><button className="primary" disabled={!consent || busy} onClick={submit}>{busy ? 'Sending…' : 'Join the town'}</button></div>
              </div>
            )}
          </>
        )}
        <p className="foot"><a href="#/">← Back to the game</a></p>
      </div>
    </div>
  )
}

function NotFollowing() {
  return (
    <div className="not-following" role="alert">
      <b>Kamu belum follow @{GUILD_IG}</b>
      <p>You don’t follow @{GUILD_IG} yet. Follow us first, then try again. If you just followed, the Guild Master needs to refresh the follower list — please check back later.</p>
      <a className="follow-btn" href={FOLLOW_URL} target="_blank" rel="noreferrer">Follow @{GUILD_IG} on Instagram</a>
    </div>
  )
}

function Status({ reg, onRefresh, onWithdraw, busy }: { reg: Registration; onRefresh: () => void; onWithdraw: () => void; busy: boolean }) {
  return (
    <div className="reg-step">
      <div className="reg-summary"><AvatarPreview look={reg.appearance} size={160} /><div><b>{reg.displayName}</b><small>@{reg.instagram}</small></div></div>
      {reg.status === 'pending' ? (
        <>
          <h2>Almost there! ✉️</h2>
          <p>To prove this Instagram account is yours, send this code as a direct message to <b>@{GUILD_IG}</b>:</p>
          <p className="code" aria-label="verification code">{reg.verificationCode}</p>
          <p className="note">The Guild Master checks the message and approves you. You’ll then move into a free cottage in town.</p>
          <button onClick={onRefresh}>↻ Check status</button>
        </>
      ) : (
        <>
          <h2>Welcome, resident! 🏡</h2>
          <p>You’ve been approved. Look for {reg.displayName} in WanderTales Town — if all cottages are full you’ll move in as soon as a new one is built.</p>
        </>
      )}
      <button className="link" disabled={busy} onClick={onWithdraw}>Withdraw consent and delete my resident</button>
    </div>
  )
}
