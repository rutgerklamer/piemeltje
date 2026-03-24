// ── Shared mutable state ──
// All modules import this and read/write to it directly.

// Canvas
export const BASE_W = 480;
export const BASE_H = 720;
export let dpr = 1;
export let canvasScale = 1;
export function setDpr(v) { dpr = v; }
export function setCanvasScale(v) { canvasScale = v; }

// Spine constants
export const N = 16;
export const SEG_LEN = 11;
export const BASE_X = 240;
export const BASE_Y = 320;
export const GRAVITY = 0.22;
export const CONSTRAINT_ITERS = 8;

// Spine points
export const pts = [];
for (let i = 0; i < N; i++) {
  pts.push({
    x: BASE_X, y: BASE_Y + i * SEG_LEN,
    px: BASE_X, py: BASE_Y + i * SEG_LEN,
    lateralV: 0
  });
}

// Ball physics
export const ballL = { x: BASE_X - 26, y: BASE_Y + 38, px: BASE_X - 26, py: BASE_Y + 38, swayPhase: 0 };
export const ballR = { x: BASE_X + 26, y: BASE_Y + 42, px: BASE_X + 26, py: BASE_Y + 42, swayPhase: Math.PI * 0.7 };
export const BALL_SPRING = 0.022;
export const BALL_FRICTION = 0.90;
export const BALL_GRAVITY = 0.12;

// Erection state
export let progress = 0;
export let target = 0;
export let springVel = 0;
export let stage = 0;
export let stageTime = 0;
export let prevStage = 0;
export let transitionFlash = 0;
export function setProgress(v) { progress = v; }
export function setTarget(v) { target = v; }
export function setSpringVel(v) { springVel = v; }
export function setStage(v) { stage = v; }
export function setStageTime(v) { stageTime = v; }
export function setPrevStage(v) { prevStage = v; }
export function setTransitionFlash(v) { transitionFlash = v; }

// Mouse/touch
export let mouseX = BASE_X;
export let mouseY = BASE_Y + 100;
export let mouseInCanvas = false;
export let lastInteractionTime = 0;
export function setMouseX(v) { mouseX = v; }
export function setMouseY(v) { mouseY = v; }
export function setMouseInCanvas(v) { mouseInCanvas = v; }
export function setLastInteractionTime(v) { lastInteractionTime = v; }

// Idle life
export let breathPhase = 0;
export let shrinkageAmount = 0;
export let twitchTimer = 0;
export let twitchImpulse = { node: 0, dx: 0, dy: 0, life: 0 };
export function setBreathPhase(v) { breathPhase = v; }
export function setShrinkageAmount(v) { shrinkageAmount = v; }
export function setTwitchTimer(v) { twitchTimer = v; }
export function setTwitchImpulse(v) { twitchImpulse = v; }

// Scroll velocity
export let scrollVelocity = 0;
export let overshootBounce = 0;
export function setScrollVelocity(v) { scrollVelocity = v; }
export function setOvershootBounce(v) { overshootBounce = v; }

// Light position
export let lightX = BASE_W * 0.3;
export let lightY = BASE_H * 0.15;
export function setLightX(v) { lightX = v; }
export function setLightY(v) { lightY = v; }

// Heartbeat
export let heartbeatPhase = 0;
export const HEARTBEAT_RATE = 1.1;
export function setHeartbeatPhase(v) { heartbeatPhase = v; }

// ══════════════════════════════════════════
//  Tumble animation state (spec §4)
// ══════════════════════════════════════════
// Current rotation angle in radians (0=upright, PI/2=sideways, PI=upside down)
export let tumbleAngle = 0;
// Whether tumble animation is currently running
export let tumbleActive = false;
// Angular velocity (radians per frame)
export let tumbleVelocity = 0;
// Target angle for spring-based tumble animation
export let tumbleTargetAngle = 0;
// Spring damping for tumble motion
export let tumbleDamping = 0.88;
// Spring stiffness for tumble motion
export let tumbleStiffness = 0.06;
// Computed pivot point X (geometric center of full mass)
export let tumblePivotX = BASE_X;
// Computed pivot point Y (geometric center of full mass)
export let tumblePivotY = BASE_Y + 60;
// Number of completed tumble rotations (for tracking)
export let tumbleCount = 0;
// Tumble easing phase (0-1, used for smooth start/stop)
export let tumbleEase = 0;

export function setTumbleAngle(v) { tumbleAngle = v; }
export function setTumbleActive(v) { tumbleActive = v; }
export function setTumbleVelocity(v) { tumbleVelocity = v; }
export function setTumbleTargetAngle(v) { tumbleTargetAngle = v; }
export function setTumbleDamping(v) { tumbleDamping = v; }
export function setTumbleStiffness(v) { tumbleStiffness = v; }
export function setTumblePivotX(v) { tumblePivotX = v; }
export function setTumblePivotY(v) { tumblePivotY = v; }
export function setTumbleCount(v) { tumbleCount = v; }
export function setTumbleEase(v) { tumbleEase = v; }
