// ══════════════════════════════════════════════════════════════
//  ERECTION STAGE ENGINE v1.0.0
//  Controls physical parameters per erection stage,
//  shaft dimensions, and rotation-aware shape computation.
// ══════════════════════════════════════════════════════════════
import { lerp, clamp, smoothstep } from './helpers.js';
import * as S from './state.js';

// ══════════════════════════════════════════
//  STAGE THRESHOLDS (hysteresis for stability)
// ══════════════════════════════════════════
const upThresholds = [0.15, 0.40, 0.75];
const downThresholds = [0.12, 0.36, 0.71];

export function getStage(p) {
  if (p < (S.stage > 0 ? downThresholds[0] : upThresholds[0])) return 0;
  if (p < (S.stage > 1 ? downThresholds[1] : upThresholds[1])) return 1;
  if (p < (S.stage > 2 ? downThresholds[2] : upThresholds[2])) return 2;
  return 3;
}

export function getStageParams(s, p) {
  switch (s) {
    case 0: return { gravMul: 1.0, stiffness: 0.0, damping: 0.965, wobble: 1.0, friction: 0.975 };
    case 1: return { gravMul: lerp(0.9, 0.5, (p - 0.15) / 0.25), stiffness: lerp(0.0, 0.3, (p - 0.15) / 0.25), damping: 0.94, wobble: 0.7, friction: 0.95 };
    case 2: return { gravMul: lerp(0.5, 0.1, (p - 0.40) / 0.35), stiffness: lerp(0.3, 0.8, (p - 0.40) / 0.35), damping: 0.88, wobble: 0.3, friction: 0.90 };
    case 3: return { gravMul: 0.02, stiffness: lerp(0.8, 1.0, (p - 0.75) / 0.25), damping: 0.82, wobble: 0.08, friction: 0.85 };
  }
}


// ══════════════════════════════════════════
//  HEARTBEAT / THROB
// ══════════════════════════════════════════
export function getHeartbeat() {
  if (S.progress < 0.70) return 0;
  const raw = Math.sin(S.heartbeatPhase * Math.PI * 2);
  const beat = Math.pow(Math.max(0, raw), 16);
  const fadeIn = smoothstep((S.progress - 0.70) / 0.30);
  return beat * fadeIn * 0.6;
}

export function getThrobWave() {
  if (S.progress < 0.75) return -1;
  const cycle = (S.heartbeatPhase % 1);
  const wave = cycle * 2.5 - 0.3;
  return clamp(wave, -0.1, 1.1);
}


// ══════════════════════════════════════════
//  SHAFT DIMENSIONS — ANATOMY-CORRECT PROPORTIONS
// ══════════════════════════════════════════

// The neck width where shaft meets glans — smooth coronal transition
export function stableNeckWidth(p) {
  const tipW = lerp(26, 34, p);
  const engorgement = smoothstep(clamp(p * 1.6 - 0.6, 0, 1));
  return lerp(24, tipW, engorgement);
}

// Shaft width at parametric position t (0=base, 1=tip).
// FIX: Proper taper profile with natural asymmetry.
// - Base is widest (with flare where it meets the balls)
// - Middle is slightly narrower
// - Tip widens again to meet the glans coronal ridge
// - Natural slight S-curve asymmetry built into left/right offset
export function shaftWidth(t, p) {
  const baseW = lerp(32, 42, p);
  const midW = lerp(28, 38, p);     // slightly narrower mid-shaft
  const tipW = lerp(28, 36, p);     // wider tip for proper glans ratio

  // Natural taper profile: wide base -> narrower mid -> wider tip
  // Uses a smooth cubic for natural shape
  let w;
  if (t < 0.3) {
    // Base to mid: taper down
    const localT = t / 0.3;
    w = lerp(baseW, midW, smoothstep(localT));
  } else if (t < 0.7) {
    // Mid section: fairly constant with slight taper
    const localT = (t - 0.3) / 0.4;
    w = lerp(midW, midW * 0.97, localT);
  } else if (t < 0.9) {
    // Mid to pre-neck: widen toward tip
    const localT = (t - 0.7) / 0.2;
    w = lerp(midW * 0.97, tipW, smoothstep(localT));
  } else {
    // Neck dip: narrow slightly before glans to create coronal groove
    const localT = (t - 0.9) / 0.1;
    const neckDip = lerp(0.0, lerp(0.08, 0.12, p), smoothstep(localT));
    w = tipW * (1.0 - neckDip);
  }

  // Engorgement swelling — more pronounced in middle sections
  const engorgement = smoothstep(clamp(p * 1.6 - t * 0.6, 0, 1));

  // Base flare (funnel shape where shaft meets balls)
  // FIX: Proper trechtervorming (funnel) transition to balls
  const baseFlare = Math.pow(Math.max(0, 1 - t * 3.0), 2.5) * lerp(10, 16, p);

  // Heartbeat throb wave
  const hb = getHeartbeat();
  const throbPos = getThrobWave();
  const waveDist = Math.abs(t - throbPos);
  const waveStr = waveDist < 0.12 ? (1 - waveDist / 0.12) * 0.8 : 0;
  const throb = (hb * 0.6 + waveStr) * (0.6 + t * 0.4);

  // Stage 1 oscillation
  const stage1Blend = smoothstep(clamp((p - 0.15) / 0.05, 0, 1))
    * (1 - smoothstep(clamp((p - 0.38) / 0.05, 0, 1)));
  const stageOsc = stage1Blend * Math.sin(S.stageTime * 1.5) * 0.4;

  return Math.max(16, lerp(24, w, engorgement) + baseFlare + throb + stageOsc);
}

