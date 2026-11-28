// Runs the Rookery search engine off the main thread. Messages: {id, op:'move'|'analyse'|'lines', fen, level|depth|movetime}
import { Chess } from '/shared/chess.js';
import { Engine, pickMove, LEVELS, mateIn } from '/shared/engine.js';
const eng = new Engine();
self.onmessage = (e) => {
  const { id, op, fen } = e.data;
  try {
    const pos = new Chess(fen);
    if (op === 'move') { const r = pickMove(pos, e.data.level, { movetimeCap: e.data.cap ?? null }); self.postMessage({ id, ok: true, result: r }); }
    else if (op === 'analyse') { const r = eng.search(pos, { depth: e.data.depth || 10, movetime: e.data.movetime || 800 }); self.postMessage({ id, ok: true, result: { move: r.move, score: r.score, depth: r.depth, pv: r.pv, nodes: r.nodes, mate: mateIn ? mateIn(r.score) : null } }); }
    else if (op === 'root') { const sc = eng.rootScores(pos, e.data.depth || 4); self.postMessage({ id, ok: true, result: sc }); }
    else self.postMessage({ id, ok: false, error: 'unknown op' });
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
