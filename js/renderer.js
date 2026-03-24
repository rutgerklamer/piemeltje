// ══════════════════════════════════════════════════════════════
//  RENDERER + PHYSICS v3.0.0 — Seamless shaft-scrotum junction
//
//  THE FIX: rightO[0] and leftO[0] are SHARED anchor points
//  between the shaft outline and the scrotum arc. The scrotum
//  Catmull-Rom spline uses rightO[1]/leftO[1] as phantom control
//  points, ensuring C1 tangent continuity at the junction.
//
//  One unified buildFullBodyPath() fills shaft+scrotum as ONE
//  shape. No separate opaque shaft fill. No plank. No seam.
//
//  Ball details are rendered inside a scrotum-only clip (evenodd
//  with shaft excluded), so they don't bleed onto the shaft.
//  Shaft details are rendered inside a shaft-only clip.
//  The junction zone shows only the unified skin fill — seamless.
//
//  Physics simulation inlined (previously physics.js).
//  Lighting: procedural dot-product with world-space light source.
// ══════════════════════════════════════════════════════════════

import { lerp, clamp, smoothstep, dist, rng } from './helpers.js';
import * as S from './state.js';
import { getSpine } from './spine.js';
import {
  getStage, getStageParams, getHeartbeat, getThrobWave,
  shaftWidth, stableNeckWidth, getGlansParams, getVenusLineParams
} from './stages.js';
import { particles, spawnParticle } from './particles.js';
import {
  skinColor, skinColorDark, outlineColor, glansColor, glansOutlineFn,
  veinColor, hairColor, aoColor, sssColor
} from './colors.js';
import { ballHairs, veinPaths, veinBranches, ballPores } from './data.js';
import { updateTumble, computePivot, isInverted, getInvertedDrape } from './tumble.js';

const LINE_JOIN = 'round';
const LINE_CAP = 'round';
const SPINE_SAMPLES_PER_SEG = 5;


// ══════════════════════════════════════════
//  CATMULL-ROM INTERPOLATION
// ══════════════════════════════════════════

// Evaluate Catmull-Rom at parameter t (0..1) between p1 and p2.
// p0 and p3 are neighboring control points for tangent computation.
// Returns [x, y].
function crInterp(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  ];
}

// Trace Catmull-Rom through control points with explicit phantom array.
// phantomPts includes phantom points at index 0 and length-1.
// Draws segments from index startIdx to endIdx (inclusive endpoints).
// Caller must already be at the start position.
function traceCRWithPhantoms(ctx, allPts, startIdx, endIdx, samples) {
  const S = samples || 6;
  const n = allPts.length;
  for (let i = startIdx; i < endIdx; i++) {
    const p0 = allPts[Math.max(0, i - 1)];
    const p1 = allPts[i];
    const p2 = allPts[Math.min(n - 1, i + 1)];
    const p3 = allPts[Math.min(n - 1, i + 2)];
    for (let s = 1; s <= S; s++) {
      const t = s / S;
      const [x, y] = crInterp(p0, p1, p2, p3, t);
      ctx.lineTo(x, y);
    }
  }
}


// ══════════════════════════════════════════════════════════════
//  PHYSICS SIMULATION
//  Verlet integration with volume-preserving constraints,
//  gravity-aware deformation, ball-shaft coupling, particles.
//  Called by main.js each physics tick.
// ══════════════════════════════════════════════════════════════

