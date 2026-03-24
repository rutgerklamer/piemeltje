// ── Pre-generated static data ──
import { rng } from './helpers.js';

export const ballHairs = [];
for (let i = 0; i < 40; i++) {
  ballHairs.push({
    side: rng() > 0.5 ? 'L' : 'R',
    posAngle: Math.PI * 0.15 + rng() * Math.PI * 0.7,
    posDist: 0.75 + rng() * 0.25,
    angle: Math.PI * 0.2 + rng() * Math.PI * 0.6,
    length: 8 + rng() * 14,
    curl: (rng() - 0.5) * 2.8,
    curl2: (rng() - 0.5) * 1.5,
    thick: 0.5 + rng() * 0.7,
    alpha: 0.35 + rng() * 0.35
  });
}

export const veinPaths = [
  { offsetBase: 0.35, offsetAmp: 0.08, freq: 5.5, startT: 0.05, endT: 0.88, widthMin: 1.2, widthMax: 3.2, appearAt: 0.25, fullAt: 0.7, side: 1 },
  { offsetBase: -0.28, offsetAmp: 0.12, freq: 7.2, startT: 0.12, endT: 0.72, widthMin: 0.8, widthMax: 2.2, appearAt: 0.40, fullAt: 0.8, side: -1 },
  { offsetBase: 0.15, offsetAmp: 0.06, freq: 9.0, startT: 0.02, endT: 0.35, widthMin: 0.6, widthMax: 1.5, appearAt: 0.50, fullAt: 0.85, side: 1 }
];

export const veinBranches = [];
for (let i = 0; i < 6; i++) {
  veinBranches.push({
    parentVein: i < 3 ? 0 : 1, t: 0.15 + rng() * 0.6,
    angle: (rng() - 0.5) * 1.2, length: 8 + rng() * 13,
    thick: 0.4 + rng() * 0.5, appearAt: 0.55 + rng() * 0.2
  });
}

export const ballPores = [];
for (let b = 0; b < 2; b++) {
  for (let j = 0; j < 14; j++) {
    ballPores.push({ ball: b, ang: rng() * Math.PI * 2, dist: 0.4 + rng() * 0.5, r: 0.3 + rng() * 0.4 });
  }
}
