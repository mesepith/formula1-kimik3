// ============ ai.js — opponent drivers ============
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';

export class AIDriver {
  constructor(car, skill, rng) {
    this.car = car;
    this.skill = skill;               // 0.90 .. 1.0
    this.rng = rng;
    this.input = { throttle: 0, brake: 0, steer: 0, ers: false, drs: false };
    this.latOffset = 0;               // racing offset target
    this.offsetCur = 0;
    this.aggression = 0.75 + rng() * 0.25;
    this.wobblePhase = rng() * 10;
  }

  computeInput(dt, track, cars, raceState) {
    const st = this.car.state;
    const inp = this.input;
    const N = track.N, s = track.samples;
    const ds = track.length / N;
    const i = st.trackIdx >= 0 ? st.trackIdx : 0;

    // ---------- target speed from profile ----------
    const aheadSamples = Math.max(3, Math.floor((st.speed * 1.1) / ds));
    let vTarget = Infinity;
    for (let k = 2; k < aheadSamples; k += 2) {
      vTarget = Math.min(vTarget, s.vMax[(i + k) % N]);
    }
    if (!isFinite(vTarget)) vTarget = s.vMax[i];
    vTarget *= this.skill * (raceState === 'wet' ? 0.97 : 1);

    // ---------- traffic awareness ----------
    let avoidLat = 0, carAhead = null, gapAhead = Infinity;
    for (const other of cars) {
      if (other === this.car || other.finished) continue;
      const ost = other.state;
      let dt1 = ost.trackT - st.trackT;
      if (dt1 < -0.5) dt1 += 1; if (dt1 > 0.5) dt1 -= 1;
      const gap = dt1 * track.length;
      if (gap > 0 && gap < 40 && Math.abs(ost.lat - st.lat) < 3.2) {
        if (gap < gapAhead) { gapAhead = gap; carAhead = other; }
      }
      // side-by-side → hold line, small avoid
      if (Math.abs(gap) < 6 && Math.abs(ost.lat - st.lat) < 2.6) {
        avoidLat = Math.sign(st.lat - ost.lat) * 1.2;
      }
    }
    if (carAhead) {
      const closing = st.speed - carAhead.state.speed;
      if (gapAhead < 7 + st.speed * 0.08 && closing > 0.5) {
        vTarget = Math.min(vTarget, carAhead.state.speed + 0.5);
        // try to pass: pick side with more room
        const passSide = carAhead.state.lat > 0 ? -1 : 1;
        if (gapAhead < 16) this.latOffset = clamp(passSide * 2.6, -track.halfWidth + 2, track.halfWidth - 2);
      }
    } else if (Math.abs(this.latOffset) > 0.1 && this.rng() < dt * 0.5) {
      this.latOffset *= 0.5; // drift back to line
    }

    // ---------- throttle / brake ----------
    const vErr = vTarget - st.speed;
    if (vErr > 1.5) { inp.throttle = 1; inp.brake = 0; }
    else if (vErr > -1) { inp.throttle = clamp(0.4 + vErr * 0.2, 0, 1); inp.brake = 0; }
    else { inp.throttle = 0; inp.brake = clamp(-vErr * 0.12, 0.15, 1) * this.aggression; }

    // ---------- steering ----------
    const lookDist = clamp(st.speed * 0.55, 9, 58);
    const lookSamples = Math.floor(lookDist / ds);
    const ti = (i + lookSamples) % N;
    const targetLat = clamp(this.latOffset + avoidLat, -track.halfWidth + 1.4, track.halfWidth - 1.4);
    const tx = s.px[ti] + s.rx[ti] * targetLat;
    const tz = s.pz[ti] + s.rz[ti] * targetLat;
    const dx = tx - st.pos.x, dz = tz - st.pos.z;
    const targetYaw = Math.atan2(dx, dz);
    let yawErr = targetYaw - st.yaw;
    while (yawErr > Math.PI) yawErr -= Math.PI * 2;
    while (yawErr < -Math.PI) yawErr += Math.PI * 2;
    inp.steer = clamp(yawErr * 2.4, -1, 1);

    // small human-like wobble on straights
    inp.steer += Math.sin(raceState.time * 1.3 + this.wobblePhase) * 0.02 * (1 - this.skill);

    // ---------- ERS / DRS ----------
    inp.ers = st.ers > 0.25 && vTarget > 70 && vErr > 0;
    inp.drs = st.drsAvailable && vTarget > 60;

    // wet caution
    if (raceState.wet) {
      inp.throttle *= 0.96;
      if (st.slide > 0.25) { inp.throttle *= 0.5; inp.steer *= 0.7; }
    }
    return inp;
  }
}