export function simulate(canvas) {
  const p = S.progress;
  const s = S.stage;
  const sp = getStageParams(s, p);
  const hb = getHeartbeat();
  const now = performance.now();

  // ── Update tumble animation ──
  updateTumble();
  computePivot();

  // ── Tumble-aware physics modifiers ──
  const tumbleActive = S.tumbleActive;
  const tumbleAngle = S.tumbleAngle || 0;
  const tumbleCos = Math.cos(tumbleAngle);
  const tumbleSin = Math.sin(tumbleAngle);
  const tumbleAbsSin = Math.abs(tumbleSin);
  const tumbleGravityMul = tumbleActive ? (1 - tumbleAbsSin * 0.8) : 1.0;
  const tumbleIdleMul = tumbleActive ? 0.1 : 1.0;

  // ── Gravity direction changes with rotation ──
  const inverted = isInverted();
  const gravityDir = inverted ? -1 : 1;

  // ── Idle life: breathing ──
  S.setBreathPhase(S.breathPhase + 0.002);
  const breathSway = Math.sin(S.breathPhase * Math.PI * 2 / 3) * (1 - p * 0.95) * tumbleIdleMul;

  // ── Idle life: micro-twitches ──
  S.setTwitchTimer(S.twitchTimer - 1 / 60);
  if (S.twitchTimer <= 0 && p < 0.5 && !tumbleActive) {
    S.setTwitchTimer(3 + Math.random() * 6);
    const node = 2 + Math.floor(Math.random() * (S.N - 4));
    S.setTwitchImpulse({
      node,
      dx: (Math.random() - 0.5) * 0.8,
      dy: (Math.random() - 0.5) * 0.4,
      life: 8
    });
  }

  // ── Idle shrinkage ──
  const timeSinceInteraction = (now - S.lastInteractionTime) / 1000;
  if (timeSinceInteraction > 10 && S.target > 0) {
    S.setShrinkageAmount(smoothstep(clamp((timeSinceInteraction - 10) / 20, 0, 1)) * 0.3);
  } else {
    S.setShrinkageAmount(S.shrinkageAmount * 0.95);
  }

  // ── Heartbeat phase ──
  S.setHeartbeatPhase(S.heartbeatPhase + S.HEARTBEAT_RATE / 60);

  // ── Verlet integration ──
  for (let i = 1; i < S.N; i++) {
    const pt = S.pts[i];
    let vx = (pt.x - pt.px) * sp.friction;
    let vy = (pt.y - pt.py) * sp.friction;

    // Gravity with tumble modifier and direction
    vy += S.GRAVITY * sp.gravMul * tumbleGravityMul * gravityDir;

    // Breathing sway
    vx += breathSway * 0.025 * (i / S.N);

    // Micro-twitch impulse
    if (S.twitchImpulse.life > 0 && i === S.twitchImpulse.node) {
      const strength = S.twitchImpulse.life / 8 * tumbleIdleMul;
      vx += S.twitchImpulse.dx * strength;
      vy += S.twitchImpulse.dy * strength;
    }

    // Inverted drape
    if (inverted && !tumbleActive) {
      const t = i / (S.N - 1);
      const drape = getInvertedDrape(t);
      vy += drape.sag * 0.02;
    }

    const wobbleForce = -pt.lateralV * 0.1 * sp.wobble;
    pt.lateralV += wobbleForce;
    pt.lateralV *= 0.85;

    pt.px = pt.x; pt.py = pt.y;
    pt.x += vx; pt.y += vy;
  }
  if (S.twitchImpulse.life > 0) {
    S.setTwitchImpulse({ ...S.twitchImpulse, life: S.twitchImpulse.life - 1 });
  }

  S.pts[0].x = S.BASE_X; S.pts[0].y = S.BASE_Y;
  S.pts[0].px = S.BASE_X; S.pts[0].py = S.BASE_Y;

  // ── Distance + angle constraints ──
  const constraintIters = tumbleActive ? S.CONSTRAINT_ITERS + 4 : S.CONSTRAINT_ITERS;
  for (let iter = 0; iter < constraintIters; iter++) {
    for (let i = 0; i < S.N - 1; i++) {
      const a = S.pts[i], b = S.pts[i + 1];
      const restLen = S.SEG_LEN * lerp(1.0, 1.08, p * smoothstep(1 - i / S.N));
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const diff = (d - restLen) / d;
      if (i === 0) {
        b.x -= dx * diff;
        b.y -= dy * diff;
      } else {
        const h = diff * 0.5;
        a.x += dx * h; a.y += dy * h;
        b.x -= dx * h; b.y -= dy * h;
      }
    }
    for (let i = 0; i < S.N - 2; i++) {
      const a = S.pts[i], b = S.pts[i + 1], c = S.pts[i + 2];
      const abx = b.x - a.x, aby = b.y - a.y;
      const bcx = c.x - b.x, bcy = c.y - b.y;
      const dot = abx * bcx + aby * bcy;
      const lenAB = Math.sqrt(abx * abx + aby * aby) || 0.001;
      const lenBC = Math.sqrt(bcx * bcx + bcy * bcy) || 0.001;
      const cosAngle = dot / (lenAB * lenBC);
      if (cosAngle < -0.15) {
        const tx = b.x + abx * (lenBC / lenAB);
        const ty = b.y + aby * (lenBC / lenAB);
        const str = 0.35;
        if (i + 2 > 0) {
          c.x += (tx - c.x) * str;
          c.y += (ty - c.y) * str;
        }
      }
    }
    S.pts[0].x = S.BASE_X; S.pts[0].y = S.BASE_Y;
  }

  // ── Per-segment angular spring stiffness ──
  if (sp.stiffness > 0.001) {
    for (let i = 0; i < S.N - 1; i++) {
      const t = i / (S.N - 2);
      const segDelay = t * 0.4;
      const segStiff = smoothstep(clamp(sp.stiffness - segDelay, 0, 1)) * 0.65;
      if (segStiff < 0.001) continue;
      const curve = s >= 3 ? 0.06 : 0.03;
      const erectAngle = -1.47 + t * curve;
      const a = S.pts[i], b = S.pts[i + 1];
      const goalX = a.x + Math.cos(erectAngle) * S.SEG_LEN;
      const goalY = a.y + Math.sin(erectAngle) * S.SEG_LEN;
      b.x = lerp(b.x, goalX, segStiff);
      b.y = lerp(b.y, goalY, segStiff);
    }
  }

  // ── Tumble rotational force on spine ──
  if (tumbleActive && Math.abs(S.tumbleVelocity) > 0.001) {
    const pivotX = S.tumblePivotX || S.BASE_X;
    const pivotY = S.tumblePivotY || S.BASE_Y;
    for (let i = 1; i < S.N; i++) {
      const dx = S.pts[i].x - pivotX;
      const dy = S.pts[i].y - pivotY;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const tangentX = -dy / d;
      const tangentY = dx / d;
      const force = S.tumbleVelocity * d * 0.015;
      S.pts[i].x += tangentX * force;
      S.pts[i].y += tangentY * force;
    }
  }

  // ── Elastic overshoot ──
  if (S.overshootBounce > 0.01) {
    const bounce = Math.sin(S.overshootBounce * 8) * S.overshootBounce * 0.3;
    for (let i = 1; i < S.N; i++) {
      const t = i / (S.N - 1);
      S.pts[i].x += bounce * t * 2;
    }
    S.setOvershootBounce(S.overshootBounce * 0.88);
  }

  // ── Velocity damping ──
  if (p > 0.02) {
    const killStr = smoothstep(clamp(sp.stiffness * 1.5, 0, 1)) * 0.85;
    for (let i = 1; i < S.N; i++) {
      S.pts[i].px = lerp(S.pts[i].px, S.pts[i].x, killStr);
      S.pts[i].py = lerp(S.pts[i].py, S.pts[i].y, killStr);
    }
  }

  S.pts[0].x = S.BASE_X; S.pts[0].y = S.BASE_Y;

  // ── Energy cap ──
  const maxSpeed = lerp(3.0, 1.5, sp.stiffness);
  for (let i = 1; i < S.N; i++) {
    const vx = S.pts[i].x - S.pts[i].px;
    const vy = S.pts[i].y - S.pts[i].py;
    const spd = Math.sqrt(vx * vx + vy * vy);
    if (spd > maxSpeed) {
      const scale = maxSpeed / spd;
      S.pts[i].px = S.pts[i].x - vx * scale;
      S.pts[i].py = S.pts[i].y - vy * scale;
    }
  }

  // ── Mouse proximity forces ──
  if (S.mouseInCanvas && !tumbleActive) {
    const rect = canvas.getBoundingClientRect();
    const mx = (S.mouseX - rect.left) / S.canvasScale;
    const my = (S.mouseY - rect.top) / S.canvasScale;
    for (let i = 1; i < S.N; i++) {
      const d = dist(S.pts[i].x, S.pts[i].y, mx, my);
      if (d < 80) {
        const strength = (1 - d / 80) * 0.5;
        const dx = S.pts[i].x - mx;
        const dy = S.pts[i].y - my;
        const dn = Math.sqrt(dx * dx + dy * dy) || 1;
        if (p < 0.3) {
          S.pts[i].x += (dx / dn) * strength * 1.2;
          S.pts[i].y += (dy / dn) * strength * 0.6;
        } else if (p > 0.6) {
          S.pts[i].x -= (dx / dn) * strength * 0.15;
          S.pts[i].y -= (dy / dn) * strength * 0.08;
        }
        S.pts[i].lateralV += (dx / dn) * strength * 0.3;
      }
    }
  }

  // ── Heartbeat impulse ──
  if (hb > 0.01) {
    const throbPos = getThrobWave();
    for (let i = 1; i < S.N; i++) {
      const t = i / (S.N - 1);
      const dx = S.pts[i].x - S.pts[Math.max(0, i - 1)].x;
      const dy = S.pts[i].y - S.pts[Math.max(0, i - 1)].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const waveDist = Math.abs(t - throbPos);
      const waveStr = waveDist < 0.15 ? (1 - waveDist / 0.15) : 0;
      const strength = (hb * 0.1 + waveStr * 0.06) * (0.5 + t * 0.5);
      S.pts[i].x += (dx / d) * strength;
      S.pts[i].y += (dy / d) * strength;
    }
  }

  // ── Stage transitions ──
  const newStage = getStage(p);
  if (newStage !== S.prevStage) {
    S.setStageTime(0);
    if (newStage === 2) {
      S.setTransitionFlash(0.5);
    } else if (newStage === 3) {
      S.setTransitionFlash(0.8);
      S.setOvershootBounce(0.3);
    }
    S.setPrevStage(newStage);
  }
  S.setStage(newStage);
  S.setStageTime(S.stageTime + 1 / 60);
  S.setTransitionFlash(S.transitionFlash * 0.90);

  // ── Ball physics ──
  const ballSpread = lerp(26, 25, p);
  const ballDrop = lerp(38, 36, p);

  let restLX = -ballSpread, restLY = ballDrop;
  let restRX = ballSpread, restRY = ballDrop + 5;
  if (tumbleActive || Math.abs(tumbleAngle) > 0.01) {
    restLY = ballDrop * tumbleCos;
    restRY = (ballDrop + 5) * tumbleCos;
  }

  function simBall(ball, restX, restY) {
    const vx = (ball.x - ball.px) * S.BALL_FRICTION;
    const vy = (ball.y - ball.py) * S.BALL_FRICTION;
    ball.px = ball.x; ball.py = ball.y;
    const targetX = S.BASE_X + restX;
    const targetY = S.BASE_Y + restY;
    ball.x += vx + (targetX - ball.x) * S.BALL_SPRING;
    ball.y += vy + (targetY - ball.y) * S.BALL_SPRING + S.BALL_GRAVITY * tumbleGravityMul * gravityDir;

    // Coupling: balls follow shaft base movement
    const s1 = S.pts[1], s2 = S.pts[2];
    ball.x += (s1.x - S.BASE_X) * 0.018 + (s2.x - s1.x) * 0.008;
    ball.y += (s1.y - S.BASE_Y) * 0.006 + (s2.y - s1.y) * 0.003;

    // Idle sway
    ball.swayPhase += 0.015 + Math.random() * 0.005;
    const sway = Math.sin(ball.swayPhase) * (1 - p * 0.7) * 0.6 * tumbleIdleMul;
    ball.x += sway;

    // Heartbeat pull
    if (hb > 0.01) {
      ball.y -= hb * 0.3 * gravityDir;
      ball.x += (S.BASE_X - ball.x) * hb * 0.01;
    }
  }

  simBall(S.ballL, restLX, restLY);
  simBall(S.ballR, restRX, restRY);

  // ── Ball collision avoidance ──
  const bdx = S.ballR.x - S.ballL.x;
  const bdy = S.ballR.y - S.ballL.y;
  const bdist = Math.sqrt(bdx * bdx + bdy * bdy) || 1;
  const minDist = tumbleActive ? 42 : 52;
  if (bdist < minDist) {
    const push = (minDist - bdist) * 0.5;
    S.ballL.x -= (bdx / bdist) * push;
    S.ballR.x += (bdx / bdist) * push;
  }

  // ── Tumble rotational force on balls ──
  if (tumbleActive && Math.abs(S.tumbleVelocity) > 0.001) {
    const pivotX = S.tumblePivotX || S.BASE_X;
    const pivotY = S.tumblePivotY || S.BASE_Y;
    for (const ball of [S.ballL, S.ballR]) {
      const dx = ball.x - pivotX;
      const dy = ball.y - pivotY;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const tangentX = -dy / d;
      const tangentY = dx / d;
      const force = S.tumbleVelocity * d * 0.012;
      ball.x += tangentX * force;
      ball.y += tangentY * force;
    }
  }

  // ── Particle simulation ──
  for (let i = particles.length - 1; i >= 0; i--) {
    const part = particles[i];
    part.life -= 1 / 60;
    if (part.life <= 0) { particles.splice(i, 1); continue; }
    part.x += part.vx;
    part.y += part.vy;
    if (part.type === 'sweat') {
      part.vy += 0.03;
      part.vx *= 0.99;
    } else if (part.type === 'throb') {
      part.size *= 1.02;
    }
  }

  // ── Spawn sweat particles ──
  if (p > 0.7 && Math.random() < 0.03 * (p - 0.7) * 3 && !tumbleActive) {
    const si = 2 + Math.floor(Math.random() * (S.N - 4));
    const pt = S.pts[si];
    spawnParticle('sweat', pt.x + (Math.random() - 0.5) * 20, pt.y + (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 0.2, 0.3 + Math.random() * 0.3, 2 + Math.random() * 2, 1.5 + Math.random(), 'rgba(255,255,255,0.4)');
  }

  // ── Spawn throb ring ──
  if (hb > 0.5 && Math.random() < 0.3) {
    spawnParticle('throb', S.pts[1].x, S.pts[1].y, 0, 0, 0.8, 3, 'rgba(200,80,60,0.15)');
  }

  // ── Tumble wind particles ──
  if (tumbleActive && Math.abs(S.tumbleVelocity) > 0.03 && Math.random() < 0.15) {
    const si = 1 + Math.floor(Math.random() * (S.N - 2));
    const pt = S.pts[si];
    const windDir = S.tumbleVelocity > 0 ? 1 : -1;
    spawnParticle('sweat',
      pt.x + (Math.random() - 0.5) * 30,
      pt.y + (Math.random() - 0.5) * 15,
      windDir * (0.5 + Math.random() * 0.5),
      (Math.random() - 0.5) * 0.3,
      0.8 + Math.random(),
      1.0 + Math.random() * 0.5,
      'rgba(220,200,180,0.3)'
    );
  }

  // ── Light tracking ──
  if (S.mouseInCanvas) {
    const rect = canvas.getBoundingClientRect();
    const mx = (S.mouseX - rect.left) / S.canvasScale;
    const my = (S.mouseY - rect.top) / S.canvasScale;
    S.setLightX(lerp(S.lightX, mx, 0.03));
    S.setLightY(lerp(S.lightY, my, 0.03));
  } else {
    S.setLightX(lerp(S.lightX, S.BASE_W * 0.3, 0.01));
    S.setLightY(lerp(S.lightY, S.BASE_H * 0.15, 0.01));
  }
}


// ══════════════════════════════════════════
//  GEOMETRY: build shaft silhouette in LOCAL space
// ══════════════════════════════════════════

function buildLocalGeometry(p) {
  const spine = getSpine(SPINE_SAMPLES_PER_SEG);
  const SL = spine.length;

  const positions = [];
  const tangents = [];
  const normals = [];
  const widths = [];
  let lastNx = -1, lastNy = 0;

  for (let i = 0; i < SL; i++) {
    const { pos, tan } = spine[i];
    positions.push(pos);
    tangents.push(tan);

    let nx = -tan[1], ny = tan[0];
    if (nx * lastNx + ny * lastNy < 0) { nx = -nx; ny = -ny; }
    lastNx = nx; lastNy = ny;
    normals.push([nx, ny]);

    const t = i / (SL - 1);
    widths.push(shaftWidth(t, p) / 2);
  }

  // Build left/right outlines
  const leftO = [], rightO = [];
  for (let i = 0; i < SL; i++) {
    const [px, py] = positions[i];
    const [nx, ny] = normals[i];
    const w = widths[i];
    leftO.push([px + nx * w, py + ny * w]);
    rightO.push([px - nx * w, py - ny * w]);
  }

  // Stabilize base normals to prevent scrotum distortion during erection.
  // The first few samples blend toward horizontal so the shaft-to-scrotum
  // connection points don't rotate when the shaft stiffens upward.
  const BASE_NORMAL_BLEND = 5;
  for (let i = 0; i < Math.min(BASE_NORMAL_BLEND, SL); i++) {
    const blend = smoothstep(i / BASE_NORMAL_BLEND);
    const [nx, ny] = normals[i];
    const bx = lerp(-1, nx, blend);
    const by = lerp(0, ny, blend);
    const len = Math.sqrt(bx * bx + by * by) || 1;
    normals[i] = [bx / len, by / len];
  }

  // Rebuild outlines for stabilized base normals only
  for (let i = 0; i < Math.min(BASE_NORMAL_BLEND, SL); i++) {
    const [px, py] = positions[i];
    const [nx, ny] = normals[i];
    const w = widths[i];
    leftO[i] = [px + nx * w, py + ny * w];
    rightO[i] = [px - nx * w, py - ny * w];
  }

  return { spine, SL, positions, tangents, normals, widths, leftO, rightO };
}


// ══════════════════════════════════════════
//  LIGHT COMPUTATION
// ══════════════════════════════════════════

function getLocalLightDir(tumbleAngle) {
  const worldLx = S.lightX - S.BASE_X;
  const worldLy = S.lightY - S.BASE_Y;
  const len = Math.sqrt(worldLx * worldLx + worldLy * worldLy) || 1;
  const wlx = worldLx / len, wly = worldLy / len;

  const cos = Math.cos(-tumbleAngle);
  const sin = Math.sin(-tumbleAngle);
  return {
    x: wlx * cos - wly * sin,
    y: wlx * sin + wly * cos
  };
}

function diffuse(nx, ny, lx, ly) {
  const dot = nx * lx + ny * ly;
  return clamp(dot * 0.5 + 0.5, 0.15, 1.0);
}


// ══════════════════════════════════════════
//  BALL GEOMETRY
// ══════════════════════════════════════════

function getBallPositions(p) {
  return {
    lx: S.ballL.x, ly: S.ballL.y,
    rx: S.ballR.x, ry: S.ballR.y,
    sxL: lerp(42, 41, p), syL: lerp(44, 43, p),
    sxR: lerp(42, 41, p) * 0.95, syR: lerp(44, 43, p) * 0.95
  };
}


// ══════════════════════════════════════════
//  PATH HELPERS
// ══════════════════════════════════════════

function ellipsePoint(cx, cy, rx, ry, rot, angle) {
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  return [
    cx + rx * cosA * cosR - ry * sinA * sinR,
    cy + rx * cosA * sinR + ry * sinA * cosR
  ];
}

// Trace shaft outline as a closed path (left edge → right edge reversed)
function traceShaftPath(ctx, leftO, rightO, SL) {
  ctx.moveTo(leftO[0][0], leftO[0][1]);
  for (let i = 1; i < SL; i++) ctx.lineTo(leftO[i][0], leftO[i][1]);
  ctx.lineTo(rightO[SL - 1][0], rightO[SL - 1][1]);
  for (let i = SL - 2; i >= 0; i--) ctx.lineTo(rightO[i][0], rightO[i][1]);
  ctx.closePath();
}

// Glans outline: left tip → dome → right tip
function traceGlansOutline(ctx, geo, p) {
  const { leftO, rightO, SL, positions, tangents } = geo;
  const tipPos = positions[SL - 1];
  const tipTan = tangents[SL - 1];
  const tipAng = Math.atan2(tipTan[1], tipTan[0]);
  const tipW = shaftWidth(1, p);
  const glansParams = getGlansParams(p);
  const gl = glansParams.length;
  const hw = glansParams.width / 2;
  const cosA = Math.cos(tipAng), sinA = Math.sin(tipAng);

  function w(lx, ly) {
    return [
      tipPos[0] + lx * cosA - ly * sinA,
      tipPos[1] + lx * sinA + ly * cosA
    ];
  }

  // Smooth corona transition — gentle bulge, no sharp bumps
  const cb = 1.5; // subtle corona bulge
  const a1 = w(-1, hw + cb), a2 = w(gl * 0.06, hw + cb * 0.6), a3 = w(gl * 0.18, hw * 0.99);
  ctx.bezierCurveTo(a1[0], a1[1], a2[0], a2[1], a3[0], a3[1]);
  const b1 = w(gl * 0.35, hw * 0.96), b2 = w(gl * 0.55, hw * 0.84), b3 = w(gl * 0.70, hw * 0.58);
  ctx.bezierCurveTo(b1[0], b1[1], b2[0], b2[1], b3[0], b3[1]);
  const c1 = w(gl * 0.80, hw * 0.30), c2 = w(gl * 0.88, 0), c3 = w(gl * 0.80, -hw * 0.30);
  ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], c3[0], c3[1]);
  const d1 = w(gl * 0.70, -hw * 0.58), d2 = w(gl * 0.55, -hw * 0.84), d3 = w(gl * 0.35, -hw * 0.96);
  ctx.bezierCurveTo(d1[0], d1[1], d2[0], d2[1], d3[0], d3[1]);
  const e1 = w(gl * 0.18, -hw * 0.99), e2 = w(gl * 0.06, -(hw + cb * 0.6)), e3 = w(-1, -(hw + cb));
  ctx.bezierCurveTo(e1[0], e1[1], e2[0], e2[1], e3[0], e3[1]);
  ctx.lineTo(rightO[SL - 1][0], rightO[SL - 1][1]);
}


