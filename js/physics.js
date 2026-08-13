// ============ physics.js — vehicle dynamics ============
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';

export const CAR_PARAMS = {
  mass: 795,
  power: 740e3,          // W
  ersPower: 110e3,
  wheelbase: 3.7,
  cDA: 1.62,             // drag area (high downforce)
  cRr: 0.014,
  rho: 1.18,
  muBase: 1.78,          // slick grip
  dfK: 0.0029,           // downforce accel per v²
  gearsTop: [39, 50, 61, 72, 82, 91, 99, 107], // m/s per gear
  idleRpm: 3800, maxRpm: 12600, shiftRpm: 12300,
  brakeG: 5.2,
  ersDrain: 0.30, ersHarvestBrake: 0.16, ersHarvestCoast: 0.05,
};

export class CarState {
  constructor() {
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;          // forward speed m/s (signed)
    this.latVel = 0;         // lateral velocity
    this.gear = 1;
    this.rpm = CAR_PARAMS.idleRpm;
    this.shiftTimer = 0;
    this.ers = 1.0;
    this.ersDeploying = false;
    this.drsOpen = false;
    this.drsAvailable = false;
    this.tireWear = 0;
    this.tireTemp = 68;
    this.brakeTemp = 380;
    this.slide = 0;          // current slide amount 0..1
    this.slipstream = 0;     // set by race manager
    this.damage = 0;
    this.offTrack = false;
    this.onKerb = false;
    this.steerVisual = 0;
    this.wheelSpin = 0;
    this.trackT = 0;         // spline position
    this.trackIdx = -1;      // nearest sample hint
    this.lat = 0;            // lateral offset on track
    this.airborne = 0;
    this.hydro = 0;          // hydroplane intensity
    this.pitchVisual = 0; this.rollVisual = 0;
  }
}

