// ============ car.js — open-wheel race car builder ============
import * as THREE from 'three';
import { mergeGeometries, makeCanvasTexture, drawSignText } from './utils.js';

// Car faces +Z. Dimensions ~ F1: L 5.6m, W 2.0m, wheelbase 3.7m
export const CAR_DIM = {
  halfLen: 2.8, halfWid: 1.0, wheelR: 0.335, wheelW: 0.40,
  rearWheelR: 0.37, rearWheelW: 0.46,   // rears are bigger — must read from behind
  frontAxle: 1.85, rearAxle: -1.85, // z positions
};

function tireTexture(accent) {
  return makeCanvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#151517'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const g = 16 + Math.random() * 14;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.strokeStyle = accent; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(w, 10); ctx.stroke();
    drawSignText(ctx, 'BHARAT', w / 2, h / 2 + 8, 16, '#c8c8c8');
  });
}

function numberTexture(num, team) {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    const c = new THREE.Color(team.primary);
    ctx.fillStyle = `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(0, 0, w, 20);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
    drawSignText(ctx, String(num), w / 2, h / 2 + 4, 76, '#fff');
  });
}

export function buildCar(team, driverNum, accentHex) {
  const paint = [];   // primary color parts
  const carbon = [];  // dark carbon parts
  const accent = [];  // secondary color parts
  const R = CAR_DIM.wheelR;

  const bx = (arr, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    arr.push(g);
    return g;
  };
  const cyl = (arr, r0, r1, h, seg, x, y, z, rx = 0, rz = 0, ry = 0) => {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    arr.push(g);
    return g;
  };

  // ---------- floor & diffuser ----------
  bx(carbon, 1.9, 0.04, 4.6, 0, 0.06, -0.1);
  bx(carbon, 1.4, 0.03, 0.7, 0, 0.16, -2.5, 0, -0.35); // diffuser ramp
  for (const sd of [-1, 1]) bx(carbon, 0.02, 0.12, 0.7, sd * 0.5, 0.2, -2.5, 0, -0.35);

  // ---------- nose cone ----------
  bx(paint, 0.26, 0.22, 1.5, 0, 0.34, 1.9);            // main nose
  bx(paint, 0.2, 0.16, 0.8, 0, 0.28, 2.55);            // tip
  bx(accent, 0.22, 0.05, 0.5, 0, 0.40, 1.55);          // stripe

  // ---------- front wing ----------
  bx(carbon, 2.0, 0.03, 0.55, 0, 0.09, 2.62);          // main plane
  bx(carbon, 2.0, 0.02, 0.3, 0, 0.16, 2.78, 0, -0.25); // flap
  for (const sd of [-1, 1]) {
    bx(accent, 0.04, 0.3, 0.62, sd * 1.0, 0.2, 2.62);  // endplate
    bx(carbon, 0.3, 0.02, 0.3, sd * 0.82, 0.2, 2.7, 0, -0.3); // cascade
  }

  // ---------- monocoque / cockpit ----------
  bx(paint, 0.62, 0.42, 1.9, 0, 0.42, 0.45);           // chassis
  bx(paint, 0.56, 0.3, 0.9, 0, 0.55, -0.35);           // cockpit surround
  bx(accent, 0.6, 0.06, 1.2, 0, 0.66, 0.3);            // top stripe
  // cockpit opening (dark)
  bx(carbon, 0.44, 0.2, 0.85, 0, 0.62, -0.1);

  // ---------- halo ----------
  const haloG = new THREE.TorusGeometry(0.42, 0.035, 8, 20, Math.PI * 1.25);
  haloG.rotateZ(Math.PI * -0.125 + Math.PI / 2);
  haloG.rotateY(0);
  haloG.rotateX(0);
  haloG.translate(0, 0.78, 0.05);
  carbon.push(haloG);
  bx(carbon, 0.05, 0.3, 0.08, 0, 0.72, 0.48);          // halo front strut

  // ---------- mirrors & antenna ----------
  for (const sd of [-1, 1]) {
    bx(carbon, 0.16, 0.03, 0.05, sd * 0.42, 0.72, 0.42);
    bx(accent, 0.05, 0.08, 0.04, sd * 0.5, 0.74, 0.42);
  }
  cyl(carbon, 0.008, 0.008, 0.35, 4, 0.15, 0.95, -0.5);

  // ---------- sidepods ----------
  for (const sd of [-1, 1]) {
    bx(paint, 0.42, 0.34, 1.5, sd * 0.52, 0.36, -0.55);
    bx(carbon, 0.3, 0.18, 0.5, sd * 0.55, 0.42, -0.05);  // inlet
    bx(carbon, 0.36, 0.02, 1.1, sd * 0.68, 0.14, -0.6, 0, 0, sd * 0.06); // floor edge
  }
  // bargeboards
  for (const sd of [-1, 1]) bx(carbon, 0.02, 0.26, 0.7, sd * 0.45, 0.3, 0.6, sd * 0.25);

  // ---------- engine cover & shark fin ----------
  bx(paint, 0.4, 0.34, 1.6, 0, 0.62, -1.15);
  const fin = bx(accent, 0.03, 0.5, 1.5, 0, 0.92, -1.35, 0, 0.06);
  // airbox
  bx(carbon, 0.24, 0.18, 0.4, 0, 0.82, -0.62);
  // T-cam pods
  for (const sd of [-1, 1]) bx(accent, 0.08, 0.06, 0.14, sd * 0.3, 0.8, 0.32);

  // ---------- rear wing ----------
  bx(carbon, 1.0, 0.02, 0.35, 0, 0.78, -2.55);          // main plane
  for (const sd of [-1, 1]) {
    bx(paint, 0.04, 0.5, 0.6, sd * 0.98, 0.72, -2.5);   // endplates
    bx(carbon, 0.34, 0.03, 0.05, sd * 0.3, 0.5, -2.42); // swan mounts
  }
  // beam wing
  bx(carbon, 0.9, 0.02, 0.25, 0, 0.42, -2.6);

  // ---------- suspension ----------
  for (const sd of [-1, 1]) {
    for (const [az, len] of [[CAR_DIM.frontAxle, 0.75], [CAR_DIM.rearAxle, 0.7]]) {
      bx(carbon, len, 0.03, 0.05, sd * (len / 2 + 0.3), 0.42, az, sd * 0.08);
      bx(carbon, len, 0.03, 0.05, sd * (len / 2 + 0.3), 0.24, az + 0.08, -sd * 0.08);
    }
  }

  // ---------- assemble static meshes ----------
  const group = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({
    color: team.primary, roughness: 0.22, metalness: 0.45, envMapIntensity: 1.2,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x16181c, roughness: 0.45, metalness: 0.65,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: team.secondary, roughness: 0.3, metalness: 0.4,
  });
  const mk = (arr, mat, shadow = true) => {
    if (!arr.length) return null;
    const m = new THREE.Mesh(mergeGeometries(arr), mat);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  mk(paint, paintMat);
  mk(carbon, carbonMat);
  mk(accent, accentMat);

  // ---------- number fin decal ----------
  const numTex = numberTexture(driverNum, team);
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.35, metalness: 0.2 });
  for (const sd of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), numMat);
    p.position.set(sd * 0.03, 0.95, -1.35);
    p.rotation.y = sd * Math.PI / 2 + (sd > 0 ? 0 : Math.PI);
    p.rotation.y = sd > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.position.x = sd * 0.035;
    group.add(p);
  }

  // ---------- DRS flap (separate — animates) ----------
  const drsPivot = new THREE.Group();
  const flapG = new THREE.BoxGeometry(1.0, 0.02, 0.3);
  flapG.translate(0, 0, -0.15);
  const flap = new THREE.Mesh(flapG, carbonMat);
  flap.castShadow = true;
  drsPivot.add(flap);
  drsPivot.position.set(0, 0.94, -2.42);
  group.add(drsPivot);

  // ---------- rain light ----------
  const rainMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 0 });
  const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.03), rainMat);
  rainLight.position.set(0, 0.62, -2.78);
  group.add(rainLight);

  // ---------- headlights (lit at night via race loop) ----------
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: 0 });
  const hlGeo = new THREE.BoxGeometry(0.1, 0.06, 0.02);
  const headlights = [];
  for (const sd of [-1, 1]) {
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(sd * 0.32, 0.3, 2.62);
    group.add(hl);
    headlights.push(hl);
  }
  const beam = new THREE.SpotLight(0xfff0c8, 0, 60, 1.05, 0.55, 1.4);
  beam.position.set(0, 0.5, 2.3);
  const beamTarget = new THREE.Object3D();
  beamTarget.position.set(0, -0.4, 26);
  group.add(beam, beamTarget);
  beam.target = beamTarget;

  // ---------- wheels ----------
  // tire: dark rubber. A bright accent ring on the OUTER face makes the round tire
  // outline unmistakable from behind and in haze (this is what made the rears invisible).
  const tireTex = tireTexture('#ffd23f');
  const tireMat = new THREE.MeshStandardMaterial({ map: tireTex, roughness: 0.92, metalness: 0 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9c1cb, roughness: 0.3, metalness: 0.85, emissive: 0x23272c, emissiveIntensity: 0.5 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.6, emissive: 0xff4400, emissiveIntensity: 0 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0.2, emissive: 0xffd23f, emissiveIntensity: 0.3 });

  const wheels = {};
  const mkWheel = (x, z, key, steer, radius, width) => {
    const Wr = radius ?? R, Ww = width ?? CAR_DIM.wheelW;
    const pivot = new THREE.Group();       // steering pivot
    const spin = new THREE.Group();        // spinning group
    const tg = new THREE.CylinderGeometry(Wr, Wr, Ww, 26);
    tg.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tg, tireMat);
    tire.castShadow = true;
    spin.add(tire);
    // bright outer-face ring — outlines the tire so it's never lost against dark asphalt
    const ring = new THREE.Mesh(new THREE.TorusGeometry(Wr * 0.88, 0.02, 8, 32), ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x > 0 ? Ww / 2 + 0.012 : -(Ww / 2 + 0.012);
    spin.add(ring);
    // rim rings
    const rg = new THREE.CylinderGeometry(Wr * 0.55, Wr * 0.55, Ww + 0.02, 16);
    rg.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(rg, rimMat));
    // wheel cover (team color)
    const cg = new THREE.CylinderGeometry(Wr * 0.3, Wr * 0.3, Ww + 0.04, 12);
    cg.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(cg, accentMat));
    // brake disc
    const bg = new THREE.CylinderGeometry(Wr * 0.42, Wr * 0.42, 0.05, 14);
    bg.rotateZ(Math.PI / 2);
    const bd = new THREE.Mesh(bg, brakeMat);
    bd.position.x = x > 0 ? -0.12 : 0.12;
    spin.add(bd);
    pivot.add(spin);
    pivot.position.set(x, Wr + 0.02, z);
    group.add(pivot);
    wheels[key] = { pivot, spin, steer, radius: Wr };
  };
  mkWheel(-0.82, CAR_DIM.frontAxle, 'fl', true);
  mkWheel(0.82, CAR_DIM.frontAxle, 'fr', true);
  // rear track is wider + tires are bigger — from any rear/high camera the rear tires
  // must visibly clear the bodywork, otherwise the car looks like it has no rear wheels.
  // (cosmetic only — physics tracks its own contact model)
  mkWheel(-1.02, CAR_DIM.rearAxle, 'rl', false, CAR_DIM.rearWheelR, CAR_DIM.rearWheelW);
  mkWheel(1.02, CAR_DIM.rearAxle, 'rr', false, CAR_DIM.rearWheelR, CAR_DIM.rearWheelW);

  // ---------- driver ----------
  const helmetMat = new THREE.MeshStandardMaterial({ color: accentHex ?? team.secondary, roughness: 0.15, metalness: 0.3 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), helmetMat);
  helmet.position.set(0, 0.78, -0.05);
  helmet.castShadow = true;
  group.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.148, 14, 8, -0.6, 1.2, 1.1, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.05, metalness: 0.9 }));
  visor.position.copy(helmet.position);
  group.add(visor);
  // shoulders
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: team.primary, roughness: 0.7 }));
  shoulders.position.set(0, 0.62, -0.18);
  group.add(shoulders);

  // ---------- steering wheel (cockpit view) ----------
  const swGroup = new THREE.Group();
  const swRim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 14), carbonMat);
  swGroup.add(swRim);
  const swScreenMat = new THREE.MeshStandardMaterial({ color: 0x0a1420, emissive: 0x1a4a6a, emissiveIntensity: 0.8 });
  const swScreen = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.02), swScreenMat);
  swGroup.add(swScreen);
  swGroup.position.set(0, 0.68, 0.28);
  swGroup.rotation.x = -0.5;
  group.add(swGroup);

  group.traverse(o => { if (o.isMesh) o.matrixAutoUpdate = true; });

  return {
    group, wheels, drsPivot, rainMat, brakeMat, swGroup, helmet, helmetMat,
    headlightMat: hlMat, beam,
    cockpitAnchor: new THREE.Vector3(0, 0.86, 0.1),
    helmetAnchor: new THREE.Vector3(0, 0.92, 0.02),
  };
}
