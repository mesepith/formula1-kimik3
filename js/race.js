// ============ race.js — race orchestration ============
import * as THREE from 'three';
import { clamp, lerp, mulberry32, fmtTime } from './utils.js';
import { CarState, stepCar, CAR_PARAMS } from './physics.js';
import { AIDriver } from './ai.js';
import { buildCar } from './car.js';
import { TEAMS, GAME } from './config.js';

export class Race {
  constructor({ scene, track, weather, audio, mode, laps, playerTeamId, playerCarIndex, aiCount, upgrades, championship }) {
    this.scene = scene; this.track = track; this.weather = weather; this.audio = audio;
    this.mode = mode;              // 'quick' | 'championship' | 'career' | 'timetrial'
    this.laps = mode === 'timetrial' ? 999 : laps;
    this.state = 'grid';           // grid → lights → racing → finished
    this.clock = 0;
    this.lightsTimer = 0;
    this.litLights = 0;
    this.falseStart = false;
    this.events = [];              // {type, ...} consumed by main
    this.cars = [];
    this.fastestLap = { ms: Infinity, car: null };
    this.upgrades = upgrades || { engine: 0, aero: 0, tires: 0 };
    this._rng = mulberry32(Date.now() % 100000);

    // ---------- build field ----------
    const playerTeam = TEAMS.find(t => t.id === playerTeamId) || TEAMS[0];
    const isTT = mode === 'timetrial';
    const count = isTT ? 1 : Math.min(aiCount + 1, GAME.maxCars);

    // order: player + AI from other teams
    const field = [];
    field.push({ team: playerTeam, carIndex: playerCarIndex ?? 0, isPlayer: true });
    let ti = 0;
    while (field.length < count) {
      const team = TEAMS[ti % TEAMS.length];
      const ci = Math.floor(ti / TEAMS.length) % 2;
      if (team.id !== playerTeam.id || field.length < count) {
        field.push({ team, carIndex: ci, isPlayer: false });
      }
      ti++;
    }

    // grid order: championship later rounds → by standings; else player at P6
    let gridOrder = [...field.keys()];
    gridOrder.sort(() => this._rng() - 0.5); // shuffle AI
    // place player
    let playerGrid = 5;
    if (championship && championship.round > 0 && championship.standings.length) {
      const idx = championship.standings.findIndex(s => s.isPlayer);
      playerGrid = clamp(idx, 0, count - 1);
    }
    const playerFieldIdx = 0;
    gridOrder = gridOrder.filter(i => i !== playerFieldIdx);
    gridOrder.splice(playerGrid, 0, playerFieldIdx);

    gridOrder.slice(0, count).forEach((fieldIdx, gridPos) => {
      const f = field[fieldIdx];
      const driver = f.team.drivers[f.carIndex];
      const num = f.team.numbers[f.carIndex];
      const mesh = buildCar(f.team, num, f.isPlayer ? 0xff9933 : undefined);
      scene.add(mesh.group);
      const state = new CarState();
      const slot = track.grid[gridPos % track.grid.length];
      state.pos.set(slot.x, slot.y, slot.z);
      state.yaw = slot.yaw;
      state.rpm = CAR_PARAMS.idleRpm;

      const skill = f.isPlayer ? 1 : clamp(f.team.skill + (this._rng() - 0.5) * 0.03, 0.9, 1.0);
      const car = {
        id: fieldIdx, isPlayer: f.isPlayer, team: f.team, driver, num, mesh, state,
        ai: f.isPlayer ? null : new AIDriver(null, skill, mulberry32(gridPos * 77 + 3)),
        lap: 0, progress: 0, tPrev: 0,
        lapStart: 0, lastLap: null, bestLap: null,
        sectors: [null, null, null], sectorStart: 0, curSector: 0,
        bestSectors: [null, null, null],
        finished: false, finishTime: null, position: gridPos + 1,
        penalty: 0, out: false,
        gapAhead: null, drsWasOpen: false,
      };
      car.ai && (car.ai.car = car);
      state.trackIdx = Math.floor(((1 - (46 + gridPos * 8.2) / track.length) % 1) * track.N);
      state.tPrev = state.trackIdx / track.N;
      this.cars.push(car);
    });
    this.player = this.cars.find(c => c.isPlayer);
    // player upgrade params
    this.playerParams = { ...CAR_PARAMS };
    this.playerParams.power += this.upgrades.engine * 22e3;
    this.playerParams.dfK = CAR_PARAMS.dfK * (1 + this.upgrades.aero * 0.045);
    this.playerParams.muBase = CAR_PARAMS.muBase * (1 + this.upgrades.tires * 0.02);
    this._sortPositions(true);
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  // ---------- start lights ----------
  beginLights() {
    this.state = 'lights';
    this.lightsTimer = 0;
    this.litLights = 0;
    this._holdTime = 0.6 + this._rng() * 1.4;
    this._lightsOutFired = false;
  }

  _updateLights(dt) {
    this.lightsTimer += dt;
    const interval = 0.85;
    const want = clamp(Math.floor(this.lightsTimer / interval) + 1, 0, 5);
    if (want > this.litLights && this.litLights < 5) {
      this.litLights = want;
      this.emit('light', { n: this.litLights });
    }
    if (this.litLights >= 5) {
      const t5 = 5 * interval;
      if (this.lightsTimer > t5 + this._holdTime && !this._lightsOutFired) {
        this._lightsOutFired = true;
        this.state = 'racing';
        this.raceStartClock = this.clock;
        for (const c of this.cars) { c.lapStart = 0; c.sectorStart = 0; c.state.rpm = CAR_PARAMS.idleRpm; }
        this.emit('lightsOut');
      }
      // false start check
      if (!this._lightsOutFired && this.player.state.speed > 0.6) {
        this.falseStart = true;
        this.player.penalty += 10000;
        this.emit('falseStart');
      }
    }
  }

  // ---------- main update ----------
  update(dt, playerInput, camMode) {
    this.clock += dt;
    const track = this.track;
    const wet = this.weather.wetness > 0.35;
    const raceCtx = { wet, time: this.clock };

    // dynamic weather ramp for rain/monsoon
    const wd = this.weather.def;
    if (wd && wd.rain > 0 && this.state === 'racing') {
      const ramp = clamp(0.45 + this.clock / 150, 0, 1);
      this.weather.rainAmountTarget = wd.rain * ramp;
    }

    if (this.state === 'lights') this._updateLights(dt);

    for (const car of this.cars) {
      const st = car.state;
      // ---------- input ----------
      let inp;
      if (this.state !== 'racing') {
        inp = { throttle: 0, brake: 0.4, steer: 0, ers: false, drs: false };
        // revving on the grid
        st.rpm = CAR_PARAMS.idleRpm + 2500 + Math.sin(this.clock * 7 + car.id) * 1800;
      } else if (car.finished) {
        // cool-down lap: AI-style cruise
        inp = car.ai ? car.ai.computeInput(dt, track, this.cars, raceCtx) : { throttle: 0.3, brake: 0, steer: 0, ers: false, drs: false };
        inp.throttle = Math.min(inp.throttle ?? 0.3, 0.55);
      } else if (car.isPlayer) {
        inp = playerInput;
      } else {
        inp = car.ai.computeInput(dt, track, this.cars, raceCtx);
      }

      // ---------- DRS ----------
      if (this.state === 'racing' && !car.finished) {
        const inZone = track.inDRSZone(st.trackT);
        let canDrs = false;
        if (inZone) {
          if (this.mode === 'timetrial') canDrs = true;
          else canDrs = car.gapAhead != null && car.gapAhead < GAME.drsWindow;
        }
        st.drsAvailable = canDrs;
        if (!inZone) st.drsOpen = false;
        else if (inp.drs && canDrs && !st.drsOpen) { st.drsOpen = true; if (car.isPlayer) this.emit('drs'); }
      } else { st.drsAvailable = false; st.drsOpen = false; }

      // ---------- slipstream ----------
      st.slipstream = 0;
      for (const other of this.cars) {
        if (other === car) continue;
        let dtT = other.state.trackT - st.trackT;
        if (dtT < -0.5) dtT += 1; if (dtT > 0.5) dtT -= 1;
        const gap = dtT * track.length;
        if (gap > 2 && gap < 22 && Math.abs(other.state.lat - st.lat) < 2.0) {
          st.slipstream = Math.max(st.slipstream, 1 - gap / 22);
        }
      }

      // ---------- physics ----------
      const wasRacing = this.state === 'racing' && !car.finished;
      const P = car.isPlayer ? this.playerParams : CAR_PARAMS;
      if (this.state === 'racing' || car.finished) {
        stepCar(st, inp, dt, track, this.weather.grip, this.weather.rainAmount, P);
      } else {
        // pinned on grid
        st.speed = 0;
        if (car.isPlayer && inp.throttle > 0.3 && this.state === 'lights') {
          // anti-stall rev — handled in lights check via speed? simulate creep:
          st.speed = 0;
          if (this.litLights >= 5 && !this._lightsOutFired) {
            // jumped
            this.falseStart = true; car.penalty += 10000;
            if (!this._fsFired) { this._fsFired = true; this.emit('falseStart'); }
          }
        }
      }

      // ---------- lap / sector tracking ----------
      if (wasRacing || (this.state === 'racing' && !car.finished)) {
        const tNow = st.trackT;
        const tPrev = car.tPrev;
        // sector crossings
        for (let sec = 0; sec < 3; sec++) {
          const bound = sec === 0 ? 1 / 3 : sec === 1 ? 2 / 3 : 1.0;
          const lo = sec === 0 ? 0 : sec === 0 ? 0 : 0;
        }
        const crossed = (bound) => (tPrev < bound && tNow >= bound) || (tPrev > 0.9 && tNow < 0.1 && bound === 1.0) ||
          (tPrev > bound - 0.0 && tPrev < 0.9 && (tNow < tPrev - 0.5) && bound <= tNow + 1);
        // simpler: detect wrap for s/f
        if (tPrev > 0.85 && tNow < 0.15) {
          // crossed start/finish
          car.lap++;
          const lapMs = (this.clock - car.lapStart) * 1000;
          if (car.lap > 1 && lapMs > 20000) { // ignore grid crossing glitch... lap counted after lights
            car.lastLap = lapMs;
            if (!car.bestLap || lapMs < car.bestLap) car.bestLap = lapMs;
            if (lapMs < this.fastestLap.ms) {
              this.fastestLap = { ms: lapMs, car };
              this.emit('fastestLap', { car, ms: lapMs });
            }
            if (car.isPlayer) this.emit('lapComplete', { car, ms: lapMs });
          }
          car.lapStart = this.clock;
          // finish?
          if (!car.finished && car.lap > this.laps) {
            car.finished = true;
            car.finishTime = this.clock * 1000 + car.penalty;
            this.emit('finish', { car });
            if (car.isPlayer) this._playerFinished();
          }
        }
        // sectors
        for (let sec = 0; sec < 2; sec++) {
          const bound = (sec + 1) / 3;
          if (tPrev < bound && tNow >= bound && tNow - tPrev < 0.2) {
            const secMs = (this.clock - car.sectorStart) * 1000;
            car.sectors[sec] = secMs;
            if (!car.bestSectors[sec] || secMs < car.bestSectors[sec]) {
              car.bestSectors[sec] = secMs;
              if (car.isPlayer) this.emit('sectorPB', { sec, ms: secMs });
            }
            if (car.isPlayer) this.emit('sector', { sec, ms: secMs });
            car.sectorStart = this.clock;
          }
        }
        if (tPrev > 0.85 && tNow < 0.15) car.sectorStart = this.clock;
        car.tPrev = tNow;
        car.progress = car.lap + tNow;
      }

      // ---------- mesh sync ----------
      this._syncMesh(car, dt, camMode);
    }

    // ---------- car-car collisions ----------
    for (let a = 0; a < this.cars.length; a++) {
      for (let b = a + 1; b < this.cars.length; b++) {
        const A = this.cars[a].state, B = this.cars[b].state;
        const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4.4 && d2 > 0.0001) {
          const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
          const push = (2.1 - d) * 0.5;
          A.pos.x -= nx * push; A.pos.z -= nz * push;
          B.pos.x += nx * push; B.pos.z += nz * push;
          const relV = Math.abs(A.speed - B.speed);
          const avg = (A.speed + B.speed) / 2;
          A.speed = lerp(A.speed, avg, 0.12); B.speed = lerp(B.speed, avg, 0.12);
          if (relV > 4) {
            A.damage = Math.min(1, A.damage + 0.02);
            B.damage = Math.min(1, B.damage + 0.02);
            if (this.cars[a].isPlayer || this.cars[b].isPlayer) this.emit('contact', { severity: relV });
          }
        }
      }
    }

    this._sortPositions();
    this._computeGaps();
  }

