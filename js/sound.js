// ── Sound layer (opt-in) ──
import { smoothstep } from './helpers.js';
import * as S from './state.js';
import { getHeartbeat } from './stages.js';

let audioCtx = null;
let soundEnabled = false;
let lastHbTrigger = 0;

function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playHeartbeat() {
  if (!audioCtx || !soundEnabled || S.progress < 0.7) return;
  const hb = getHeartbeat();
  if (hb < 0.3) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 55;
  gain.gain.value = hb * 0.08 * smoothstep((S.progress - 0.7) / 0.3);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.stop(audioCtx.currentTime + 0.2);
}

export function setupSound() {
  const soundBtn = document.getElementById('sound-btn');
  soundBtn.addEventListener('click', () => {
    if (!audioCtx) initAudio();
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? '♪ Sound ON' : '♪ Sound';
    soundBtn.style.background = soundEnabled ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)';
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  });
}

export function tickSound(now) {
  if (!soundEnabled) return;
  const hb = getHeartbeat();
  if (hb > 0.4 && now - lastHbTrigger > 400) {
    playHeartbeat();
    lastHbTrigger = now;
  }
}
