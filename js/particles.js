// ── Particle system ──
export const MAX_PARTICLES = 30;
export const particles = [];

export function spawnParticle(type, x, y, vx, vy, life, size, color) {
  if (particles.length >= MAX_PARTICLES) {
    const idx = particles.findIndex(p => p.life <= 0);
    if (idx >= 0) particles.splice(idx, 1);
    else return;
  }
  particles.push({ type, x, y, vx, vy, life, maxLife: life, size, color });
}
