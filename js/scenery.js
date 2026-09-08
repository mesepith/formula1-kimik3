// ============ scenery.js — city environments & landmarks ============
import * as THREE from 'three';
import { mergeGeometries, makeCanvasTexture, mulberry32, clamp, lerp, drawSignText } from './utils.js';

// ---------- facade textures ----------
function facadeTexture(style, baseColor) {
  return makeCanvasTexture(128, 256, (ctx, w, h) => {
    const c = new THREE.Color(baseColor);
    ctx.fillStyle = `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`;
    ctx.fillRect(0, 0, w, h);
    const cols = style === 'glass' ? 8 : 6, rows = style === 'glass' ? 22 : 12;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const wx = 6 + x * (w - 12) / cols, wy = 8 + y * (h - 16) / rows;
        const ww = (w - 12) / cols - 5, wh = (h - 16) / rows - 5;
        if (style === 'glass') {
          ctx.fillStyle = `rgba(${120 + Math.random() * 60},${170 + Math.random() * 50},${210 + Math.random() * 40},0.95)`;
        } else if (style === 'colonial') {
          ctx.fillStyle = Math.random() < 0.5 ? '#2a3038' : '#3a4450';
          ctx.beginPath(); ctx.arc(wx + ww / 2, wy + wh / 2, ww / 2.2, 0, Math.PI, true); ctx.fill();
        } else {
          ctx.fillStyle = Math.random() < 0.3 ? '#202830' : `rgba(${40 + Math.random() * 40},${50 + Math.random() * 40},${60 + Math.random() * 30},1)`;
        }
        ctx.fillRect(wx, wy, ww, wh);
      }
    }
    if (style === 'pink') { // jaipur crenellations + white trim
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 9, 8);
      ctx.fillRect(0, 14, w, 3);
    }
  });
}

