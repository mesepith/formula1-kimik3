// ============ road-debug.js — click-to-inspect road location tool ============
// Toggle with F4 while driving. Click anywhere on the screen → if the click lands
// on the road, a marker appears and a panel shows the exact road location data.
// The player can then screenshot and share so a developer can see exactly where
// the issue is: city, distance along lap, sample index, curvature, speed limit,
// etc.
import * as THREE from 'three';
import { clamp } from './utils.js';

const SURFACES = ['ASPHALT', 'KERB', 'VERGE/OFF-TRACK'];

export class RoadDebugger {
  constructor() {
    this.active = false;
    this.enabled = false;          // true while a race is running
    this.game = null;
    this._mouse = new THREE.Vector2();
    this._lastClick = null;
    this._history = [];            // last N snapshots
    this._maxHistory = 12;

    // DOM
    this.root = document.getElementById('road-debug');
    this.panel = document.getElementById('road-debug-panel');
    this.hint = document.getElementById('road-debug-hint');
    this.marker = document.getElementById('road-debug-marker');

    this._raycaster = new THREE.Raycaster();

    this._onClick = this._onClick.bind(this);
    addEventListener('click', this._onClick);
  }

  attach(game) { this.game = game; }
  setEnabled(v) { this.enabled = v; if (!v) this.toggle(false); }

  toggle(force) {
    const want = force !== undefined ? force : !this.active;
    if (want === this.active) return;
    this.active = want;
    this.root.classList.toggle('active', want);
    if (want) {
      this._showHint();
    } else {
      this._clearMarker();
      this._hidePanel();
    }
  }

