// ── Math helpers ──
export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
export function smoothstep(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
export function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }

export function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const rng = mulberry32(1337);
