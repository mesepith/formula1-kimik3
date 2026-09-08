// ============ track.js — procedural circuit builder ============
import * as THREE from 'three';
import { mergeGeometries, makeCanvasTexture, mulberry32, clamp, drawSignText } from './utils.js';
import { FAKE_BRANDS } from './config.js';

const WALL_DIST = 3.4;      // apron width between road edge and wall
const SAMPLE_N = 1400;

// ---------- textures ----------
function asphaltTexture() {
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#33363a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const g = 40 + Math.random() * 40;
      ctx.fillStyle = `rgb(${g},${g},${g + 3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    // patch repairs
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(20,20,22,0.25)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 12 + Math.random() * 20);
    }
    ctx.strokeStyle = 'rgba(15,15,18,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(w, 128); ctx.stroke();
  });
}
function kerbTexture() {
  const t = makeCanvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#d8232a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(w / 2, 0, w / 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 300; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  });
  return t;
}
function concreteTexture() {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#9aa0a4'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      const g = 130 + Math.random() * 50;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.strokeStyle = 'rgba(60,60,60,0.5)';
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  });
}
function fenceTexture() {
  const t = makeCanvasTexture(64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(160,170,180,0.9)'; ctx.lineWidth = 1;
    for (let i = 0; i <= w; i += 6) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
    for (let i = 0; i <= h; i += 6) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
  });
  t.repeat.set(1, 1);
  return t;
}
function checkerTexture() {
  return makeCanvasTexture(64, 64, (ctx, w, h) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  });
}
function brandTexture(rng) {
  const [name, sub] = FAKE_BRANDS[Math.floor(rng() * FAKE_BRANDS.length)];
  const hues = ['#ff7a00', '#0a5aa8', '#0a8a4a', '#c82848', '#6a2ad8', '#0088a8', '#e0a000'];
  const bg = hues[Math.floor(rng() * hues.length)];
  return makeCanvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 0, w, 10);
    drawSignText(ctx, name, w / 2, h / 2 - 8, 30, '#fff');
    drawSignText(ctx, sub, w / 2, h - 14, 13, 'rgba(255,255,255,0.85)');
  });
}
function standTexture(rng, label) {
  return makeCanvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#18202c'; ctx.fillRect(0, 0, w, h);
    drawSignText(ctx, label, w / 2, h / 2, 34, '#ffd23f');
  });
}

// ---------- geometry helpers ----------
function ribbon(samples, i0, i1, lat0, lat1, yOff, uvScale = 8, uRepeat = 1) {
  // ribbon between lateral offsets lat0..lat1 for sample range (inclusive)
  const n = i1 - i0 + 1;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), norm = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    const px = samples.px[i], py = samples.py[i], pz = samples.pz[i];
    const rx = samples.rx[i], rz = samples.rz[i];
    const d = samples.dist[i];
    pos[k * 6 + 0] = px + rx * lat0; pos[k * 6 + 1] = py + yOff; pos[k * 6 + 2] = pz + rz * lat0;
    pos[k * 6 + 3] = px + rx * lat1; pos[k * 6 + 4] = py + yOff; pos[k * 6 + 5] = pz + rz * lat1;
    norm[k * 6 + 1] = 1; norm[k * 6 + 4] = 1;
    uv[k * 4 + 0] = 0; uv[k * 4 + 1] = d / uvScale * uRepeat;
    uv[k * 4 + 2] = 1; uv[k * 4 + 3] = d / uvScale * uRepeat;
    if (k < n - 1) {
      const a = k * 2, b = k * 2 + 1, c = k * 2 + 2, e = k * 2 + 3;
      idx.push(a, b, c, b, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function wallRibbon(samples, i0, i1, lat, h0, h1, vRepeat = 40) {
  const n = i1 - i0 + 1;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    const px = samples.px[i] + samples.rx[i] * lat, pz = samples.pz[i] + samples.rz[i] * lat, py = samples.py[i];
    pos[k * 6 + 0] = px; pos[k * 6 + 1] = py + h0; pos[k * 6 + 2] = pz;
    pos[k * 6 + 3] = px; pos[k * 6 + 4] = py + h1; pos[k * 6 + 5] = pz;
    uv[k * 4 + 0] = samples.dist[i] / vRepeat; uv[k * 4 + 1] = 0;
    uv[k * 4 + 2] = samples.dist[i] / vRepeat; uv[k * 4 + 3] = 1;
    if (k < n - 1) {
      const a = k * 2, b = k * 2 + 1, c = k * 2 + 2, e = k * 2 + 3;
      idx.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ============================================================
export class Track {
  constructor(scene, city, opts = {}) {
    this.city = city;
    this.scene = scene;
    this.group = new THREE.Group();
    this.halfWidth = city.width / 2;
    this.lampMaterials = [];   // emissive mats to toggle at night
    this.rng = mulberry32(city.seed);

    // --- spline ---
    const pts = city.points.map(p => new THREE.Vector3(p[0], p[2], p[1]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    this._sample();

    scene.add(this.group);
    this._buildRoad();
    this._buildKerbs();
    this._buildWallsAndFences();
    this._buildStartStraight();
    this._buildPitLane();
    this._buildGrandstands();
    this._buildLamps();
    this._buildHoardings();
    this._buildTireBarriers();
    this._computeSpeedProfile();
    this._computeDRS();
    this._computeGrid();
  }

  _sample() {
    const N = this.N = SAMPLE_N;
    const s = this.samples = {
      px: new Float32Array(N), py: new Float32Array(N), pz: new Float32Array(N),
      tx: new Float32Array(N), tz: new Float32Array(N), ty: new Float32Array(N),
      rx: new Float32Array(N), rz: new Float32Array(N),
      kappa: new Float32Array(N), vMax: new Float32Array(N), dist: new Float32Array(N),
    };
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const u = i / N;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      s.px[i] = p.x; s.py[i] = p.y; s.pz[i] = p.z;
      const tl = Math.hypot(t.x, t.z) || 1;
      s.tx[i] = t.x / tl; s.tz[i] = t.z / tl; s.ty[i] = t.y;
      s.rx[i] = t.z / tl; s.rz[i] = -t.x / tl; // right = tangent × up
      s.dist[i] = u * this.length;
    }
    // curvature
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const ds = this.length / N;
      const dtx = s.tx[j] - s.tx[i], dtz = s.tz[j] - s.tz[i];
      s.kappa[i] = Math.hypot(dtx, dtz) / ds * Math.sign(s.tx[i] * s.rz[j] - s.tz[i] * s.rx[j] || 1);
    }
    // smooth curvature
    const sm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) sum += s.kappa[(i + k + N) % N];
      sm[i] = sum / 7;
    }
    s.kappa.set(sm);
  }

  _buildRoad() {
    const N = this.N, s = this.samples, hw = this.halfWidth;
    const asphalt = asphaltTexture();
    asphalt.repeat.set(1, 1);
    this.roadMat = new THREE.MeshStandardMaterial({
      map: asphalt, roughness: 0.92, metalness: 0.02, color: 0xffffff,
    });
    const g = ribbon(s, 0, N - 1, -hw, hw, 0, 10);
    // close the loop: extra segment from N-1 → 0 handled by ribbon wrap quad
    const road = new THREE.Mesh(g, this.roadMat);
    road.receiveShadow = true;
    this.group.add(road);

    // wrap segment (last → first)
    const wrap = this._wrapRibbon(-hw, hw, 0, 10, this.roadMat);
    this.group.add(wrap);

    // side skirts: vertical drops from road edges down to the ground, so elevated
    // sections (Ladakh, flyovers) don't show floating ribbons. Depth scales with the
    // track's elevation range: flat street circuits get a shallow 1.2m kerb reveal,
    // the mountain circuit gets a deep retaining wall that reaches the valley floor.
    let minPY = Infinity, maxPY = -Infinity;
    for (let i = 0; i < N; i++) { minPY = Math.min(minPY, s.py[i]); maxPY = Math.max(maxPY, s.py[i]); }
    const skirtDepth = (maxPY - minPY) > 4 ? Math.min((maxPY - minPY) * 0.5 + 3, 46) : 1.2;
    const skirtMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, color: 0x6a6f75 });
    for (const side of [-1, 1]) {
      const sg = wallRibbon(s, 0, N - 1, side * hw, -skirtDepth, 0.02, 30);
      const sm2 = new THREE.Mesh(sg, skirtMat);
      sm2.receiveShadow = true;
      this.group.add(sm2);
      this.group.add(this._wrapWall(side * hw, -skirtDepth, 0.02, skirtMat));
    }

    // white edge lines — fully emissive so they read identical in sun or shadow,
    // day or night — both road boundaries always look the same.
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    lineMat.toneMapped = true;
    for (const side of [-1, 1]) {
      const lg = ribbon(s, 0, N - 1, side * (hw - 0.5), side * (hw + 0.08), 0.018, 10);
      const lm = new THREE.Mesh(lg, lineMat);
      lm.receiveShadow = false; // never darkened by building shadows
      this.group.add(lm);
      this.group.add(this._wrapRibbon(side * (hw - 0.5), side * (hw + 0.08), 0.018, 10, lineMat));
    }

    // verge: ONE uniform pale concrete band from the white line all the way to the
    // wall, identical on BOTH sides — this replaces the old dark outer apron so the
    // read of the road boundary never differs left vs right.
    const vergeTex = concreteTexture();
    const vergeMat = new THREE.MeshStandardMaterial({
      map: vergeTex, color: 0xd6dbe2, roughness: 0.85,
      emissive: 0xffffff, emissiveMap: vergeTex, emissiveIntensity: 0.28,
    });
    this.lampMaterials.push({ mat: vergeMat, day: 0.28, night: 0.75 });
    for (const side of [-1, 1]) {
      const vg = ribbon(s, 0, N - 1, side * (hw + 0.08), side * (hw + WALL_DIST), -0.005, 12);
      const vm = new THREE.Mesh(vg, vergeMat);
      vm.receiveShadow = true;
      this.group.add(vm);
      this.group.add(this._wrapRibbon(side * (hw + 0.08), side * (hw + WALL_DIST), -0.005, 12, vergeMat));
    }

    // finish line checker strip
    const check = checkerTexture();
    const cm = new THREE.MeshStandardMaterial({ map: check, roughness: 0.6 });
    const fg = ribbon(s, 0, 1, -hw, hw, 0.02, 4);
    const fm = new THREE.Mesh(fg, cm);
    this.group.add(fm);

    // sector lines
    const sm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.65 });
    for (const tt of [1 / 3, 2 / 3]) {
      const i = Math.floor(tt * N);
      const sg = ribbon(s, i, i + 1, -hw, hw, 0.018, 4);
      this.group.add(new THREE.Mesh(sg, sm));
    }
  }

  _wrapRibbon(lat0, lat1, yOff, uvScale, mat) {
    const N = this.N, s = this.samples;
    const pos = new Float32Array(12), uv = new Float32Array(8), norm = new Float32Array(12);
    const i = N - 1, j = 0;
    const data = [
      [i, lat0], [i, lat1], [j, lat0], [j, lat1],
    ];
    data.forEach(([k, lat], n) => {
      pos[n * 3] = s.px[k] + s.rx[k] * lat; pos[n * 3 + 1] = s.py[k] + yOff; pos[n * 3 + 2] = s.pz[k] + s.rz[k] * lat;
      norm[n * 3 + 1] = 1;
      uv[n * 2] = n % 2; uv[n * 2 + 1] = s.dist[k] / uvScale;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    return new THREE.Mesh(g, mat);
  }

  _buildKerbs() {
    const N = this.N, s = this.samples, hw = this.halfWidth;
    const kt = kerbTexture();
    // fully emissive so the boundary is equally readable in sun or shadow, day or night.
    // DoubleSide is explicit because the ribbon winding flips for negative lat offsets.
    const km = new THREE.MeshBasicMaterial({
      map: kt, toneMapped: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    // continuous red/white kerb on BOTH sides for the entire lap — not only corners —
    // so the left boundary is always as obvious as the right one.
    const geoms = [];
    for (const side of [-1, 1]) {
      const g = ribbon(s, 0, N - 1, side * (hw + 0.02), side * (hw + 1.15), 0.035, 5, 1);
      geoms.push(g);
      this.group.add(this._wrapRibbon(side * (hw + 0.02), side * (hw + 1.15), 0.035, 5, km));
    }
    const merged = mergeGeometries(geoms);
    const m = new THREE.Mesh(merged, km);
    m.receiveShadow = false;
    this.group.add(m);
  }

  // horizontal wrap quad between last sample and first (closes the loop)
  _wrapWall(lat, h0, h1, mat) {
    const N = this.N, s = this.samples;
    const i = N - 1, j = 0;
    const ax = s.px[i] + s.rx[i] * lat, az = s.pz[i] + s.rz[i] * lat, ay = s.py[i];
    const bx = s.px[j] + s.rx[j] * lat, bz = s.pz[j] + s.rz[j] * lat, by = s.py[j];
    const pos = new Float32Array([
      ax, ay + h0, az, bx, by + h0, bz, ax, ay + h1, az, bx, by + h1, bz,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  _buildWallsAndFences() {
    const N = this.N, s = this.samples, hw = this.halfWidth;
    // (run-off surface between the white lines and the walls is the pale concrete
    //  verge built in _buildRoad — one identical band on both sides)
    const conc = concreteTexture();
    const wm = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, color: 0xd8dde2 });
    for (const side of [-1, 1]) {
      const g = wallRibbon(s, 0, N - 1, side * (hw + WALL_DIST), 0, 1.0, 30);
      const m = new THREE.Mesh(g, wm);
      m.castShadow = false; m.receiveShadow = true;
      this.group.add(m);
      this.group.add(this._wrapWall(side * (hw + WALL_DIST), 0, 1.0, wm));
    }
    // debris fence (transparent grid) above walls
    const ft = fenceTexture();
    const fm = new THREE.MeshStandardMaterial({
      map: ft, transparent: true, alphaTest: 0.15, side: THREE.DoubleSide,
      color: 0x8899aa, roughness: 0.6, metalness: 0.6,
    });
    for (const side of [-1, 1]) {
      const g = wallRibbon(s, 0, N - 1, side * (hw + WALL_DIST), 1.0, 3.1, 8);
      this.group.add(new THREE.Mesh(g, fm));
      this.group.add(this._wrapWall(side * (hw + WALL_DIST), 1.0, 3.1, fm));
    }
  }

  _buildStartStraight() {
    const s = this.samples, hw = this.halfWidth;
    const start = this.pointAt(0);
    const right = this.rightAt(0);
    const tan = this.tangentAt(0);

    // --- gantry with start lights ---
    const gantry = new THREE.Group();
    const postG = new THREE.BoxGeometry(0.5, 6.5, 0.5);
    const postM = new THREE.MeshStandardMaterial({ color: 0x30363e, roughness: 0.5, metalness: 0.7 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postG, postM);
      post.position.set(start.x + right.x * side * (hw + 1.6), start.y + 3.25, start.z + right.z * side * (hw + 1.6));
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4, 0.9, 0.9), postM);
    beam.position.set(start.x, start.y + 6.2, start.z);
    beam.rotation.y = Math.atan2(right.x, right.z) + Math.PI / 2;
    gantry.add(beam);
    // light housing
    const housing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.4 }));
    housing.position.set(start.x, start.y + 5.4, start.z);
    housing.rotation.y = Math.atan2(right.x, right.z) + Math.PI / 2;
    gantry.add(housing);
    // 5 red lamps (emissive — race manager toggles)
    this.gantryLights = [];
    const lg = new THREE.SphereGeometry(0.22, 12, 12);
    for (let i = 0; i < 5; i++) {
      const lm = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0x000000 });
      const lamp = new THREE.Mesh(lg, lm);
      const off = (i - 2) * 0.62;
      lamp.position.set(
        start.x + right.x * off - tan.x * 0.28,
        start.y + 5.4,
        start.z + right.z * off - tan.z * 0.28);
      gantry.add(lamp);
      this.gantryLights.push(lm);
    }
    // banner above
    const bannerTex = makeCanvasTexture(512, 64, (ctx, w, h) => {
      ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff9933'; ctx.fillRect(0, 0, w / 3, 6);
      ctx.fillStyle = '#fff'; ctx.fillRect(w / 3, 0, w / 3, 6);
      ctx.fillStyle = '#138808'; ctx.fillRect(2 * w / 3, 0, w / 3, 6);
      drawSignText(ctx, `${this.city.name} · ${this.city.hindi} GRAND CIRCUIT`, w / 2, h / 2 + 6, 30, '#ffd23f');
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 3.4, 1.6),
      new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, emissive: 0x333333, emissiveMap: bannerTex }));
    banner.position.set(start.x + tan.x * 0.2, start.y + 7.6, start.z + tan.z * 0.2);
    banner.rotation.y = Math.atan2(right.x, right.z) + Math.PI / 2;
    gantry.add(banner);
    this.lampMaterials.push({ mat: banner.material, day: 0.0, night: 1.2 });
    this.group.add(gantry);

    // --- grid slot paint ---
    const gm = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 });
    const geoms = [];
    const N = this.N;
    for (let i = 0; i < 16; i++) {
      const t = 1 - (46 + i * 8.2) / this.length;
      const si = Math.floor(((t % 1) + 1) % 1 * N);
      const lat = (i % 2 === 0 ? 1 : -1) * 2.4;
      // L-shaped slot: two small quads
      const g1 = ribbon(s, si, si + 1, lat - 1.6, lat - 1.3, 0.015, 4);
      const g2 = ribbon(s, si, si + 1, lat + 1.3, lat + 1.6, 0.015, 4);
      geoms.push(g1, g2);
    }
    if (geoms.length) this.group.add(new THREE.Mesh(mergeGeometries(geoms), gm));
  }

  _buildPitLane() {
    const s = this.samples, hw = this.halfWidth, N = this.N;
    const conc = concreteTexture();
    const pm = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, color: 0xb8c0c8 });
    // pit lane t range: 0.93 → 1.03
    const i0 = Math.floor(0.928 * N), i1 = Math.floor(0.035 * N) + N;
    const ext = { px: [], py: [], pz: [], rx: [], rz: [], tx: [], tz: [], dist: [] };
    for (let i = i0; i <= i1; i++) {
      const k = i % N;
      ext.px.push(s.px[k]); ext.py.push(s.py[k]); ext.pz.push(s.pz[k]);
      ext.rx.push(s.rx[k]); ext.rz.push(s.rz[k]); ext.dist.push((i - i0) * this.length / N);
    }
    const laneLat = hw + 7.5;
    const g = ribbon(ext, 0, ext.px.length - 1, laneLat - 2.6, laneLat + 2.6, 0.005, 10);
    this.group.add(new THREE.Mesh(g, pm));
    // pit boxes paint
    const bm = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.8 });
    const bgs = [];
    for (let b = 2; b < ext.px.length - 8; b += 14) {
      bgs.push(ribbon(ext, b, b + 8, laneLat - 2.2, laneLat - 1.9, 0.012, 4));
      bgs.push(ribbon(ext, b, b + 8, laneLat + 1.9, laneLat + 2.2, 0.012, 4));
    }
    if (bgs.length) this.group.add(new THREE.Mesh(mergeGeometries(bgs), bm));

    // pit wall between track and lane
    const wg = wallRibbon(ext, 0, ext.px.length - 1, hw + 3.9, 0, 1.0, 30);
    this.group.add(new THREE.Mesh(wg, pm));

    // pit building — aligned to the average tangent so it never swings onto the road.
    // On the mountain circuit the pit straight climbs hard, so the building is dropped
    // to the lowest pit-lane altitude and built tall enough to still read at road level
    // at the high end — it terraces into the slope instead of floating over the fall.
    const bldLat = laneLat + 8;
    let pitMinY = Infinity;
    for (let k = 0; k < ext.px.length; k++) pitMinY = Math.min(pitMinY, ext.py[k]);
    const pitMaxY = ext.py.reduce ? Math.max(...ext.py) : pitMinY;  // ext arrays are JS arrays
    const bldRise = Math.max(0, pitMaxY - pitMinY);
    const bldG = new THREE.BoxGeometry(4, 6.2 + bldRise, ext.px.length * this.length / N * 0.82);
    const bldM = new THREE.MeshStandardMaterial({ color: 0x28303c, roughness: 0.6, metalness: 0.3 });
    const mid = Math.floor(ext.px.length / 2);
    const bld = new THREE.Mesh(bldG, bldM);
    // base at the low end of the pit lane, center-height adjusted for the extra rise
    bld.position.set(ext.px[mid] + ext.rx[mid] * bldLat, pitMinY + (6.2 + bldRise) / 2 - 0.2, ext.pz[mid] + ext.rz[mid] * bldLat);
    // average tangent across the pit straight for a stable orientation
    let atx = 0, atz = 0;
    for (let k = 0; k < ext.px.length; k++) { atx += ext.tx[k]; atz += ext.tz[k]; }
    bld.rotation.y = Math.atan2(atx, atz) + Math.PI / 2;
    bld.castShadow = true;
    this.group.add(bld);

    // garage doors (emissive strip)
    const doorTex = makeCanvasTexture(512, 32, (ctx, w, h) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#3a4a5c' : '#2c3a4a';
        ctx.fillRect(i * w / 8 + 2, 2, w / 8 - 4, h - 4);
      }
    });
    // garage doors sit at the building's low-end base so they meet the pit lane
    const doors = new THREE.Mesh(new THREE.PlaneGeometry(bldG.depth, 2.6),
      new THREE.MeshStandardMaterial({ map: doorTex, emissive: 0x222a33, emissiveMap: doorTex }));
    doors.position.set(ext.px[mid] + ext.rx[mid] * (bldLat - 2.05), pitMinY + 1.35, ext.pz[mid] + ext.rz[mid] * (bldLat - 2.05));
    doors.rotation.y = Math.atan2(ext.rx[mid], ext.rz[mid]) + Math.PI / 2 + Math.PI;
    this.group.add(doors);
    this.lampMaterials.push({ mat: doors.material, day: 0.25, night: 0.9 });

    // timing tower — tall enough to reach the ground even on the mountain's climb
    const tt = new THREE.Mesh(new THREE.BoxGeometry(2.4, 22 + bldRise, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.5, metalness: 0.5 }));
    const t0 = Math.floor(ext.px.length * 0.35);
    tt.position.set(ext.px[t0] + ext.rx[t0] * (bldLat + 4), pitMinY + (22 + bldRise) / 2 - 0.2, ext.pz[t0] + ext.rz[t0] * (bldLat + 4));
    tt.castShadow = true;
    this.group.add(tt);
    const screenTex = makeCanvasTexture(64, 256, (ctx, w, h) => {
      ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = ['#ffd23f', '#4dff6a', '#00c8ff'][i % 3];
        ctx.fillRect(8, 10 + i * 24, w - 16, 14);
      }
    });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 12),
      new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 0.9 }));
    scr.position.set(ext.px[t0] + ext.rx[t0] * (bldLat + 2.7), ext.py[t0] + 13, ext.pz[t0] + ext.rz[t0] * (bldLat + 2.7));
    scr.rotation.y = Math.atan2(ext.rx[t0], ext.rz[t0]) + Math.PI / 2 + Math.PI;
    this.group.add(scr);
    this.lampMaterials.push({ mat: scr.material, day: 0.5, night: 1.4 });
  }

  _buildGrandstands() {
    const s = this.samples, hw = this.halfWidth, N = this.N;
    const standPositions = [
      { t: 0.985, side: -1 }, { t: 0.02, side: -1 }, { t: 0.96, side: -1 },
    ];
    const crowdGeo = new THREE.BoxGeometry(0.5, 0.9, 0.4);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const structM = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.7, metalness: 0.3 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0xd84a20, roughness: 0.6 });
    const crowdColors = [0xff9933, 0xffffff, 0x138808, 0x2266cc, 0xffd23f, 0xd84a20, 0xeeeeee, 0x0a5aa8];
    const rng = this.rng;

    for (const sp of standPositions) {
      const i = Math.floor(sp.t * N) % N;
      const lat = sp.side * (hw + WALL_DIST + 9);
      const cx = s.px[i] + s.rx[i] * lat, cz = s.pz[i] + s.rz[i] * lat, cy = s.py[i];
      const yaw = Math.atan2(-s.rx[i] * sp.side, -s.rz[i] * sp.side);
      const stand = new THREE.Group();
      // stepped rows
      const rows = 8, cols = 44;
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 1.6), structM);
        step.position.set(0, 1.5 + r * 0.85, r * 1.35);
        stand.add(step);
      }
      // roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(32, 0.4, 13), roofM);
      roof.position.set(0, 9.4, 5.2);
      roof.rotation.x = -0.12;
      stand.add(roof);
      // crowd
      const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, rows * cols);
      const m4 = new THREE.Matrix4();
      let ci = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        m4.makeTranslation(-14.5 + c * (29 / cols), 2.35 + r * 0.85, r * 1.35);
        crowd.setMatrixAt(ci, m4);
        crowd.setColorAt(ci, new THREE.Color(crowdColors[Math.floor(rng() * crowdColors.length)]));
        ci++;
      }
      crowd.instanceMatrix.needsUpdate = true;
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
      stand.add(crowd);
      // banner
      const bt = standTexture(rng, this.city.name + ' GP');
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.2),
        new THREE.MeshStandardMaterial({ map: bt, emissive: 0x555555, emissiveMap: bt }));
      ban.position.set(0, 0.9, -1.2);
      ban.rotation.y = Math.PI;
      stand.add(ban);
      this.lampMaterials.push({ mat: ban.material, day: 0.3, night: 1.0 });

      stand.position.set(cx, cy, cz);
      stand.rotation.y = yaw;
      stand.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.group.add(stand);
    }
  }

  _buildLamps() {
    // floodlight poles every ~130m alternating sides
    const s = this.samples, hw = this.halfWidth, N = this.N;
    const step = Math.floor(130 / (this.length / N));
    const poleG = new THREE.CylinderGeometry(0.12, 0.2, 12, 6);
    const poleM = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.5, metalness: 0.7 });
    const headG = new THREE.BoxGeometry(1.6, 0.5, 0.6);
    const poles = [];
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xd8d8cc, emissive: 0x000000 });
    for (let i = 0; i < N; i += step) {
      const side = (Math.floor(i / step) % 2) ? 1 : -1;
      const lat = side * (hw + WALL_DIST + 1.5);
      const x = s.px[i] + s.rx[i] * lat, z = s.pz[i] + s.rz[i] * lat, y = s.py[i];
      const pole = new THREE.Mesh(poleG, poleM);
      pole.position.set(x, y + 6, z);
      poles.push(pole);
      const head = new THREE.Mesh(headG, this.lampHeadMat);
      head.position.set(x - s.rx[i] * side * 1.2, y + 12, z - s.rz[i] * side * 1.2);
      head.rotation.y = Math.atan2(-s.rx[i] * side, -s.rz[i] * side);
      head.rotation.x = 0.4;
      poles.push(head);
    }
    for (const p of poles) { p.castShadow = false; this.group.add(p); }
  }

  _buildHoardings() {
    const s = this.samples, hw = this.halfWidth, N = this.N;
    const rng = this.rng;
    const textures = [];
    for (let i = 0; i < 8; i++) textures.push(brandTexture(rng));
    const mats = textures.map(t => new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    const geo = new THREE.PlaneGeometry(7, 1.1);
    const step = Math.floor(26 / (this.length / N));
    for (let i = 6; i < N - 6; i += step) {
      if (rng() < 0.35) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const lat = side * (hw + WALL_DIST - 0.06);
      const x = s.px[i] + s.rx[i] * lat, z = s.pz[i] + s.rz[i] * lat, y = s.py[i];
      const m = new THREE.Mesh(geo, mats[Math.floor(rng() * mats.length)]);
      m.position.set(x, y + 0.62, z);
      m.rotation.y = Math.atan2(-s.rx[i] * side, -s.rz[i] * side);
      this.group.add(m);
    }
  }

  _buildTireBarriers() {
    // red/white tire stacks at big braking zones
    const s = this.samples, N = this.N, hw = this.halfWidth;
    const tex = makeCanvasTexture(64, 64, (ctx, w, h) => {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#d8232a' : '#eee';
        ctx.fillRect(0, i * h / 4, w, h / 4);
      }
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const geo = new THREE.BoxGeometry(2.4, 1.1, 1.2);
    const geoms = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 4) % N;
      const drop = s.vMax ? 0 : 0; // computed later; use kappa spike instead
    }
    // place where curvature jumps from low to high
    for (let i = 0; i < N; i++) {
      const prev = Math.abs(s.kappa[(i - 10 + N) % N]);
      const cur = Math.abs(s.kappa[i]);
      if (cur > 0.02 && prev < 0.008) {
        for (const side of [-1, 1]) {
          const lat = side * (hw + WALL_DIST + 1.2);
          const g = geo.clone();
          const m4 = new THREE.Matrix4();
          const yaw = Math.atan2(s.tx[i], s.tz[i]);
          m4.makeRotationY(yaw);
          m4.setPosition(s.px[i] + s.rx[i] * lat, s.py[i] + 0.55, s.pz[i] + s.rz[i] * lat);
          g.applyMatrix4(m4);
          geoms.push(g);
        }
      }
    }
    if (geoms.length) this.group.add(new THREE.Mesh(mergeGeometries(geoms), mat));
  }

  _computeSpeedProfile() {
    const N = this.N, s = this.samples;
    const latAcc = 34;      // m/s² usable lateral
    const aBrake = 30, aAccel = 13;
    const ds = this.length / N;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(s.kappa[i]);
      s.vMax[i] = k < 1e-4 ? 96 : Math.min(96, Math.sqrt(latAcc / k));
    }
    // smooth vMax
    const sm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let mn = Infinity;
      for (let k = -4; k <= 4; k++) mn = Math.min(mn, s.vMax[(i + k + N) % N]);
      sm[i] = mn;
    }
    s.vMax.set(sm);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N * 2 - 1; i >= 0; i--) {
        const a = i % N, b = (i + 1) % N;
        const allowed = Math.sqrt(s.vMax[b] * s.vMax[b] + 2 * aBrake * ds);
        if (s.vMax[a] > allowed) s.vMax[a] = allowed;
      }
      for (let i = 0; i < N * 2; i++) {
        const a = i % N, b = (i + 1) % N;
        const allowed = Math.sqrt(s.vMax[a] * s.vMax[a] + 2 * aAccel * ds);
        if (s.vMax[b] > allowed) s.vMax[b] = allowed;
      }
    }
  }

  _computeDRS() {
    // DRS zones on the two longest flat-out runs
    const N = this.N, s = this.samples;
    const flat = new Array(N).fill(false);
    for (let i = 0; i < N; i++) flat[i] = s.vMax[i] > 72;
    const runs = [];
    let i = 0;
    const visited = new Array(N).fill(false);
    for (let start = 0; start < N; start++) {
      if (!flat[start] || visited[start]) continue;
      let len = 0;
      while (len < N && flat[(start + len) % N] && !visited[(start + len) % N]) {
        visited[(start + len) % N] = true; len++;
      }
      if (len * this.length / N > 380) runs.push({ start, len });
    }
    runs.sort((a, b) => b.len - a.len);
    this.drsZones = runs.slice(0, 2).map(r => ({
      t0: ((r.start + 8) % N) / N,
      t1: ((r.start + r.len - 8) % N) / N,
    }));
    // detection point: 180m before zone
    this.drsDetect = this.drsZones.map(z => (z.t0 - 180 / this.length + 1) % 1);
    // DRS sign boards
    const bm = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.6 });
    const bg = new THREE.BoxGeometry(1.6, 0.9, 0.1);
    const hw = this.halfWidth;
    for (const z of this.drsZones) {
      const i = Math.floor(z.t0 * N) % N;
      for (const side of [1]) {
        const m = new THREE.Mesh(bg, bm);
        m.position.set(s.px[i] + s.rx[i] * side * (hw + 1.8), s.py[i] + 1.4, s.pz[i] + s.rz[i] * side * (hw + 1.8));
        m.rotation.y = Math.atan2(-s.rx[i] * side, -s.rz[i] * side);
        this.group.add(m);
      }
    }
  }

  _computeGrid() {
    this.grid = [];
    const N = this.N, s = this.samples;
    for (let i = 0; i < 16; i++) {
      const t = 1 - (46 + i * 8.2) / this.length;
      const lat = (i % 2 === 0 ? 1 : -1) * 2.4;
      const p = this.pointAt(t), r = this.rightAt(t), tn = this.tangentAt(t);
      this.grid.push({
        x: p.x + r.x * lat, y: p.y, z: p.z + r.z * lat,
        yaw: Math.atan2(tn.x, tn.z),
      });
    }
  }

  // ---------- runtime API ----------
  pointAt(t, out = new THREE.Vector3()) {
    const N = this.N, s = this.samples;
    t = ((t % 1) + 1) % 1;
    const f = t * N, i = Math.floor(f) % N, j = (i + 1) % N, fr = f - Math.floor(f);
    return out.set(
      s.px[i] + (s.px[j] - s.px[i]) * fr,
      s.py[i] + (s.py[j] - s.py[i]) * fr,
      s.pz[i] + (s.pz[j] - s.pz[i]) * fr);
  }
  tangentAt(t, out = new THREE.Vector3()) {
    const N = this.N, s = this.samples;
    const i = Math.floor((((t % 1) + 1) % 1) * N) % N;
    return out.set(s.tx[i], s.ty ? s.ty[i] : 0, s.tz[i]);
  }
  rightAt(t, out = new THREE.Vector3()) {
    const N = this.N, s = this.samples;
    const i = Math.floor((((t % 1) + 1) % 1) * N) % N;
    return out.set(s.rx[i], 0, s.rz[i]);
  }

  // nearest sample to position; hint = previous index
  nearest(pos, hint = -1) {
    const N = this.N, s = this.samples;
    let bestI = 0, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -10; k <= 26; k++) {
        const i = ((hint + k) % N + N) % N;
        const dx = pos.x - s.px[i], dz = pos.z - s.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; }
      }
    } else {
      for (let i = 0; i < N; i += 6) {
        const dx = pos.x - s.px[i], dz = pos.z - s.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      // refine
      const rough = bestI;
      for (let k = -6; k <= 6; k++) {
        const i = ((rough + k) % N + N) % N;
        const dx = pos.x - s.px[i], dz = pos.z - s.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; }
      }
    }
    // lateral offset (signed)
    const dx = pos.x - s.px[bestI], dz = pos.z - s.pz[bestI];
    const lat = dx * s.rx[bestI] + dz * s.rz[bestI];
    return { i: bestI, t: bestI / N, lat, dist: Math.sqrt(bestD) };
  }

  inDRSZone(t) {
    for (const z of this.drsZones) {
      if (z.t0 < z.t1) { if (t >= z.t0 && t <= z.t1) return true; }
      else if (t >= z.t0 || t <= z.t1) return true;
    }
    return false;
  }

  setNight(nightFactor) {
    for (const e of this.lampMaterials) {
      e.mat.emissiveIntensity = e.day + (e.night - e.day) * nightFactor;
    }
    if (this.lampHeadMat) {
      this.lampHeadMat.emissive.setHex(nightFactor > 0.4 ? 0xfff2cc : 0x000000);
      this.lampHeadMat.emissiveIntensity = nightFactor * 2.2;
    }
  }

  setWet(wet) {
    if (this.roadMat) {
      this.roadMat.roughness = 0.92 - wet * 0.62;
      this.roadMat.metalness = 0.02 + wet * 0.25;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
}
