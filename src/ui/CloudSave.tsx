import { useEffect, useState } from 'react'
import { backendMode, type CloudSummary } from '../backend'
import { cloud, checkNow, keepThisDevice, onCloudChange, pushNow, setEnabled, useCloudSave } from '../backend/cloud'
import { summarize } from '../game/persist'
import { useGame } from '../game/store'

const Card = ({ title, s, extra }: { title: string; s: CloudSummary; extra?: string }) => (
  <div className="save-card">
    <b>{title}</b>
    Day {s.day} · {s.season} · {s.gold} gold · {s.population} residents · {s.buildings} buildings
    {extra && <><br />{extra}</>}
  </div>
)

/** Settings section: turn cloud saves on, and resolve a conflict when two devices saved different towns. */
export function CloudSaveBox() {
  const [, force] = useState(0)
  useEffect(() => onCloudChange(() => force((n) => n + 1)), [])
  const busy = cloud.status === 'working'
  const other = cloud.status === 'conflict' ? cloud.other : null
  return (
    <div className="cloud-box">
      <label><input type="checkbox" checked={cloud.enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} /> Sync this town to the cloud</label>
      {backendMode === 'local' && <p className="note">Local dev backend: the “cloud” is one slot in this browser. Good for trying this out, not a real backup.</p>}
      {cloud.enabled && !other && (
        <p>
          {cloud.status === 'working' ? 'Syncing…' : cloud.status === 'error' ? <span className="warn">⚠ {cloud.error}</span>
            : cloud.lastSync ? `✔ Synced ${new Date(cloud.lastSync).toLocaleTimeString()} · cloud revision ${cloud.rev}` : 'Waiting for the first sync…'}
        </p>
      )}
      {other && (
        <>
          <p className="warn">Two different saves exist. Nothing was overwritten. Which one do you want to keep?</p>
          <Card title="This device" s={summarize(useGame.getState().time)} />
          <Card title={`Cloud · revision ${other.rev}`} s={other.summary} extra={`Saved ${new Date(other.savedAt).toLocaleString()} on ${other.device}`} />
          <div className="actions col">
            <button disabled={busy} onClick={() => { if (confirm('Replace the cloud save with this device’s town? The cloud save will be lost.')) void keepThisDevice() }}>Keep this device</button>
            <button disabled={busy} onClick={() => { if (confirm('Replace this device’s town with the cloud save? The town on this device will be lost.')) void useCloudSave() }}>Use cloud save</button>
          </div>
        </>
      )}
      {cloud.enabled && !other && (
        <div className="actions">
          <button disabled={busy} onClick={() => void pushNow()}>⬆ Save now</button>
          <button disabled={busy} onClick={() => void checkNow()}>🔄 Check cloud</button>
        </div>
      )}
    </div>
  )
}
