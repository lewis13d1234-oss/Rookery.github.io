// Opening database: ECO code, name, main line, idea and per-move notes.
// Every line is replayed through the rules engine by scripts/validate-content.js.
import { Chess } from './chess.js';

// [eco, name, moves (SAN), idea, notes {plyIndex: text}]
const RAW = [
  ['B00', "King's Pawn Opening", 'e4', 'White grabs central space and opens lines for the queen and king\'s bishop.', { 0: 'e4 stakes a claim on d5 and f5 and frees the bishop and queen.' }],
  ['C20', "King's Pawn Game", 'e4 e5', 'Symmetrical, open play. Both sides fight for the centre and rush to develop.', { 1: 'Black mirrors White: e5 contests d4 and f4 and keeps the position balanced.' }],
  ['C40', "King's Knight Opening", 'e4 e5 Nf3', 'Develops with a threat: the e5-pawn is attacked.', { 2: 'Nf3 develops a piece, attacks e5 and prepares to castle.' }],
  ['C44', "King's Knight Opening: Normal Variation", 'e4 e5 Nf3 Nc6', 'Black defends e5 by developing — the starting point of most open games.', { 3: 'Nc6 defends the pawn and develops a piece toward the centre.' }],
  ['C50', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4', 'White aims the bishop at f7, Black\'s weakest square, and builds a quick centre with c3 and d4.',
    { 4: 'Bc4 eyes f7 — the only square defended solely by the king. Black can mirror with ...Bc5 (Giuoco Piano) or play ...Nf6 (Two Knights).' }],
  ['C53', 'Italian Game: Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+', 'The "quiet game": White prepares d4 to build a big centre; Black counters with checks and piece pressure.',
    { 6: 'c3 prepares d4, planning a strong pawn centre.', 8: 'd4 strikes at the centre immediately.', 11: 'Bb4+ is the standard check — White must choose Bd2 or Nc3.' }],
  ['C54', 'Italian Game: Giuoco Pianissimo', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6', 'The slow, strategic version: White delays d4 and manoeuvres. Solid for both sides.', {}],
  ['C51', 'Evans Gambit', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'White sacrifices a pawn to win time and build a dominating centre with c3 and d4.', { 6: 'b4! deflects the bishop from the a7–g1 diagonal and gains tempi for c3 and d4.' }],
  ['C55', 'Italian Game: Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6', 'Black counterattacks e4 instead of copying White. Sharp tactics follow after Ng5.', { 5: 'Nf6 attacks e4 and ignores the f7 threat for now.' }],
  ['C57', 'Two Knights Defense: Fried Liver Attack', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7', 'A violent sacrifice that drags the black king into the open. Black\'s best is to avoid it with 5...Na5.', { 10: 'Nxf7 forks queen and rook and exposes the king.' }],
  ['C60', 'Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5', 'White pressures the knight that defends e5. A rich strategic opening that has been a top-level choice for centuries.',
    { 4: 'Bb5 attacks the defender of e5. The threat is slow, but it ties Black down. After 3...a6 (the Morphy Defence) the bishop must decide.' }],
  ['C65', 'Ruy Lopez: Berlin Defense', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5', 'The "Berlin Wall": an early queen trade leads to a solid endgame that is very hard to crack.', {}],
  ['C77', 'Ruy Lopez: Morphy Defense', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6', 'Black forces the bishop to decide and develops with tempo against e4.', { 5: '...a6 questions the bishop. Taking on c6 gives White doubled pawns for Black but loses the bishop pair.', 7: 'Nf6 attacks e4 — White usually castles and lets Black take.' }],
  ['C84', 'Ruy Lopez: Closed Variation', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O', 'The main line. Both sides complete development; White follows with h3 and d4, Black with ...Na5 and ...c5.', { 8: 'O-O: White declines to defend e4, since Nxe4 Re1 wins time back.', 14: 'c3 prepares d4 and gives the bishop a retreat on c2.' }],
  ['C42', "Petrov's Defence", 'e4 e5 Nf3 Nf6', 'Black counterattacks e4 immediately. Solid and symmetrical; White must be accurate to avoid 3.Nxe5? Nxe4.', {}],
  ['C45', 'Scotch Game', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4', 'White opens the centre at once. After the knight exchange the position is open and rich in tactics.', {}],
  ['C23', "Bishop's Opening", 'e4 e5 Bc4', 'Develops the bishop first and keeps the option of f4 or Nf3.', {}],
  ['C25', 'Vienna Game', 'e4 e5 Nc3', 'White prepares f4 and keeps the Nf3 option open. Flexible and quick to develop.', {}],
  ['C30', "King's Gambit", 'e4 e5 f4', 'The romantic gambit: White offers a pawn for open lines and a big centre.', { 2: 'f4 challenges e5 and opens the f-file for the rook.' }],
  ['C33', "King's Gambit Accepted", 'e4 e5 f4 exf4', 'Black takes the pawn; White will develop quickly and attack on the f-file.', {}],
  ['C41', 'Philidor Defence', 'e4 e5 Nf3 d6', 'Black supports e5 with a pawn. Solid but a little passive.', {}],

  ['B20', 'Sicilian Defence', 'e4 c5', 'Black fights for the centre asymmetrically. The most popular reply to 1.e4 at every level because it creates winning chances for both sides.',
    { 1: '...c5 prevents d4 and trades a wing pawn for the central d-pawn.' }],
  ['B22', 'Sicilian Defence: Alapin Variation', 'e4 c5 c3', 'White prepares d4 with a pawn so that cxd4 can be answered with cxd4, keeping a big centre.', {}],
  ['B23', 'Sicilian Defence: Closed', 'e4 c5 Nc3', 'White avoids the main lines and builds slowly with g3, Bg2 and f4.', {}],
  ['B30', 'Sicilian Defence: Old Sicilian', 'e4 c5 Nf3 Nc6', 'Black develops the knight to c6 and keeps flexible pawn structures.', {}],
  ['B31', 'Sicilian Defence: Rossolimo Variation', 'e4 c5 Nf3 Nc6 Bb5 g6', 'White avoids the heavy theory of the open Sicilian and may double Black\'s pawns with Bxc6.', {}],
  ['B33', 'Sicilian Defence: Sveshnikov Variation', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5', 'Black accepts a backward d6-pawn and a hole on d5 in return for active pieces.', { 9: '...e5 kicks the knight and claims space but weakens d5.' }],
  ['B70', 'Sicilian Defence: Dragon Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Black fianchettoes the bishop to g7 so that it bears down the long diagonal against White\'s queenside.', { 9: '...g6 prepares Bg7 — the "Dragon" bishop.' }],
  ['B90', 'Sicilian Defence: Najdorf Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Bobby Fischer\'s favourite. ...a6 prevents Nb5/Bb5 and prepares ...e5 or ...b5. Extremely rich theoretically.', { 9: '...a6 is the signature move: it stops White\'s pieces from using b5.' }],

  ['C00', 'French Defence', 'e4 e6', 'Black prepares ...d5 to challenge the centre, accepting a slightly cramped position for a solid pawn chain.', { 1: '...e6 prepares ...d5, but locks in the light-squared bishop.' }],
  ['C01', 'French Defence: Exchange Variation', 'e4 e6 d4 d5 exd5 exd5', 'White simplifies into a symmetrical structure. Safe, but often drawish.', {}],
  ['C02', 'French Defence: Advance Variation', 'e4 e6 d4 d5 e5', 'White gains space and fixes the structure; Black attacks the base of the chain with ...c5 and ...Nc6.', { 4: 'e5 gains space, but White\'s pawn chain now has a target at d4.' }],
  ['C03', 'French Defence: Tarrasch Variation', 'e4 e6 d4 d5 Nd2', 'White avoids the Winawer pin by keeping the c-pawn free, and prepares to recapture on d5 with the queen\'s knight.', {}],
  ['C11', 'French Defence: Classical Variation', 'e4 e6 d4 d5 Nc3 Nf6', 'Black attacks e4 and White chooses between e5 and Bg5. A principled main line.', {}],
  ['C15', 'French Defence: Winawer Variation', 'e4 e6 d4 d5 Nc3 Bb4', 'Black pins the c3-knight, to attack d4 and double White\'s pawns after Bxc3+. Sharp and unbalanced.', { 5: '...Bb4 pins the knight so e4 is under pressure and a structural fight follows.' }],

  ['B10', 'Caro-Kann Defence', 'e4 c6', 'Black prepares ...d5 while keeping the bishop free. Rock-solid and strategically simple.', { 1: '...c6 supports ...d5 without blocking the light-squared bishop (unlike the French).' }],
  ['B12', 'Caro-Kann Defence: Advance Variation', 'e4 c6 d4 d5 e5', 'White gains space; Black develops the bishop outside the chain with ...Bf5 and breaks with ...c5.', { 4: 'e5 gains space; Black\'s bishop will go to f5 before the pawn chain closes it in.' }],
  ['B13', 'Caro-Kann Defence: Exchange Variation', 'e4 c6 d4 d5 exd5 cxd5', 'A symmetrical structure that gives White a small, stable edge in space.', {}],
  ['B14', 'Caro-Kann Defence: Panov-Botvinnik Attack', 'e4 c6 d4 d5 exd5 cxd5 c4', 'White builds a strong centre and gets an isolated-pawn type of play.', {}],
  ['B18', 'Caro-Kann Defence: Classical Variation', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', 'The classical main line: Black has solved the problem of the light-squared bishop and is solid.', { 7: '...Bf5 develops the bishop before playing ...e6 — the whole point of the Caro-Kann.' }],

  ['B01', 'Scandinavian Defence', 'e4 d5', 'Black challenges e4 at once. The queen comes out early after exd5 Qxd5.', {}],
  ['B02', "Alekhine's Defence", 'e4 Nf6', 'Black invites White to overextend its pawns and attacks them later.', {}],
  ['B06', 'Modern Defence', 'e4 g6', 'Black delays the fight for the centre and fianchettoes first.', {}],
  ['B07', 'Pirc Defence', 'e4 d6 d4 Nf6 Nc3 g6', 'A hypermodern setup: Black lets White build a centre and undermines it later.', {}],
  ['B00', 'Nimzowitsch Defence', 'e4 Nc6', 'Black develops a knight to control the centre from the side.', {}],

  ['D00', "Queen's Pawn Game", 'd4 d5', 'Symmetrical central play. White continues with c4, Nf3 or Bf4.', { 1: '...d5 mirrors White and fights for e4.' }],
  ['D02', 'London System', 'd4 d5 Nf3 Nf6 Bf4', 'A solid system where White develops the bishop outside the pawn chain before playing e3 and c3. Easy to learn, hard to crack.', { 4: 'Bf4 gets the bishop out before e3 locks it in — that is the whole London idea.' }],
  ['D06', "Queen's Gambit", 'd4 d5 c4', 'White offers a pawn to deflect Black\'s d-pawn; if Black takes, White gets a lead in the centre.', { 2: 'c4 attacks d5. It is not a real gambit — White can regain the pawn.' }],
  ['D20', "Queen's Gambit Accepted", 'd4 d5 c4 dxc4', 'Black takes the pawn; White will play e3 and Bxc4 and obtain central control.', {}],
  ['D30', "Queen's Gambit Declined", 'd4 d5 c4 e6', 'Black supports d5 with a solid pawn. The classical way to meet the Queen\'s Gambit.', { 3: '...e6 keeps the d5-pawn firmly protected, at the cost of the light-squared bishop\'s mobility.' }],
  ['D35', "Queen's Gambit Declined: Exchange Variation", 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5', 'White cashes in the tension and gets a Minority Attack plan on the queenside.', {}],
  ['D10', 'Slav Defence', 'd4 d5 c4 c6', 'Black supports d5 without blocking the bishop. A very solid and fashionable defence.', {}],
  ['D43', 'Semi-Slav Defence', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6', 'A combative blend of Slav and QGD: a sound structure with plenty of tactical resources.', {}],

  ['A45', 'Indian Game', 'd4 Nf6', 'Black controls e4 with the knight and keeps the choice of setup open.', {}],
  ['E60', "King's Indian Defence", 'd4 Nf6 c4 g6', 'Black lets White occupy the centre, then attacks it with ...e5 or ...c5. Leads to sharp, kingside attacking chances.', { 3: '...g6 prepares the fianchetto: the bishop on g7 will eye the centre.' }],
  ['E70', "King's Indian Defence: Normal Variation", 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6', 'White has a broad centre; Black will strike with ...e5 and attack the king.', {}],
  ['E90', "King's Indian Defence: Classical Variation", 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5', 'The main line: after ...e5 and ...Nbd7, Black prepares to break with ...exd4 or ...Ne8 and ...f5.', {}],
  ['D80', 'Grünfeld Defence', 'd4 Nf6 c4 g6 Nc3 d5', 'Black strikes at the centre at once and aims to undermine it with ...Nxd5 and ...c5.', {}],
  ['E20', 'Nimzo-Indian Defence', 'd4 Nf6 c4 e6 Nc3 Bb4', 'Black pins the c3-knight to control e4 and may give up the bishop for structural damage.', { 5: '...Bb4 pins the knight that guards e4 and pressures White\'s centre.' }],
  ['E11', 'Bogo-Indian Defence', 'd4 Nf6 c4 e6 Nf3 Bb4+', 'Black checks to develop the bishop without allowing the Nc3 pin sequences.', {}],
  ['E12', "Queen's Indian Defence", 'd4 Nf6 c4 e6 Nf3 b6', 'Black fianchettoes to control e4. Flexible and rock solid.', {}],
  ['E01', 'Catalan Opening', 'd4 Nf6 c4 e6 g3 d5 Bg2', 'White fianchettoes the king\'s bishop to pressure Black\'s queenside along the long diagonal.', {}],
  ['A40', "Queen's Pawn Opening", 'd4', 'White claims the centre with the d-pawn, a slightly safer start than 1.e4.', {}],
  ['A80', 'Dutch Defence', 'd4 f5', 'Black takes control of e4 with the f-pawn and aims for kingside play.', {}],

  ['A10', 'English Opening', 'c4', 'A flexible flank opening that fights for d5 and often transposes into d4 openings.', {}],
  ['A20', 'English Opening: Reversed Sicilian', 'c4 e5', 'Black adopts a Sicilian setup with colours reversed.', {}],
  ['A30', 'English Opening: Symmetrical Variation', 'c4 c5', 'Both sides mirror each other; the game becomes a manoeuvring struggle.', {}],
  ['A04', 'Réti Opening', 'Nf3', 'White develops and keeps the central pawn structure undecided.', {}],
  ['A02', "Bird's Opening", 'f4', 'White grabs control of e5 with the f-pawn, like a reversed Dutch.', {}],
  ['A00', 'Polish Opening', 'b4', 'An unusual flank opening that gains queenside space immediately.', {}],
];

export const OPENINGS = RAW.map(([eco, name, line, idea, notes]) => ({
  eco, name, moves: line.split(' '), idea, notes: notes || {},
  family: name.split(':')[0].trim(),
}));

export const FEATURED = ['C50', 'C60', 'B20', 'C00', 'B10', 'D06', 'E60', 'D02'];

/** Find the longest opening whose line is a prefix of the played moves (or the played moves are a prefix of its line). */
export function classify(sans) {
  let best = null;
  for (const o of OPENINGS) {
    if (o.moves.length > sans.length) continue;
    let ok = true;
    for (let i = 0; i < o.moves.length; i++) if (o.moves[i] !== sans[i]) { ok = false; break; }
    if (ok && (!best || o.moves.length > best.moves.length)) best = o;
  }
  return best;
}

/** Book continuations after a move sequence: [{san, openings:[names], eco}] */
export function nextBookMoves(prefix) {
  const map = new Map();
  for (const o of OPENINGS) {
    if (o.moves.length <= prefix.length) continue;
    let ok = true;
    for (let i = 0; i < prefix.length; i++) if (o.moves[i] !== prefix[i]) { ok = false; break; }
    if (!ok) continue;
    const san = o.moves[prefix.length];
    if (!map.has(san)) map.set(san, []);
    map.get(san).push(o);
  }
  return [...map.entries()].map(([san, list]) => ({ san, openings: list.map((o) => ({ eco: o.eco, name: o.name, moves: o.moves.length })) }))
    .sort((a, b) => b.openings.length - a.openings.length);
}

/** Opening entries whose line passes through (starts with) the given prefix. */
export function matching(prefix) {
  return OPENINGS.filter((o) => {
    const n = Math.min(o.moves.length, prefix.length);
    for (let i = 0; i < n; i++) if (o.moves[i] !== prefix[i]) return false;
    return true;
  });
}

export function validateOpenings() {
  const problems = [];
  for (const o of OPENINGS) {
    try { Chess.replay(o.moves); } catch (e) { problems.push(`${o.eco} ${o.name}: ${e.message}`); }
    for (const k of Object.keys(o.notes)) if (+k >= o.moves.length) problems.push(`${o.eco}: note index ${k} beyond line`);
  }
  return problems;
}