function groundTexture(kind, baseColor) {return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const c = new THREE.Color(baseColor);
    ctx.fillStyle = `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`;
    ctx.fillRect(0, 0, w, h);
    const n = kind === 'sand' || kind === 'beach' ? 2600 : 5200;
    for (let i = 0; i < n; i++) {
      const v = (Math.random() - 0.5) * 36;
      ctx.fillStyle = `rgba(${c.r * 255 + v | 0},${c.g * 255 + v | 0},${c.b * 255 + v | 0},0.5)`;
      const s = kind === 'city' ? 8 + Math.random() * 30 : 2 + Math.random() * 4;
      ctx.fillRect(Math.random() * w, Math.random() * h, s, s * (kind === 'city' ? 0.5 : 1));
    }
    if (kind === 'tropical' || kind === 'dusty') {
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(30,60,25,${0.08 + Math.random() * 0.12})`;
        ctx.beginPath();
        ctx.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 12 + Math.random() * 26, Math.random() * 3, 0, 7);
        ctx.fill();
      }
    }
  });
}

// lift a hex color toward a brighter, more visible ground shade
function brightenGround(baseColor) {
  const c = new THREE.Color(baseColor);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.55), clamp(hsl.l * 1.6 + 0.08, 0.28, 0.6));
  return c.getHex();
}

// rocky noise retained for future terrain use
function mulberryWave(x, z) {
  const v = Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.019 - 0.7)
          + Math.sin(x * 0.047 - 0.5) * Math.cos(z * 0.043 + 1.1) * 0.5;
  return v * 0.5 + 0.5;
}

function palmFrondTexture() {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#2a6a20'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(64, 120); ctx.quadraticCurveTo(64, 40, 64, 8); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const t = i / 14, y = 112 - t * 96;
      const len = 12 + Math.sin(t * Math.PI) * 34;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `rgb(${30 + t * 40},${100 + t * 40},${30 + t * 20})`;
      ctx.beginPath(); ctx.moveTo(64, y); ctx.quadraticCurveTo(64 - len * .6, y - 8, 64 - len, y + 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(64, y); ctx.quadraticCurveTo(64 + len * .6, y - 8, 64 + len, y + 10); ctx.stroke();
    }
  });
}

function flagTexture() {
  return makeCanvasTexture(96, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ff9933'; ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#138808'; ctx.fillRect(0, 2 * h / 3, w, h / 3);
    ctx.strokeStyle = '#000080'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 9, 0, 7); ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * 9, h / 2 + Math.sin(a) * 9); ctx.stroke();
    }
  });
}

// ============================================================
export function buildEnvironment(scene, track, city, opts = {}) {
  const rng = mulberry32(city.seed * 7 + 3);
  const group = new THREE.Group();
  const env = city.env;
  const animated = [];    // update callbacks fn(dt, t)
  const nightMats = [];   // {mat, day, night}
  const s = track.samples, N = track.N;
  const hw = track.halfWidth;

  // ---------- bounding box of track ----------
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < N; i += 4) {
    minX = Math.min(minX, s.px[i]); maxX = Math.max(maxX, s.px[i]);
    minZ = Math.min(minZ, s.pz[i]); maxZ = Math.max(maxZ, s.pz[i]);
    minY = Math.min(minY, s.py[i]); maxY = Math.max(maxY, s.py[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const sizeX = maxX - minX + 1400, sizeZ = maxZ - minZ + 1400;

  // ---------- ground / terrain ----------
  const gtex = groundTexture(env.groundKind, brightenGround(env.ground));
  gtex.repeat.set(sizeX / 90, sizeZ / 90);
  const gmat = new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.96, metalness: 0 });
  let flatGround = null;
  // terrainHeight(x,z): exposed for the mountain circuit so props & buildings can be
  // anchored to the sculpted terrain (Ladakh). Flat cities keep y=0.
  let terrainHeight = null;
  if (env.monument === 'mountains') {
    // Lap profile: this circuit spirals UP a mountain. The road folds back over
    // itself, so any (x,z) column can have SEVERAL road altitudes stacked above it.
    // The terrain for that column must hug the LOWEST of those altitudes (the one the
    // player actually drives along the valley floor), or it will bulge up between the
    // levels and hang over the lower road like a floating roof.
    //
    // Precompute, for every sample, the lowest road altitude reachable within the
    // fold corridor (foldR). Then terrain targets that floor minus a small shoulder,
    // filling the chasm right up to the road edge so the ribbon never floats, while
    // never poking THROUGH a higher level (min() keeps it under whichever level is
    // physically lowest at that column).
    const foldR = 165;
    const yLow = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let lo = s.py[i];
      for (let j = 0; j < N; j += 2) {
        const dx = s.px[i] - s.px[j], dz = s.pz[i] - s.pz[j];
        if (dx * dx + dz * dz < foldR * foldR && s.py[j] < lo) lo = s.py[j];
      }
      yLow[i] = lo;
    }
    // smooth the floor so the terrain doesn't staircase along the ribbon
    const yLowSm = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) sum += yLow[(i + k + N) % N];
      yLowSm[i] = sum / 13;
    }

    // nearest-distance + floor query (coarse; matches the vertex pass below)
    const queryFloor = (x, z) => {
      let dMin = 1e9, yF = 0;
      for (let i = 0; i < N; i += 3) {
        const dx = x - s.px[i], dz = z - s.pz[i];
        const d = dx * dx + dz * dz;
        if (d < dMin) { dMin = d; yF = yLowSm[i]; }
      }
      return { d: Math.sqrt(dMin), yFloor: yF };
    };

    const shoulder = 2.1;   // terrain sits this far below the driving surface
    const blendR = 130;     // horizontal distance over which terrain falls from road to far peaks
    terrainHeight = (x, z) => {
      const { d, yFloor } = queryFloor(x, z);
      const ridge = Math.abs(Math.sin(x * 0.008) * Math.cos(z * 0.011)) + Math.abs(Math.sin(x * 0.021 + z * 0.017));
      const rise = clamp((d - 48) / blendR, 0, 1);
      let h = yFloor - shoulder + rise * rise * (48 + ridge * 80);
      // far background must read as high peaks, not a black hole
      h = Math.max(h, minY - 30);
      return h;
    };

    const seg = 120;
    const tg = new THREE.PlaneGeometry(sizeX, sizeZ, seg, seg);
    tg.rotateX(-Math.PI / 2);
    const posA = tg.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    const cRock = new THREE.Color(0x5c554c), cSnow = new THREE.Color(0xf4f8fc), cDirt = new THREE.Color(0x4a4038);
    for (let vi = 0; vi < posA.count; vi++) {
      const x = posA.getX(vi) + cx, z = posA.getZ(vi) + cz;
      const { d: dRoad, yFloor } = queryFloor(x, z);
      const h = terrainHeight(x, z);
      posA.setY(vi, h);
      // Snow only on genuine high ground that is FAR from the circuit. Near the road
      // the surface is the shoulder/cut, which must read as rock & dirt — otherwise a
      // smooth pale mound reads as sky and makes grounded buildings look airborne.
      let snow = clamp((h - (maxY - 6)) / 42, 0, 1);
      const dFade = clamp((dRoad - 130) / 90, 0, 1); // fade snow in with distance
      snow *= dFade * dFade * (3 - 2 * dFade);
      const cc = snow > 0.08 ? cSnow.clone().lerp(cRock, 1 - snow) : cDirt;
      colors[vi * 3] = cc.r; colors[vi * 3 + 1] = cc.g; colors[vi * 3 + 2] = cc.b;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tg.computeVertexNormals();
    const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const terrain = new THREE.Mesh(tg, tm);
    terrain.position.set(cx, 0, cz);
    terrain.receiveShadow = true;
    group.add(terrain);
    // tunnel over a high section
    const ti = Math.floor(0.55 * N);
    const tPos = track.pointAt(0.55), tRight = track.rightAt(0.55), tTan = track.tangentAt(0.55);
    const tunnel = new THREE.Group();
    const tMat = new THREE.MeshStandardMaterial({ color: 0x5a5248, roughness: 0.95, side: THREE.DoubleSide });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(hw + 4.5, hw + 4.5, 90, 18, 1, true, 0, Math.PI), tMat);
    tube.rotation.z = Math.PI / 2; tube.rotation.y = Math.PI / 2;
    tube.position.y = 0;
    tunnel.add(tube);
    // interior light strip
    const stripTex = makeCanvasTexture(16, 128, (ctx, w, h) => {
      for (let i = 0; i < 8; i++) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(4, i * 16 + 4, 8, 6); }
    });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(86, 1.2),
      new THREE.MeshStandardMaterial({ map: stripTex, emissive: 0xffffff, emissiveMap: stripTex, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
    strip.rotation.x = Math.PI / 2; strip.position.y = hw + 3.4;
    tunnel.add(strip);
    nightMats.push({ mat: strip.material, day: 0.8, night: 1.6 });
    tunnel.position.copy(tPos);
    tunnel.rotation.y = Math.atan2(tTan.x, tTan.z) + Math.PI / 2;
    group.add(tunnel);
  } else {
    flatGround = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), gmat);
    flatGround.rotation.x = -Math.PI / 2;
    flatGround.position.set(cx, -0.08, cz);
    flatGround.receiveShadow = true;
    group.add(flatGround);
  }
  const groundY = () => 0; // flat cities
  const hasElevation = (maxY - minY) > 0.5; // any city with meaningful elevation changes

  // For cities with elevation, add a shaped underlay that fills the gap between the
  // road and the terrain, so no section ever looks like a floating ribbon.
  if (env.monument !== 'mountains' && hasElevation) {
    const segX = Math.max(24, Math.floor(sizeX / 40));
    const segZ = Math.max(24, Math.floor(sizeZ / 40));
    const tg = new THREE.PlaneGeometry(sizeX, sizeZ, segX, segZ);
    tg.rotateX(-Math.PI / 2);
    const posA = tg.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    for (let vi = 0; vi < posA.count; vi++) {
      const x = posA.getX(vi) + cx, z = posA.getZ(vi) + cz;
      let dMin = 1e9, yNear = 0;
      for (let i = 0; i < N; i += 6) {
        const dx = x - s.px[i], dz = z - s.pz[i];
        const d = dx * dx + dz * dz;
        if (d < dMin) { dMin = d; yNear = s.py[i]; }
      }
      dMin = Math.sqrt(dMin);
      // terrain rises to just below the road near the circuit, then falls away
      let h;
      if (dMin < 12) h = yNear - 0.35;
      else if (dMin < 45) h = yNear - 0.35 - (dMin - 12) * 0.05;
      else h = Math.max(yNear - 2, 0);
      posA.setY(vi, h);
      const c = new THREE.Color(env.ground).multiplyScalar(0.75 + 0.25 * clamp(dMin / 45, 0, 1));
      colors[vi * 3] = c.r; colors[vi * 3 + 1] = c.g; colors[vi * 3 + 2] = c.b;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tg.computeVertexNormals();
    const underlay = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    underlay.position.set(cx, 0, cz);
    underlay.receiveShadow = true;
    group.add(underlay);
    // hide the flat ground plane — the underlay replaces it
    if (flatGround) flatGround.visible = false;
  }

  // ---------- water ----------
  if (env.water) {
    const wdir = new THREE.Vector2(env.water[0] ?? env.water.dir[0], env.water.dir[1]).normalize();
    const wsize = 2600;
    const wtex = makeCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#1a4a66'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(${40 + Math.random() * 40},${110 + Math.random() * 60},${150 + Math.random() * 60},0.35)`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 14 + Math.random() * 30, 2);
      }
    });
    wtex.repeat.set(18, 18);
    const wmat = new THREE.MeshStandardMaterial({
      map: wtex, color: env.water.kind === 'backwater' ? 0x3a6a50 : 0x2a6a9a,
      roughness: 0.12, metalness: 0.45,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(wsize, wsize), wmat);
    water.rotation.x = -Math.PI / 2;
    const wcx = cx + wdir.x * (Math.max(sizeX, sizeZ) / 2 * 0.4 + env.water.dist);
    const wcz = cz + wdir.y * (Math.max(sizeX, sizeZ) / 2 * 0.4 + env.water.dist);
    water.position.set(wcx, -0.35, wcz);
    group.add(water);
    animated.push((dt, t) => { wtex.offset.set(Math.sin(t * 0.02) * 0.05 + t * 0.004, t * 0.007); });

    // boats
    const boatG = [];
    for (let b = 0; b < 7; b++) {
      const bx = wcx + (rng() - 0.5) * 900, bz = wcz + (rng() - 0.5) * 900;
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 2.2),
        new THREE.MeshStandardMaterial({ color: [0xc84a20, 0x2a6a9a, 0xd8b020, 0xeeeeee][b % 4], roughness: 0.8 }));
      hull.position.y = 0.4; boat.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4), new THREE.MeshStandardMaterial({ color: 0x6a4a2a }));
      mast.position.y = 2.4; boat.add(mast);
      boat.position.set(bx, -0.1, bz);
      boat.rotation.y = rng() * 6;
      group.add(boat);
      const phase = rng() * 6;
      animated.push((dt, t) => { boat.position.y = -0.1 + Math.sin(t * 0.8 + phase) * 0.15; boat.rotation.z = Math.sin(t * 0.6 + phase) * 0.04; });
    }
    // beach sand strip for goa
    if (env.water.kind === 'beach') {
      const sandTex = groundTexture('beach', 0xe0c88a);
      sandTex.repeat.set(30, 6);
      const sand = new THREE.Mesh(new THREE.PlaneGeometry(wsize, 300),
        new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
      sand.rotation.x = -Math.PI / 2;
      sand.position.set(wcx - wdir.x * (wsize / 2 - 130), -0.05, wcz - wdir.y * (wsize / 2 - 130));
      group.add(sand);
    }
  }

  // ---------- buildings ----------
  const style = env.buildings.style;
  const palettes = env.buildings.palette;
  const groupsByStyle = {};
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  boxG.translate(0, 0.5, 0);
  const instances = [];
  const waterDir = env.water ? new THREE.Vector2(env.water.dir[0], env.water.dir[1]).normalize() : null;

  // track clearance helper: buildings must never sit on the road/apron
  const clearance = (x, z) => {
    let dMin = 1e9;
    for (let j = 0; j < N; j += 6) {
      const dx = x - s.px[j], dz = z - s.pz[j];
      const d = dx * dx + dz * dz;
      if (d < dMin) dMin = d;
    }
    return Math.sqrt(dMin);
  };
  const minClear = hw + 26; // keep city blocks well outside the barriers
  const isMountain = env.monument === 'mountains';
  // lowest road altitude near a point (any axis) — used to anchor Ladakh buildings to
  // the valley floor so they never hover over the terrain dug under a folded-over section
  const lowestRoadNear = (x, z) => {
    let lo = Infinity;
    for (let j = 0; j < N; j += 2) {
      const dx = x - s.px[j], dz = z - s.pz[j];
      if (dx * dx + dz * dz < 200 * 200 && s.py[j] < lo) lo = s.py[j];
    }
    return lo;
  };

  for (let i = 0; i < N; i += 3) {
    if (rng() > env.buildings.density) continue;
    for (const side of [-1, 1]) {
      if (rng() < 0.35) continue;
      const lat = side * (hw + 30 + rng() * 60);
      const bx = s.px[i] + s.rx[i] * lat, bz = s.pz[i] + s.rz[i] * lat;
      if (waterDir) {
        const d = new THREE.Vector2(bx - cx, bz - cz).normalize();
        if (d.dot(waterDir) > 0.45) continue; // keep waterfront open
      }
      // Ladakh: a building spawned next to a HIGH section that has a LOWER section
      // folding under it would hover above the valley floor. Only allow buildings on
      // terrain that is near the local road (i.e. beside the lowest stacked level) —
      // and even then only on the gentle valley floor, never on a stepped shelf.
      if (isMountain && terrainHeight) {
        const low = lowestRoadNear(bx, bz);
        if (low !== Infinity && s.py[i] > low + 7) continue; // high shelf above a lower road
        if (s.py[i] > minY + 26) continue; // keep the high climbs clear of clutter
      }
      const w = 10 + rng() * 22, d = 10 + rng() * 22;
      const footprint = Math.hypot(w, d) / 2;
      if (clearance(bx, bz) < minClear + footprint) continue; // would touch the circuit
      const distC = Math.hypot(bx - cx, bz - cz);
      const central = 1 - clamp(distC / (Math.max(sizeX, sizeZ) * 0.5), 0, 1);
      let hMax = env.buildings.maxH * (0.35 + central * 0.9);
      let hgt = 8 + rng() * hMax;
      if (style === 'colonial' || style === 'pink' || style === 'goa' || style === 'kochi') hgt = 6 + rng() * env.buildings.maxH;
      if (style === 'ladakh') hgt = 4 + rng() * 8;
      const color = palettes[Math.floor(rng() * palettes.length)];
      // Ladakh: sit the base on the actual terrain instead of the road altitude, so
      // buildings on the lower slopes never float and never get buried by the road.
      let baseY = 0;
      if (isMountain && terrainHeight) {
        // Ground the building on the LOWEST terrain anywhere under its footprint —
        // the corner check matters here: on a stepped fold-slope the downhill corner
        // can hang meters below the centre point, which is what made single boxes
        // hover. Sample the 4 corners + centre and take the minimum.
        const hwf = w / 2, hdf = d / 2;
        let ty = Infinity;
        // conservative: sample a small disc of points covering the rotated footprint
        for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
          const px = bx + ox * hwf, pz = bz + oz * hdf;
          ty = Math.min(ty, terrainHeight(px, pz));
        }
        // If the fold put the bowl floor far below this road section, drop the box —
        // it would float over the gap no matter where we ground it.
        if (s.py[i] - ty > 9) continue;
        // settle the box 1.5m into its footing so the whole lower edge is grounded
        // even on the coarse terrain mesh (no daylight under the downhill corner).
        baseY = Math.min(ty, s.py[i] - 1.0) - 1.5;
      }
      instances.push({ x: bx, z: bz, y: baseY, w, d, h: hgt, yaw: rng() * Math.PI, color });
    }
  }
  // bucket by color palette index → instanced meshes
  const byColor = {};
  for (const inst of instances) {
    (byColor[inst.color] = byColor[inst.color] || []).push(inst);
  }
  for (const colorHex of Object.keys(byColor)) {
    const list = byColor[colorHex];
    const ft = facadeTexture(style, Number(colorHex));
    const mat = new THREE.MeshStandardMaterial({
      map: ft, roughness: style === 'glass' ? 0.25 : 0.85,
      metalness: style === 'glass' ? 0.55 : 0.05,
      emissiveMap: style === 'glass' || style === 'modern' || style === 'mumbai' ? ft : null,
      emissive: (style === 'glass' || style === 'modern' || style === 'mumbai') ? new THREE.Color(0xffe9b0) : new THREE.Color(0),
      emissiveIntensity: 0,
    });
    nightMats.push({ mat, day: 0, night: style === 'glass' ? 1.1 : 0.55 });
    const im = new THREE.InstancedMesh(boxG, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
    list.forEach((inst, k) => {
      const y = (inst.y === null || inst.y === undefined) ? 0 : inst.y;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.yaw);
      sc.set(inst.w, inst.h, inst.d);
      pv.set(inst.x, y - 0.1, inst.z);
      m4.compose(pv, q, sc);
      im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false;
    group.add(im);
  }

  // ---------- trees ----------
  if (env.trees !== 'none' && env.treeDensity > 0.1) {
    const count = Math.floor(260 * env.treeDensity);
    const trunkG = new THREE.CylinderGeometry(0.14, 0.22, 3.2, 5);
    trunkG.translate(0, 1.6, 0);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, count);
    let crowns;
    const isPalm = env.trees === 'palm' || env.trees === 'coconut';
    if (isPalm) {
      const frondT = palmFrondTexture();
      const f1 = new THREE.PlaneGeometry(3.4, 3.4);
      const fG = mergeGeometries([f1, f1.clone().rotateY(Math.PI / 2), f1.clone().rotateY(Math.PI / 4), f1.clone().rotateY(-Math.PI / 4)]);
      fG.translate(0, 4.4, 0);
      crowns = new THREE.InstancedMesh(fG, new THREE.MeshStandardMaterial({
        map: frondT, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: env.trees === 'coconut' ? 0x3a8a2a : 0x2a7a30,
      }), count);
    } else {
      const crownG = new THREE.IcosahedronGeometry(1.9, 1);
      crownG.translate(0, 4.0, 0);
      crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0x3a7a2a, roughness: 1, flatShading: true }), count);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sc = new THREE.Vector3();
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const i = Math.floor(rng() * N);
      const side = rng() < 0.5 ? -1 : 1;
      const lat = side * (hw + 5.5 + rng() * 30);
      const x = s.px[i] + s.rx[i] * lat, z = s.pz[i] + s.rz[i] * lat;
      if (waterDir) {
        const d = new THREE.Vector2(x - cx, z - cz).normalize();
        if (d.dot(waterDir) > 0.75) continue;
      }
      const scale = 0.8 + rng() * (env.trees === 'coconut' ? 0.9 : 0.5);
      if (clearance(x, z) < hw + 5.0 + scale * 3.6) continue; // keep fronds off the track
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.3);
      const treeY = (env.monument === 'mountains' && terrainHeight) ? terrainHeight(x, z) : s.py[i] - 0.05;
      pv.set(x, treeY, z);
      sc.set(scale, scale * (env.trees === 'coconut' ? 1.35 : 1), scale);
      m4.compose(pv, q, sc);
      trunks.setMatrixAt(placed, m4);
      crowns.setMatrixAt(placed, m4);
      placed++;
    }
    trunks.count = placed; crowns.count = placed;
    trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
    group.add(trunks, crowns);
  }

  // ---------- monuments ----------
  buildMonument(group, track, city, rng, nightMats, animated, { cx, cz, minY, maxY, terrainHeight });

  // ---------- street traffic (outside barriers) ----------
  buildTraffic(group, track, city, rng, animated);

  // ---------- flags along start straight ----------
  const flagT = flagTexture();
  for (let k = 0; k < 10; k++) {
    const t = 1 - (30 + k * 12) / track.length;
    const p = track.pointAt(t), r = track.rightAt(t);
    const side = k % 2 ? 1 : -1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 7),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.7, roughness: 0.4 }));
    pole.position.set(p.x + r.x * side * (hw + 4.6), p.y + 3.5, p.z + r.z * side * (hw + 4.6));
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1),
      new THREE.MeshStandardMaterial({ map: flagT, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(pole.position.x, p.y + 6.2, pole.position.z);
    group.add(flag);
    const ph = k * 0.7;
    animated.push((dt, t) => { flag.rotation.y = Math.sin(t * 2.2 + ph) * 0.28; });
  }

  // ---------- street signs ----------
  const signTexts = { mumbai: 'मरिन ड्राइव', delhi: 'राजपथ', bengaluru: 'टेक पार्क', hyderabad: 'हाइटेक सिटी', chennai: 'मरीना', kolkata: 'हावड़ा', jaipur: 'पिंक सिटी', ahmedabad: 'रिवरफ्रंट', kochi: 'बैकवॉटर', goa: 'बीच रोड', ladakh: 'खारदुंग ला' };
  const signTex = makeCanvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#0a5aa8'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(3, 3, w - 6, h - 6);
    drawSignText(ctx, signTexts[city.id] || city.name, w / 2, h / 2 - 10, 26, '#fff');
    drawSignText(ctx, city.name + ' GP CIRCUIT', w / 2, h - 14, 13, '#ffd23f');
  });
  for (let k = 0; k < 6; k++) {
    const t = (k / 6 + 0.08) % 1;
    const p = track.pointAt(t), r = track.rightAt(t), tn = track.tangentAt(t);
    const side = k % 2 ? 1 : -1;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.5 }));
    post.position.set(p.x + r.x * side * (hw + 4.2), p.y + 1.6, p.z + r.z * side * (hw + 4.2));
    group.add(post);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65),
      new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide }));
    sign.position.set(post.position.x, p.y + 3.1, post.position.z);
    sign.rotation.y = Math.atan2(tn.x, tn.z) + Math.PI / 2;
    group.add(sign);
  }

  scene.add(group);
  return {
    group, animated, nightMats,
    update(dt, t) { for (const fn of animated) fn(dt, t); },
    dispose() {
      scene.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
      });
    }
  };
}

