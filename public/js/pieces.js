// Original piece artwork (hand-drawn SVG paths, 100x100). Three free sets: "rook" (default), "classic" (Unicode glyphs), "letters".
const P = {
  p: '<circle cx="50" cy="30" r="12"/><path d="M38 78 C38 60 44 52 50 46 C56 52 62 60 62 78 Z"/><rect x="30" y="78" width="40" height="8" rx="3"/>',
  r: '<path d="M27 86 V76 H33 L36 44 H29 V24 H39 V31 H45 V24 H55 V31 H61 V24 H71 V44 H64 L67 76 H73 V86 Z"/><path d="M33 76 H67" class="d"/>',
  n: '<path d="M28 86 V76 C28 58 40 52 44 40 L34 44 L26 52 L20 46 C24 32 36 20 49 16 L54 8 L60 18 C76 22 82 40 76 60 L74 86 Z"/><circle cx="50" cy="32" r="3" class="e"/><path d="M28 76 H74" class="d"/>',
  b: '<circle cx="50" cy="16" r="6"/><path d="M50 22 C62 32 68 46 62 60 C60 66 64 72 68 78 V86 H32 V78 C36 72 40 66 38 60 C32 46 38 32 50 22 Z"/><path d="M44 38 L56 50" class="d"/>',
  q: '<circle cx="22" cy="28" r="5"/><circle cx="38" cy="18" r="5"/><circle cx="50" cy="14" r="5"/><circle cx="62" cy="18" r="5"/><circle cx="78" cy="28" r="5"/><path d="M24 34 L36 62 L40 26 L50 56 L60 26 L64 62 L76 34 L72 78 H28 Z"/><rect x="26" y="78" width="48" height="8" rx="3"/>',
  k: '<path d="M46 8 H54 V16 H62 V23 H54 V30 H46 V23 H38 V16 H46 Z"/><path d="M50 32 C70 32 80 46 74 62 C72 70 76 76 78 80 V86 H22 V80 C24 76 28 70 26 62 C20 46 30 32 50 32 Z"/><path d="M30 76 H70" class="d"/>',
};
const GLYPH = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙', bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟' };

export const PIECE_SETS = {
  rook: 'Rookery (default)',
  mono: 'Monochrome',
  wood: 'Maple and walnut',
  metal: 'Gold and silver',
  glass: 'Glass',
  outline: 'Outline',
  bold: 'Bold',
  candy: 'Candy',
  neon: 'Neon',
  classic: 'Classic glyphs',
  letters: 'Letters',
};
const svgFor = (color, type, set) => {
  if (set === 'classic') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="76" text-anchor="middle" font-size="86" font-family="'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',serif" fill="${color === 'w' ? '#fff' : '#111'}" stroke="${color === 'w' ? '#111' : '#fff'}" stroke-width="${color === 'w' ? 2.5 : 0}" paint-order="stroke">${GLYPH[color + type]}</text></svg>`;
  if (set === 'letters') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="${color === 'w' ? '#f6f1e4' : '#2b2e38'}" stroke="${color === 'w' ? '#2b2e38' : '#f6f1e4'}" stroke-width="4"/><text x="50" y="66" text-anchor="middle" font-size="46" font-weight="700" font-family="Georgia,serif" fill="${color === 'w' ? '#2b2e38' : '#f6f1e4'}">${type.toUpperCase()}</text></svg>`;
  // Colour skins share the original silhouettes: [white fill, white edge, white detail, black fill, black edge, black detail, stroke width]
  const V = {
    rook: ['#f7f2e6', '#1b1d24', '#1b1d24', '#343845', '#0d0e12', '#f2ecda', 3], mono: ['#ffffff', '#1b1d24', '#1b1d24', '#000000', '#ffffff', '#f2ecda', 3],
    wood: ['#f0d6a8', '#6b4524', '#6b4524', '#6a3f22', '#2a170a', '#e8c590', 3], metal: ['#e4e7ec', '#59606d', '#59606d', '#d9a928', '#6b4f08', '#fff0b0', 3],
    glass: ['#e8f4ff', '#4f86b5', '#4f86b5', '#2d3a58', '#8fb4ff', '#cfe0ff', 3], outline: ['#ffffff', '#222222', '#222222', '#303030', '#ffffff', '#ffffff', 5],
    bold: ['#ffd23f', '#111111', '#111111', '#e63946', '#111111', '#ffffff', 6], candy: ['#ffd1e8', '#b03a76', '#b03a76', '#7a4fd6', '#3c2183', '#e2d6ff', 3],
    neon: ['#10242b', '#2dfce0', '#2dfce0', '#2a1233', '#ff4fd8', '#ff4fd8', 3.5],
  }[set] || null; const v = V || ['#f7f2e6', '#1b1d24', '#1b1d24', '#343845', '#0d0e12', '#f2ecda', 3];
  const w = color === 'w'; const fill = w ? v[0] : v[3], stroke = w ? v[1] : v[4], detail = w ? v[2] : v[5];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="${fill}" stroke="${stroke}" stroke-width="${v[6]}" stroke-linejoin="round" stroke-linecap="round"><style>.d{fill:none;stroke:${detail};stroke-width:2.5}.e{fill:${detail};stroke:none}</style>${P[type]}</svg>`;
};
const cache = {};
export function pieceSvg(color, type, set = 'rook') { const k = set + color + type; return cache[k] || (cache[k] = svgFor(color, type, set)); }
