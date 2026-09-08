// ============ trackgen-experiment: soften the Ladakh start/finish pinch ============
// Reproduces the reported spot:
//   ROAD DEBUG ladakh | 5m/3831m (0.1%) curve=RIGHT R≈9.9m κ=-0.10151 vMax=60kmh
// Root cause: the road comes home 170°-left-turning at the wrap (direction into P0
// is ≈(-80,+80) ≈ heading NW-ish, direction out is P0→P1 ≈ (+40,-180) ≈ heading N),
// so the closed centripetal Catmull-Rom pinches the start line to R≈8–10m.
//
// Fix strategy tested here: keep the whole mountain (P0..P20) EXACTLY as it is, and
// replace only the descent links P21..P26 so that the last ~750m before the gantry
// is a straight run whose heading matches the exit heading (P0→P1). A single open
// left-hander at the TOP of the descent absorbs the direction change instead of the
// start line.
import * as THREE from '../vendor/three.module.js';

const BASE = [
  [0, 0, 20], [40, -180, 24], [30, -360, 30], [-60, -520, 38], [-180, -600, 46],
  [-320, -590, 52], [-420, -500, 58], [-460, -370, 64], [-420, -240, 70],
  [-320, -180, 74], [-220, -240, 78], [-180, -380, 84], [-230, -520, 90],
  [-360, -580, 96], [-490, -540, 100], [-560, -410, 104], [-540, -260, 108],
  [-440, -150, 110], [-300, -120, 108], [-200, -30, 104], [-150, 110, 98],
  [-60, 220, 90], [60, 260, 82], [160, 190, 72], [200, 60, 62],
  [160, -60, 50], [80, -80, 40],
];

function build(points) {
  const N = 1400;
  const pts = points.map(p => new THREE.Vector3(p[0], p[2], p[1]));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const length = curve.getLength();
  const p = new THREE.Vector3(), tn = new THREE.Vector3();
  const tx = [], tz = [], rx = [], rz = [], px = [], pz = [], py = [];
  for (let i = 0; i < N; i++) {
    const u = i / N;
    curve.getPointAt(u, p); curve.getTangentAt(u, tn);
    px[i] = p.x; pz[i] = p.z; py[i] = p.y;
    const tl = Math.hypot(tn.x, tn.z) || 1;
    tx[i] = tn.x / tl; tz[i] = tn.z / tl;
    rx[i] = tn.z / tl; rz[i] = -tn.x / tl;
  }
  const kappa = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N, ds = length / N;
    kappa[i] = Math.hypot(tx[j] - tx[i], tz[j] - tz[i]) / ds * Math.sign(tx[i] * rz[j] - tz[i] * rx[j] || 1);
  }
  const sm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += kappa[(i + k + N) % N];
    sm[i] = sum / 7;
  }
  return { N, length, sm, px, pz, py };
}

function report(points, label) {
  const { N, length, sm, px, pz } = build(points);
  const maxima = [];
  for (let i = 0; i < N; i++) {
    const a = Math.abs(sm[(i - 1 + N) % N]), b = Math.abs(sm[i]), c2 = Math.abs(sm[(i + 1) % N]);
    if (b >= a && b >= c2 && b > 0.012)
      maxima.push({ R: 1 / b, d: i / N * length, dir: sm[i] < 0 ? 'R' : 'L', xz: `${px[i].toFixed(0)},${pz[i].toFixed(0)}` });
  }
  maxima.sort((x, y) => x.R - y.R);
  console.log(`=== ${label}  len=${length.toFixed(0)}m ===`);
  let lastD = -999, shown = 0;
  for (const m of maxima) {
    if (Math.abs(m.d - lastD) < 30) continue;
    console.log(`  R=${m.R.toFixed(1).padStart(6)}m  @${m.d.toFixed(0).padStart(4)}m  ${m.dir}  xz=${m.xz}`);
    lastD = m.d;
    if (++shown >= 16) break;
  }
  // the reported spot: nearest sample to xz=-2.0,-4.1
  let bi = 0, bd = 1e9;
  for (let i = 0; i < N; i++) { const d = Math.hypot(px[i] + 2, pz[i] + 4.1); if (d < bd) { bd = d; bi = i; } }
  console.log(`  REPORTED SPOT xz=-2,-4.1: R=${(1 / Math.abs(sm[bi])).toFixed(1)}m`);
}

