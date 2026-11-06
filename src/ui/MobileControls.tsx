import { useRef, useState } from 'react'
import { input } from '../game/live'

/** Virtual joystick + sprint for touch screens. Writes into the shared input state. */
export function MobileControls() {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const active = useRef<number | null>(null)

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    const R = r.width / 2
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R)
    const d = Math.hypot(dx, dy)
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
    setKnob({ x: dx, y: dy })
    input.joy.x = dx / R
    input.joy.y = -dy / R
  }
  const end = () => { active.current = null; setKnob({ x: 0, y: 0 }); input.joy.x = 0; input.joy.y = 0 }

  return (
    <>
      <div ref={base} className="joy"
        onPointerDown={(e) => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e) }}
        onPointerMove={(e) => { if (active.current === e.pointerId) update(e) }}
        onPointerUp={end} onPointerCancel={end}>
        <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button className="sprint"
        onPointerDown={() => (input.sprint = true)} onPointerUp={() => (input.sprint = false)}
        onPointerCancel={() => (input.sprint = false)} onPointerLeave={() => (input.sprint = false)}>
        🏃
      </button>
    </>
  )
}
