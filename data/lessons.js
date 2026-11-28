// Rookery curriculum. Free for everyone. Exercise types:
//  move   {fen, solutions:[uci...]}       - play one of the listed moves
//  reach  {fen, square}                   - click every square the piece on `square` can legally move to
//  mate   {fen, n}                        - deliver forced mate within n moves (checked live by the mate solver)
//  choice {prompt, options, answer}       - multiple choice
//  line   {side:'w'|'b', moves:'e4 e5 ..'}- play your side of an opening line; the opponent replies automatically
const T = (title, body, extra = {}) => ({ type: 'text', title, body, ...extra });

export const LEVELS = ['beginner', 'intermediate', 'advanced'];
export const CATEGORIES = ['Fundamentals', 'Tactics', 'Strategy', 'Endgames', 'Checkmate patterns', 'Opening theory'];

export const LESSONS = [
  // ---------------------------------------------------------------- BEGINNER / Fundamentals
  { id: 'board-and-notation', level: 'beginner', category: 'Fundamentals', title: 'The board and notation', summary: 'Files, ranks, squares and how moves are written.', minutes: 5, steps: [
    T('Eight by eight', 'The board has 64 squares. Columns are called **files** (a–h) and rows are **ranks** (1–8). Every square has a name made of its file and rank — the white king starts on e1. The bottom-right square (h1) is always a light square.', { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', marks: ['e1', 'e8'] }),
    T('Setting up', 'White always moves first. The queen goes on her own colour (white queen on a light square, d1). Pawns fill the second and seventh ranks. Learn this picture — every game starts here.', { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }),
    T('Writing moves', 'A move is the piece letter plus the destination: **Nf3** means a knight goes to f3. Pawn moves have no letter: **e4**. A capture adds an x: **Bxc6**. K = king, Q = queen, R = rook, B = bishop, N = knight.'),
    { type: 'exercise', kind: 'move', prompt: 'Play the pawn from e2 to e4 (written e4).', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', solutions: ['e2e4'], hint: 'The pawn on e2 may move two squares on its first move.', explain: 'e4 takes space in the centre and opens lines for the queen and bishop.' },
    { type: 'exercise', kind: 'move', prompt: 'Develop a knight: play Nf3.', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', solutions: ['g1f3'], hint: 'The knight on g1 jumps to f3.', explain: 'Knights belong near the centre. Nf3 also eyes the d4 and e5 squares.' },
  ] },
  { id: 'pawns', level: 'beginner', category: 'Fundamentals', title: 'How pawns move', summary: 'Forward, double-step, and capture diagonally.', minutes: 4, steps: [
    T('Forward only', 'Pawns move one square forward. From their starting square they may move two. They never move backward, and they cannot capture the piece in front of them.', { fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', marks: ['e3', 'e4'] }),
    { type: 'exercise', kind: 'reach', prompt: 'Click every square the pawn on e2 can move to.', fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', square: 'e2' },
    T('Capturing', 'Pawns capture one square diagonally forward — different from how they move. That is why pawns can block each other head-on.'),
    { type: 'exercise', kind: 'move', prompt: 'Capture the pawn on d5 with your e4 pawn.', fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', solutions: ['e4d5'], hint: 'Diagonally forward.', explain: 'exd5 wins a pawn and opens the d-file for Black\'s queen to recapture — a classic Scandinavian Defence.' },
  ] },
  { id: 'knights', level: 'beginner', category: 'Fundamentals', title: 'The knight', summary: 'The L-shaped jumper that ignores blockers.', minutes: 4, steps: [
    T('An L-shaped jump', 'The knight moves two squares in one direction and one square sideways. It is the only piece that **jumps over** others. In the centre it controls eight squares; in a corner only two.', { fen: '7k/8/8/8/3N4/8/8/K7 w - - 0 1', marks: ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'] }),
    { type: 'exercise', kind: 'reach', prompt: 'Click all eight squares the knight on d4 can reach.', fen: '7k/8/8/8/3N4/8/8/K7 w - - 0 1', square: 'd4' },
    T('Rule of thumb', '"A knight on the rim is dim." Knights are strongest in the centre where they attack the most squares.'),
  ] },
  { id: 'bishops', level: 'beginner', category: 'Fundamentals', title: 'The bishop', summary: 'Diagonal glider — stays on one colour.', minutes: 3, steps: [
    T('Diagonals only', 'A bishop slides any distance along a diagonal until something blocks it. Each bishop stays on the same colour of square for the whole game, so you have a "light-squared" and a "dark-squared" bishop. Two bishops working together cover all squares.', { fen: 'k7/8/8/8/3B4/8/8/7K w - - 0 1' }),
    { type: 'exercise', kind: 'reach', prompt: 'Click every square the bishop on d4 can move to.', fen: 'k7/8/8/8/3B4/8/8/7K w - - 0 1', square: 'd4' },
  ] },
  { id: 'rooks', level: 'beginner', category: 'Fundamentals', title: 'The rook', summary: 'Straight-line power on files and ranks.', minutes: 3, steps: [
    T('Straight lines', 'Rooks move any distance horizontally or vertically. They are strongest on **open files** (files with no pawns) and on the seventh rank. A rook is worth about five pawns.', { fen: 'k7/8/8/8/3R4/8/8/7K w - - 0 1' }),
    { type: 'exercise', kind: 'reach', prompt: 'Click every square the rook on d4 can move to (14 squares).', fen: 'k7/8/8/8/3R4/8/8/7K w - - 0 1', square: 'd4' },
  ] },
  { id: 'queens', level: 'beginner', category: 'Fundamentals', title: 'The queen', summary: 'Rook plus bishop — the strongest piece.', minutes: 3, steps: [
    T('The most powerful piece', 'The queen moves like a rook and a bishop combined. She is worth about nine pawns, so don\'t bring her out too early — she can be chased by lesser pieces.', { fen: 'k7/8/8/8/3Q4/8/8/7K w - - 0 1' }),
    { type: 'exercise', kind: 'reach', prompt: 'Click every square the queen on d4 can reach.', fen: 'k7/8/8/8/3Q4/8/8/7K w - - 0 1', square: 'd4' },
  ] },
  { id: 'kings', level: 'beginner', category: 'Fundamentals', title: 'The king', summary: 'One step at a time — and never into check.', minutes: 3, steps: [
    T('Slow but vital', 'The king moves one square in any direction but can **never** move to a square attacked by the opponent. Lose the king and you lose the game, so keep him safe in the opening and middlegame — and active in the endgame.', { fen: '8/8/8/8/4K3/8/8/k7 w - - 0 1' }),
    { type: 'exercise', kind: 'reach', prompt: 'Click every square the king on e4 can move to.', fen: '7k/8/8/8/4K3/8/8/8 w - - 0 1', square: 'e4' },
  ] },
  { id: 'check-mate-stalemate', level: 'beginner', category: 'Fundamentals', title: 'Check, checkmate and stalemate', summary: 'How games end.', minutes: 6, steps: [
    T('Check', 'When the king is attacked it is **in check**. You must respond immediately by moving the king, blocking, or capturing the attacker.'),
    T('Checkmate', 'If there is no way to escape check, it is **checkmate** and the game is over. The side that delivers mate wins.'),
    T('Stalemate', 'If the side to move is **not** in check but has no legal move, the game is a **draw** by stalemate. Beware: it is the most common way to throw away a won game! In this picture, Black has no legal move and is not in check.', { fen: 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1' }),
    { type: 'exercise', kind: 'move', prompt: 'White to move. Checkmate — but do NOT stalemate! (Qc7 would be stalemate.)', fen: 'k7/8/1K6/8/8/8/2Q5/8 w - - 0 1', solutions: ['c2c8'], hint: 'Put the queen on the back rank.', explain: 'Qc8# attacks a8 and b8; the king covers a7 and b7 for you. Always check that the opponent still has a legal move before you play a quiet-looking "attack".' },
    { type: 'exercise', kind: 'mate', prompt: 'Find checkmate in one.', fen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1', n: 1, explain: 'Rh8# — rook gives check along the 8th rank and the white king takes away a7 and b7.' },
  ] },
  { id: 'castling', level: 'beginner', category: 'Fundamentals', title: 'Castling', summary: 'Tuck your king away and activate a rook.', minutes: 4, steps: [
    T('Two moves in one', 'Castling moves the king two squares toward a rook and the rook jumps to the other side of the king. You may castle only if: neither piece has moved, no pieces stand between them, the king is not in check, and does not pass through or land on an attacked square.', { fen: 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1' }),
    { type: 'exercise', kind: 'move', prompt: 'Castle kingside (short castling).', fen: 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1', solutions: ['e1g1'], hint: 'Move your king two squares toward the h1 rook.', explain: 'Castling short gets your king behind the pawns and brings the rook to the centre. Do it early!' },
  ] },
  { id: 'special-pawn-moves', level: 'beginner', category: 'Fundamentals', title: 'En passant and promotion', summary: 'The two special pawn rules.', minutes: 5, steps: [
    T('En passant', 'If a pawn moves two squares and lands beside an enemy pawn, that enemy pawn may capture it "in passing" — as if it had moved just one square. You must do it immediately or lose the right.'),
    { type: 'exercise', kind: 'move', prompt: 'Black has just played ...f7-f5. Capture it en passant.', fen: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', solutions: ['e5f6'], hint: 'Your e5 pawn captures onto f6, the square the pawn skipped.', explain: 'exf6 e.p. removes the f5 pawn even though it is not on f6.' },
    T('Promotion', 'A pawn that reaches the far rank must become a queen, rook, bishop or knight. Nearly always you choose the queen.'),
    { type: 'exercise', kind: 'move', prompt: 'Promote the pawn to a queen.', fen: '7k/4P3/8/8/8/8/8/K7 w - - 0 1', solutions: ['e7e8q'], hint: 'Move to e8 and choose a queen.', explain: 'e8=Q+ gives check and a second queen.' },
  ] },
  { id: 'piece-values', level: 'beginner', category: 'Fundamentals', title: 'Piece values and trades', summary: 'Knowing what is worth what.', minutes: 4, steps: [
    T('Counting material', 'Pawn = 1, knight = 3, bishop = 3, rook = 5, queen = 9. These are guidelines: a trade is good when you receive more value than you give. Two minor pieces for a rook and pawn is roughly equal.'),
    { type: 'exercise', kind: 'choice', prompt: 'You can capture a bishop with your rook, but the bishop is protected by a pawn. What happens?', options: ['You win material', 'You lose about two points (5 for 3)', 'It is an even trade'], answer: 1, explain: 'Rook (5) for bishop (3) loses two points of material, unless there is a bigger tactical gain.' },
    { type: 'exercise', kind: 'choice', prompt: 'Which trade favours you?', options: ['Your knight for their rook', 'Your queen for their bishop', 'Your rook for their pawn'], answer: 0, explain: 'Knight (3) for a rook (5) wins the "exchange" — two points.' },
  ] },
  { id: 'loose-pieces', level: 'beginner', category: 'Tactics', title: 'Spot the loose piece', summary: 'The first question: is it defended?', minutes: 4, steps: [
    T('Loose pieces drop off', 'Before every move ask: "What is attacked? What is undefended?" Most games below 1000 are decided by a piece being left hanging.'),
    { type: 'exercise', kind: 'move', prompt: 'Black\'s queen has just taken a pawn on h4. Punish it.', fen: 'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', solutions: ['f3h4'], hint: 'Something attacks h4 already.', explain: 'Nxh4 wins the queen for nothing — the queen went out too early and wasn\'t protected.' },
  ] },

  // ---------------------------------------------------------------- INTERMEDIATE / Tactics
  { id: 'forks', level: 'intermediate', category: 'Tactics', title: 'Forks', summary: 'One piece, two targets.', minutes: 5, steps: [
    T('Double attack', 'A **fork** is a single move that attacks two or more enemy pieces at once. Knights are the best forkers because most pieces cannot attack them back; pawns and queens fork too.', { fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', arrows: [['d5', 'c7'], ['c7', 'a8'], ['c7', 'e8']] }),
    { type: 'exercise', kind: 'move', prompt: 'Find the knight fork.', fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', solutions: ['d5c7'], hint: 'A "royal fork" attacks the king and a rook together.', explain: 'Nc7+ attacks the king on e8 and the rook on a8. The king must move, then you win the rook.' },
  ] },
  { id: 'pins', level: 'intermediate', category: 'Tactics', title: 'Pins', summary: 'A piece that cannot move without exposing something bigger.', minutes: 5, steps: [
    T('Absolute and relative pins', 'A piece is **pinned** when moving it would expose a more valuable piece behind it. If the piece behind is the king, the pin is **absolute** — the pinned piece cannot legally move at all.', { fen: '4k3/4q3/8/8/8/8/8/4RK2 w - - 0 1' }),
    { type: 'exercise', kind: 'move', prompt: 'Black\'s queen is pinned to its king. Win it.', fen: '4k3/4q3/8/8/8/8/8/4RK2 w - - 0 1', solutions: ['e1e7'], hint: 'The rook already attacks the queen.', explain: 'Rxe7+ Kxe7 — you gave up a rook (5) for a queen (9). The queen could not escape because moving it would put its own king in check.' },
  ] },
  { id: 'skewers', level: 'intermediate', category: 'Tactics', title: 'Skewers', summary: 'A pin in reverse — the big piece must run.', minutes: 4, steps: [
    T('Reverse pin', 'In a **skewer** you attack a valuable piece that has to move, exposing a less valuable (or equal) piece behind it, which you then capture.', { fen: 'q2k4/8/8/8/8/8/8/1K5R w - - 0 1' }),
    { type: 'exercise', kind: 'move', prompt: 'Skewer the king and the queen.', fen: 'q2k4/8/8/8/8/8/8/1K5R w - - 0 1', solutions: ['h1h8'], hint: 'Check along the 8th rank.', explain: 'Rh8+ forces the king off the rank and then Rxa8 wins the queen.' },
  ] },
  { id: 'discovered-attacks', level: 'intermediate', category: 'Tactics', title: 'Discovered attacks', summary: 'Move one piece, unleash another.', minutes: 5, steps: [
    T('Open the line', 'A **discovered attack** happens when you move a piece out of the way and reveal an attack from a piece behind it. If the revealed piece gives check, it is a *discovered check* — and the moving piece can do anything it likes.', { fen: 'q3k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1' }),
    { type: 'exercise', kind: 'move', prompt: 'Win the queen with a discovered check.', fen: 'q3k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1', solutions: ['e4a8'], hint: 'The bishop can capture something while uncovering the rook.', explain: 'Bxa8+ takes the queen and uncovers Re1\'s check. Black has no time to recapture.' },
  ] },
  { id: 'back-rank', level: 'intermediate', category: 'Checkmate patterns', title: 'Back-rank mate', summary: 'The king trapped behind its own pawns.', minutes: 4, steps: [
    T('Pawns in the way', 'A king on the back rank boxed in by its own pawns can be mated by a rook or queen. Give your king "luft" (a flight square) with h3 or h6 to avoid it, and look for the pattern against the opponent.', { fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1' }),
    { type: 'exercise', kind: 'mate', prompt: 'Checkmate in one.', fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', n: 1, explain: 'Ra8# — the f7, g7 and h7 pawns take away every flight square.' },
  ] },
  { id: 'smothered-mate', level: 'intermediate', category: 'Checkmate patterns', title: 'Smothered mate', summary: 'A knight delivers mate to a boxed-in king.', minutes: 4, steps: [
    T('Boxed in by friends', 'A **smothered mate** is delivered by a knight because it is the only piece that checks from a distance without needing a line. The king\'s own pieces take away all its squares.', { fen: '6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1' }),
    { type: 'exercise', kind: 'mate', prompt: 'Checkmate in one.', fen: '6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1', n: 1, explain: 'Nf7#. The king on h8 is hemmed in by its own rook and pawns.' },
  ] },
  { id: 'two-rook-mate', level: 'intermediate', category: 'Checkmate patterns', title: 'The ladder mate', summary: 'Two rooks chase the king off the board.', minutes: 4, steps: [
    T('Rook after rook', 'Two rooks can force mate on their own: one rook cuts off a rank, the other gives check; then the roles swap, rung by rung, until the king is on the edge.', { fen: '7k/8/8/8/8/8/1R6/R6K w - - 0 1' }),
    { type: 'exercise', kind: 'mate', prompt: 'Find mate in two.', fen: '7k/8/8/8/8/8/1R6/R6K w - - 0 1', n: 2, explain: 'Ra7 (or Rb7) cuts off the seventh rank; after the king shuffles, the other rook mates on the eighth.' },
  ] },
  { id: 'opening-principles', level: 'intermediate', category: 'Opening theory', title: 'Opening principles', summary: 'Centre, development, king safety.', minutes: 5, steps: [
    T('Three goals', '1) **Control the centre** with pawns (e4/d4) and pieces. 2) **Develop** knights and bishops before moving anything twice. 3) **Castle** early. Don\'t bring the queen out early, and don\'t make unnecessary pawn moves.', { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4' }),
    { type: 'exercise', kind: 'choice', prompt: 'After 1.e4 e5 2.Nf3 Nc6 — which move best follows the principles?', options: ['3.Bc4 (develop with a threat)', '3.h4 (a wing pawn)', '3.Qh5 (early queen)'], answer: 0, explain: 'Bc4 develops, eyes f7 and prepares castling. The others waste time or expose the queen.' },
    { type: 'exercise', kind: 'choice', prompt: 'Why is moving the same piece twice in the opening usually a mistake?', options: ['It loses a tempo (a move) while the opponent develops', 'It breaks a rule of chess', 'It is illegal'], answer: 0, explain: 'Each tempo spent shuffling is a developing move your opponent gets for free.' },
  ] },
  { id: 'centre-control', level: 'intermediate', category: 'Strategy', title: 'Controlling the centre', summary: 'Why d4, e4, d5, e5 matter.', minutes: 4, steps: [
    T('Central pieces see more', 'Pieces in the centre attack more squares and can switch flanks quickly. Occupy the centre with pawns, then support them with pieces; or control it from a distance with fianchettoed bishops.', { fen: 'rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2' }),
    { type: 'exercise', kind: 'choice', prompt: 'A knight on d4 attacks 8 squares; on a1 it attacks 2. What does this teach you?', options: ['Develop knights toward the centre', 'Keep knights on the edge', 'Knights are weak pieces'], answer: 0, explain: 'Mobility is power. Put your pieces where they attack the most squares.' },
  ] },
  { id: 'pawn-structure', level: 'intermediate', category: 'Strategy', title: 'Pawn structure basics', summary: 'Isolated, doubled, backward and passed pawns.', minutes: 6, steps: [
    T('Pawns never go back', 'Pawn weaknesses are permanent. **Isolated pawns** have no friendly pawn on adjacent files. **Doubled pawns** are two on the same file. **Backward pawns** cannot be defended by other pawns. A **passed pawn** has no enemy pawn ahead on its file or the adjacent ones — and passed pawns are strong, especially in the endgame.', { fen: '4k3/pp3pp1/8/3P4/8/2P5/P4PPP/4K3 w - - 0 1', marks: ['d5', 'c3'] }),
    { type: 'exercise', kind: 'choice', prompt: 'In the diagram, which pawn is a passed pawn for White?', options: ['d5', 'c3', 'f2'], answer: 0, explain: 'No black pawn on the c-, d- or e-file can stop d5 on its way to d8. A passed pawn must be watched at all times.' },
  ] },
  { id: 'king-safety', level: 'intermediate', category: 'Strategy', title: 'King safety', summary: 'Why you castle and keep the pawn shield.', minutes: 4, steps: [
    T('Shelter first', 'After castling, the pawns in front of the king (f, g, h) are his shield. Pushing them loosens the shelter. Attackers love open files and diagonals pointing at the king.'),
    { type: 'exercise', kind: 'choice', prompt: 'Your king is castled short with pawns on f2, g2, h2. Which move weakens it most?', options: ['g4?', 'h3', 'a3'], answer: 0, explain: 'g4 opens diagonals and squares around the king. h3 creates luft but is usually fine; a3 is a distant wing move.' },
  ] },

  // ---------------------------------------------------------------- ADVANCED
  { id: 'outposts-and-bishops', level: 'advanced', category: 'Strategy', title: 'Outposts and good bishops', summary: 'Knights on strong squares, bishops with scope.', minutes: 6, steps: [
    T('Outposts', 'An **outpost** is a square deep in enemy territory that cannot be attacked by enemy pawns. A knight on such a square is often stronger than a rook. A bishop is "good" when its pawns are on the opposite colour from the bishop.', { fen: '4k3/pp3ppp/2p5/8/3N4/2P5/PP3PPP/4K3 w - - 0 1', marks: ['d4'] }),
    { type: 'exercise', kind: 'choice', prompt: 'Black has pawns on a7, b7, c6, f7, g7, h7. Why is a white knight on d4 stable?', options: ['No black pawn can ever attack d4 (no c- or e-pawn can capture it)', 'Knights cannot be captured', 'It is protected by the king'], answer: 0, explain: 'A pawn on the c- or e-file would attack d4. With those pawns gone (or advanced past), the knight is untouchable by pawns.' },
  ] },
  { id: 'open-files-seventh', level: 'advanced', category: 'Strategy', title: 'Open files and the seventh rank', summary: 'Put the rooks to work.', minutes: 5, steps: [
    T('Rooks want lines', 'Rooks need open files. Double them (one behind the other) to dominate the file and invade on the 7th rank, where they attack pawns from the side and cage the king.', { fen: '6k1/pp3ppp/8/8/8/8/PP3PPP/3RR1K1 w - - 0 1' }),
    { type: 'exercise', kind: 'move', prompt: 'Place your rook on the open d-file.', fen: '4k3/pp3ppp/8/8/8/8/PP3PPP/R5K1 w - - 0 1', solutions: ['a1d1', 'a1e1', 'a1c1', 'a1b1'], hint: 'Any open file is better than a closed one; the d-file is open.', explain: 'Rd1 puts the rook on an open file, ready to invade on d7 or d8.' },
  ] },
  { id: 'rule-of-the-square', level: 'advanced', category: 'Endgames', title: 'The rule of the square', summary: 'Can the king catch the pawn?', minutes: 5, steps: [
    T('A mental box', 'Draw a square whose side is the number of squares from the pawn to its promotion square. If the defending king can step into that square (with the right side to move), it catches the pawn. If not, the pawn queens.', { fen: '8/8/4k3/P7/8/8/8/4K3 w - - 0 1', marks: ['a5', 'a8', 'd5', 'd8'] }),
    { type: 'exercise', kind: 'choice', prompt: 'White to move: pawn a5, black king e6. Can the king stop the pawn?', options: ['No — the king is outside the square', 'Yes, it just walks to a8', 'Only if Black moves first'], answer: 0, explain: 'The pawn needs three moves; the square runs a5–d5–d8–a8. The king on e6 is just outside it: 1.a6 Kd7 2.a7 Kc7 3.a8=Q.' },
  ] },
  { id: 'opposition', level: 'advanced', category: 'Endgames', title: 'Opposition', summary: 'The key idea in king-and-pawn endings.', minutes: 5, steps: [
    T('Face to face', 'Two kings are in **opposition** when they stand on the same file (or rank) with exactly one square between them. The side who does **not** have to move holds the opposition, forcing the other king to give way. Getting your king in front of the pawn and winning the opposition decides most pawn endings.'),
    { type: 'exercise', kind: 'choice', prompt: 'It is Black\'s move and the kings face each other with one square between. Who holds the opposition?', options: ['White (Black must give way)', 'Black', 'Neither'], answer: 0, explain: 'The side that has to move concedes ground. The player NOT to move holds the opposition.' },
  ] },
  { id: 'queen-and-king-mate', level: 'advanced', category: 'Endgames', title: 'Mate with king and queen', summary: 'Never stalemate — drive the king to the edge.', minutes: 5, steps: [
    T('The technique', 'Use the queen to confine the king to ever smaller boxes (a knight\'s move away works well), bring your king close, and mate on the edge. Always make sure the enemy king has a legal move unless you are mating.'),
    { type: 'exercise', kind: 'mate', prompt: 'Find mate in two.', fen: 'k7/8/2K5/8/8/8/8/7Q w - - 0 1', n: 2, explain: 'The white king already covers b7 and b6, so the queen only has to take away the remaining squares without stalemating.' },
  ] },
  { id: 'king-rook-mate', level: 'advanced', category: 'Endgames', title: 'Mate with king and rook', summary: 'Cut off, box in, mate.', minutes: 5, steps: [
    T('Opposition + a rook check', 'With a rook the king must help: get your king to the same file as the enemy king, take the opposition, and the rook delivers a check on the edge.', { fen: 'k7/8/2K5/8/8/8/8/7R w - - 0 1' }),
    { type: 'exercise', kind: 'mate', prompt: 'Find mate in two.', fen: 'k7/8/2K5/8/8/8/8/7R w - - 0 1', n: 2, explain: '1.Kc7 Ka7 2.Ra1#. The king takes away b7/b8 and the rook mates on the a-file.' },
  ] },
  { id: 'italian-game-plan', level: 'advanced', category: 'Opening theory', title: 'Italian Game: the quiet plan', summary: 'A classical line with a clear idea.', minutes: 5, steps: [
    T('Plan', 'In the Giuoco Piano White develops with Bc4 and Nf3, prepares c3 and d4 to build a centre, and castles. Black mirrors with ...Bc5. Learn the first moves.'),
    { type: 'exercise', kind: 'line', prompt: 'Play the White moves of the Italian Game.', side: 'w', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+', explain: 'You now have a big centre; after Bb4+ White usually answers Bd2 or Nc3.' },
  ] },
  { id: 'ruy-lopez-plan', level: 'advanced', category: 'Opening theory', title: 'Ruy Lopez: the main line', summary: 'Pressure on e5 and a long strategic fight.', minutes: 5, steps: [
    T('Plan', 'The Ruy Lopez puts the bishop on b5 to pressure the knight that defends e5. White castles, plays Re1, c3 and d4, with a lasting central tension.'),
    { type: 'exercise', kind: 'line', prompt: 'Play the White moves of the Closed Ruy Lopez.', side: 'w', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O', explain: 'c3 prepares d4 and gives the bishop the c2 retreat.' },
  ] },
  { id: 'sicilian-najdorf', level: 'advanced', category: 'Opening theory', title: 'The Sicilian: Najdorf', summary: 'Black\'s sharpest, most flexible defence.', minutes: 5, steps: [
    T('Idea', 'Black fights for d4 with ...c5 and ...d6. After the knight exchange on d4, ...a6 prepares ...e5 or ...b5 and stops White\'s knights using b5.'),
    { type: 'exercise', kind: 'line', prompt: 'Play the Black moves of the Najdorf.', side: 'b', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', explain: '...a6 is the signature Najdorf move.' },
  ] },
  { id: 'london-system', level: 'advanced', category: 'Opening theory', title: 'The London System', summary: 'A solid setup for White.', minutes: 4, steps: [
    T('Idea', 'White develops the dark-squared bishop to f4 before closing the pawn chain with e3, then builds with Nf3, c3, Nbd2 and Bd3. Same setup against nearly everything.'),
    { type: 'exercise', kind: 'line', prompt: 'Play the White moves.', side: 'w', moves: 'd4 d5 Nf3 Nf6 Bf4', explain: 'The bishop is out before ...e6 can shut it in.' },
  ] },
  { id: 'queens-gambit-plan', level: 'advanced', category: 'Opening theory', title: 'The Queen\'s Gambit Declined', summary: 'A classical centre-fight.', minutes: 5, steps: [
    T('Idea', '1.d4 d5 2.c4 challenges d5. Black declines with ...e6, keeping a solid centre. White develops with Nc3 and Nf3, Bg5, and decides when to exchange on d5.'),
    { type: 'exercise', kind: 'line', prompt: 'Play the White moves.', side: 'w', moves: 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5', explain: 'The Exchange Variation gives White a "minority attack" plan with b4–b5 against the c6 square.' },
  ] },
];