// ══════════════════════════════════════════════════════════════
//  SCROTUM ARC — CATMULL-ROM WITH SHARED ANCHOR POINTS
//
//  THIS IS THE KEY FIX. The scrotum arc is a Catmull-Rom spline
//  through control points that INCLUDE rightO[0] and leftO[0]
//  as interpolation points. Phantom points from the shaft edges
//  (rightO[1], leftO[1]) ensure the tangent at the junction
//  matches the shaft edge tangent direction. Result: C1 continuous
//  transition from shaft into scrotum. No seam. No plank.
//
//  Control point array:
//  [0]  rightO[1]        ← phantom (shaft edge direction)
//  [1]  rightO[0]        ← SHARED ANCHOR (shaft right base)
//  [2..9]  right ball arc points on ellipse
//  [10] seamRight        ← seam bottom right
//  [11] seamLeft         ← seam bottom left
//  [12..19] left ball arc points on ellipse
//  [20] leftO[0]         ← SHARED ANCHOR (shaft left base)
//  [21] leftO[1]         ← phantom (shaft edge direction)
//
//  We trace CR segments from index 1 to 19 (rightO[0] → leftO[0]).
// ══════════════════════════════════════════════════════════════

function traceScrotumArc(ctx, geo, balls, p) {
  const { leftO, rightO } = geo;
  const { lx, ly, rx, ry, sxL, syL, sxR, syR } = balls;

  // Scrotum midpoint and bottom
  const scMidX = (lx + rx) / 2;
  const scrBot = Math.max(ly, ry) + Math.max(syL, syR) * lerp(0.65, 0.60, p);

  // ── Right ball arc: from rightO[0] direction around to seam ──
  // Angle from right ball center toward rightO[0]
  const rEntryAng = Math.atan2(rightO[0][1] - ry, rightO[0][0] - rx);
  // Angle from right ball center toward seam bottom
  const rExitAng = Math.atan2((scrBot - 4) - ry, (scMidX + 2) - rx);

  // Normalize: ensure we go clockwise (increasing angle in screen coords)
  let rEnd = rExitAng;
  if (rEnd < rEntryAng) rEnd += Math.PI * 2;

  // Sample 8 points along the right ball arc (between entry and exit)
  const N_ARC = 8;
  const rightArcPts = [];
  for (let i = 1; i <= N_ARC; i++) {
    const a = rEntryAng + (rEnd - rEntryAng) * (i / (N_ARC + 1));
    rightArcPts.push(ellipsePoint(rx, ry, sxR, syR, 0.1, a));
  }

  // ── Left ball arc: from seam around to leftO[0] direction ──
  const lEntryAng = Math.atan2((scrBot - 4) - ly, (scMidX - 2) - lx);
  const lExitAng = Math.atan2(leftO[0][1] - ly, leftO[0][0] - lx);

  let lEnd = lExitAng;
  if (lEnd < lEntryAng) lEnd += Math.PI * 2;

  const leftArcPts = [];
  for (let i = 1; i <= N_ARC; i++) {
    const a = lEntryAng + (lEnd - lEntryAng) * (i / (N_ARC + 1));
    leftArcPts.push(ellipsePoint(lx, ly, sxL, syL, -0.1, a));
  }

  // ── Seam bottom control points ──
  const seamW = Math.max(6, Math.abs(rx - lx) * 0.12);
  const seamR = [scMidX + seamW, scrBot + 2];
  const seamL = [scMidX - seamW, scrBot + 2];

  // ── Build full Catmull-Rom control point array ──
  // Phantoms at both ends ensure tangent continuity with shaft edges
  const allPts = [
    rightO[1],         // [0]  phantom
    rightO[0],         // [1]  SHARED ANCHOR
    ...rightArcPts,    // [2..9]  right ball arc (8 points)
    seamR,             // [10] seam right
    seamL,             // [11] seam left
    ...leftArcPts,     // [12..19] left ball arc (8 points)
    leftO[0],          // [20] SHARED ANCHOR
    leftO[1],          // [21] phantom
  ];

  // Trace Catmull-Rom from rightO[0] to leftO[0]
  // We draw segments for indices 1 through n-3 (skipping phantoms)
  const n = allPts.length;
  const SAMP = 6;
  for (let i = 1; i < n - 2; i++) {
    const p0 = allPts[i - 1];
    const p1 = allPts[i];
    const p2 = allPts[i + 1];
    const p3 = allPts[Math.min(n - 1, i + 2)];
    for (let s = 1; s <= SAMP; s++) {
      const t = s / SAMP;
      const [x, y] = crInterp(p0, p1, p2, p3, t);
      ctx.lineTo(x, y);
    }
  }
}


