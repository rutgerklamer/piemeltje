// ── Catmull-Rom spline & spine generation ──
import { N, pts } from './state.js';

export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
    0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
  ];
}

export function catmullRomTangent(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const dx = 0.5*((-p0[0]+p2[0]) + (4*p0[0]-10*p1[0]+8*p2[0]-2*p3[0])*t + (-3*p0[0]+9*p1[0]-9*p2[0]+3*p3[0])*t2);
  const dy = 0.5*((-p0[1]+p2[1]) + (4*p0[1]-10*p1[1]+8*p2[1]-2*p3[1])*t + (-3*p0[1]+9*p1[1]-9*p2[1]+3*p3[1])*t2);
  const len = Math.sqrt(dx*dx+dy*dy)||1;
  return [dx/len, dy/len];
}

export function getSpine(samplesPerSeg) {
  const cp = pts.map(p => [p.x, p.y]);
  const spine = [];
  for (let i = 0; i < N-1; i++) {
    const p0=cp[Math.max(0,i-1)], p1=cp[i], p2=cp[Math.min(N-1,i+1)], p3=cp[Math.min(N-1,i+2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s/samplesPerSeg;
      spine.push({ pos: catmullRom(p0,p1,p2,p3,t), tan: catmullRomTangent(p0,p1,p2,p3,t) });
    }
  }
  const last=cp[N-1], prev=cp[N-2], tan=[last[0]-prev[0],last[1]-prev[1]];
  const tl=Math.sqrt(tan[0]*tan[0]+tan[1]*tan[1])||1;
  spine.push({pos:last,tan:[tan[0]/tl,tan[1]/tl]});
  return spine;
}