export function stepCar(st, input, dt, track, weatherGrip, rainAmount, P = CAR_PARAMS) {
  const v = st.speed;
  const fwdX = Math.sin(st.yaw), fwdZ = Math.cos(st.yaw);
  const rightX = fwdZ, rightZ = -fwdX;

  // ---------- surface ----------
  const near = track.nearest(st.pos, st.trackIdx);
  st.trackIdx = near.i;
  st.trackT = near.t;
  st.lat = near.lat;
  const hw = track.halfWidth;
  st.onKerb = Math.abs(near.lat) > hw - 0.55 && Math.abs(near.lat) < hw + 1.15;
  const onApron = Math.abs(near.lat) >= hw + 1.15;
  st.offTrack = onApron;

  // ---------- grip ----------
  let mu = P.muBase * weatherGrip;
  // tire condition
  const tempFactor = st.tireTemp < 70 ? lerp(0.84, 1, st.tireTemp / 70)
    : st.tireTemp > 118 ? 0.94 : 1;
  mu *= tempFactor * (1 - 0.38 * st.tireWear);
  if (st.onKerb) mu *= 0.94;
  if (onApron) mu *= 0.62;
  if (st.damage > 0.5) mu *= 0.94;

  // hydroplaning: random grip loss at speed in rain
  st.hydro = 0;
  if (rainAmount > 0.4 && v > 42) {
    const h = Math.random();
    if (h < 0.02 * rainAmount * (v / 90)) {
      st.latVel += (Math.random() - 0.5) * 3.2 * rainAmount;
      st.hydro = 1;
    }
    mu *= 1 - 0.12 * rainAmount * clamp((v - 42) / 50, 0, 1);
  }

  const downforceAcc = P.dfK * v * v * (st.drsOpen ? 0.72 : 1);
  const maxLatAcc = mu * (9.81 + downforceAcc);
  const maxDriveAcc = mu * (9.81 + downforceAcc) * 0.55;

  // ---------- steering ----------
  const steerRange = lerp(0.26, 0.048, clamp(v / 92, 0, 1));
  const steerTarget = input.steer * steerRange;
  const steerRate = lerp(3.2, 1.6, clamp(v / 92, 0, 1));
  st.steerVisual += clamp(steerTarget - st.steerVisual, -steerRate * dt, steerRate * dt);

  // ---------- longitudinal ----------
  let engineForce = 0;
  const power = (P.power * (1 - st.damage * 0.3)) + (st.ersDeploying ? P.ersPower : 0);
  if (st.shiftTimer > 0) st.shiftTimer -= dt;
  if (input.throttle > 0 && st.shiftTimer <= 0) {
    engineForce = input.throttle * power / Math.max(Math.abs(v), 6);
    const maxF = P.mass * maxDriveAcc;
    if (engineForce > maxF) engineForce = maxF; // traction limit
  }
  // ERS
  st.ersDeploying = !!(input.ers && st.ers > 0.005 && input.throttle > 0.2);
  if (st.ersDeploying) st.ers = Math.max(0, st.ers - P.ersDrain * dt);
  // drag & rolling
  const cDA = P.cDA * (st.drsOpen ? 0.80 : 1) * (1 - 0.24 * st.slipstream);
  const dragF = 0.5 * P.rho * cDA * v * Math.abs(v);
  const rrF = P.cRr * P.mass * 9.81 * Math.sign(v);
  // brakes
  let brakeF = 0;
  if (input.brake > 0 && v > 0.1) {
    const fade = clamp(1.25 - st.brakeTemp / 1400, 0.55, 1);
    brakeF = input.brake * P.mass * 9.81 * P.brakeG * (0.6 + 0.4 * mu / P.muBase) * fade;
    st.brakeTemp += input.brake * Math.abs(v) * dt * 9;
    st.ers = Math.min(1, st.ers + P.ersHarvestBrake * input.brake * dt);
  } else if (input.throttle < 0.15) {
    st.ers = Math.min(1, st.ers + P.ersHarvestCoast * dt);
  }
  st.brakeTemp = Math.max(320, st.brakeTemp - (26 + Math.abs(v) * 1.9) * dt);

  const acc = (engineForce - dragF * Math.sign(v) - rrF - brakeF) / P.mass;
  st.speed = v + acc * dt;
  if (st.speed < 0) st.speed = Math.min(0, st.speed); // allow tiny reverse only via reset
  if (st.speed < 0.05 && input.throttle < 0.05) st.speed = 0;

  // ---------- gearbox ----------
  const tops = P.gearsTop;
  const gTop = tops[st.gear - 1];
  const gPrev = st.gear > 1 ? tops[st.gear - 2] : 0;
  st.rpm = P.idleRpm + clamp((st.speed - gPrev) / (gTop - gPrev), 0, 1.04) * (P.maxRpm - P.idleRpm);
  if (st.shiftTimer <= 0) {
    if (st.rpm >= P.shiftRpm && st.gear < 8) { st.gear++; st.shiftTimer = 0.045; st.justShifted = 1; }
    else if (st.gear > 1 && st.speed < tops[st.gear - 2] * 0.62) { st.gear--; st.shiftTimer = 0.045; st.justShifted = -1; }
    else st.justShifted = 0;
  } else st.justShifted = 0;

  // ---------- lateral ----------
  let yawRate = 0;
  if (st.speed > 0.5) {
    const desiredYaw = st.speed / P.wheelbase * Math.tan(st.steerVisual);
    const latAccNeed = desiredYaw * st.speed;
    if (Math.abs(latAccNeed) <= maxLatAcc) {
      yawRate = desiredYaw;
      st.slide = Math.max(0, st.slide - dt * 3);
      st.latVel *= Math.max(0, 1 - 9 * dt); // grip kills lateral drift
    } else {
      yawRate = Math.sign(latAccNeed) * maxLatAcc / st.speed;
      const excess = Math.abs(latAccNeed) - maxLatAcc;
      st.slide = clamp(excess / 18, 0, 1);
      st.latVel += Math.sign(latAccNeed) * excess * dt * 0.55; // push wide
      st.latVel *= Math.max(0, 1 - 2.2 * dt);
      st.speed -= st.speed * st.slide * 0.24 * dt; // scrub speed
    }
  }
  st.yaw += yawRate * dt;

  // DRS drag closes under heavy cornering automatically (safety)
  if (st.drsOpen && (input.brake > 0.25 || st.slide > 0.4)) st.drsOpen = false;

  // ---------- integrate position ----------
  const vx = fwdX * st.speed + rightX * st.latVel;
  const vz = fwdZ * st.speed + rightZ * st.latVel;
  st.pos.x += vx * dt;
  st.pos.z += vz * dt;

  // ---------- walls ----------
  const wallLat = hw + 3.05;
  if (Math.abs(st.lat) > wallLat) {
    // re-project position onto wall boundary
    const over = Math.abs(st.lat) - wallLat;
    const sign = Math.sign(st.lat);
    const s = track.samples, i = st.trackIdx;
    st.pos.x -= s.rx[i] * sign * over;
    st.pos.z -= s.rz[i] * sign * over;
    const velAlongWall = st.latVel * sign;
    if (velAlongWall > 0) st.latVel = -velAlongWall * 0.18; // bounce
    st.speed *= Math.max(0, 1 - 3.2 * dt * clamp(Math.abs(velAlongWall) / 10 + 0.4, 0, 1));
    st.damage = Math.min(1, st.damage + Math.abs(velAlongWall) * 0.02 + 0.01);
    st.hitWall = true;
  } else st.hitWall = false;

  // ground height (from track elevation)
  const s2 = track.samples, i2 = st.trackIdx;
  const j2 = (i2 + 1) % track.N;
  st.pos.y = lerp(st.pos.y, s2.py[i2], 1 - Math.exp(-14 * dt));

  // ---------- tires ----------
  const latAcc = Math.abs(yawRate) * st.speed;
  const heatIn = st.slide * 55 + latAcc * 0.16 + input.brake * 4;
  st.tireTemp += (heatIn - (st.tireTemp - 62) * 0.06 - st.speed * 0.012) * dt;
  const wearRate = (st.slide * 0.011 + latAcc * 0.0000035 * (st.tireTemp > 110 ? 2.1 : 1) + input.brake * 0.0009) * (onApron ? 2.5 : 1);
  st.tireWear = clamp(st.tireWear + wearRate * dt, 0, 1);

  // ---------- visuals ----------
  st.wheelSpin += (st.speed / 0.335) * dt;
  st.pitchVisual = lerp(st.pitchVisual, clamp(-acc * 0.006, -0.05, 0.04), 1 - Math.exp(-8 * dt));
  st.rollVisual = lerp(st.rollVisual, clamp(latAcc * 0.0022 * Math.sign(st.steerVisual || 0.001), -0.06, 0.06), 1 - Math.exp(-8 * dt));

  return st;
}
