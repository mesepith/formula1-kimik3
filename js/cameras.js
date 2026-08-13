// ============ cameras.js — camera rig & cinematics ============
import * as THREE from 'three';
import { clamp, lerp, damp, easeInOutCubic, Timeline } from './utils.js';

export const CAM_MODES = ['chase', 'cockpit', 'helmet', 'nose', 'tv', 'aerial'];
const CAM_LABELS = { chase: 'CHASE CAM', cockpit: 'COCKPIT', helmet: 'HELMET CAM', nose: 'WING CAM', tv: 'TV BROADCAST', aerial: 'AERIAL' };

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.shake = 0;
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._tvPoints = [];
    this._tvIdx = 0;
    this._tvTimer = 0;
    this.cinematic = null;  // active Timeline
    this._cinState = null;
    this.baseFov = 64;
    this.onSkip = null;
  }

  label() { return CAM_LABELS[this.mode]; }
  cycle() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    return this.label();
  }

  buildTVPoints(track) {
    this._tvPoints = [];
    for (let k = 0; k < 14; k++) {
      const t = k / 14;
      const p = track.pointAt(t), r = track.rightAt(t);
      const side = k % 2 ? 1 : -1;
      const lat = side * (track.halfWidth + 6 + (k % 3) * 3);
      this._tvPoints.push(new THREE.Vector3(p.x + r.x * lat, p.y + 4 + (k % 3) * 2.5, p.z + r.z * lat));
    }
  }

  // ---------- race cameras ----------
  update(dt, playerCar, track, time) {
    const st = playerCar.state;
    const cam = this.cam;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const slideShake = st.slide * 0.35 + (st.offTrack ? 0.4 : 0) + (st.onKerb ? 0.25 : 0);
    const shk = this.shake + slideShake;
    const shX = (Math.random() - 0.5) * shk * 0.12, shY = (Math.random() - 0.5) * shk * 0.12;

    const fwdX = Math.sin(st.yaw), fwdZ = Math.cos(st.yaw);
    const sp01 = clamp(st.speed / 95, 0, 1);

    if (this.cinematic) {
      const done = this.cinematic.update(dt);
      this._applyCinematic(playerCar, track);
      if (done) this.endCinematic();
      return;
    }

    switch (this.mode) {
      case 'chase': {
        const dist = 7.2 + sp01 * 3.4, h = 2.7 + sp01 * 0.7;
        const tx = st.pos.x - fwdX * dist, tz = st.pos.z - fwdZ * dist;
        const ty = st.pos.y + h;
        this._pos.x = damp(this._pos.x, tx, 7, dt);
        this._pos.y = damp(this._pos.y, ty, 7, dt);
        this._pos.z = damp(this._pos.z, tz, 7, dt);
        cam.position.set(this._pos.x + shX, this._pos.y + shY, this._pos.z);
        this._look.set(st.pos.x + fwdX * 9, st.pos.y + 1.1, st.pos.z + fwdZ * 9);
        cam.lookAt(this._look);
        cam.fov = damp(cam.fov, this.baseFov + sp01 * 16, 5, dt);
        cam.updateProjectionMatrix();
        break;
      }
      case 'cockpit': case 'helmet': {
        const anchor = this.mode === 'cockpit' ? playerCar.mesh.cockpitAnchor : playerCar.mesh.helmetAnchor;
        const bob = this.mode === 'helmet' ? Math.sin(time * 21) * 0.006 * sp01 : 0;
        const local = new THREE.Vector3(anchor.x, anchor.y + bob, anchor.z);
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), st.yaw);
        cam.position.set(st.pos.x + local.x + shX * 0.3, st.pos.y + local.y + shY * 0.3, st.pos.z + local.z);
        const lookAhead = this.mode === 'helmet' ? 30 : 20;
        const steerLook = this.mode === 'helmet' ? st.steerVisual * 6 : 0;
        const lx = st.pos.x + Math.sin(st.yaw + steerLook * 0.1) * lookAhead;
        const lz = st.pos.z + Math.cos(st.yaw + steerLook * 0.1) * lookAhead;
        cam.position.y += Math.sin(time * 33) * 0.004 * sp01;
        cam.lookAt(lx, st.pos.y + 0.4, lz);
        cam.rotation.z += st.rollVisual * (this.mode === 'helmet' ? 0.9 : 0.35);
        cam.fov = damp(cam.fov, this.mode === 'cockpit' ? 74 : 82, 6, dt);
        cam.updateProjectionMatrix();
        break;
      }
      case 'nose': {
        const local = new THREE.Vector3(0, 0.42, 1.4);
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), st.yaw);
        cam.position.set(st.pos.x + local.x, st.pos.y + local.y, st.pos.z + local.z);
        cam.lookAt(st.pos.x + fwdX * 26, st.pos.y + 0.3, st.pos.z + fwdZ * 26);
        cam.rotation.z += st.rollVisual * 0.5;
        cam.fov = damp(cam.fov, 92 + sp01 * 10, 6, dt);
        cam.updateProjectionMatrix();
        break;
      }
      case 'tv': {
        this._tvTimer -= dt;
        // find closest point
        let bestI = this._tvIdx, bestD = Infinity;
        for (let i = 0; i < this._tvPoints.length; i++) {
          const d = this._tvPoints[i].distanceToSquared(st.pos);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        if (bestI !== this._tvIdx && this._tvTimer <= 0) { this._tvIdx = bestI; this._tvTimer = 2.5; }
        if (this._tvTimer <= -6) this._tvTimer = 2; // minimum dwell handled above
        const p = this._tvPoints[this._tvIdx];
        cam.position.copy(p);
        const dist = Math.sqrt(bestD);
        cam.lookAt(st.pos.x, st.pos.y + 0.5, st.pos.z);
        cam.fov = damp(cam.fov, clamp(1400 / Math.max(dist, 12), 14, 60), 8, dt);
        cam.updateProjectionMatrix();
        break;
      }
      case 'aerial': {
        const tx = st.pos.x - fwdX * 30, tz = st.pos.z - fwdZ * 30;
        this._pos.x = damp(this._pos.x, tx, 3, dt);
        this._pos.y = damp(this._pos.y, st.pos.y + 95, 3, dt);
        this._pos.z = damp(this._pos.z, tz, 3, dt);
        cam.position.copy(this._pos);
        cam.lookAt(st.pos.x + fwdX * 18, st.pos.y, st.pos.z + fwdZ * 18);
        cam.fov = damp(cam.fov, 46, 4, dt);
        cam.updateProjectionMatrix();
        break;
      }
    }
  }

  // ---------- intro cinematic ----------
  startIntro(track, city, playerCar, sky) {
    const cam = this.cam;
    const start = track.pointAt(0);
    const right = track.rightAt(0);
    const tan = track.tangentAt(0);
    const ps = playerCar.state.pos;
    const cityCx = track.samples.px.reduce((a, b) => a + b, 0) / track.N;
    const cityCz = track.samples.pz.reduce((a, b) => a + b, 0) / track.N;

    const tl = new Timeline();
    this._cinState = { track, playerCar, shots: [] };

    // Shot 1: helicopter sweep over city → start straight (0–6s)
    const s1a = new THREE.Vector3(cityCx + 500, 260, cityCz + 500);
    const s1b = new THREE.Vector3(start.x - tan.x * 150 + 60, 90, start.z - tan.z * 150 + 60);
    // Shot 2: low fly down the straight (6–10.5s)
    const s2a = new THREE.Vector3(start.x - tan.x * 120 + right.x * 8, start.y + 6, start.z - tan.z * 120 + right.z * 8);
    const s2b = new THREE.Vector3(start.x + tan.x * 40 + right.x * 6, start.y + 4, start.z + tan.z * 40 + right.z * 6);
    // Shot 3: orbit player car (10.5–14s)
    // Shot 4: rise to gantry (14–16.5s)
    const s4a = new THREE.Vector3(start.x - tan.x * 20 + right.x * 10, start.y + 2.5, start.z - tan.z * 20 + right.z * 10);
    const s4b = new THREE.Vector3(start.x - tan.x * 26, start.y + 9, start.z - tan.z * 26);

    this._cinState.shots = [
      { t0: 0, t1: 6, from: s1a, to: s1b, lookFrom: new THREE.Vector3(cityCx, 20, cityCz), lookTo: start.clone(), fov0: 58, fov1: 52 },
      { t0: 6, t1: 10.5, from: s2a, to: s2b, lookFrom: start.clone(), lookTo: new THREE.Vector3(ps.x, ps.y + 1, ps.z), fov0: 60, fov1: 55 },
      { t0: 10.5, t1: 14, orbit: true, center: new THREE.Vector3(ps.x, ps.y, ps.z), r0: 9, r1: 5.5, a0: 2.2, a1: 4.4, h: 2.2, fov0: 52, fov1: 48 },
      { t0: 14, t1: 16.5, from: s4a, to: s4b, lookFrom: new THREE.Vector3(ps.x, ps.y + 1, ps.z), lookTo: start.clone().add(new THREE.Vector3(0, 5, 0)), fov0: 46, fov1: 42 },
    ];
    this._cinState.dur = 16.5;
    this._cinState.t = 0;
    this.cinematic = tl; // dummy timeline; we drive manually
    this.cinematic = { update: (dt) => { this._cinState.t += dt; return this._cinState.t >= this._cinState.dur; } };
  }

  _applyCinematic(playerCar, track) {
    const cs = this._cinState;
    const t = cs.t;
    const cam = this.cam;
    for (const sh of cs.shots) {
      if (t < sh.t0 || t > sh.t1) continue;
      const p = easeInOutCubic(clamp((t - sh.t0) / (sh.t1 - sh.t0), 0, 1));
      if (sh.orbit) {
        const a = lerp(sh.a0, sh.a1, p), r = lerp(sh.r0, sh.r1, p);
        cam.position.set(sh.center.x + Math.cos(a) * r, sh.center.y + sh.h, sh.center.z + Math.sin(a) * r);
        cam.lookAt(sh.center.x, sh.center.y + 0.8, sh.center.z);
      } else {
        cam.position.lerpVectors(sh.from, sh.to, p);
        const look = new THREE.Vector3().lerpVectors(sh.lookFrom, sh.lookTo, p);
        cam.lookAt(look);
      }
      cam.fov = lerp(sh.fov0, sh.fov1, p);
      cam.updateProjectionMatrix();
      return;
    }
  }

  endCinematic() {
    this.cinematic = null;
    this._cinState = null;
    this._pos.copy(this.cam.position); // smooth handoff
    if (this.onSkip) this.onSkip();
  }
  skipCinematic() {
    if (!this.cinematic) return false;
    this._cinState.t = this._cinState.dur;
    return true;
  }
}
