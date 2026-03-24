// ── Main entry point ──
import { clamp, smoothstep } from './helpers.js';
import * as S from './state.js';
import { simulate, draw } from './renderer.js';
import { setupInput } from './input.js';
import { setupSound, tickSound } from './sound.js';
import { startTumble } from './tumble.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ── Canvas sizing ──
function resize() {
  S.setDpr(window.devicePixelRatio || 1);
  S.setCanvasScale(Math.min(window.innerWidth / S.BASE_W, window.innerHeight / S.BASE_H) * 0.85);
  canvas.width = S.BASE_W * S.canvasScale * S.dpr;
  canvas.height = S.BASE_H * S.canvasScale * S.dpr;
  canvas.style.width = S.BASE_W * S.canvasScale + 'px';
  canvas.style.height = S.BASE_H * S.canvasScale + 'px';
  ctx.setTransform(S.dpr * S.canvasScale, 0, 0, S.dpr * S.canvasScale, 0, 0);
}

// ── Progress spring ──
const RISE_STIFF = 0.018, RISE_DAMP = 0.82;
const FALL_STIFF = 0.012, FALL_DAMP = 0.88;
const TARGET_DECAY = 0.00012;
let lastScrollTime = Date.now();
let origTargetVal = 0;

function updateProgress() {
  const now = Date.now();
  if (now - lastScrollTime > 3000 && S.target > 0) {
    S.setTarget(Math.max(0, S.target - TARGET_DECAY));
  }
  if (Math.abs(S.target - origTargetVal) > 0.001) {
    lastScrollTime = now;
    origTargetVal = S.target;
  }
  const effectiveTarget = Math.max(0, S.target - S.shrinkageAmount);
  const diff = effectiveTarget - S.progress;
  const rising = diff > 0;
  S.setSpringVel(S.springVel + diff * (rising ? RISE_STIFF : FALL_STIFF));
  S.setSpringVel(S.springVel * (rising ? RISE_DAMP : FALL_DAMP));
  S.setProgress(clamp(S.progress + S.springVel, 0, 1));
  S.setScrollVelocity(S.scrollVelocity * 0.9);
}

// ── Main loop ──
let lastTime = performance.now();
const PHYSICS_DT = 1000 / 60;
let acc = 0;

function tick(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;
  acc += dt;
  while (acc >= PHYSICS_DT) {
    updateProgress();
    simulate(canvas);
    acc -= PHYSICS_DT;
  }
  draw(ctx, canvas);
  tickSound(now);
  requestAnimationFrame(tick);
}

// ── Tumble button setup ──
function setupTumbleButton() {
  const tumbleBtn = document.getElementById('tumble-btn');
  if (tumbleBtn) {
    tumbleBtn.addEventListener('click', () => {
      S.setLastInteractionTime(performance.now());
      startTumble();
      tumbleBtn.classList.add('active');
      setTimeout(() => tumbleBtn.classList.remove('active'), 1200);
    });
  }
}

// ── Init ──
S.setLastInteractionTime(performance.now());
window.addEventListener('resize', resize);
resize();
setupInput(canvas);
setupSound();
setupTumbleButton();

// Warm up physics
for (let i = 0; i < 200; i++) simulate(canvas);

requestAnimationFrame(tick);