  _showHint() {
    this.hint.textContent = '📍 ROAD DEBUG ACTIVE — click anywhere on the screen to capture the road location. F4 to exit.';
    this.hint.classList.remove('hidden');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.hint.classList.add('hidden'), 6000);
  }

  _clearMarker() {
    this.marker.classList.add('hidden');
  }

  _hidePanel() {
    this.panel.classList.add('hidden');
    this.panel.innerHTML = '';
  }

  _onClick(e) {
    if (!this.active || !this.enabled || !this.game) return;
    // ignore clicks on UI panels themselves
    if (e.target.closest('#road-debug') || e.target.closest('.screen') || e.target.closest('#hud')) return;

    const rect = this.game.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._mouse, this.game.camera);

    const track = this.game.track;
    if (!track) return;

    const o = this._raycaster.ray.origin, dir = this._raycaster.ray.direction;
    let best = null;
    // Drivable band must match what physics & track builder actually let you use:
    // asphalt  |lat| <= hw−0.55
    // kerb     hw−0.55 .. hw+1.15
    // apron    hw+1.15 .. hw+wallLat (physics treats this as off-track but still driveable)
    const hw = track.halfWidth;
    const wallLat = hw + 3.05;                // from physics.js: car clamps at this band
    let prevT = 0.5, prevAbove = true;
    for (let t = 0.8; t < 900; t += 2.5) {
      const px = o.x + dir.x * t, py = o.y + dir.y * t, pz = o.z + dir.z * t;
      if (py > 240 && dir.y > 0) break;           // racing away to sky with no chance
      const near = track.nearest({ x: px, z: pz }, -1);
      const i = near.i, j = (i + 1) % track.N;
      // interpolate road height along the segment (same as physics)
      const sdx = track.samples.px[j] - track.samples.px[i], sdz = track.samples.pz[j] - track.samples.pz[i];
      const sl2 = sdx * sdx + sdz * sdz;
      const fr = sl2 > 1e-6 ? clamp(((px - track.samples.px[i]) * sdx + (pz - track.samples.pz[i]) * sdz) / sl2, 0, 1) : 0;
      const roadY = track.samples.py[i] + (track.samples.py[j] - track.samples.py[i]) * fr;
      const over = Math.abs(near.lat) <= wallLat;   // anywhere between the walls
      // the ray is considered to touch the surface when it's within 0.55m of the
      // interpolated road height — kerbs sit ~3.5cm proud of the asphalt, apron at −5mm.
      const above = py > roadY + 0.55;
      if (over && !above && prevAbove) {
        // refine crossing between prevT and t
        let lo = prevT, hi = t;
        for (let k = 0; k < 18; k++) {
          const mid = (lo + hi) / 2;
          const mx = o.x + dir.x * mid, my = o.y + dir.y * mid, mz = o.z + dir.z * mid;
          const nn = track.nearest({ x: mx, z: mz }, -1);
          const ii = nn.i, jj = (ii + 1) % track.N;
          const ddx = track.samples.px[jj] - track.samples.px[ii], ddz = track.samples.pz[jj] - track.samples.pz[ii];
          const ll2 = ddx * ddx + ddz * ddz;
          const ff = ll2 > 1e-6 ? clamp(((mx - track.samples.px[ii]) * ddx + (mz - track.samples.pz[ii]) * ddz) / ll2, 0, 1) : 0;
          const ry = track.samples.py[ii] + (track.samples.py[jj] - track.samples.py[ii]) * ff;
          if (my > ry + 0.02) lo = mid; else hi = mid;
        }
        const hx = o.x + dir.x * hi, hz = o.z + dir.z * hi;
        const fin = track.nearest({ x: hx, z: hz }, -1);
        if (Math.abs(fin.lat) <= wallLat) {
          best = { i: fin.i, t: fin.t, lat: fin.lat, dist: hi, d3: 0 };
        }
        break;
      }
      prevT = t; prevAbove = above;
    }

    if (!best) {
      this._flashMessage('⚠ No drivable surface under that click — try the asphalt, kerb, or light verge just beside it.');
      return;
    }

    this._lastClick = best;
    this._renderMarker(e.clientX - rect.left, e.clientY - rect.top);
    this._showPanel(best, e.clientX - rect.left, e.clientY - rect.top);
    this._pushHistory(best);
  }

  _flashMessage(txt) {
    this.panel.innerHTML = `<div class="rd-error">${txt}</div>`;
    this.panel.classList.remove('hidden');
    clearTimeout(this._errTimer);
    this._errTimer = setTimeout(() => this._hidePanel(), 2200);
  }

  _renderMarker(x, y) {
    this.marker.style.left = x + 'px';
    this.marker.style.top = y + 'px';
    this.marker.classList.remove('hidden');
    // pulse animation re-trigger
    this.marker.style.animation = 'none';
    void this.marker.offsetWidth;
    this.marker.style.animation = '';
  }

  _surfaceFor(lat, hw) {
    const a = Math.abs(lat);
    if (a < hw - 0.55) return 0; // asphalt
    if (a < hw + 1.15) return 1; // kerb
    return 2;                    // apron / runoff
  }

  _showPanel(info, clickX, clickY) {
    const track = this.game.track;
    const s = track.samples;
    const i = info.i;
    const hw = track.halfWidth;
    const N = track.N;

    // curvature and direction
    const kappa = s.kappa[i];
    const radius = Math.abs(kappa) > 1e-5 ? (1 / Math.abs(kappa)).toFixed(1) : '∞';
    const dir = kappa > 0.0005 ? 'LEFT' : kappa < -0.0005 ? 'RIGHT' : 'STRAIGHT';

    // elevation near click
    const iPrev = (i - 8 + N) % N, iNext = (i + 8) % N;
    const slope = ((s.py[iNext] - s.py[iPrev]) / (track.length / N * 16)).toFixed(3);

    // speed limit at this point
    const vMax = s.vMax[i];
    const speedKmh = Math.round(vMax * 3.6);

    // DRS zone?
    const t = info.t;
    let drs = 'NO';
    for (let zi = 0; zi < track.drsZones.length; zi++) {
      const z = track.drsZones[zi];
      const inside = z.t0 < z.t1 ? (t >= z.t0 && t <= z.t1) : (t >= z.t0 || t <= z.t1);
      if (inside) drs = `ZONE ${zi + 1}`;
    }

    // nearest control point
    let cpIdx = 0, cpD = Infinity;
    for (let k = 0; k < track.city.points.length; k++) {
      const p = track.city.points[k];
      // points stored as [x, z, elevation] → spline uses (p[0], p[2], p[1])
      const dx = s.px[i] - p[0], dz = s.pz[i] - p[1];
      const d = dx * dx + dz * dz;
      if (d < cpD) { cpD = d; cpIdx = k; }
    }

    const surface = SURFACES[this._surfaceFor(info.lat, hw)];
    const distM = (info.t * track.length).toFixed(0);
    const pct = (info.t * 100).toFixed(1);
    const sector = t < 1 / 3 ? 1 : t < 2 / 3 ? 2 : 3;

    const rows = [
      ['CITY', `${track.city.name} (${track.city.id})`],
      ['LAP DIST', `${distM} m / ${track.length.toFixed(0)} m (${pct}%)`],
      ['SECTOR', `S${sector}`],
      ['SAMPLE IDX', `${i} / ${N}`],
      ['TRACK T / U', info.t.toFixed(5)],
      ['LAT OFFSET', `${info.lat.toFixed(2)} m (right + / left −)`],
      ['SURFACE', surface],
      ['HALF WIDTH', `${hw.toFixed(1)} m`],
      ['CURVATURE κ', kappa.toFixed(5)],
      ['RADIUS', `${radius} m`],
      ['DIRECTION', dir],
      ['ELEVATION', `${s.py[i].toFixed(2)} m`],
      ['SLOPE', `${slope} m/m`],
      ['vMax (AI line)', `${speedKmh} km/h`],
      ['DRS', drs],
      ['NEAREST CTRL PT', `#${cpIdx} of ${track.city.points.length} — ${Math.sqrt(cpD).toFixed(0)} m away`],
      ['WORLD X / Z', `${s.px[i].toFixed(1)}, ${s.pz[i].toFixed(1)}`],
    ];

    // build HTML
    let html = `<div class="rd-head">
      <span>📍 ROAD LOCATION</span>
      <button class="rd-btn" data-act="copy">COPY</button>
      <button class="rd-btn" data-act="close">✕</button>
    </div>`;
    html += `<div class="rd-note">Screenshot this + panel and share to debug</div>`;
    html += `<table class="rd-table">`;
    for (const [k, v] of rows) html += `<tr><td>${k}</td><td>${v}</td></tr>`;
    html += `</table>`;
    html += `<div class="rd-player-label">— PLAYER CAR —</div>`;
    html += `<table class="rd-table">`;

    const p = this.game.race?.player?.state;
    if (p) {
      html += `<tr><td>DIST TO CLICK</td><td>${p.pos.distanceTo(new THREE.Vector3(s.px[i], s.py[i], s.pz[i])).toFixed(1)} m</td></tr>`;
      html += `<tr><td>SPEED</td><td>${Math.round(Math.abs(p.speed) * 3.6)} km/h</td></tr>`;
      html += `<tr><td>GEAR</td><td>${p.reversing ? 'R' : p.gear}</td></tr>`;
      html += `<tr><td>RPM</td><td>${Math.round(p.rpm)}</td></tr>`;
      html += `<tr><td>OFF TRACK</td><td>${p.offTrack ? 'YES' : 'NO'} ${p.onKerb ? '(kerb)' : ''}</td></tr>`;
      html += `<tr><td>HIT WALL</td><td>${p.hitWall ? 'YES' : 'NO'}</td></tr>`;
      html += `<tr><td>SLIDE</td><td>${p.slide.toFixed(2)}</td></tr>`;
    } else {
      html += `<tr><td colspan="2">No player data</td></tr>`;
    }
    html += `</table>`;
    html += `<div class="rd-foot">Click elsewhere for another point · F4 to close</div>`;

    this.panel.innerHTML = html;
    this.panel.classList.remove('hidden');

    // wire buttons
    this.panel.querySelector('[data-act="close"]').onclick = (ev) => {
      ev.stopPropagation();
      this._hidePanel();
      this._clearMarker();
    };
    this.panel.querySelector('[data-act="copy"]').onclick = (ev) => {
      ev.stopPropagation();
        const cpDist = Math.sqrt(cpD).toFixed(0);
        const text = `ROAD DEBUG ${track.city.id} | ${distM}m/${track.length.toFixed(0)}m (${pct}%) S${sector} surf=${surface} lat=${info.lat.toFixed(2)}m | curve=${dir} R≈${radius}m κ=${kappa.toFixed(5)} | elev=${s.py[i].toFixed(2)}m slope=${slope} vMax=${speedKmh}kmh drs=${drs} | t=${info.t.toFixed(5)} sample=${i}/${N} ctrlPt=#${cpIdx}@${cpDist}m | xz=${s.px[i].toFixed(1)},${s.pz[i].toFixed(1)}`;
      navigator.clipboard?.writeText(text).then(() => {
        const btn = this.panel.querySelector('[data-act="copy"]');
        btn.textContent = 'COPIED!';
        setTimeout(() => btn.textContent = 'COPY', 1200);
      });
    };
  }

  _pushHistory(info) {
    const track = this.game.track;
    const s = track.samples;
    this._history.unshift({
      t: info.t, i: info.i, lat: info.lat,
      dist: (info.t * track.length).toFixed(0),
      city: track.city.id,
      x: s.px[info.i].toFixed(1), z: s.pz[info.i].toFixed(1),
    });
    if (this._history.length > this._maxHistory) this._history.pop();
  }

  // console helper: window.game.dbg.last() → prints snapshot
  last() {
    if (!this._lastClick || !this.game?.track) return null;
    const info = this._lastClick;
    const track = this.game.track;
    const s = track.samples;
    const i = info.i;
    return {
      city: track.city.id,
      distM: (info.t * track.length).toFixed(1),
      t: info.t,
      sampleIdx: i,
      lat: info.lat,
      surface: SURFACES[this._surfaceFor(info.lat, track.halfWidth)],
      kappa: s.kappa[i],
      elev: s.py[i],
      vMaxKmh: Math.round(s.vMax[i] * 3.6),
      drsZones: track.drsZones,
      history: this._history,
    };
  }
}