// Get the natural asymmetry offset for left vs right side.
// The left side has a slightly stronger curve than the right (natural anatomy).
// Returns an offset to add to the normal position.
export function getAsymmetryOffset(t, p, side) {
  // side: -1 = left, +1 = right
  // Natural S-curve: slight bend to one side
  const sCurve = Math.sin(t * Math.PI) * lerp(1.5, 0.8, p);
  // Left side gets more curvature than right
  const asymmetry = side < 0 ? 1.15 : 0.85;
  return sCurve * asymmetry;
}


// ══════════════════════════════════════════
//  GLANS DIMENSIONS — PROPER PROPORTIONS
// ══════════════════════════════════════════

// FIX: Glans is now proportionally correct relative to shaft.
// The glans should be ~1.2-1.35x the tip shaft diameter,
// with a smooth volume transition at the coronal ridge.
export function getGlansParams(p) {
  const sinR = Math.abs(Math.sin(S.tumbleAngle || 0));
  const frontalFactor = smoothstep(sinR);

  const baseWidth = shaftWidth(1, p);
  // FIX: Glans width is proportional to shaft tip — ratio corrected
  const bulletLen = lerp(28, 38, p);
  const bulletW = baseWidth * lerp(1.35, 1.55, p);  // glans head noticeably wider than shaft
  const circleRadius = baseWidth * 0.55;             // slightly larger for frontal view

  return {
    frontal: frontalFactor,
    length: lerp(bulletLen, circleRadius * 0.4, frontalFactor),
    width: lerp(bulletW, baseWidth, frontalFactor),
    circleRadius: circleRadius,
    highlightSize: lerp(0.18, 0.35, frontalFactor),
    // Coronal ridge parameters for smooth transition
    ridgeWidth: lerp(1.5, 2.5, p),       // thickness of the ridge line
    ridgeDepth: lerp(0.06, 0.12, p),      // how deep the groove is
    neckNarrow: lerp(0.88, 0.82, p)       // neck narrows slightly below glans
  };
}


// ══════════════════════════════════════════
//  ROTATION-AWARE DIMENSIONS
// ══════════════════════════════════════════

// Apparent shaft length multiplier based on tumble angle
export function getApparentShaftLength() {
  const cosR = Math.cos(S.tumbleAngle || 0);
  const absCos = Math.abs(cosR);
  return lerp(0.15, 1.0, absCos);
}

// Ball scale factors based on tumble angle
export function getBallScale() {
  const sinR = Math.abs(Math.sin(S.tumbleAngle || 0));
  return {
    vScale: lerp(1.0, 0.7, sinR),
    hScale: lerp(1.0, 0.85, sinR),
    gap: lerp(1.0, 0.6, sinR)
  };
}

// Shaft width adjusted for foreshortening during tumble
export function shaftWidthForeshortened(t, p) {
  const baseWidth = shaftWidth(t, p);
  const sinR = Math.abs(Math.sin(S.tumbleAngle || 0));
  const wideningFactor = 1.0 + sinR * 0.3;
  return baseWidth * wideningFactor;
}

// Venus line / raphe — smooth fade at both ends (no abrupt stop)
export function getVenusLineParams(t, p) {
  const lineStart = 0.15;
  const lineEnd = 0.62;
  if (t < lineStart || t > lineEnd) return { visible: false, opacity: 0 };

  const fadeIn = smoothstep(clamp((t - lineStart) / 0.08, 0, 1));
  const fadeOut = 1.0 - smoothstep(clamp((t - (lineEnd - 0.1)) / 0.1, 0, 1));
  const opacity = fadeIn * fadeOut * lerp(0.08, 0.15, p);

  return { visible: opacity > 0.005, opacity };
}

// Vertical offset for the whole character during tumble
export function getTumbleVerticalOffset() {
  const cosR = Math.cos(S.tumbleAngle || 0);
  return cosR < 0 ? -cosR * 40 : 0;
}

// Get gravity drape factor for inverted state.
// When inverted, the shaft should droop and widen at its hanging end.
export function getGravityDrape() {
  const cosR = Math.cos(S.tumbleAngle || 0);
  if (cosR >= 0) return { widthMul: 1.0, droopAngle: 0, baseWiden: 1.0 };

  const invertAmount = Math.abs(cosR);
  return {
    widthMul: 1.0 + invertAmount * 0.15,      // shaft widens slightly when hanging
    droopAngle: invertAmount * 0.3,             // tip droops due to gravity
    baseWiden: 1.0 + invertAmount * 0.2         // base (now at top) spreads
  };
}

// Get connection geometry parameters for shaft-to-ball junction.
// FIX: Ensures visible funnel transition in ALL orientations.
export function getConnectionGeometry(p) {
  const cosR = Math.cos(S.tumbleAngle || 0);
  const inverted = cosR < 0;
  const invertAmount = inverted ? Math.abs(cosR) : 0;

  return {
    // Funnel flare radius (how wide the transition zone is)
    flareRadius: lerp(12, 18, p) * (1 + invertAmount * 0.3),
    // How many spine segments the transition covers
    transitionLength: lerp(3, 5, p),
    // Bezier tension for smooth curvature
    tension: lerp(0.3, 0.5, p),
    // When inverted, the gap must be explicitly bridged
    bridgeGap: inverted,
    // Extra overlap to prevent visual separation
    overlapExtra: invertAmount * 8
  };
}
