// Promise wrapper over the engine worker. A fresh worker is created if a search must be cancelled.
import { LEVELS } from '/shared/engine.js';
export { LEVELS };
let worker = null, seq = 0; const pending = new Map();
function ensure() {
  if (worker) return worker;
  worker = new Worker('/js/engine-worker.js', { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data.result) : p.rej(new Error(e.data.error)); };
  worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error('Engine failed: ' + (e.message || 'worker error'))); pending.clear(); worker = null; };
  return worker;
}
function call(msg) { const id = ++seq; return new Promise((res, rej) => { pending.set(id, { res, rej }); ensure().postMessage({ id, ...msg }); }); }
export const engineMove = (fen, level, cap) => call({ op: 'move', fen, level, cap });
export const analyse = (fen, { depth = 10, movetime = 800 } = {}) => call({ op: 'analyse', fen, depth, movetime });
export const rootScores = (fen, depth = 4) => call({ op: 'root', fen, depth });
export function cancelEngine() { if (worker) { worker.terminate(); worker = null; for (const p of pending.values()) p.rej(new Error('cancelled')); pending.clear(); } }
