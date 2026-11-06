import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadGame, startAutosave } from './game/persist'
import { onTownChange } from './game/town'
import { initPlaceholders, rehouse, syncCommunity, syncGuild } from './backend/sync'
import { applyPendingHomes } from './game/community'
import { useGame } from './game/store'
import { startCloudSync } from './backend/cloud'
import { initAudioOnGesture } from './game/audio'
import './styles.css'

loadGame()
applyPendingHomes() // placeholders don't go through applyMembers, so loadGame() alone won't restore one moved by demolishBuilding
startAutosave()
initPlaceholders()
onTownChange(() => { useGame.setState((s) => ({ rev: s.rev + 1 })); rehouse() }) // a finished cottage can house waiting residents
initAudioOnGesture()
startCloudSync()
syncCommunity().then(syncGuild)
setInterval(() => syncCommunity().then(syncGuild), 60_000)
createRoot(document.getElementById('root')!).render(<App />)
