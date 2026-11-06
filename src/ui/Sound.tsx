import { useState } from 'react'
import { audioState, setMusicVolume, setSound, startAudio } from '../game/audio'

/** Settings: sound on/off, master volume and a separate music (BGM) volume. */
export function SoundBox() {
  const [on, setOn] = useState(audioState.on)
  const [vol, setVol] = useState(Math.round(audioState.vol * 100))
  const [music, setMusic] = useState(Math.round(audioState.music * 100))
  const slider = (label: string, value: number, set: (n: number) => void) => (
    <label className="slider">
      <span>{label} <b>{value}%</b></span>
      <input type="range" min={0} max={100} value={value} disabled={!on} onChange={(e) => { startAudio(); set(+e.target.value) }} />
    </label>
  )
  return (
    <div className="cloud-box">
      <label><input type="checkbox" checked={on} onChange={(e) => { startAudio(); setOn(e.target.checked); setSound(e.target.checked) }} /> Sound on</label>
      {slider('🔊 Master volume', vol, (n) => { setVol(n); setSound(true, n / 100) })}
      {slider('🎵 Music (BGM)', music, (n) => { setMusic(n); setMusicVolume(n / 100) })}
    </div>
  )
}