function chords(points, label, from, to) {
  const pts = points.map(p => new THREE.Vector3(p[0], p[2], p[1]));
  console.log(`${label}: ` + Array.from({ length: to - from }, (_, k) => {
    const a = pts[from + k], b = pts[from + k + 1];
    return `${a.distanceTo(b).toFixed(0)}m`;
  }).join(' | '));
}

function overlap(points, label) {
  const { N, length, px, pz, py } = build(points);
  let worst = 1e9, wa = 0, wb = 0;
  for (let i = 0; i < N; i++) for (let j = i + 40; j < N; j++) {
    if (i + (N - j) < 40) continue;
    const d = Math.hypot(px[i] - px[j], pz[i] - pz[j], py[i] - py[j]);
    if (d < worst) { worst = d; wa = i; wb = j; }
  }
  console.log(`  overlap ${label}: closest non-adjacent = ${worst.toFixed(1)}m  @${(wa / N * length).toFixed(0)}m & @${(wb / N * length).toFixed(0)}m ${worst < 16 ? '⚠ SELF-INTERSECT RISK' : 'ok'}`);
}

report(BASE, 'CURRENT (start-line kink)');

// Direction out of the start line:
const ex = BASE[1][0] - BASE[0][0], ez = BASE[1][1] - BASE[0][1]; // (40,-180)
const el = Math.hypot(ex, ez);
const ux = ex / el, uz = ez / el; // unit exit heading ≈ (0.217,-0.976)
console.log(`exit heading unit = (${ux.toFixed(3)}, ${uz.toFixed(3)})`);

// HOME STRAIGHT points: P0 - k*heading → lies "before" the start on the exit line.
// Chord between consecutive must be ≥ neighbours (~130–190m) to avoid pinches.
const st = d => [(-d * ux), (-d * uz)]; // (x,z) at distance d before P0 on that line

// Candidate FINAL: points 21..26 on the home straight (distances chosen ~140m apart)
const FINAL = BASE.slice();
FINAL[26] = [st(95)[0], st(95)[1], 34];
FINAL[25] = [st(240)[0], st(240)[1], 44];
FINAL[24] = [st(385)[0], st(385)[1], 56];
FINAL[23] = [st(530)[0], st(530)[1], 68];
FINAL[22] = [st(675)[0], st(675)[1], 78];
FINAL[21] = [st(820)[0], st(820)[1], 88];
// single open left-hander joining the ridge (P20=-150,110) onto the straight:
FINAL[20] = [-330, 420, 96];
FINAL[19] = [-390, 180, 104];
report(FINAL, 'FINAL v9: 820m home straight, open-left join');
chords(FINAL, 'join chords 17→22', 17, 22);
overlap(FINAL, 'FINAL');

// v10: the remaining pinch sits at the P20→P21 join (chord jumps 249→145m and the
// heading turns hard). Make the join a proper single-radius 90° left with even
// chords: place P19/P20/P21 as one circular arc (same spacing d≈165m ≈ straight
// spacing) with turning angle split evenly.
// P18=(-440,-150,110). Straight heading into P0: u=(0.217,-0.976).
// Pick the arc's end tangent = u. Arc start tangent = dir(P18→P19).
// Simple robust geometry: choose P20/P21 ON the line, P19 out wide enough that
// both turn halves are ≤45° at equal 165m chords.
const F2 = BASE.slice();
F2[26] = [st(95)[0], st(95)[1], 34];
F2[25] = [st(240)[0], st(240)[1], 44];
F2[24] = [st(385)[0], st(385)[1], 56];
F2[23] = [st(530)[0], st(530)[1], 68];
F2[22] = [st(675)[0], st(675)[1], 78];
// join corner: one wide 90° left at ~R=210m split across two points
F2[21] = [st(840)[0], st(840)[1], 88];   // straight starts here
F2[20] = [st(1005)[0] - 150, st(1005)[1] + 8, 96];  // 45° kink out
F2[19] = [st(1120)[0] - 330, st(1120)[1] - 40, 103]; // second 45° → now heading W→S?
report(F2, 'FINAL v10: two 45° steps onto the straight');
chords(F2, 'v10 chords 17→22', 17, 22);
overlap(F2, 'v10');

