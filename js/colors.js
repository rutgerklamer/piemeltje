// ══════════════════════════════════════════════════════════════
//  COLOR SYSTEM v1.0.0 — Unified palette with lighting-aware computation
//  All frames use the same base palette (spec 3a) with dynamic
//  shading computed from a single consistent light source.
// ══════════════════════════════════════════════════════════════
import { lerp, clamp, smoothstep } from './helpers.js';

// ══════════════════════════════════════════
//  FIXED PALETTE CONSTANTS (spec 3a)
// ══════════════════════════════════════════

// Base skin tone
export const SKIN_BASE_R = 200, SKIN_BASE_G = 130, SKIN_BASE_B = 90;
export const SKIN_BASE = '#C8825A';

// Highlight tone (lighter, warmer — used for specular and rim)
export const SKIN_HIGHLIGHT_R = 223, SKIN_HIGHLIGHT_G = 168, SKIN_HIGHLIGHT_B = 130;
export const SKIN_HIGHLIGHT = '#DFA882';

// Shadow/depth tone (darker, cooler)
export const SKIN_SHADOW_R = 160, SKIN_SHADOW_G = 98, SKIN_SHADOW_B = 62;
export const SKIN_SHADOW = '#A0623E';

// Deep shadow (for ambient occlusion and crevices)
export const SKIN_DEEP_SHADOW_R = 110, SKIN_DEEP_SHADOW_G = 60, SKIN_DEEP_SHADOW_B = 38;

// Outline stroke (consistent across all frames)
export const OUTLINE_R = 122, OUTLINE_G = 65, OUTLINE_B = 40;
export const OUTLINE_COLOR = '#7A4128';

// Glans base (more saturated/pinkish than skin)
export const GLANS_BASE_R = 195, GLANS_BASE_G = 120, GLANS_BASE_B = 95;
export const GLANS_BASE = '#C3785F';

// Glans highlight (pinker, lighter)
export const GLANS_HIGHLIGHT_R = 220, GLANS_HIGHLIGHT_G = 155, GLANS_HIGHLIGHT_B = 135;

// Glans outline (darker than skin outline)
export const GLANS_OUTLINE_R = 108, GLANS_OUTLINE_G = 55, GLANS_OUTLINE_B = 38;
export const GLANS_OUTLINE = '#6C3726';

// Drop shadow
export const DROP_SHADOW_COLOR = 'rgba(0,0,0,0.12)';
export const DROP_SHADOW_OPACITY = 0.12;

// Vein color base (bluish-purple undertone)
export const VEIN_BASE_R = 95, VEIN_BASE_G = 85, VEIN_BASE_B = 120;

// Hair color (dark brown)
export const HAIR_R = 35, HAIR_G = 20, HAIR_B = 12;

// Ambient occlusion tint (warm dark brown for crevices)
export const AO_R = 45, AO_G = 22, AO_B = 12;

// Subsurface scattering tint (warm reddish for thin-skin glow)
export const SSS_R = 210, SSS_G = 140, SSS_B = 120;


// ══════════════════════════════════════════
//  COLOR FUNCTIONS
// ══════════════════════════════════════════

// Base skin color with engorgement progression and proximity flush
export function skinColor(p, proximity) {
  const flush = (proximity || 0) * 0.15;
  const r = Math.round(lerp(SKIN_BASE_R, SKIN_BASE_R - 4 + flush * 40, p));
  const g = Math.round(lerp(SKIN_BASE_G, SKIN_BASE_G - 20 - flush * 20, p));
  const b = Math.round(lerp(SKIN_BASE_B, SKIN_BASE_B - 16 - flush * 20, p));
  return `rgb(${r},${g},${b})`;
}

// Skin color as RGB components (for gradient construction)
export function skinColorRGB(p, proximity) {
  const flush = (proximity || 0) * 0.15;
  return {
    r: Math.round(lerp(SKIN_BASE_R, SKIN_BASE_R - 4 + flush * 40, p)),
    g: Math.round(lerp(SKIN_BASE_G, SKIN_BASE_G - 20 - flush * 20, p)),
    b: Math.round(lerp(SKIN_BASE_B, SKIN_BASE_B - 16 - flush * 20, p))
  };
}

// Darker skin variant for shadow areas
export function skinColorDark(p) {
  const r = Math.round(lerp(SKIN_SHADOW_R + 12, SKIN_SHADOW_R + 8, p));
  const g = Math.round(lerp(SKIN_SHADOW_G + 32, SKIN_SHADOW_G + 10, p));
  const b = Math.round(lerp(SKIN_SHADOW_B + 7, SKIN_SHADOW_B - 10, p));
  return `rgb(${r},${g},${b})`;
}

// Outline color — stays very close to OUTLINE_COLOR constant
export function outlineColor(p) {
  const r = Math.round(lerp(OUTLINE_R + 3, OUTLINE_R - 2, p));
  const g = Math.round(lerp(OUTLINE_G + 7, OUTLINE_G - 3, p));
  const b = Math.round(lerp(OUTLINE_B + 5, OUTLINE_B - 2, p));
  return `rgb(${r},${g},${b})`;
}

// Glans color — more pinkish/saturated than skin, deepens with engorgement
export function glansColor(p) {
  const r = Math.round(lerp(GLANS_BASE_R - 5, GLANS_BASE_R - 13, p));
  const g = Math.round(lerp(GLANS_BASE_G + 28, GLANS_BASE_G - 2, p));
  const b = Math.round(lerp(GLANS_BASE_B + 27, GLANS_BASE_B + 1, p));
  return `rgb(${r},${g},${b})`;
}

