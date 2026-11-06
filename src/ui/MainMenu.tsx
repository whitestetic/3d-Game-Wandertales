import { useState } from 'react'
import { useGame } from '../game/store'

export function MainMenu() {
  const saved = useGame((s) => s.playerName)
  const [name, setName] = useState(saved)
  const clean = name.trim().slice(0, 24)
  return (
    <div className="menu">
      <form className="menu-card" onSubmit={(e) => { e.preventDefault(); useGame.getState().start(clean || 'Guild Master') }}>
        <p className="kicker">A cozy fantasy life simulation</p>
        <h1>WanderTales<span>Guild</span></h1>
        <label htmlFor="gm-name">Your name, Guild Master</label>
        <input id="gm-name" value={name} maxLength={24} placeholder="Guild Master" onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <button type="submit">Enter the Town</button>
        <a className="join" href="#/creator">🎨 Customize your Guild Master →</a>
        <a className="join" href="#/register">Follower of @wandertales.guild? Become a resident →</a>
        <p className="foot">Early preview · placeholder residents are marked as mock data</p>
      </form>
    </div>
  )
}