// ══════════════════════════════════════════
//  UNIFIED BODY PATH — ONE SHAPE, ONE FILL
//
//  Traces: leftO[0] → shaft left edge → glans → shaft right edge
//  → rightO[0] → scrotum arc → leftO[0]. Closed path.
//
//  rightO[0] and leftO[0] are shared anchors: the shaft edge
//  ends there, and the scrotum arc begins/ends there.
//  No gap. No overlap. One continuous path.
// ══════════════════════════════════════════

function buildFullBodyPath(ctx, geo, balls, p) {
  const { leftO, rightO, SL } = geo;

  // Start at left base (shaft base left = scrotum exit)
  ctx.moveTo(leftO[0][0], leftO[0][1]);

  // Shaft left edge: base → tip
  for (let i = 1; i < SL; i++) ctx.lineTo(leftO[i][0], leftO[i][1]);

  // Glans dome at tip
  traceGlansOutline(ctx, geo, p);

  // Shaft right edge: tip → base
  for (let i = SL - 2; i >= 0; i--) ctx.lineTo(rightO[i][0], rightO[i][1]);

  // Scrotum arc: rightO[0] → balls → seam → leftO[0]
  // This continues seamlessly from rightO[0] (shared anchor)
  // and ends at leftO[0] (shared anchor = starting point)
  traceScrotumArc(ctx, geo, balls, p);
}

// Per-segment quad sub-paths to fix winding holes when shaft self-intersects
function patchShaftSubPaths(ctx, geo) {
  const { leftO, rightO, SL } = geo;
  for (let i = 0; i < SL - 1; i++) {
    ctx.moveTo(leftO[i][0], leftO[i][1]);
    ctx.lineTo(leftO[i + 1][0], leftO[i + 1][1]);
    ctx.lineTo(rightO[i + 1][0], rightO[i + 1][1]);
    ctx.lineTo(rightO[i][0], rightO[i][1]);
    ctx.closePath();
  }
}


// ══════════════════════════════════════════
//  DRAWING LAYERS
// ══════════════════════════════════════════


// ── BACKGROUND ──

function drawBackground(ctx) {
  const bgGrad = ctx.createLinearGradient(0, 0, 0, S.BASE_H);
  bgGrad.addColorStop(0, '#f8f4f0');
  bgGrad.addColorStop(1, '#ede6df');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, S.BASE_W, S.BASE_H);
}


// ── DROP SHADOW ──

