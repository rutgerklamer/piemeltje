// ══════════════════════════════════════════════════════════════
//  TUMBLE / ROTATION ENGINE v1.0.0
//  Manages 360 degree forward rotation (tumble) around the X-axis.
//  Includes volume-preserving deformation, gravity-aware draping,
//  and proper ball/glans transformation during twist.
// ══════════════════════════════════════════════════════════════
import { lerp, clamp, smoothstep } from './helpers.js';
import * as S from './state.js';


// ══════════════════════════════════════════
//  TUMBLE CONTROL
// ══════════════════════════════════════════

// Start a new tumble animation (one full 360 degree rotation forward)
export function startTumble() {
  if (S.tumbleActive) return;
  S.setTumbleActive(true);
  S.setTumbleTargetAngle(S.tumbleAngle + Math.PI * 2);
  S.setTumbleVelocity(0.02);
  S.setTumbleEase(0);
  S.setTumbleCount(S.tumbleCount + 1);
}

// Start a partial tumble to a specific angle
export function tumbleTo(targetAngle) {
  S.setTumbleActive(true);
  S.setTumbleTargetAngle(targetAngle);
  S.setTumbleVelocity(0);
  S.setTumbleEase(0);
}

// Emergency stop the tumble
export function stopTumble() {
  S.setTumbleActive(false);
  S.setTumbleVelocity(0);
  const normalized = S.tumbleAngle % (Math.PI * 2);
  const snaps = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2];
  let closest = 0, minDist = Infinity;
  for (const snap of snaps) {
    const d = Math.abs(normalized - snap);
    if (d < minDist) { minDist = d; closest = snap; }
  }
  S.setTumbleAngle(S.tumbleAngle - normalized + closest);
  S.setTumbleTargetAngle(S.tumbleAngle);
}


// ══════════════════════════════════════════
//  TUMBLE PHYSICS UPDATE (call each frame)
// ══════════════════════════════════════════
export function updateTumble() {
  if (!S.tumbleActive) {
    if (Math.abs(S.tumbleAngle % (Math.PI * 2)) > 0.01) {
      const remainder = S.tumbleAngle % (Math.PI * 2);
      if (Math.abs(remainder) < 0.05) {
        S.setTumbleAngle(S.tumbleAngle - remainder);
      }
    }
    return;
  }

  // Ease-in factor
  S.setTumbleEase(Math.min(1, S.tumbleEase + 0.05));
  const easeFactor = smoothstep(S.tumbleEase);

  // Spring-based angular physics
  const diff = S.tumbleTargetAngle - S.tumbleAngle;
  const springForce = diff * S.tumbleStiffness * easeFactor;
  let vel = S.tumbleVelocity + springForce;
  vel *= S.tumbleDamping;

  S.setTumbleVelocity(vel);
  S.setTumbleAngle(S.tumbleAngle + vel);

  // Check for completion
  const angleDist = Math.abs(S.tumbleTargetAngle - S.tumbleAngle);
  const velMag = Math.abs(vel);

  if (angleDist < 0.015 && velMag < 0.005) {
    S.setTumbleAngle(S.tumbleTargetAngle);
    S.setTumbleVelocity(0);
    S.setTumbleActive(false);
    S.setTumbleEase(0);

    const fullRotations = Math.floor(S.tumbleAngle / (Math.PI * 2));
    if (fullRotations > 0) {
      S.setTumbleAngle(S.tumbleAngle - fullRotations * Math.PI * 2);
      S.setTumbleTargetAngle(S.tumbleTargetAngle - fullRotations * Math.PI * 2);
    }
  }
}


// ══════════════════════════════════════════
//  PIVOT COMPUTATION
// ══════════════════════════════════════════
// Geometric center of the full mass (shaft + balls).
export function computePivot() {
  let sumX = 0, sumY = 0, count = 0;

  for (let i = 0; i < S.N; i++) {
    const weight = (i === 0 || i === S.N - 1) ? 2.0 : 1.0;
    sumX += S.pts[i].x * weight;
    sumY += S.pts[i].y * weight;
    count += weight;
  }

  const ballWeight = 3.0;
  sumX += S.ballL.x * ballWeight;
  sumY += S.ballL.y * ballWeight;
  sumX += S.ballR.x * ballWeight;
  sumY += S.ballR.y * ballWeight;
  count += ballWeight * 2;

  S.setTumblePivotX(sumX / count);
  S.setTumblePivotY(sumY / count);
}


// ══════════════════════════════════════════
//  ROTATION QUERY HELPERS
// ══════════════════════════════════════════

export function getNormalizedAngle() {
  const a = S.tumbleAngle % (Math.PI * 2);
  return a < 0 ? a + Math.PI * 2 : a;
}

// Shaft foreshortening: 1.0 = full length, ~0.15 = max foreshortened
export function getShaftForeshorten() {
  const absCos = Math.abs(Math.cos(S.tumbleAngle));
  return lerp(0.15, 1.0, absCos);
}

// Frontal factor: 0 = side view, 1 = front/back view
export function getFrontalFactor() {
  return Math.abs(Math.sin(S.tumbleAngle));
}

// Is the character inverted? (between 90 and 270 degrees)
export function isInverted() {
  const a = getNormalizedAngle();
  return a > Math.PI * 0.5 && a < Math.PI * 1.5;
}