// ---------- monuments ----------
function buildMonument(group, track, city, rng, nightMats, animated, bbox) {
  const type = city.env.monument;
  if (!type) return;
  const s = track.samples, N = track.N, hw = track.halfWidth;
  const m = new THREE.Group();

  const at = (t, lat) => {
    const i = Math.floor(((t % 1) + 1) % 1 * N);
    return { x: s.px[i] + s.rx[i] * lat, y: s.py[i], z: s.pz[i] + s.rz[i] * lat, yaw: Math.atan2(s.tx[i], s.tz[i]) };
  };

  if (type === 'indiaGate') {
    const p = at(0.5, hw + 90);
    const sand = new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.85 });
    // arch: 2 pylons + beam + cornice + chhatri
    const pyG = new THREE.BoxGeometry(7, 30, 7);
    for (const side of [-1, 1]) {
      const py = new THREE.Mesh(pyG, sand);
      py.position.set(side * 8, 15, 0);
      m.add(py);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 8), sand);
    beam.position.y = 30; m.add(beam);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(28, 2, 9), sand);
    cornice.position.y = 34.5; m.add(cornice);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8, 0, 7, 0, 2), sand);
    dome.position.y = 37; m.add(dome);
    // arch opening visual (dark inset)
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 8.4, 16, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1, side: THREE.DoubleSide }));
    arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
    arch.position.y = 24; arch.scale.set(1, 1, 1.05);
    m.add(arch);
    // lawns
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(60, 24),
      new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.05;
    m.add(lawn);
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.yaw;
    m.traverse(o => { o.castShadow = true; });
  }
  else if (type === 'fort') {
    const p = at(0.35, -(hw + 160));
    const wallM = new THREE.MeshStandardMaterial({ color: 0xd87a50, roughness: 0.95 });
    // hill
    const hill = new THREE.Mesh(new THREE.ConeGeometry(130, 70, 12),
      new THREE.MeshStandardMaterial({ color: 0xa88a60, roughness: 1, flatShading: true }));
    hill.position.y = 30; m.add(hill);
    // ramparts
    for (let ring = 0; ring < 3; ring++) {
      const r = 60 - ring * 16, y = 62 + ring * 10;
      const wallT = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 3, 9, 14, 1, true), wallM);
      wallT.position.y = y; m.add(wallT);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 13, 8), wallM);
        tw.position.set(Math.cos(a) * r, y + 1, Math.sin(a) * r);
        m.add(tw);
      }
    }
    const palace = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 18), new THREE.MeshStandardMaterial({ color: 0xe89878, roughness: 0.9 }));
    palace.position.y = 88; m.add(palace);
    m.position.set(p.x, p.y, p.z);
  }
  else if (type === 'bridge') {
    // Howrah-style steel cantilever silhouette spanning the river (to the -x side)
    const p = at(0.3, -(hw + 120));
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a5a68, roughness: 0.55, metalness: 0.75 });
    const span = 260;
    for (const side of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 62, 10), steel);
      tower.position.set(side * span / 2, 31, 0);
      m.add(tower);
      // truss arms
      for (let k = 0; k < 5; k++) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(span / 5.2, 3.2, 7), steel);
        arm.position.set(side * (span / 2 - (k + 0.5) * span / 10), 58 - k * 4.4, 0);
        arm.rotation.z = side * 0.16;
        m.add(arm);
      }
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 120, 3, 16), steel);
    deck.position.y = 24; m.add(deck);
    m.position.set(p.x, 0, p.z);
    m.rotation.y = 0.4;
  }
  else if (type === 'cyberTowers') {
    const p = at(0.62, hw + 70);
    const glassM = new THREE.MeshStandardMaterial({ color: 0x3a6a9a, roughness: 0.15, metalness: 0.7, emissive: 0x224466, emissiveIntensity: 0.25 });
    for (let k = 0; k < 4; k++) {
      const h = 55 + k * 14;
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(9 - k, 11 - k, h, 8), glassM);
      tw.position.set((k - 1.5) * 26, h / 2, (k % 2) * 22);
      m.add(tw);
    }
    nightMats.push({ mat: glassM, day: 0.25, night: 1.0 });
    const logoTex = makeCanvasTexture(256, 64, (ctx, w, h) => {
      ctx.fillStyle = '#0a1626'; ctx.fillRect(0, 0, w, h);
      drawSignText(ctx, 'CYBER CITY', w / 2, h / 2, 34, '#00e0ff');
    });
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(40, 10),
      new THREE.MeshStandardMaterial({ map: logoTex, emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: 0.8 }));
    logo.position.set(0, 46, 14); m.add(logo);
    nightMats.push({ mat: logo.material, day: 0.5, night: 1.6 });
    m.position.set(p.x, p.y, p.z);
  }
  else if (type === 'port') {
    const p = at(0.75, hw + 60);
    const craneM = new THREE.MeshStandardMaterial({ color: 0xd84a20, roughness: 0.6, metalness: 0.4 });
    for (let k = 0; k < 3; k++) {
      const crane = new THREE.Group();
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 42, 2), craneM);
        leg.position.set(side * 12, 21, 0); crane.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(58, 3, 3), craneM);
      beam.position.y = 42; crane.add(beam);
      crane.position.set(k * 70 - 70, 0, (k % 2) * 30);
      crane.rotation.y = 0.3;
      m.add(crane);
    }
    // containers
    for (let k = 0; k < 16; k++) {
      const cont = new THREE.Mesh(new THREE.BoxGeometry(12, 2.6, 2.6),
        new THREE.MeshStandardMaterial({ color: [0xc83a2a, 0x2a6a9a, 0x3a8a3a, 0xd8a020][k % 4], roughness: 0.8 }));
      cont.position.set((rng() - 0.5) * 160, 1.3 + Math.floor(k / 8) * 2.7, 20 + (rng() - 0.5) * 60);
      m.add(cont);
    }
    m.position.set(p.x, p.y, p.z);
  }
  else if (type === 'lighthouse') {
    const p = at(0.45, -(hw + 80));
    const lhM = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7 });
    const stripeM = new THREE.MeshStandardMaterial({ color: 0xd83a2a, roughness: 0.7 });
    for (let k = 0; k < 5; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - k * 0.25, 2.8 - k * 0.25, 5, 12), k % 2 ? stripeM : lhM);
      seg.position.y = 2.5 + k * 5;
      m.add(seg);
    }
    const lampM = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe9a8, emissiveIntensity: 0.4 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), lampM);
    lamp.position.y = 27; m.add(lamp);
    nightMats.push({ mat: lampM, day: 0.4, night: 2.4 });
    animated.push((dt, t) => { lamp.material.emissiveIntensity = (0.4 + Math.max(0, Math.sin(t * 1.4)) * 1.6) * (nightMats[0]?.f ?? 1); });
    m.position.set(p.x, p.y, p.z);
  }
  else if (type === 'fishingNets') {
    const p = at(0.55, -(hw + 40));
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 });
    const netM = new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) {
      const net = new THREE.Group();
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 10), wood);
        pole.position.set(side * 4, 4, 0);
        pole.rotation.z = side * 0.3;
        net.add(pole);
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), netM);
      mesh.position.y = 5.5; mesh.rotation.x = 0.5;
      net.add(mesh);
      net.position.set(k * 18 - 27, 0, (k % 2) * 8);
      m.add(net);
    }
    m.position.set(p.x, p.y, p.z);
  }
  else if (type === 'riverBridge') {
    // cable-stayed bridge crossing the track
    const p = at(0.4, 0);
    const conc = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.7 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 300), conc);
    deck.rotation.y = Math.PI / 2;
    deck.position.y = 14;
    m.add(deck);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(3, 60, 3), conc);
    pylon.position.y = 30; m.add(pylon);
    const cableM = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4, emissive: 0x554400 });
    for (let k = 1; k <= 6; k++) {
      for (const side of [-1, 1]) {
        const len = Math.hypot(46, k * 20);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, len), cableM);
        cable.position.set(side * k * 10, 14 + (46) / 2, 0);
        cable.rotation.z = side * Math.atan2(k * 20, 46);
        m.add(cable);
      }
    }
    nightMats.push({ mat: cableM, day: 0.1, night: 1.2 });
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.yaw + 0.5;
  }
  else if (type === 'mountains') {
    // monastery on a spur + prayer flags
    const p = at(0.8, hw + 90);
    const base = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 20),
      new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.95 }));
    base.position.y = 7; m.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(22, 8, 14),
      new THREE.MeshStandardMaterial({ color: 0xc84a30, roughness: 0.9 }));
    top.position.y = 18; m.add(top);
    for (let k = 0; k < 5; k++) {
      const stupa = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 8),
        new THREE.MeshStandardMaterial({ color: 0xd8b020 }));
      stupa.position.set(-10 + k * 5, 25, 0);
      m.add(stupa);
    }
    // The monastery sits on a spur at road level (its intended shelf). Because the
    // lap folds over itself here, the terrain directly below is dug down to the lower
    // level — so we run a stone foundation pier from the building's base all the way
    // down to that valley floor. Result: a terraced cliff-face monastery, never a
    // floating box.
    const floorY = bbox.terrainHeight ? bbox.terrainHeight(p.x, p.z) : 0;
    const baseY = Math.max(floorY, p.y + 2);   // perch just above the local road shelf
    m.position.set(p.x, baseY, p.z);
    const drop = (baseY - floorY) + 6;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(26, drop, 18),
      new THREE.MeshStandardMaterial({ color: 0x6a6156, roughness: 1 }));
    pier.position.y = 2 - drop / 2; m.add(pier);
  }

  group.add(m);
}