function drawDropShadow(ctx, geo, balls, p, tumbleAngle) {
  const pivotX = S.tumblePivotX || S.BASE_X;
  const pivotY = S.tumblePivotY || (S.BASE_Y + 60);

  const cos = Math.cos(tumbleAngle), sin = Math.sin(tumbleAngle);
  function toWorld(x, y) {
    const dx = x - pivotX, dy = y - pivotY;
    return [pivotX + dx * cos - dy * sin, pivotY + dx * sin + dy * cos];
  }

  const { lx, ly, rx, ry, sxL, syL, sxR, syR } = balls;
  const { positions, SL } = geo;

  let maxWorldY = -Infinity;
  let shadowCenterX = pivotX;
  const checkPoints = [
    [lx, ly + syL], [rx, ry + syR],
    [lx, ly - syL], [rx, ry - syR],
    positions[SL - 1], positions[0]
  ];
  for (const pt of checkPoints) {
    const [wx, wy] = toWorld(pt[0], pt[1]);
    if (wy > maxWorldY) {
      maxWorldY = wy;
      shadowCenterX = wx;
    }
  }

  const shadowY = maxWorldY + 10;
  const shadowRx = lerp(50, 45, p);
  const shadowRy = 8;
  const RINGS = 6;

  ctx.save();
  for (let ring = RINGS; ring >= 0; ring--) {
    const t = ring / RINGS;
    const scale = lerp(0.35, 1.0, t);
    const alpha = 0.15 * (1 - t * t);
    if (alpha < 0.002) continue;
    ctx.beginPath();
    ctx.ellipse(shadowCenterX, shadowY, Math.max(shadowRx * scale, 0.5), Math.max(shadowRy * scale, 0.5), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(4)})`;
    ctx.fill();
  }
  ctx.restore();
}


// ── BODY FILL — one unified path, one fill call ──

function drawBodyFill(ctx, geo, balls, p) {
  const sc = skinColor(p, 0);
  ctx.beginPath();
  buildFullBodyPath(ctx, geo, balls, p);
  patchShaftSubPaths(ctx, geo);
  ctx.fillStyle = sc;
  ctx.fill('nonzero');
}


// ── VOLUME GRADIENT ──
// Global body volume: light center, dark edges

function drawVolumeGradient(ctx, geo, balls, p, localLight) {
  const bodyMidX = (balls.lx + balls.rx) / 2;
  const bodyMidY = (geo.positions[0][1] + geo.positions[geo.SL - 1][1]) / 2;
  const bodyRadius = Math.abs(geo.positions[geo.SL - 1][1] - geo.positions[0][1]) * 0.8;

  const volGrad = ctx.createRadialGradient(
    bodyMidX + localLight.x * bodyRadius * 0.2, bodyMidY + localLight.y * bodyRadius * 0.15,
    bodyRadius * 0.1,
    bodyMidX, bodyMidY,
    bodyRadius
  );
  volGrad.addColorStop(0, 'rgba(255,235,215,0.07)');
  volGrad.addColorStop(0.4, 'rgba(255,235,215,0)');
  volGrad.addColorStop(0.75, 'rgba(50,28,15,0.06)');
  volGrad.addColorStop(1, 'rgba(40,20,10,0.12)');
  ctx.fillStyle = volGrad;
  ctx.fillRect(-S.BASE_W, -S.BASE_H, S.BASE_W * 3, S.BASE_H * 3);
}


// ── JUNCTION SHADING ──
// Subtle ambient occlusion at the shaft-scrotum junction zone

function drawJunctionShading(ctx, geo, balls, p) {
  const { leftO, rightO } = geo;
  const { lx, ly, rx, ry, sxL, syL, sxR, syR } = balls;

  // AO darkening where shaft meets scrotum
  const jMidX = (leftO[0][0] + rightO[0][0]) / 2;
  const jTopY = (leftO[0][1] + rightO[0][1]) / 2;
  const shaftBaseW = Math.abs(rightO[0][0] - leftO[0][0]);
  const aoWidth = Math.max(shaftBaseW, (sxL + sxR)) * 0.85;
  const aoHeight = Math.abs(Math.max(ly, ry) - jTopY) * 0.7;

  if (aoHeight > 2 && aoWidth > 2) {
    const aoGrad = ctx.createRadialGradient(
      jMidX, jTopY + aoHeight * 0.3, aoHeight * 0.08,
      jMidX, jTopY + aoHeight * 0.3, aoWidth * 0.8
    );
    aoGrad.addColorStop(0, aoColor(0.22));
    aoGrad.addColorStop(0.25, aoColor(0.14));
    aoGrad.addColorStop(0.5, aoColor(0.06));
    aoGrad.addColorStop(1, aoColor(0));
    ctx.fillStyle = aoGrad;
    ctx.fillRect(jMidX - aoWidth, jTopY - 5, aoWidth * 2, aoHeight * 1.5);
  }

  // Soft shadow under shaft base — tapers into scrotum naturally
  const shadowGrad = ctx.createLinearGradient(jMidX, jTopY - 2, jMidX, jTopY + aoHeight * 0.4);
  shadowGrad.addColorStop(0, 'rgba(60,30,18,0.08)');
  shadowGrad.addColorStop(0.5, 'rgba(60,30,18,0.04)');
  shadowGrad.addColorStop(1, 'rgba(60,30,18,0)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(jMidX - shaftBaseW * 0.6, jTopY - 2, shaftBaseW * 1.2, aoHeight * 0.5);
}


// ── SHAFT SHADING ──

function drawShaftShading(ctx, geo, p, localLight) {
  const { positions, tangents, normals, widths, leftO, rightO, SL } = geo;

  ctx.save();
  ctx.beginPath();
  traceShaftPath(ctx, leftO, rightO, SL);
  ctx.clip();

  // Shadow side strip
  for (let i = 0; i < SL - 1; i++) {
    const t = i / (SL - 1);
    const [nx, ny] = normals[i];
    const [px, py] = positions[i];
    const [px2, py2] = positions[i + 1];
    const [nx2, ny2] = normals[i + 1];
    const w1 = widths[i], w2 = widths[i + 1];

    const d1 = diffuse(nx, ny, localLight.x, localLight.y);
    const d2 = diffuse(nx2, ny2, localLight.x, localLight.y);

    const shadowAlpha1 = clamp((1 - d1) * 0.25, 0, 0.25);
    const shadowAlpha2 = clamp((1 - d2) * 0.25, 0, 0.25);

    if (shadowAlpha1 > 0.01 || shadowAlpha2 > 0.01) {
      const dot1 = nx * localLight.x + ny * localLight.y;
      const side = dot1 > 0 ? -1 : 1;

      ctx.beginPath();
      ctx.moveTo(px + nx * w1 * 0.3 * side, py + ny * w1 * 0.3 * side);
      ctx.lineTo(px2 + nx2 * w2 * 0.3 * side, py2 + ny2 * w2 * 0.3 * side);
      ctx.lineTo(px2 + nx2 * w2 * side, py2 + ny2 * w2 * side);
      ctx.lineTo(px + nx * w1 * side, py + ny * w1 * side);
      ctx.closePath();

      const avgAlpha = (shadowAlpha1 + shadowAlpha2) / 2;
      ctx.fillStyle = `rgba(70,45,25,${avgAlpha.toFixed(4)})`;
      ctx.fill();
    }

    // Highlight on the lit side
    const hlAlpha1 = clamp((d1 - 0.6) * 0.3, 0, 0.15);
    const hlAlpha2 = clamp((d2 - 0.6) * 0.3, 0, 0.15);

    if (hlAlpha1 > 0.005 || hlAlpha2 > 0.005) {
      const hlSide = (nx * localLight.x + ny * localLight.y) > 0 ? 1 : -1;

      ctx.beginPath();
      ctx.moveTo(px + nx * w1 * 0.5 * hlSide, py + ny * w1 * 0.5 * hlSide);
      ctx.lineTo(px2 + nx2 * w2 * 0.5 * hlSide, py2 + ny2 * w2 * 0.5 * hlSide);
      ctx.lineTo(px2 + nx2 * w2 * hlSide, py2 + ny2 * w2 * hlSide);
      ctx.lineTo(px + nx * w1 * hlSide, py + ny * w1 * hlSide);
      ctx.closePath();

      const avgHl = (hlAlpha1 + hlAlpha2) / 2;
      ctx.fillStyle = `rgba(255,240,220,${avgHl.toFixed(4)})`;
      ctx.fill();
    }
  }

  // Specular highlight streak
  if (p > 0.3) {
    const specStr = smoothstep((p - 0.3) / 0.5) * 0.15;
    const hlSide = (normals[Math.floor(SL / 2)][0] * localLight.x +
                    normals[Math.floor(SL / 2)][1] * localLight.y) > 0 ? 1 : -1;

    for (let i = 2; i < SL - 2; i++) {
      const t = i / (SL - 1);
      const [px, py] = positions[i];
      const [nx, ny] = normals[i];
      const w = widths[i];
      const [px2, py2] = positions[Math.min(i + 1, SL - 1)];

      const taper = Math.sin(t * Math.PI);
      const alpha = specStr * taper;
      if (alpha < 0.002) continue;

      const specX = px + nx * w * 0.65 * hlSide;
      const specY = py + ny * w * 0.65 * hlSide;
      const ni = Math.min(i + 1, SL - 1);
      const specX2 = px2 + normals[ni][0] * widths[ni] * 0.65 * hlSide;
      const specY2 = py2 + normals[ni][1] * widths[ni] * 0.65 * hlSide;

      ctx.beginPath();
      ctx.moveTo(specX, specY);
      ctx.lineTo(specX2, specY2);
      ctx.strokeStyle = `rgba(255,255,250,${alpha.toFixed(4)})`;
      ctx.lineWidth = lerp(1.5, 3.5, p) * taper;
      ctx.lineCap = LINE_CAP;
      ctx.stroke();
    }
  }

  // Skin wrinkles
  ctx.globalAlpha = 0.04 + p * 0.02;
  ctx.strokeStyle = 'rgb(60,35,20)';
  ctx.lineWidth = 0.4;
  for (let i = 2; i < SL - 2; i += 3) {
    const [px, py] = positions[i];
    const [tx, ty] = tangents[i];
    const [nx, ny] = normals[i];
    const w = widths[i];
    ctx.beginPath();
    ctx.moveTo(px + nx * w * 0.4 + tx * 1.5, py + ny * w * 0.4 + ty * 1.5);
    ctx.lineTo(px - nx * w * 0.6 - tx * 1.5, py - ny * w * 0.6 - ty * 1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Venus line / raphe
  ctx.save();
  ctx.lineCap = LINE_CAP;
  ctx.lineJoin = LINE_JOIN;
  for (let i = 2; i < SL - 2; i++) {
    const t = i / (SL - 1);
    const venusParams = getVenusLineParams(t, p);
    if (!venusParams.visible) continue;
    const [px, py] = positions[i];
    const [px2, py2] = positions[Math.min(i + 1, SL - 1)];
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px2, py2);
    ctx.strokeStyle = `rgba(45,25,12,${venusParams.opacity})`;
    ctx.lineWidth = lerp(1.2, 0.6, t);
    ctx.stroke();
  }
  ctx.restore();

  // SSS spots
  for (let i = 3; i < SL - 3; i += 3) {
    const t = i / (SL - 1);
    const [px, py] = positions[i];
    const w = widths[i];
    const sssStr = smoothstep(clamp(p * 1.5 - t * 0.3, 0, 1)) * lerp(0.04, 0.10, p);
    if (sssStr < 0.005) continue;
    const sssR = w * 0.9;
    const gSSS = ctx.createRadialGradient(px, py, 0, px, py, sssR);
    gSSS.addColorStop(0, sssColor(p, sssStr));
    gSSS.addColorStop(1, sssColor(p, 0));
    ctx.beginPath();
    ctx.arc(px, py, sssR, 0, Math.PI * 2);
    ctx.fillStyle = gSSS;
    ctx.fill();
  }

  // Skin pores
  ctx.globalAlpha = 0.03 + p * 0.015;
  ctx.fillStyle = 'rgb(80,50,35)';
  for (let i = 1; i < SL - 2; i += 2) {
    const [px, py] = positions[i];
    const [nx, ny] = normals[i];
    const w = widths[i];
    for (let d = -0.5; d <= 0.5; d += 0.25) {
      const ppx = px + nx * w * d + (rng() - 0.5) * 2;
      const ppy = py + ny * w * d + (rng() - 0.5) * 2;
      ctx.beginPath();
      ctx.arc(ppx, ppy, 0.3 + rng() * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // shaft clip
}


// ── VEINS ──

function drawVeins(ctx, geo, p) {
  const { positions, tangents, normals, widths, SL } = geo;
  const hb = getHeartbeat();
  const throbWave = getThrobWave();

  for (const vein of veinPaths) {
    if (p < vein.appearAt * 0.5) continue;
    const vp = smoothstep(clamp((p - vein.appearAt) / (vein.fullAt - vein.appearAt), 0, 1));
    if (vp < 0.01) continue;

    const pulseMul = 1 + hb * 0.3;
    const alpha = vp * lerp(0.15, 0.50, p);
    const width = lerp(vein.widthMin, vein.widthMax, vp) * pulseMul;
    const si = Math.floor(SL * vein.startT), ei = Math.floor(SL * vein.endT);
    const totalSegs = ei - si;

    ctx.lineCap = LINE_CAP;
    ctx.lineJoin = LINE_JOIN;

    for (let i = si; i < ei; i++) {
      const t = i / (SL - 1);
      const segT = totalSegs > 0 ? (i - si) / totalSegs : 0.5;
      const fadeIn = smoothstep(clamp(segT / 0.25, 0, 1));
      const fadeOut = smoothstep(clamp((1 - segT) / 0.25, 0, 1));
      const fade = fadeIn * fadeOut;

      const [px, py] = positions[i];
      const [tx, ty] = tangents[i];
      const nx = -ty * vein.side, ny = tx * vein.side;
      const w = widths[i];
      const off = w * (vein.offsetBase + vein.offsetAmp * Math.sin(t * vein.freq));

      const [px2, py2] = positions[Math.min(i + 1, SL - 1)];
      const [tx2, ty2] = tangents[Math.min(i + 1, SL - 1)];
      const nx2 = -ty2 * vein.side, ny2 = tx2 * vein.side;
      const w2 = widths[Math.min(i + 1, SL - 1)];
      const t2 = (i + 1) / (SL - 1);
      const off2 = w2 * (vein.offsetBase + vein.offsetAmp * Math.sin(t2 * vein.freq));

      const segAlpha = alpha * fade;
      const segWidth = width * (0.3 + 0.7 * fade);
      if (segAlpha < 0.001) continue;

      ctx.beginPath();
      ctx.moveTo(px + nx * off, py + ny * off);
      ctx.lineTo(px2 + nx2 * off2, py2 + ny2 * off2);
      ctx.strokeStyle = veinColor(p, segAlpha);
      ctx.lineWidth = segWidth;
      ctx.stroke();
    }
  }

  // Vein branches
  for (const br of veinBranches) {
    if (p < br.appearAt) continue;
    const ba = smoothstep(clamp((p - br.appearAt) / 0.25, 0, 1)) * lerp(0.1, 0.3, p);
    if (ba < 0.01) continue;
    const pv = veinPaths[br.parentVein];
    const bsi = clamp(Math.floor(SL * lerp(pv.startT, pv.endT, br.t)), 0, SL - 1);
    const [px, py] = positions[bsi];
    const [tx, ty] = tangents[bsi];
    const bnx = -ty * pv.side, bny = tx * pv.side;
    const bw = widths[bsi];
    const bo = bw * pv.offsetBase;
    const bx = px + bnx * bo, by = py + bny * bo;
    const bAng = Math.atan2(ty, tx) + br.angle;

    const brSegs = 12;
    const p0x = bx, p0y = by;
    const p1x = bx + Math.cos(bAng) * br.length * 0.6;
    const p1y = by + Math.sin(bAng) * br.length * 0.6;
    const p2x = bx + Math.cos(bAng + 0.3) * br.length;
    const p2y = by + Math.sin(bAng + 0.3) * br.length;
    ctx.lineCap = LINE_CAP;
    for (let k = 0; k < brSegs; k++) {
      const t0 = k / brSegs, t1 = (k + 1) / brSegs;
      const fadeIn = smoothstep(clamp(t0 / 0.15, 0, 1));
      const fadeOut = smoothstep(clamp((1 - t0) / 0.15, 0, 1));
      const fade = fadeIn * fadeOut;
      const segAlpha = ba * fade;
      if (segAlpha < 0.001) continue;
      const ax0 = (1 - t0) * (1 - t0) * p0x + 2 * (1 - t0) * t0 * p1x + t0 * t0 * p2x;
      const ay0 = (1 - t0) * (1 - t0) * p0y + 2 * (1 - t0) * t0 * p1y + t0 * t0 * p2y;
      const ax1 = (1 - t1) * (1 - t1) * p0x + 2 * (1 - t1) * t1 * p1x + t1 * t1 * p2x;
      const ay1 = (1 - t1) * (1 - t1) * p0y + 2 * (1 - t1) * t1 * p1y + t1 * t1 * p2y;
      ctx.beginPath();
      ctx.moveTo(ax0, ay0);
      ctx.lineTo(ax1, ay1);
      ctx.strokeStyle = veinColor(p, segAlpha);
      ctx.lineWidth = br.thick * (0.3 + 0.7 * fade);
      ctx.stroke();
    }
  }
}


// ── GLANS ──

function drawGlans(ctx, geo, p, localLight) {
  const { positions, tangents, SL } = geo;
  const tipPos = positions[SL - 1];
  const tipTan = tangents[SL - 1];
  const tipAng = Math.atan2(tipTan[1], tipTan[0]);
  const tipW = shaftWidth(1, p);
  const glansParams = getGlansParams(p);
  const glansLen = glansParams.length;
  const glansW = glansParams.width;
  const hw = glansW / 2;
  const neck = tipW / 2;
  const neckW = Math.max(neck, stableNeckWidth(p) / 2);
  const overlap = lerp(28, 38, p);

  const sc = skinColor(p, 0);
  const gc = glansColor(p);
  const go = glansOutlineFn(p);

  ctx.save();
  ctx.translate(tipPos[0], tipPos[1]);
  ctx.rotate(tipAng);

  // Glans path
  function drawGlansPath() {
    const midW = (neckW + hw) / 2;
    const wideOverlap = overlap * 1.4;
    const neckNarrow = neckW * (glansParams.neckNarrow || 0.85);
    ctx.beginPath();
    ctx.moveTo(-wideOverlap, -neckW);
    // Smooth neck-to-corona transition
    ctx.bezierCurveTo(-wideOverlap * 0.7, -neckW, -wideOverlap * 0.45, -neckNarrow, -overlap * 0.25, -neckNarrow);
    // Corona ridge — gentle swell, not a sharp bump
    ctx.bezierCurveTo(-overlap * 0.08, -(neckNarrow + 1), glansLen * 0.02, -(midW + 1.5), glansLen * 0.08, -(hw + 0.8));
    // Dome curve — smooth elliptical profile
    ctx.bezierCurveTo(glansLen * 0.18, -hw * 1.0, glansLen * 0.38, -hw * 0.96, glansLen * 0.55, -hw * 0.82);
    ctx.bezierCurveTo(glansLen * 0.68, -hw * 0.58, glansLen * 0.80, -hw * 0.28, glansLen * 0.88, 0);
    ctx.bezierCurveTo(glansLen * 0.80, hw * 0.28, glansLen * 0.68, hw * 0.58, glansLen * 0.55, hw * 0.82);
    ctx.bezierCurveTo(glansLen * 0.38, hw * 0.96, glansLen * 0.18, hw * 1.0, glansLen * 0.08, hw + 0.8);
    ctx.bezierCurveTo(glansLen * 0.02, midW + 1.5, -overlap * 0.08, neckNarrow + 1, -overlap * 0.25, neckNarrow);
    ctx.bezierCurveTo(-wideOverlap * 0.45, neckNarrow, -wideOverlap * 0.7, neckW, -wideOverlap, neckW);
    ctx.closePath();
  }

  // Fill with gradient from skin to glans color
  const outerOverlap = overlap * 1.4;
  const glansGrad = ctx.createLinearGradient(-outerOverlap * 1.3, 0, glansLen * 0.5, 0);
  glansGrad.addColorStop(0, sc);
  glansGrad.addColorStop(0.30, sc);
  glansGrad.addColorStop(0.60, gc);
  glansGrad.addColorStop(1, gc);
  drawGlansPath();
  ctx.fillStyle = glansGrad;
  ctx.fill();

  // Clipped shading
  ctx.save();
  drawGlansPath();
  ctx.clip();

  // Corona SSS glow
  const coronaBlend = ctx.createRadialGradient(0, 0, 2, 0, 0, hw * 1.3);
  coronaBlend.addColorStop(0, sssColor(p, lerp(0.06, 0.12, p)));
  coronaBlend.addColorStop(0.5, sssColor(p, lerp(0.03, 0.06, p)));
  coronaBlend.addColorStop(1, sssColor(p, 0));
  ctx.fillStyle = coronaBlend;
  ctx.fillRect(-outerOverlap, -hw - 5, outerOverlap + glansLen + 10, glansW + 10);

  // Coronal groove shadow
  const grooveShade = ctx.createLinearGradient(-overlap * 0.3, 0, glansLen * 0.12, 0);
  grooveShade.addColorStop(0, `rgba(60,30,22,${lerp(0.12, 0.22, p)})`);
  grooveShade.addColorStop(0.5, `rgba(60,30,22,${lerp(0.05, 0.10, p)})`);
  grooveShade.addColorStop(1, 'rgba(60,30,22,0)');
  ctx.fillStyle = grooveShade;
  ctx.fillRect(-overlap * 0.3, -hw - 5, overlap * 0.3 + glansLen * 0.12 + 5, glansW + 10);

  // Light-aware glans shading
  const glCos = Math.cos(-tipAng), glSin = Math.sin(-tipAng);
  const glLx = localLight.x * glCos - localLight.y * glSin;
  const glLy = localLight.x * glSin + localLight.y * glCos;

  // Lower shadow
  const shadowY = -glLy * hw * 0.4;
  ctx.beginPath();
  ctx.ellipse(glansLen * 0.4, shadowY + hw * 0.15, glansLen * 0.55, hw * 0.7, 0.08, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(50,25,20,0.11)';
  ctx.fill();

  // Highlight
  const hlY = glLy * hw * 0.3;
  const glGlow = ctx.createRadialGradient(glansLen * 0.35, hlY, 2, glansLen * 0.4, hlY * 0.5, hw * 0.8);
  glGlow.addColorStop(0, `rgba(225,180,160,${lerp(0.10, 0.18, p)})`);
  glGlow.addColorStop(1, 'rgba(225,180,160,0)');
  ctx.fillStyle = glGlow;
  ctx.fillRect(-5, -hw - 5, glansLen + 10, glansW + 10);

  // Specular highlight
  ctx.beginPath();
  ctx.ellipse(glansLen * 0.4, hlY - hw * 0.1, glansLen * 0.18, hw * 0.3, -0.1, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,245,235,${lerp(0.08, 0.15, p)})`;
  ctx.fill();

  // Small bright dot
  ctx.beginPath();
  ctx.ellipse(glansLen * 0.35, hlY - hw * 0.2, 8, 5, -0.15, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,252,245,${lerp(0.10, 0.20, p)})`;
  ctx.fill();

  // Corona shadow gradient
  const coronaShade = ctx.createLinearGradient(0, 0, glansLen * 0.25, 0);
  coronaShade.addColorStop(0, 'rgba(80,40,30,0.11)');
  coronaShade.addColorStop(1, 'rgba(80,40,30,0)');
  ctx.fillStyle = coronaShade;
  ctx.fillRect(-5, -hw - 5, glansLen + 10, glansW + 10);

  ctx.restore(); // clip

  // Coronal ridge lines
  ctx.beginPath();
  ctx.moveTo(glansLen * 0.03, neck * 0.5);
  ctx.bezierCurveTo(glansLen * 0.08, hw * 0.6, glansLen * 0.14, hw * 0.52, glansLen * 0.22, hw * 0.42);
  const ridgeR = Math.round(lerp(140, 130, p)), ridgeG = Math.round(lerp(90, 70, p)), ridgeB = Math.round(lerp(75, 58, p));
  ctx.strokeStyle = `rgba(${ridgeR},${ridgeG},${ridgeB},0.30)`;
  ctx.lineWidth = glansParams.ridgeWidth || 1.0;
  ctx.lineCap = LINE_CAP;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(glansLen * 0.03, -neck * 0.5);
  ctx.bezierCurveTo(glansLen * 0.08, -hw * 0.6, glansLen * 0.14, -hw * 0.52, glansLen * 0.22, -hw * 0.42);
  ctx.strokeStyle = `rgba(${ridgeR},${ridgeG},${ridgeB},0.20)`;
  ctx.lineWidth = (glansParams.ridgeWidth || 1.0) * 0.8;
  ctx.stroke();

  // Meatus
  ctx.beginPath();
  ctx.moveTo(glansLen * 0.68, -3.5);
  ctx.quadraticCurveTo(glansLen * 0.82, 0, glansLen * 0.68, 3.5);
  ctx.strokeStyle = go;
  ctx.lineWidth = 2.2;
  ctx.lineCap = LINE_CAP;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(glansLen * 0.66, -2.5);
  ctx.quadraticCurveTo(glansLen * 0.76, 0, glansLen * 0.66, 2.5);
  ctx.strokeStyle = 'rgba(60,30,25,0.24)';
  ctx.lineWidth = 1.3;
  ctx.lineCap = LINE_CAP;
  ctx.stroke();

  ctx.restore(); // translate/rotate
}


// ── BALLS ──
// Ball volume shading, AO, raphe, pores, hairs, veins.
// Drawn inside a scrotum-only clip (everything minus shaft).

function drawBalls(ctx, geo, balls, p, localLight) {
  const { leftO, rightO } = geo;
  const { lx, ly, rx, ry, sxL, syL, sxR, syR } = balls;

  const scMidX = (lx + rx) / 2;
  const scrBot = Math.max(ly, ry) + Math.max(syL, syR) * lerp(0.65, 0.60, p);

  // Junction AO — where shaft meets scrotum
  drawJunctionShading(ctx, geo, balls, p);

  // Ball volume shading (light-aware)
  for (const [bx, by, bsx, bsy, sign] of [[lx, ly, sxL, syL, -1], [rx, ry, sxR, syR, 1]]) {
    // Shadow gradient
    const hlX = bx + localLight.x * bsx * 0.25;
    const hlY = by + localLight.y * bsy * 0.25;
    const gB = ctx.createRadialGradient(hlX, hlY, bsy * 0.1, bx, by, bsy * 1.08);
    gB.addColorStop(0, 'rgba(55,30,18,0)');
    gB.addColorStop(0.5, 'rgba(55,30,18,0.06)');
    gB.addColorStop(1, 'rgba(55,30,18,0.18)');
    ctx.beginPath();
    ctx.ellipse(bx, by, bsx * 1.08, bsy * 1.08, sign * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = gB;
    ctx.fill();

    // Highlight
    const hlR = Math.min(bsx * 0.25, bsy * 0.2);
    const hlGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, hlR);
    hlGrad.addColorStop(0, `rgba(255,240,225,${lerp(0.10, 0.16, p)})`);
    hlGrad.addColorStop(0.3, 'rgba(255,240,225,0.05)');
    hlGrad.addColorStop(1, 'rgba(255,240,225,0)');
    ctx.beginPath();
    ctx.ellipse(hlX, hlY, bsx * 0.3, bsy * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = hlGrad;
    ctx.fill();

    // Specular dot
    const specGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, 3.5);
    specGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
    specGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(hlX, hlY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = specGrad;
    ctx.fill();

    // Contour arc
    const arcStart = 0.15, arcEnd = Math.PI - 0.15, arcSegs = 12;
    for (let seg = 0; seg < arcSegs; seg++) {
      const t0 = seg / arcSegs, t1 = (seg + 1) / arcSegs;
      const a0 = arcStart + (arcEnd - arcStart) * t0;
      const a1 = arcStart + (arcEnd - arcStart) * t1;
      const edgeFade = Math.min(t0 / 0.15, (1 - t1) / 0.15, 1);
      ctx.beginPath();
      ctx.ellipse(bx, by + bsy * 0.1, bsx * 0.9, bsy * 0.85, sign * 0.1, a0, a1);
      ctx.strokeStyle = `rgba(60,30,15,${0.10 * edgeFade})`;
      ctx.lineWidth = 1.2;
      ctx.lineCap = LINE_CAP;
      ctx.stroke();
    }
  }

  // Midline raphe — wide soft shadow
  const rapheTop = Math.min(ly, ry) - Math.min(syL, syR) * 0.15;
  ctx.beginPath();
  ctx.moveTo(scMidX, rapheTop + 4);
  ctx.bezierCurveTo(scMidX - 1, ly + 6, scMidX + 1, ry + 6, scMidX, scrBot - 10);
  ctx.strokeStyle = aoColor(0.12);
  ctx.lineWidth = lerp(12, 8, p);
  ctx.lineCap = LINE_CAP;
  ctx.stroke();

  // Midline raphe — fine line
  ctx.beginPath();
  ctx.moveTo(scMidX, rapheTop);
  ctx.bezierCurveTo(scMidX - 2, (rapheTop + scrBot) * 0.45, scMidX + 2, (rapheTop + scrBot) * 0.55, scMidX, scrBot - 6);
  ctx.strokeStyle = aoColor(0.32);
  ctx.lineWidth = lerp(5, 3.5, p);
  ctx.lineCap = LINE_CAP;
  ctx.stroke();

  // Ball pores
  ctx.globalAlpha = 0.025;
  ctx.fillStyle = 'rgb(80,50,35)';
  for (const pore of ballPores) {
    const bx = pore.ball === 0 ? lx : rx;
    const by = pore.ball === 0 ? ly : ry;
    const bsx = pore.ball === 0 ? sxL : sxR;
    const bsy = pore.ball === 0 ? syL : syR;
    const dx = bx + Math.cos(pore.ang) * bsx * pore.dist;
    const dy = by + Math.sin(pore.ang) * bsy * pore.dist;
    ctx.beginPath();
    ctx.arc(dx, dy, pore.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Ball wrinkle texture — fine lines that fade with erection
  const wrinkleAlpha = lerp(0.06, 0.02, smoothstep(p));
  if (wrinkleAlpha > 0.005) {
    ctx.strokeStyle = `rgba(90,50,30,${wrinkleAlpha})`;
    ctx.lineWidth = 0.5;
    ctx.lineCap = LINE_CAP;
    for (const [bx, by, bsx, bsy, sign] of [[lx, ly, sxL, syL, -1], [rx, ry, sxR, syR, 1]]) {
      for (let w = 0; w < 6; w++) {
        const wAng = Math.PI * 0.15 + w * 0.42 + rng() * 0.12;
        const wR = bsx * (0.35 + rng() * 0.35);
        const cx = bx + Math.cos(wAng) * wR * 0.2;
        const cy = by + Math.sin(wAng) * wR * 0.4;
        const len = 5 + rng() * 10;
        const angle = wAng + Math.PI * 0.4 + rng() * 0.4;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(angle) * len * 0.5, cy - Math.sin(angle) * len * 0.5);
        ctx.quadraticCurveTo(
          cx + (rng() - 0.5) * 3, cy + (rng() - 0.5) * 2,
          cx + Math.cos(angle) * len * 0.5, cy + Math.sin(angle) * len * 0.5
        );
        ctx.stroke();
      }
    }
  }

  // Ball veins
  if (p > 0.2) {
    const ballVeinAlpha = smoothstep(clamp((p - 0.2) / 0.4, 0, 1)) * lerp(0.12, 0.35, p);
    const ballVeinW = lerp(0.8, 2.0, p) * (1 + getHeartbeat() * 0.3);

    function drawVeinWithFade(points, width, alpha) {
      if (points.length < 2) return;
      const segs = points.length - 1;
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const fadeIn = smoothstep(clamp(t / 0.3, 0, 1));
        const fadeOut = smoothstep(clamp((1 - t) / 0.3, 0, 1));
        const segAlpha = alpha * fadeIn * fadeOut;
        ctx.beginPath();
        ctx.moveTo(points[i][0], points[i][1]);
        ctx.lineTo(points[i + 1][0], points[i + 1][1]);
        ctx.strokeStyle = veinColor(p, segAlpha);
        ctx.lineWidth = width * (0.6 + fadeIn * 0.4);
        ctx.lineCap = LINE_CAP;
        ctx.stroke();
      }
    }

    // Left ball vein
    const leftVeinPts = [];
    for (let t = 0; t <= 1; t += 0.1) {
      const cx = lerp(leftO[0][0] + 3, lx - sxL * 0.4, t);
      const cy = lerp(leftO[0][1] + 4, ly + syL * 0.15, t);
      const curve = Math.sin(t * Math.PI) * sxL * 0.15;
      leftVeinPts.push([cx - curve, cy]);
    }
    drawVeinWithFade(leftVeinPts, ballVeinW, ballVeinAlpha);

    // Right ball vein
    const rightVeinPts = [];
    for (let t = 0; t <= 1; t += 0.1) {
      const cx = lerp(rightO[0][0] - 3, rx + sxR * 0.4, t);
      const cy = lerp(rightO[0][1] + 4, ry + syR * 0.15, t);
      const curve = Math.sin(t * Math.PI) * sxR * 0.15;
      rightVeinPts.push([cx + curve, cy]);
    }
    drawVeinWithFade(rightVeinPts, ballVeinW * 0.93, ballVeinAlpha);
  }
}


// ── SCROTUM OUTLINE (drawn behind shaft via inverse clip) ──

function drawScrotumOutline(ctx, geo, balls, p) {
  const oc = outlineColor(p);
  const outlineWidth = lerp(3.0, 2.4, p);

  // Trace the scrotum arc as a stroke (open path)
  ctx.beginPath();
  ctx.moveTo(geo.rightO[0][0], geo.rightO[0][1]);
  traceScrotumArc(ctx, geo, balls, p);

  ctx.strokeStyle = oc;
  ctx.lineWidth = outlineWidth;
  ctx.lineCap = LINE_CAP;
  ctx.lineJoin = LINE_JOIN;
  ctx.stroke();

  // Inner rim light for scrotum
  if (p > 0.05) {
    ctx.save();
    ctx.beginPath();
    buildFullBodyPath(ctx, geo, balls, p);
    patchShaftSubPaths(ctx, geo);
    ctx.clip('nonzero');

    ctx.beginPath();
    ctx.moveTo(geo.rightO[0][0], geo.rightO[0][1]);
    traceScrotumArc(ctx, geo, balls, p);

    ctx.strokeStyle = `rgba(255,242,228,${lerp(0.03, 0.09, p)})`;
    ctx.lineWidth = outlineWidth + 3;
    ctx.lineCap = LINE_CAP;
    ctx.lineJoin = LINE_JOIN;
    ctx.stroke();
    ctx.restore();
  }
}


// ── SHAFT + GLANS OUTLINE (drawn on top of everything) ──

function drawShaftOutline(ctx, geo, balls, p) {
  const oc = outlineColor(p);
  const outlineWidth = lerp(3.0, 2.4, p);
  const { leftO, rightO, SL } = geo;

  // Open path: shaft left → glans → shaft right (no bottom closing)
  ctx.beginPath();
  ctx.moveTo(leftO[0][0], leftO[0][1]);
  for (let i = 1; i < SL; i++) ctx.lineTo(leftO[i][0], leftO[i][1]);
  traceGlansOutline(ctx, geo, p);
  for (let i = SL - 2; i >= 0; i--) ctx.lineTo(rightO[i][0], rightO[i][1]);

  ctx.strokeStyle = oc;
  ctx.lineWidth = outlineWidth;
  ctx.lineCap = LINE_CAP;
  ctx.lineJoin = LINE_JOIN;
  ctx.stroke();

  // Inner rim light for shaft
  if (p > 0.05) {
    ctx.save();
    ctx.beginPath();
    buildFullBodyPath(ctx, geo, balls, p);
    patchShaftSubPaths(ctx, geo);
    ctx.clip('nonzero');

    ctx.beginPath();
    ctx.moveTo(leftO[0][0], leftO[0][1]);
    for (let i = 1; i < SL; i++) ctx.lineTo(leftO[i][0], leftO[i][1]);
    traceGlansOutline(ctx, geo, p);
    for (let i = SL - 2; i >= 0; i--) ctx.lineTo(rightO[i][0], rightO[i][1]);

    ctx.strokeStyle = `rgba(255,242,228,${lerp(0.03, 0.09, p)})`;
    ctx.lineWidth = outlineWidth + 3;
    ctx.lineCap = LINE_CAP;
    ctx.lineJoin = LINE_JOIN;
    ctx.stroke();
    ctx.restore();
  }
}


// ── HEARTBEAT PULSE ──

function drawHeartbeatPulse(ctx, geo) {
  const hb = getHeartbeat();
  if (hb < 0.01) return;
  const { leftO, rightO, SL } = geo;
  ctx.beginPath();
  ctx.moveTo(leftO[0][0], leftO[0][1]);
  for (let i = 1; i < SL; i++) ctx.lineTo(leftO[i][0], leftO[i][1]);
  for (let i = SL - 1; i >= 0; i--) ctx.lineTo(rightO[i][0], rightO[i][1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(160,45,35,${hb * 0.05})`;
  ctx.fill();
}