// Glans color as RGB components
export function glansColorRGB(p) {
  return {
    r: Math.round(lerp(GLANS_BASE_R - 5, GLANS_BASE_R - 13, p)),
    g: Math.round(lerp(GLANS_BASE_G + 28, GLANS_BASE_G - 2, p)),
    b: Math.round(lerp(GLANS_BASE_B + 27, GLANS_BASE_B + 1, p))
  };
}

// Glans outline — darker than regular outline
export function glansOutlineFn(p) {
  const r = Math.round(lerp(GLANS_OUTLINE_R + 4, GLANS_OUTLINE_R - 3, p));
  const g = Math.round(lerp(GLANS_OUTLINE_G + 20, GLANS_OUTLINE_G + 7, p));
  const b = Math.round(lerp(GLANS_OUTLINE_B + 22, GLANS_OUTLINE_B + 10, p));
  return `rgb(${r},${g},${b})`;
}

// Vein color — bluish-purple undertone with alpha
export function veinColor(p, a) {
  const r = Math.round(lerp(VEIN_BASE_R + 10, VEIN_BASE_R - 5, p));
  const g = Math.round(lerp(VEIN_BASE_G + 15, VEIN_BASE_G + 7, p));
  const b = Math.round(lerp(VEIN_BASE_B - 5, VEIN_BASE_B, p));
  return `rgba(${r},${g},${b},${a})`;
}

// Hair color — consistent dark brown
export function hairColor(alpha) {
  return `rgba(${HAIR_R},${HAIR_G},${HAIR_B},${alpha})`;
}

// Highlight color with alpha
export function highlightColor(p, alpha) {
  const r = Math.round(lerp(SKIN_HIGHLIGHT_R, SKIN_HIGHLIGHT_R - 5, p));
  const g = Math.round(lerp(SKIN_HIGHLIGHT_G, SKIN_HIGHLIGHT_G - 12, p));
  const b = Math.round(lerp(SKIN_HIGHLIGHT_B, SKIN_HIGHLIGHT_B - 10, p));
  return `rgba(${r},${g},${b},${alpha || 1})`;
}

// Shadow color with alpha
export function shadowColor(p, alpha) {
  const r = Math.round(lerp(SKIN_SHADOW_R, SKIN_SHADOW_R - 8, p));
  const g = Math.round(lerp(SKIN_SHADOW_G, SKIN_SHADOW_G - 10, p));
  const b = Math.round(lerp(SKIN_SHADOW_B, SKIN_SHADOW_B - 8, p));
  return `rgba(${r},${g},${b},${alpha || 1})`;
}

// Ambient occlusion color with alpha
export function aoColor(alpha) {
  return `rgba(${AO_R},${AO_G},${AO_B},${alpha})`;
}

// Subsurface scattering color with alpha
export function sssColor(p, alpha) {
  const r = Math.round(lerp(SSS_R, SSS_R + 10, p));
  const g = Math.round(lerp(SSS_G, SSS_G - 15, p));
  const b = Math.round(lerp(SSS_B, SSS_B - 10, p));
  return `rgba(${r},${g},${b},${alpha})`;
}

// Deep shadow for crevices and occlusion zones
export function deepShadowColor(alpha) {
  return `rgba(${SKIN_DEEP_SHADOW_R},${SKIN_DEEP_SHADOW_G},${SKIN_DEEP_SHADOW_B},${alpha})`;
}


// ══════════════════════════════════════════
//  LIGHTING-AWARE COLOR COMPUTATION
// ══════════════════════════════════════════

// Compute a diffuse shade factor from surface normal and light direction.
// Returns 0 (fully in shadow) to 1 (fully lit).
// normalX, normalY: surface normal (unit vector)
// lightDirX, lightDirY: direction TO the light from the surface point (unit vector)
export function diffuseFactor(normalX, normalY, lightDirX, lightDirY) {
  const dot = normalX * lightDirX + normalY * lightDirY;
  // Half-Lambert diffuse: wraps light around more (softer shadows)
  return clamp(dot * 0.5 + 0.5, 0.15, 1.0);
}

// Compute specular highlight intensity.
// viewDir is assumed to be (0, 0, -1) — looking at the screen.
// reflectance is material shininess (higher = tighter highlight).
export function specularFactor(normalX, normalY, lightDirX, lightDirY, shininess) {
  // Blinn-Phong approximation in 2D
  // Half-vector between light and view (view is straight-on)
  const hx = lightDirX;
  const hy = lightDirY - 1; // view dir is (0, -1) in screen space
  const hLen = Math.sqrt(hx * hx + hy * hy) || 1;
  const dot = Math.max(0, normalX * (hx / hLen) + normalY * (hy / hLen));
  return Math.pow(dot, shininess || 16);
}

// Material descriptor for consistent appearance across all views.
// Returns an object with computed shading values given the light angle.
export function computeMaterial(p, normalX, normalY, lightDirX, lightDirY) {
  const diff = diffuseFactor(normalX, normalY, lightDirX, lightDirY);
  const spec = specularFactor(normalX, normalY, lightDirX, lightDirY, lerp(8, 24, p));

  // Skin material: warm diffuse + subtle specular
  const baseRGB = skinColorRGB(p, 0);
  const shadedR = Math.round(baseRGB.r * lerp(0.7, 1.0, diff));
  const shadedG = Math.round(baseRGB.g * lerp(0.65, 1.0, diff));
  const shadedB = Math.round(baseRGB.b * lerp(0.6, 1.0, diff));

  return {
    diffuse: diff,
    specular: spec,
    color: `rgb(${shadedR},${shadedG},${shadedB})`,
    specularAlpha: spec * lerp(0.08, 0.20, p)
  };
}