// ══════════════════════════════════════════
//  DYNAMIC SHADOW PARAMETERS
// ══════════════════════════════════════════
// FIX: Shadow is now computed dynamically based on orientation,
// not hard-coded to object local space.
export function getShadowParams() {
  const angle = getNormalizedAngle();
  const cosR = Math.cos(angle);
  const sinR = Math.sin(angle);
  const absCos = Math.abs(cosR);
  const absSin = Math.abs(sinR);

  let widthMul, heightMul, opacity, offsetY;

  if (cosR >= 0) {
    widthMul = lerp(1.0, 1.4, absSin);
    heightMul = lerp(0.3, 0.2, absSin);
    opacity = lerp(0.15, 0.12, absSin);
    offsetY = 8;
  } else {
    widthMul = lerp(1.4, 1.2, absCos);
    heightMul = lerp(0.2, 0.25, absCos);
    opacity = lerp(0.12, 0.13, absCos);
    offsetY = lerp(8, 18, absCos);
  }

  return { widthMul, heightMul, opacity, offsetY };
}


// ══════════════════════════════════════════
//  BALL COMPRESSION FOR ROTATION
// ══════════════════════════════════════════
export function getBallCompression() {
  const sinR = Math.abs(Math.sin(S.tumbleAngle));
  return {
    vScale: lerp(1.0, 0.7, sinR),
    hScale: lerp(1.0, 0.85, sinR),
    gap: lerp(1.0, 0.6, sinR)
  };
}


// ══════════════════════════════════════════
//  GLANS FRONTAL INTERPOLATION
// ══════════════════════════════════════════
export function getGlansFrontalFactor() {
  return smoothstep(Math.abs(Math.sin(S.tumbleAngle)));
}


// ══════════════════════════════════════════
//  DRAW ORDER BASED ON ROTATION
// ══════════════════════════════════════════
export function getDrawOrder() {
  const angle = getNormalizedAngle();
  if (angle < Math.PI * 0.25 || angle > Math.PI * 1.75) return 'normal';
  if (angle > Math.PI * 0.75 && angle < Math.PI * 1.25) return 'inverted';
  return 'frontal';
}


// ══════════════════════════════════════════
//  DEPTH SHADOW FOR BACK-SIDE DURING ROTATION
// ══════════════════════════════════════════
export function getDepthShadowIntensity() {
  return smoothstep(Math.abs(Math.sin(S.tumbleAngle))) * 0.15;
}


// ══════════════════════════════════════════
//  VOLUME-PRESERVING TWIST DEFORMATION
// ══════════════════════════════════════════
// When the shaft twists, it must preserve volume:
// narrowing in one axis means widening in the perpendicular.
// The twist point should be near the base, not mid-shaft.

// Get twist parameters for a spine point at parametric t.
// twistAmount: 0-1, how much twist is applied
// Returns { widthScale, depthScale, rotation }
export function getTwistDeformation(t, twistAmount) {
  if (twistAmount < 0.001) return { widthScale: 1, depthScale: 1, rotation: 0 };

  // Twist position: near base (t ~ 0.15-0.3), not mid-shaft
  const twistCenter = 0.2;
  const twistFalloff = 0.25;
  const distFromTwist = Math.abs(t - twistCenter);
  const twistInfluence = smoothstep(1 - clamp(distFromTwist / twistFalloff, 0, 1));

  // Volume preservation: if width shrinks, depth grows
  // Area = width * depth = constant
  // At twist point: width -> width * cos(twist), depth -> depth / cos(twist)
  const twistAngle = twistAmount * twistInfluence * Math.PI * 0.4;
  const cosT = Math.cos(twistAngle);
  const minScale = 0.65; // never thinner than 65% (volume preservation)

  return {
    widthScale: Math.max(minScale, cosT),
    depthScale: 1.0 / Math.max(minScale, cosT),  // compensate to preserve volume
    rotation: twistAngle,
    influence: twistInfluence
  };
}

// Get ball deformation caused by shaft twist.
// When the shaft twists, it should pull/deform the balls slightly.
export function getBallTwistDeformation(twistAmount) {
  if (twistAmount < 0.001) return { leftSquish: 1, rightSquish: 1, shiftX: 0, shiftY: 0 };

  const pull = twistAmount * 0.12;
  return {
    leftSquish: 1.0 - pull * 0.5,   // left ball slightly compressed
    rightSquish: 1.0 + pull * 0.3,  // right ball slightly stretched
    shiftX: twistAmount * 3,         // balls shift slightly in twist direction
    shiftY: twistAmount * -2         // pulled upward slightly
  };
}

// Get glans rotation from twist.
// FIX: When shaft twists, glans must rotate with it.
export function getGlansTwistRotation(twistAmount) {
  return twistAmount * Math.PI * 0.3; // glans follows twist direction
}


// ══════════════════════════════════════════
//  GRAVITY DRAPE FOR INVERTED STATE
// ══════════════════════════════════════════
// When upside down, the shaft should droop naturally.
// Wider at the base (now at top), narrower/droopier at tip (now at bottom).
export function getInvertedDrape(t) {
  const cosR = Math.cos(S.tumbleAngle || 0);
  if (cosR >= 0) return { widthMul: 1, sag: 0 };

  const invertAmount = Math.abs(cosR);
  const sagProfile = Math.pow(t, 1.5) * invertAmount;

  // FIX: Base (t~0, now at top) spreads wider from weight above;
  // Tip (t~1, now at bottom) narrows as it droops from gravity
  const baseSpread = (1 - t) * invertAmount * 0.15;  // wider at base
  const tipNarrow = t * invertAmount * 0.10;           // narrower at tip
  return {
    widthMul: 1 + baseSpread - tipNarrow,
    sag: sagProfile * 8  // tip sags downward in px
  };
}
