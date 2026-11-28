import { h } from '../util.js';
import { Board } from '../board.js';
import { Chess } from '/shared/chess.js';
import { state } from '../api.js';
const DEMO = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');
export default async function home(root, ctx) {
  ctx.setTitle('Free chess for everyone');
  const boardHost = h('div', { class: 'hero-board' });
  root.append(h('section', { class: 'hero' }, h('div', null,
    h('h1', null, 'Chess for everyone. ', h('em', null, 'Everything free.')),
    h('p', { class: 'lead' }, 'Beat the computer at six strengths, train with puzzles, learn from 34 lessons, explore openings and analyse your own games. It all runs in your browser: no sign-up, no ads, no premium tier.'),
    h('div', { class: 'hero-actions' }, h('a', { class: 'btn primary large', href: '#/play' }, '♞ Play the computer'), h('a', { class: 'btn large', href: '#/puzzles' }, '🧩 Solve puzzles')),
    h('div', { class: 'promise' }, h('span', null, 'No accounts'), h('span', null, 'No ads'), h('span', null, 'Every feature unlocked'), h('span', null, 'Works offline'))),
    h('div', null, boardHost, h('p', { class: 'muted center small', style: { marginTop: '10px' } }, 'The Opera Game, Paris 1858 — Morphy vs. Duke of Brunswick & Count Isouard'))));
  const g = new Chess(); const b = new Board(boardHost, { fen: g.fen(), interactive: false, set: state.prefs.pieces, coords: false }); let i = 0, timer;
  const step = () => { if (i >= DEMO.length) { timer = setTimeout(() => { g.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'); i = 0; b.setPosition(g.fen(), { animate: false }); timer = setTimeout(step, 1200); }, 3500); return; } const mv = g.move(DEMO[i++]); b.setPosition(g.fen(), { lastMove: [mv.from, mv.to], check: g.inCheck() ? b.kingSquare(g.turnColor()) : null }); timer = setTimeout(step, 1100); };
  timer = setTimeout(step, 1500);
  const features = [['🤖', 'Computer opponents', 'Six strength levels with optional clocks, hints, takebacks and a PGN of every game.', '/play'], ['👥', 'Two players', 'Share one device for a full game with optional clock, takebacks and PGN export.', '/local'], ['🌐', 'Play a friend online', 'Direct browser-to-browser games: swap two codes in any chat app. No server, no account.', '/online'], ['🧩', 'Puzzles', 'Daily puzzle, Rush, Survival and themed training with a rating that is saved in your browser.', '/puzzles'], ['📘', 'Lessons', '34 interactive lessons from how the pieces move to endgame technique.', '/learn'], ['📖', 'Openings', 'ECO explorer, line trainer, repertoire builder and PGN import/export.', '/openings'], ['🔍', 'Analysis', 'Import a PGN for accuracy, blunders, missed wins and an evaluation graph.', '/analysis']];
  root.append(h('div', { class: 'section-title' }, h('h2', null, 'Everything you need to improve')), h('div', { class: 'grid-4' }, features.map(([ico, t, d, href]) => h('a', { class: 'card hover feature', href: '#' + href }, h('span', { class: 'ico' }, ico), h('h3', { style: { margin: 0 } }, t), h('span', { class: 'muted' }, d)))),
    h('p', { class: 'muted small center', style: { marginTop: '24px' } }, 'This is the standalone edition. Online multiplayer, accounts, ratings, clubs and tournaments need the Rookery server; see the project README.'));
  return () => clearTimeout(timer);
}
