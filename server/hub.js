// Registry of live WebSocket connections (by user) used for pushing events and presence.
const byUser = new Map(); // userId -> Set<ws>
export const all = new Set();

export function addClient(ws) { all.add(ws); if (ws.user) { if (!byUser.has(ws.user.id)) byUser.set(ws.user.id, new Set()); byUser.get(ws.user.id).add(ws); } }
export function removeClient(ws) {
  all.delete(ws);
  if (ws.user) { const s = byUser.get(ws.user.id); if (s) { s.delete(ws); if (!s.size) byUser.delete(ws.user.id); } }
}
export const isOnline = (uid) => byUser.has(uid);
export const onlineIds = () => [...byUser.keys()];
export const socketsOf = (uid) => byUser.get(uid) || new Set();
export function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
export function sendUser(uid, msg) { const s = byUser.get(uid); if (s) { const d = JSON.stringify(msg); for (const ws of s) if (ws.readyState === 1) ws.send(d); } }
export function broadcast(msg) { const d = JSON.stringify(msg); for (const ws of all) if (ws.readyState === 1) ws.send(d); }
