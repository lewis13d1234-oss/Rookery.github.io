// PGN parsing and export. Every parsed game is replayed through the rules engine, so illegal PGN is rejected.
import { Chess, START_FEN } from './chess.js';

function stripMovetext(text) {
  let out = '', depth = 0, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') { const j = text.indexOf('}', i); i = j < 0 ? text.length : j + 1; out += ' '; continue; }
    if (c === ';') { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j + 1; out += ' '; continue; }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0) out += c;
    i++;
  }
  return out;
}

/** Split a multi-game PGN into raw game chunks (headers + movetext). */
export function splitPgn(text) {
  const norm = String(text).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const games = [];
  let cur = [], inMoves = false;
  for (const line of norm.split('\n')) {
    const isTag = /^\s*\[\s*\w+\s+".*"\s*\]\s*$/.test(line);
    if (isTag && inMoves) { games.push(cur.join('\n')); cur = []; inMoves = false; }
    if (!isTag && line.trim()) inMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games.filter((g) => g.trim());
}

export function parsePgnGame(chunk) {
  const headers = {};
  const tagRe = /^\s*\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
  const bodyLines = [];
  for (const line of chunk.split('\n')) {
    const m = tagRe.exec(line);
    if (m) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
    else bodyLines.push(line);
  }
  const body = stripMovetext(bodyLines.join('\n'));
  const tokens = body.replace(/\$\d+/g, ' ').split(/\s+/).filter(Boolean);
  const fen = headers.FEN && headers.SetUp !== '0' ? headers.FEN : START_FEN;
  const g = new Chess(fen);
  let result = headers.Result || '*';
  for (let tok of tokens) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) { result = tok; continue; }
    tok = tok.replace(/^\d+\.(\.\.)?/, '').replace(/^\.\.\./, '');
    if (!tok || /^\d+\.*$/.test(tok)) continue;
    if (!g.move(tok)) throw new Error(`Illegal or unreadable move "${tok}" at ply ${g.ply + 1}`);
  }
  return { headers, moves: g.history(), uci: g.historyUci(), result, fen, finalFen: g.fen() };
}

/** Parse every game in a PGN string. Returns {games, errors}. */
export function parsePgn(text) {
  const games = [], errors = [];
  for (const chunk of splitPgn(text)) {
    try { games.push(parsePgnGame(chunk)); } catch (e) { errors.push(e.message); }
  }
  return { games, errors };
}

export function toPgn({ headers = {}, moves = [], result = '*', fen = null }) {
  const h = {
    Event: 'Rookery game', Site: 'Rookery', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: '-', White: '?', Black: '?', Result: result, ...headers,
  };
  h.Result = result;
  if (fen && fen !== START_FEN) { h.SetUp = '1'; h.FEN = fen; }
  const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const keys = [...order, ...Object.keys(h).filter((k) => !order.includes(k))];
  let out = keys.map((k) => `[${k} "${String(h[k]).replace(/(["\\])/g, '\\$1')}"]`).join('\n') + '\n\n';
  const startTurn = fen ? (fen.split(' ')[1] === 'b' ? 1 : 0) : 0;
  const startNum = fen ? parseInt(fen.split(' ')[5], 10) || 1 : 1;
  let line = '';
  const parts = [];
  moves.forEach((san, i) => {
    const whiteMove = (i + startTurn) % 2 === 0;
    const num = startNum + Math.floor((i + startTurn) / 2);
    if (whiteMove) parts.push(`${num}. ${san}`);
    else parts.push(i === 0 ? `${num}... ${san}` : san);
  });
  parts.push(result);
  for (const p of parts) {
    if ((line + ' ' + p).trim().length > 80) { out += line.trim() + '\n'; line = p; } else line += ' ' + p;
  }
  return out + line.trim() + '\n';
}
