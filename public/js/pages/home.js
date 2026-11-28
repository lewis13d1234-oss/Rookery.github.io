import { h, avatar, fmtTc, CAT_ICON, ago } from '../util.js';
import { Board } from '../board.js';
import { Chess } from '/shared/chess.js';
import { state, get, setPrefs } from '../api.js';

const DEMO = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');

export default async function home(root, ctx) {
  ctx.setTitle('Free chess for everyone');
  const boardHost = h('div', { class: 'hero-board' });
  const user = state.user;
  const cta = user
    ? [h('a', { class: 'btn primary large', href: '#/play' }, '♞ Play now'), h('a', { class: 'btn large', href: '#/puzzles' }, '🧩 Solve puzzles')]
    : [h('a', { class: 'btn primary large', href: '#/play' }, '♞ Play now'), h('a', { class: 'btn large', href: '#/register' }, 'Create free account')];
  root.append(
    h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Chess for everyone. ', h('em', null, 'Everything free.')),
        h('p', { class: 'lead' }, 'Play live games, beat the computer, train with puzzles, learn from lessons, analyse your games and join tournaments. No ads. No premium tier. No locked features — ever.'),
        h('div', { class: 'hero-actions' }, cta),
        h('div', { class: 'promise' }, h('span', null, 'No subscriptions'), h('span', null, 'No ads'), h('span', null, 'Every feature unlocked'), h('span', null, 'Open source'))),
      h('div', null, boardHost, h('p', { class: 'muted center small', style: { marginTop: '10px' } }, 'The Opera Game, Paris 1858 — Morphy vs. Duke of Brunswick & Count Isouard'))),
  );
  // animated demo game
  const g = new Chess(); const b = new Board(boardHost, { fen: g.fen(), interactive: false, set: state.prefs.pieces, coords: false });
  let i = 0, timer;
  const step = () => {
    if (i >= DEMO.length) { timer = setTimeout(() => { g.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'); i = 0; b.setPosition(g.fen(), { animate: false }); timer = setTimeout(step, 1200); }, 3500); return; }
    const mv = g.move(DEMO[i++]); b.setPosition(g.fen(), { lastMove: [mv.from, mv.to], check: g.inCheck() ? b.kingSquare(g.turnColor()) : null }); timer = setTimeout(step, 1100);
  };
  timer = setTimeout(step, 1500);

  const features = [['♞', 'Play online', 'Real-time games against real people — bullet, blitz, rapid, classical or your own time control.', '/play'], ['🤖', 'Computer opponents', 'Six strength levels, hints and unlimited games. Runs in your browser.', '/play/computer'], ['🧩', 'Puzzles', 'Daily puzzle, Puzzle Rush, Survival and rated training with verified solutions.', '/puzzles'], ['📘', 'Lessons', 'Beginner to advanced courses with interactive exercises and progress tracking.', '/learn'], ['📖', 'Opening explorer', 'ECO codes, ideas, statistics and a repertoire builder with PGN import/export.', '/openings'], ['🔍', 'Game analysis', 'Import PGN, find blunders and brilliancies, see accuracy and suggested improvements.', '/analysis'], ['🏆', 'Tournaments', 'Arena, Swiss and knockout events — public, private or for your club.', '/tournaments'], ['🎨', 'Make it yours', 'Boards, pieces, sounds, themes and backgrounds. All free.', '/settings']];
  root.append(h('div', { class: 'section-title' }, h('h2', null, 'Everything you need to play and improve')), h('div', { class: 'grid-4' }, features.map(([ico, t, d, href]) => h('a', { class: 'card hover feature', href: '#' + href }, h('span', { class: 'ico' }, ico), h('h3', { style: { margin: 0 } }, t), h('span', { class: 'muted' }, d)))));

  const live = h('div', { class: 'grid-3' }), pz = h('div'), stats = h('div', { class: 'row' });
  root.append(h('div', { class: 'section-title' }, h('h2', null, 'Live right now'), h('a', { href: '#/watch' }, 'Watch more →')), live);
  try {
    const { games } = await get('/api/games/live');
    if (!games.length) live.append(h('div', { class: 'card empty' }, 'No games in progress. ', h('a', { href: '#/play' }, 'Start one!')));
    for (const gm of games.slice(0, 3)) { const host = h('div', { class: 'mini-board' }); const c = h('a', { class: 'card hover', href: '#/game/' + gm.id }, host, h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '8px' } }, h('span', null, `${gm.white} (${gm.wr})`), h('span', { class: 'muted' }, 'vs'), h('span', null, `${gm.black} (${gm.br})`)), h('div', { class: 'muted small' }, `${CAT_ICON[gm.cat]} ${fmtTc(gm.tc.initial, gm.tc.inc)} · ${gm.spectators} watching`)); live.append(c); new Board(host, { fen: gm.fen, coords: false, set: state.prefs.pieces }); }
  } catch {}
  return () => clearTimeout(timer);
}
