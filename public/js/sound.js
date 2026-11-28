// Synthesised sound effects (WebAudio) — no audio files, nothing to download.
let ctx = null; let enabled = true; let volume = 0.5; let pack = 'wood';
export function configureSound(o) { if ('enabled' in o) enabled = o.enabled; if ('volume' in o) volume = o.volume; if ('pack' in o) pack = o.pack; }
function tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, delay = 0 } = {}) {
  if (!enabled || pack === 'none') return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * volume, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch {}
}
const P = {
  wood: { move: () => { tone(220, 0.07, { type: 'triangle', gain: 0.5, slide: -80 }); }, capture: () => { tone(160, 0.12, { type: 'triangle', gain: 0.7, slide: -90 }); tone(900, 0.03, { type: 'square', gain: 0.1 }); } },
  soft: { move: () => tone(440, 0.08, { gain: 0.25 }), capture: () => { tone(330, 0.12, { gain: 0.35 }); tone(220, 0.12, { gain: 0.25, delay: 0.04 }); } },
  arcade: { move: () => tone(660, 0.06, { type: 'square', gain: 0.12 }), capture: () => { tone(880, 0.05, { type: 'square', gain: 0.15 }); tone(440, 0.09, { type: 'square', gain: 0.15, delay: 0.05 }); } },
};
export function play(kind) {
  const set = P[pack] || P.wood;
  switch (kind) {
    case 'move': return set.move();
    case 'capture': return set.capture();
    case 'check': tone(520, 0.1, { type: 'sawtooth', gain: 0.2 }); return tone(390, 0.18, { type: 'sawtooth', gain: 0.2, delay: 0.09 });
    case 'castle': set.move(); return setTimeout(set.move, 90);
    case 'end': tone(392, 0.2, { gain: 0.3 }); tone(330, 0.25, { gain: 0.3, delay: 0.18 }); return tone(262, 0.4, { gain: 0.3, delay: 0.38 });
    case 'win': [523, 659, 784].forEach((f, i) => tone(f, 0.22, { gain: 0.3, delay: i * 0.12 })); return;
    case 'notify': return tone(880, 0.12, { gain: 0.2 });
    case 'low': return tone(1000, 0.05, { type: 'square', gain: 0.1 });
    case 'wrong': return tone(180, 0.25, { type: 'sawtooth', gain: 0.25, slide: -60 });
    case 'right': tone(600, 0.08, { gain: 0.25 }); return tone(900, 0.12, { gain: 0.25, delay: 0.07 });
  }
}
let liveEl = null;
export function announce(text) { if (typeof document === 'undefined') return; if (!liveEl) { liveEl = document.createElement('div'); liveEl.className = 'sr-only'; liveEl.setAttribute('aria-live', 'assertive'); liveEl.setAttribute('role', 'status'); document.body.append(liveEl); } liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = text; }, 30); }
export function soundForMove(mv, inCheck) { try { announce((mv.color === 'w' ? 'White' : 'Black') + ' plays ' + mv.san + (inCheck && !/[+#]/.test(mv.san) ? ', check' : '')); } catch {} play(inCheck ? 'check' : mv.flags?.includes('k') || mv.flags?.includes('q') ? 'castle' : mv.captured ? 'capture' : 'move'); }