  _playerFinished() {
    this.state = 'finished';
    this.emit('playerFinished');
  }

  _syncMesh(car, dt, camMode) {
    const st = car.state, g = car.mesh.group;
    g.position.copy(st.pos);
    // y: sample track height + tiny suspension bob
    const bob = st.onKerb ? Math.sin(this.clock * 40 + car.id) * 0.02 : 0;
    g.position.y = st.pos.y + bob;
    g.rotation.set(st.pitchVisual, st.yaw, st.rollVisual, 'YXZ');
    // wheels
    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const w = car.mesh.wheels[key];
      w.spin.rotation.x = st.wheelSpin;
      if (w.steer) w.pivot.rotation.y = st.steerVisual * 1.4;
    }
    // DRS
    const target = st.drsOpen ? -0.62 : 0;
    car.mesh.drsPivot.rotation.x = lerp(car.mesh.drsPivot.rotation.x, target, 1 - Math.exp(-10 * dt));
    // brake glow
    car.mesh.brakeMat.emissiveIntensity = clamp((st.brakeTemp - 500) / 500, 0, 1.4);
    // rain light blink
    car.mesh.rainMat.emissiveIntensity = this.weather.wetness > 0.3 ? (Math.sin(this.clock * 9) > 0 ? 2 : 0.2) : 0;
    // hide helmet in cockpit views
    const cockpit = camMode === 'cockpit' || camMode === 'helmet';
    car.mesh.helmet.visible = !(car.isPlayer && cockpit);
    car.mesh.swGroup.visible = !(car.isPlayer && camMode === 'chase');
    if (car.isPlayer) car.mesh.swGroup.rotation.z = -st.steerVisual * 3.2;
  }

  _sortPositions(initial = false) {
    const order = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    order.forEach((car, i) => {
      if (!initial && car.position !== i + 1 && car.isPlayer && this.state === 'racing') {
        this.emit(i + 1 < car.position ? 'positionGain' : 'positionLoss', { from: car.position, to: i + 1 });
      }
      car.position = i + 1;
    });
    this._order = order;
  }

  _computeGaps() {
    const order = this._order;
    for (let i = 0; i < order.length; i++) {
      const car = order[i];
      if (i === 0) { car.gapAhead = null; continue; }
      const ahead = order[i - 1];
      const dProg = (ahead.progress - car.progress) * this.track.length;
      car.gapAhead = ahead.state.speed > 5 ? dProg / Math.max(ahead.state.speed, 15) : dProg / 15;
    }
  }

  results() {
    return this._order.map((car, i) => ({
      pos: i + 1, driver: car.driver, team: car.team, num: car.num,
      isPlayer: car.isPlayer,
      bestLap: car.bestLap, lastLap: car.lastLap,
      time: car.finished ? car.finishTime : null,
      finished: car.finished,
      laps: car.lap,
      points: GAME.points[i] ?? 0,
    }));
  }

  dispose() {
    for (const car of this.cars) {
      this.scene.remove(car.mesh.group);
      car.mesh.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
      });
    }
  }
}
