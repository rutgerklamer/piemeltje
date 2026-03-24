// ── Input handling ──
import { clamp, dist } from './helpers.js';
import * as S from './state.js';
import { startTumble } from './tumble.js';

const SCROLL_SENS = 0.0007;
const TOUCH_SENS = 0.0015;
const HORIZONTAL_SCROLL_THRESHOLD = 50; // px delta for horizontal tumble trigger

export function setupInput(canvas) {
  // ── Scroll wheel: vertical = erection, horizontal = tumble ──
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const deltaY = e.deltaY * SCROLL_SENS;
    S.setTarget(clamp(S.target + deltaY, 0, 1));
    S.setScrollVelocity(deltaY);
    S.setLastInteractionTime(performance.now());

    if (S.target >= 0.98 && Math.abs(deltaY) > 0.015) {
      S.setOvershootBounce(Math.max(S.overshootBounce, Math.abs(deltaY) * 30));
    }

    // Horizontal scroll triggers tumble
    if (Math.abs(e.deltaX) > HORIZONTAL_SCROLL_THRESHOLD) {
      startTumble();
    }
  }, { passive: false });

  // ── Touch: swipe vertical = erection, fast upward swipe = tumble ──
  let lastTouchY = null;
  let swipeStartY = null;
  let swipeStartTime = 0;

  window.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    lastTouchY = touch.clientY;
    swipeStartY = touch.clientY;
    swipeStartTime = performance.now();
    S.setMouseX(touch.clientX);
    S.setMouseY(touch.clientY);
    S.setMouseInCanvas(true);
    S.setLastInteractionTime(performance.now());
    applyPokeImpulse(canvas, S.mouseX, S.mouseY, 3);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (lastTouchY !== null) {
      const touch = e.touches[0];
      const dy = lastTouchY - touch.clientY;
      const delta = dy * TOUCH_SENS;
      S.setTarget(clamp(S.target + delta, 0, 1));
      S.setScrollVelocity(delta);
      lastTouchY = touch.clientY;
      S.setMouseX(touch.clientX);
      S.setMouseY(touch.clientY);
      S.setLastInteractionTime(performance.now());
    }
  }, { passive: false });

  window.addEventListener('touchend', (e) => {
    // Detect fast upward swipe for tumble trigger
    if (swipeStartY !== null && lastTouchY !== null) {
      const swipeDist = swipeStartY - lastTouchY; // positive = upward
      const swipeTime = performance.now() - swipeStartTime;
      // Fast upward swipe: >200px in <300ms
      if (swipeDist > 200 && swipeTime < 300) {
        S.setLastInteractionTime(performance.now());
        startTumble();
      }
    }
    lastTouchY = null;
    swipeStartY = null;
  });

  // ── Mouse tracking ──
  window.addEventListener('mousemove', (e) => {
    S.setMouseX(e.clientX);
    S.setMouseY(e.clientY);
    S.setMouseInCanvas(true);
    S.setLastInteractionTime(performance.now());
  });
  window.addEventListener('mouseleave', () => { S.setMouseInCanvas(false); });
  window.addEventListener('mouseenter', () => { S.setMouseInCanvas(true); });

  // ── Click: poke impulse ──
  window.addEventListener('mousedown', (e) => {
    S.setLastInteractionTime(performance.now());
    applyPokeImpulse(canvas, e.clientX, e.clientY, 4);
  });

  // ── Double-click: trigger tumble ──
  window.addEventListener('dblclick', (e) => {
    e.preventDefault();
    S.setLastInteractionTime(performance.now());
    startTumble();
  });

  // ── Keyboard: T or Space triggers tumble ──
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T' || e.key === ' ') {
      e.preventDefault();
      S.setLastInteractionTime(performance.now());
      startTumble();
    }
  });
}

// ── Poke impulse (push nearby spine points away from click) ──
function applyPokeImpulse(canvas, clientX, clientY, impulse) {
  const rect = canvas.getBoundingClientRect();
  const mx = (clientX - rect.left) / S.canvasScale;
  const my = (clientY - rect.top) / S.canvasScale;
  let minD = Infinity, closestI = -1;
  for (let i = 1; i < S.N; i++) {
    const d = dist(S.pts[i].x, S.pts[i].y, mx, my);
    if (d < minD) { minD = d; closestI = i; }
  }
  if (minD < 60 && closestI > 0) {
    const dx = S.pts[closestI].x - mx;
    const dy = S.pts[closestI].y - my;
    const dn = Math.sqrt(dx * dx + dy * dy) || 1;
    // Push the closest point
    S.pts[closestI].x += (dx / dn) * impulse;
    S.pts[closestI].y += (dy / dn) * impulse;
    // Propagate to neighbors for smoother response
    if (closestI > 1) {
      S.pts[closestI - 1].x += (dx / dn) * impulse * 0.5;
      S.pts[closestI - 1].y += (dy / dn) * impulse * 0.5;
    }
    if (closestI < S.N - 1) {
      S.pts[closestI + 1].x += (dx / dn) * impulse * 0.5;
      S.pts[closestI + 1].y += (dy / dn) * impulse * 0.5;
    }
    // Even softer propagation to second neighbors
    if (closestI > 2) {
      S.pts[closestI - 2].x += (dx / dn) * impulse * 0.2;
      S.pts[closestI - 2].y += (dy / dn) * impulse * 0.2;
    }
    if (closestI < S.N - 2) {
      S.pts[closestI + 2].x += (dx / dn) * impulse * 0.2;
      S.pts[closestI + 2].y += (dy / dn) * impulse * 0.2;
    }
  }
}