// ── TRANSITION FLASH ──

function drawTransitionFlash(ctx, geo) {
  if (S.transitionFlash < 0.01) return;
  const { leftO, rightO, SL } = geo;
  ctx.beginPath();
  traceShaftPath(ctx, leftO, rightO, SL);
  ctx.fillStyle = `rgba(220,180,160,${S.transitionFlash * 0.15})`;
  ctx.fill();
}


// ── PARTICLES ──

function drawParticles(ctx, geo, p) {
  const { positions, tangents, widths, SL } = geo;

  for (const part of particles) {
    if (part.life <= 0) continue;
    const lifeRatio = part.life / part.maxLife;

    if (part.type === 'sweat') {
      ctx.globalAlpha = lifeRatio * 0.5;
      ctx.beginPath();
      ctx.arc(part.x, part.y, part.size, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(part.x - part.size * 0.3, part.y - part.size * 0.3, part.size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    } else if (part.type === 'throb') {
      ctx.globalAlpha = lifeRatio * 0.2;
      const throbT = 1 - lifeRatio;
      const si = Math.floor(throbT * (SL - 1));
      if (si < SL) {
        const [px, py] = positions[Math.min(si, SL - 1)];
        const [tx, ty] = tangents[Math.min(si, SL - 1)];
        const nx = -ty, ny = tx;
        const w = widths[Math.min(si, SL - 1)];
        ctx.beginPath();
        ctx.moveTo(px + nx * w * 1.1, py + ny * w * 1.1);
        ctx.lineTo(px - nx * w * 1.1, py - ny * w * 1.1);
        ctx.strokeStyle = 'rgba(200,80,60,0.3)';
        ctx.lineWidth = 3 * lifeRatio;
        ctx.lineCap = LINE_CAP;
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}


// ── HEAT SHIMMER ──

function drawHeatShimmer(ctx, geo, p) {
  if (p < 0.85) return;
  const { positions, tangents, SL } = geo;
  const shimmerStr = smoothstep((p - 0.85) / 0.15) * 0.04;
  const tipPos = positions[SL - 1];
  const tipTan = tangents[SL - 1];
  const glansLen = getGlansParams(p).length;
  const tipX = tipPos[0] + tipTan[0] * glansLen * 0.9;
  const tipY = tipPos[1] + tipTan[1] * glansLen * 0.9;
  for (let i = 0; i < 5; i++) {
    const t = performance.now() * 0.003 + i * 1.3;
    const ox = Math.sin(t * 2.1 + i) * 4;
    const oy = Math.cos(t * 1.7 + i * 0.5) * 3 - i * 4;
    ctx.beginPath();
    ctx.arc(tipX + ox, tipY + oy, 3 + i * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,180,${shimmerStr * (1 - i * 0.15)})`;
    ctx.fill();
  }
}


// ── MOTION BLUR ──

function drawMotionBlur(ctx, geo, p) {
  if (Math.abs(S.scrollVelocity) < 0.005) return;
  const { positions, tangents, SL } = geo;
  const sc = skinColor(p, 0);
  const blurStr = Math.min(Math.abs(S.scrollVelocity) * 8, 0.3);
  ctx.globalAlpha = blurStr;
  ctx.beginPath();
  for (let i = 0; i < SL; i++) {
    const [px, py] = positions[i];
    const [tx, ty] = tangents[i];
    const trailX = px - tx * S.scrollVelocity * 300;
    const trailY = py - ty * S.scrollVelocity * 300;
    if (i === 0) ctx.moveTo(trailX, trailY);
    else ctx.lineTo(trailX, trailY);
  }
  ctx.strokeStyle = sc;
  ctx.lineWidth = 8;
  ctx.lineCap = LINE_CAP;
  ctx.stroke();
  ctx.globalAlpha = 1;
}


// ── BALL HAIRS (drawn ON TOP of outline so they don't get clipped) ──

function drawBallHairs(ctx, geo, balls, p) {
  const { leftO, rightO } = geo;
  const { lx, ly, rx, ry, sxL, syL, sxR, syR } = balls;

  for (const h of ballHairs) {
    const bx = h.side === 'L' ? lx : rx;
    const by = h.side === 'L' ? ly : ry;
    const bsx = h.side === 'L' ? sxL : sxR;
    const bsy = h.side === 'L' ? syL : syR;
    const rot = h.side === 'L' ? -0.1 : 0.1;
    const a = h.posAngle + rot;
    const hx = bx + Math.cos(a) * bsx * h.posDist;
    const hy = by + Math.sin(a) * bsy * h.posDist;
    const outAngle = a + (h.side === 'L' ? -0.3 : 0.3);

    const angle = outAngle + h.angle - Math.PI * 0.3;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    const c1x = hx + Math.cos(angle + h.curl * 0.3) * h.length * 0.4;
    const c1y = hy + Math.sin(angle + h.curl * 0.3) * h.length * 0.4;
    const c2x = hx + Math.cos(angle + h.curl * 0.7 + h.curl2 * 0.3) * h.length * 0.7;
    const c2y = hy + Math.sin(angle + h.curl * 0.7 + h.curl2 * 0.3) * h.length * 0.7;
    const ex = hx + Math.cos(angle + h.curl + h.curl2 * 0.5) * h.length;
    const ey = hy + Math.sin(angle + h.curl + h.curl2 * 0.5) * h.length;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
    ctx.strokeStyle = hairColor(h.alpha);
    ctx.lineWidth = h.thick;
    ctx.lineCap = LINE_CAP;
    ctx.stroke();
  }
}


// ══════════════════════════════════════════════════════════════
//  MAIN DRAW
//
//  Layer order:
//  0. Background (world space)
//  1. Drop shadow (world space)
//  2. [tumble rotation applied]
//  3. Body fill (ONE unified path — shaft + scrotum)
//  4. Body clip {
//       Volume gradient
//       Scrotum-only clip { Ball details }
//       Shaft shading (shaft-only clip, internal)
//       Veins
//       Glans
//       Heartbeat, transition
//     }
//  5. Pubic hair (base detail)
//  6. Scrotum outline (inverse shaft clip — behind shaft)
//  7. Shaft + glans outline (on top)
//  8. Particles, shimmer, motion blur
//  9. [end tumble rotation]
// ══════════════════════════════════════════════════════════════

export function draw(ctx, canvas) {
  const p = S.progress;
  const tumbleAngle = S.tumbleAngle || 0;
  const pivotX = S.tumblePivotX || S.BASE_X;
  const pivotY = S.tumblePivotY || (S.BASE_Y + 60);

  // Build geometry in local (un-rotated) space
  const geo = buildLocalGeometry(p);
  const balls = getBallPositions(p);
  const localLight = getLocalLightDir(tumbleAngle);

  // ── Layer 0: Background ──
  drawBackground(ctx);

  // ── Layer 1: Drop shadow (world space, before rotation) ──
  drawDropShadow(ctx, geo, balls, p, tumbleAngle);

  // ── Apply tumble rotation ──
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(tumbleAngle);
  ctx.translate(-pivotX, -pivotY);

  // ── Layer 3: Body fill — ONE unified path, ONE fill ──
  drawBodyFill(ctx, geo, balls, p);

  // ── Layer 4: Clipped body details ──
  ctx.save();
  ctx.beginPath();
  buildFullBodyPath(ctx, geo, balls, p);
  patchShaftSubPaths(ctx, geo);
  ctx.clip('nonzero');

  // Volume gradient (entire body)
  drawVolumeGradient(ctx, geo, balls, p, localLight);

  // Ball details — scrotum-only clip (everything MINUS shaft)
  // This ensures ball shading/pores/hairs don't bleed onto the shaft.
  // The junction zone shows only the unified skin fill — seamless.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-S.BASE_W, -S.BASE_H, S.BASE_W * 4, S.BASE_H * 4);
  traceShaftPath(ctx, geo.leftO, geo.rightO, geo.SL);
  ctx.clip('evenodd');
  drawBalls(ctx, geo, balls, p, localLight);
  ctx.restore();

  // Shaft details (drawShaftShading clips to shaft internally)
  drawShaftShading(ctx, geo, p, localLight);
  drawVeins(ctx, geo, p);
  drawGlans(ctx, geo, p, localLight);

  // Effects
  drawHeartbeatPulse(ctx, geo);
  drawTransitionFlash(ctx, geo);

  ctx.restore(); // body clip

  // ── Layer 5: Scrotum outline (behind shaft via inverse clip) ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(-S.BASE_W, -S.BASE_H, S.BASE_W * 4, S.BASE_H * 4);
  traceShaftPath(ctx, geo.leftO, geo.rightO, geo.SL);
  ctx.clip('evenodd');
  drawScrotumOutline(ctx, geo, balls, p);
  ctx.restore();

  // ── Layer 6: Ball hairs (on top of scrotum outline, behind shaft) ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(-S.BASE_W, -S.BASE_H, S.BASE_W * 4, S.BASE_H * 4);
  traceShaftPath(ctx, geo.leftO, geo.rightO, geo.SL);
  ctx.clip('evenodd');
  drawBallHairs(ctx, geo, balls, p);
  ctx.restore();

  // ── Layer 7: Shaft + glans outline (on top) ──
  drawShaftOutline(ctx, geo, balls, p);

  // ── Layer 8: Particles + effects ──
  drawParticles(ctx, geo, p);
  drawHeatShimmer(ctx, geo, p);
  drawMotionBlur(ctx, geo, p);

  // ── End tumble rotation ──
  ctx.restore();
}
