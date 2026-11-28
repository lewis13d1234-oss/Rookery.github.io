// Glicko-2 rating system (Mark Glickman, http://www.glicko.net/glicko/glicko2.pdf).
// Used server-side only for real ratings; the client never computes ratings.

export const DEFAULTS = { rating: 1500, rd: 350, vol: 0.06 };
const TAU = 0.5;
const SCALE = 173.7178;
const EPS = 1e-6;

const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * @param {{rating:number, rd:number, vol:number}} p
 * @param {{rating:number, rd:number, score:number}[]} results  score: 1 win, 0.5 draw, 0 loss
 */
export function update(p, results) {
  const mu = (p.rating - 1500) / SCALE, phi = p.rd / SCALE, sigma = p.vol;
  if (!results.length) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: p.rating, rd: Math.min(350, phiStar * SCALE), vol: sigma };
  }
  let vInv = 0, deltaSum = 0;
  for (const r of results) {
    const muJ = (r.rating - 1500) / SCALE, phiJ = r.rd / SCALE;
    const gj = g(phiJ), ej = E(mu, muJ, phiJ);
    vInv += gj * gj * ej * (1 - ej);
    deltaSum += gj * (r.score - ej);
  }
  const v = 1 / vInv, delta = v * deltaSum;
  // volatility (Illinois algorithm)
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x), d2 = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d2 * d2) - (x - a) / (TAU * TAU);
  };
  let A = a, Bv;
  if (delta * delta > phi * phi + v) Bv = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; Bv = a - k * TAU; }
  let fA = f(A), fB = f(Bv);
  while (Math.abs(Bv - A) > EPS) {
    const C = A + ((A - Bv) * fA) / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = Bv; fA = fB; } else fA /= 2;
    Bv = C; fB = fC;
  }
  const sigmaP = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
  const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muP = mu + phiP * phiP * deltaSum;
  return { rating: muP * SCALE + 1500, rd: phiP * SCALE, vol: sigmaP };
}

/** Grow RD for inactivity (idle days treated as empty rating periods, capped at the initial RD). */
export function decay(p, idleDays) {
  if (idleDays <= 0) return p;
  const phi = p.rd / SCALE;
  const phiStar = Math.sqrt(phi * phi + p.vol * p.vol * idleDays);
  return { ...p, rd: Math.min(350, phiStar * SCALE) };
}