// ---------- moving traffic ----------
function buildTraffic(group, track, city, rng, animated) {
  const s = track.samples, N = track.N, hw = track.halfWidth;
  if (city.env.monument === 'mountains') return; // no traffic in Ladakh
  const vehicles = [];
  const isMumbai = city.id === 'mumbai';

  function rickshaw() {
    const g = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: 0x2a7a2a, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 2.0), bodyM);
    body.position.y = 0.85; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 2.0), new THREE.MeshStandardMaterial({ color: 0xd8c820 }));
    top.position.y = 1.6; g.add(top);
    const wheelG = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 8);
    wheelG.rotateZ(Math.PI / 2);
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x181818 });
    for (const [x, z] of [[-0.6, 0.6], [0.6, 0.6], [0, -0.75]]) {
      const w = new THREE.Mesh(wheelG, wheelM);
      w.position.set(x, 0.25, z); g.add(w);
    }
    return g;
  }
  function taxi() {
    const g = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: isMumbai ? 0x222222 : 0xe8e8e8, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 4.0), bodyM);
    body.position.y = 0.6; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.2), isMumbai ? new THREE.MeshStandardMaterial({ color: 0xd8c820 }) : bodyM);
    cab.position.set(0, 1.15, -0.2); g.add(cab);
    return g;
  }
  function bus() {
    const g = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: isMumbai ? 0xc83028 : 0x2a6a3a, roughness: 0.65 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 9), bodyM);
    body.position.y = 1.7; g.add(body);
    const winM = new THREE.MeshStandardMaterial({ color: 0x9ac0d8, roughness: 0.2, metalness: 0.5 });
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.8, 8.2), winM);
    win.position.y = 2.3; g.add(win);
    return g;
  }

  const makers = [rickshaw, rickshaw, rickshaw, taxi, taxi, bus];
  for (let v = 0; v < 12; v++) {
    const mesh = makers[v % makers.length]();
    const side = v % 2 ? 1 : -1;
    const lat = side * (hw + 9.5 + (v % 3));
    mesh.userData = { t: rng(), speed: (6 + rng() * 6) * (side > 0 ? 1 : -1) / 1, lat };
    group.add(mesh);
    vehicles.push(mesh);
  }
  const p = new THREE.Vector3(), r = new THREE.Vector3(), tn = new THREE.Vector3();
  animated.push((dt, t) => {
    for (const v of vehicles) {
      v.userData.t = (v.userData.t + v.userData.speed * dt / track.length + 1) % 1;
      track.pointAt(v.userData.t, p);
      track.rightAt(v.userData.t, r);
      track.tangentAt(v.userData.t, tn);
      v.position.set(p.x + r.x * v.userData.lat, p.y, p.z + r.z * v.userData.lat);
      const dir = v.userData.speed > 0 ? 1 : -1;
      v.rotation.y = Math.atan2(tn.x * dir, tn.z * dir);
    }
  });
}
