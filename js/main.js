// ============ main.js — game bootstrap & state machine ============
import * as THREE from 'three';
import { CITIES, TEAMS, WEATHERS, TIMES_OF_DAY, GAME, INDIAN_GP_CITY } from './config.js';
import { clamp, lerp, fmtTime } from './utils.js';
import { Track } from './track.js';
import { buildEnvironment } from './scenery.js';
import { SkyRig } from './sky.js';
import { WeatherSystem } from './weather.js';
import { Race } from './race.js';
import { CameraRig } from './cameras.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { RoadDebugger } from './road-debug.js';

const $ = id => document.getElementById(id);

class Game {
  constructor() {
    // renderer
    const canvas = $('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9fb4c8, 0.0004);
    this.camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 9000);

    this.sky = new SkyRig(this.scene, this.renderer);
    this.weatherSys = new WeatherSystem(this.scene);
    this.weatherSys.onThunder = () => this.audio.thunder();
    this.camRig = new CameraRig(this.camera);
    this.hud = new HUD();
    this.input = new Input();
    this.audio = new AudioEngine();
    this.dbg = new RoadDebugger();
    this.dbg.attach(this);

    this.track = null; this.env = null; this.race = null;
    this.state = 'menu';   // menu | loading | intro | racing | finished
    this.champ = null;
    this.clock = 0;
    this.paused = false;
    this.bestLaps = JSON.parse(localStorage.getItem('igp_best') || '{}');
    this._radioFlags = {};

    this.ui = new UI({
      onEnter: () => { this.audio.init(); this.audio.resume(); this.ui.setBestLap(this._overallBest()); },
      onStartRace: sel => this.startRace(sel),
      onMenuSound: () => { this.audio.init(); this.audio.resume(); },
      onNewSeason: mode => { this._newChamp(mode); this.ui.openCarSelect(); },
      onSeasonTeamChosen: teamId => { this.champ.teamId = teamId; this._startChampRound(); },
      onResume: () => this.togglePause(false),
      onRestart: () => { this.togglePause(false); this.startRace(this._lastSel); },
      onQuit: () => this.quitToMenu(),
      onResultsContinue: () => this.afterResults(),
      onStandingsContinue: () => this.afterStandings(),
      onCareerNext: () => this._startChampRound(),
      onBuyUpgrade: key => this._buyUpgrade(key),
      onPodiumContinue: () => this.quitToMenu(),
    });

    // firework pool (for finale)
    this._initFireworks();

    addEventListener('keydown', e => {
      if (e.code === 'KeyM') {
        this.audio.setMuted(!this.audio.muted);
        $('mute-ind').classList.toggle('hidden', !this.audio.muted);
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && (this.state === 'racing' || this.state === 'finished')) {
        // if the controls sub-panel is open, Esc goes back to the pause menu first
        const pc = $('pause-controls');
        if (this.paused && e.code === 'Escape' && pc && !pc.classList.contains('hidden')) {
          pc.classList.add('hidden');
          $('pause-main-box').classList.remove('hidden');
        } else {
          this.togglePause();
        }
      }
      if (e.code === 'F4') {
        e.preventDefault();
        if (this.state === 'racing' || this.state === 'finished' || this.state === 'intro' || this.state === 'lights') {
          this.dbg.toggle();
        }
      }
      if (e.code === 'Enter' && this.state === 'intro') {
        if (this.camRig.skipCinematic()) this.hud.setSkipHint(false);
      }
    });

    this.renderer.setAnimationLoop((t) => this._frame(t));
  }

  _overallBest() {
    const vals = Object.values(this.bestLaps);
    return vals.length ? Math.min(...vals) : null;
  }

  // ---------- championship ----------
  _newChamp(mode) {
    const standings = [];
    for (const t of TEAMS) for (let ci = 0; ci < 2; ci++) {
      standings.push({ driver: t.drivers[ci], team: t, points: 0, wins: 0, isPlayer: false, carIndex: ci });
    }
    this.champ = {
      mode, round: 0, standings, season: 1,
      upgrades: { engine: 0, aero: 0, tires: 0 }, rd: 0, teamId: null,
    };
  }

  _startChampRound() {
    const city = CITIES[this.champ.round % CITIES.length];
    const isFinale = city.id === INDIAN_GP_CITY && this.champ.round === CITIES.length - 1;
    this._lastSel = {
      mode: this.champ.mode, cityId: city.id, teamId: this.champ.teamId,
      weather: null, time: null, laps: 3, ai: 15,
    };
    // championship uses city default atmosphere; finale = sunset spectacle
    this._lastSel.weather = city.weatherDefault;
    this._lastSel.time = isFinale ? 'sunset' : city.timeDefault;
    this._lastSel.isFinale = isFinale;
    this.startRace(this._lastSel);
  }

  _buyUpgrade(key) {
    const lvl = this.champ.upgrades[key];
    const cost = lvl + 1;
    if (lvl >= 5 || this.champ.rd < cost) return;
    this.champ.rd -= cost;
    this.champ.upgrades[key]++;
    this.ui.showCareer(this.champ, this.champ.upgrades, this.champ.rd);
  }

  // ---------- race lifecycle ----------
  async startRace(sel) {
    this._lastSel = sel;
    this.ui.hideAll();
    this.paused = false;
    $('screen-pause').classList.remove('active');
    const city = CITIES.find(c => c.id === sel.cityId);
    const weatherDef = WEATHERS.find(w => w.id === (sel.weather || city.weatherDefault));
    const timeDef = TIMES_OF_DAY.find(t => t.id === (sel.time || city.timeDefault));
    this._weatherDef = weatherDef; this._timeDef = timeDef;

    $('loading').classList.remove('hidden');
    $('load-city').textContent = city.name;
    $('load-fill').style.width = '5%';
    const tick = () => new Promise(r => setTimeout(r, 16));

    this._loading = true; // freeze the frame loop's access to race objects
    // dispose previous
    if (this.race) { this.race.dispose(); this.race = null; }
    if (this.track) { this.track.dispose(); this.track = null; }
    if (this.env) { this.env.dispose(); this.env = null; }

    $('load-sub').textContent = 'Laying asphalt…'; await tick();
    this.track = new Track(this.scene, city);
    $('load-fill').style.width = '38%';
    $('load-sub').textContent = 'Building ' + city.name + '…'; await tick();
    this.env = buildEnvironment(this.scene, this.track, city);
    $('load-fill').style.width = '62%';
    $('load-sub').textContent = 'Weather systems…'; await tick();

    this.sky.set(timeDef, weatherDef, city.env.haze);
    this.scene.fog.color.copy(this.sky.fogColor);
    this.scene.fog.density = weatherDef.fog;
    this.renderer.toneMappingExposure = this.sky.exposure;
    this.weatherSys.set(weatherDef, this.track);
    this.track.setNight(this.sky.nightFactor);
    this.track.setWet(weatherDef.rain > 0 ? 1 : 0);
    for (const e of this.env.nightMats) {
      e.mat.emissiveIntensity = lerp(e.day, e.night, this.sky.nightFactor);
    }
    $('load-fill').style.width = '78%';
    $('load-sub').textContent = 'Rolling out the cars…'; await tick();

    this.race = new Race({
      scene: this.scene, track: this.track, weather: this.weatherSys, audio: this.audio,
      mode: sel.mode, laps: sel.laps, playerTeamId: sel.teamId, aiCount: sel.ai,
      upgrades: this.champ ? this.champ.upgrades : null,
      championship: this.champ ? { round: this.champ.round, standings: this.champ.standings } : null,
    });
    this.race.setNight(this.sky.nightFactor);
    this.camRig.buildTVPoints(this.track);
    this.camRig.mode = 'chase';
    this.hud.setupRace(this.race, weatherDef, sel.laps);
    this._radioFlags = {};
    $('load-fill').style.width = '100%';
    $('load-sub').textContent = 'Ready.'; await tick();
    $('loading').classList.add('hidden');

    this._loading = false;
    this.dbg.setEnabled(true);
    // intro cinematic
    this.state = 'intro';
    this.hud.show();
    this.hud.setSkipHint(true);
    document.body.classList.add('cine-on');
    this.camRig.startIntro(this.track, city, this.race.player, this.sky);
    this.camRig.onSkip = null;
    this.audio.setCrowdBase(0.06);
    const cityLine = {
      mumbai: 'The Arabian Sea glitters — welcome to the Marine Drive Street Circuit!',
      delhi: 'Golden haze over the capital — the Rajpath Grand Circuit awaits!',
      bengaluru: 'Neon city nights — Bengaluru under the floodlights!',
      hyderabad: 'Cyber towers rise over the HITEC City Speedway!',
      chennai: 'Hot and humid on the Marina — Chennai is ready!',
      kolkata: 'Dusk over the Hooghly — the Howrah Riverside GP!',
      jaipur: 'The Pink City glows at sunset — Jaipur Desert GP!',
      ahmedabad: 'Flat-out on the Sabarmati Riverfront — pure speed ahead!',
      kochi: 'Monsoon clouds over the backwaters — Kochi will be treacherous!',
      goa: 'Golden hour in Goa — beaches, palms and pure speed!',
      ladakh: 'Three and a half kilometers up — the Himalayan Summit GP!',
    }[city.id];
    this.hud.commentary(`🎙 ${sel.isFinale ? 'THE INDIAN GRAND PRIX — the biggest race of the year! ' : ''}${cityLine}`, 7000);
    if (sel.isFinale) this._fireworksUntil = this.clock + 14;

    this._introEndAt = this.clock + 16.5;
  }

  _beginLights() {
    this.state = 'lights';
    document.body.classList.remove('cine-on');
    this.hud.setSkipHint(false);
    this.hud.showLights();
    this.race.beginLights();
    this.hud.raceControl('FORMATION COMPLETE — STARTING LIGHTS', 2500);
  }

  togglePause(force) {
    if (this.state !== 'racing' && this.state !== 'finished') return;
    this.paused = force !== undefined ? force : !this.paused;
    $('screen-pause').classList.toggle('active', this.paused);
    // always land on the main pause view, not the controls sub-panel
    if (this.paused) {
      $('pause-controls').classList.add('hidden');
      $('pause-main-box').classList.remove('hidden');
    }
    if (this.race?.mode === 'timetrial') $('btn-restart').textContent = 'END SESSION';
    else $('btn-restart').textContent = 'RESTART RACE';
  }

  quitToMenu() {
    this.paused = false;
    $('screen-pause').classList.remove('active');
    if (this.race?.mode === 'timetrial' && this.race.player.bestLap) {
      const cityId = this._lastSel.cityId;
      if (!this.bestLaps[cityId] || this.race.player.bestLap < this.bestLaps[cityId]) {
        this.bestLaps[cityId] = this.race.player.bestLap;
        localStorage.setItem('igp_best', JSON.stringify(this.bestLaps));
      }
      this.ui.setBestLap(this._overallBest());
      this.ui.showResults(this.race, 'TIME TRIAL — SESSION BEST: ' + fmtTime(this.race.player.bestLap));
      this.hud.hide();
      this.state = 'menu';
      return;
    }
    this._teardownRace();
    this.state = 'menu';
    this.ui.showScreen('screen-menu');
    this.ui.setBestLap(this._overallBest());
  }

  _teardownRace() {
    if (this._resultsTimer) { clearTimeout(this._resultsTimer); this._resultsTimer = null; }
    this.dbg.setEnabled(false);
    this.hud.hide();
    document.body.classList.remove('cine-on');
    if (this.race) { this.race.dispose(); this.race = null; }
    if (this.track) { this.track.dispose(); this.track = null; }
    if (this.env) { this.env.dispose(); this.env = null; }
  }

  afterResults() {
    if (!this.champ) { this.quitToMenu(); return; }
    // apply points
    const res = this.race.results();
    for (const r of res) {
      const s = this.champ.standings.find(x => x.driver === r.driver && x.team.id === r.team.id);
      if (s) { s.points += r.points; if (r.pos === 1) s.wins++; }
    }
    const playerRes = res.find(r => r.isPlayer);
    if (this.champ.mode === 'career') this.champ.rd += playerRes.points;
    this.champ.standings.sort((a, b) => b.points - a.points);
    this._teardownRace();
    this.ui.showStandings(this.champ);
  }

  afterStandings() {
    this.champ.round++;
    if (this.champ.round >= CITIES.length) {
      // season over — podium ceremony
      const top3 = this.champ.standings.slice(0, 3).map(s => s.driver);
      const playerWon = this.champ.standings[0].isPlayer;
      this.ui.showPodium(top3, true, playerWon);
      this.champ = null;
      return;
    }
    if (this.champ.mode === 'career') this.ui.showCareer(this.champ, this.champ.upgrades, this.champ.rd);
    else this._startChampRound();
  }

  // ---------- race events ----------
  _handleEvents() {
    for (const ev of this.race.events) {
      switch (ev.type) {
        case 'light': this.hud.setLight(ev.n); this.audio.lightBeep(); break;
        case 'lightsOut':
          this.state = 'racing';
          this.hud.lightsOut(); this.audio.lightsOut();
          this.hud.commentary('🎙 LIGHTS OUT AND AWAY WE GO!'); break;
        case 'falseStart': this.hud.raceControl('⚠ FALSE START — +10.0s PENALTY', 5000); break;
        case 'drs': this.audio.drs(); break;
        case 'fastestLap':
          if (ev.car.isPlayer) { this.hud.raceControl('🟣 FASTEST LAP — ' + fmtTime(ev.ms)); this.audio.fastestLap(); }
          break;
        case 'lapComplete': {
          const lapsLeft = this.race.laps - this.race.player.lap + 1;
          if (lapsLeft === 1) this.hud.commentary('🎙 FINAL LAP!');
          break;
        }
        case 'sectorPB': this.hud.sector(ev.sec, 'green'); break;
        case 'positionGain': this.audio.overtake(); if (ev.to <= 3) this.hud.commentary(`🎙 Great drive — P${ev.to} now!`); break;
        case 'positionLoss': this.audio.positionLost(); break;
        case 'contact': this.audio.hit(); this.camRig.shake = Math.min(1, ev.severity * 0.06); break;
        case 'finish':
          if (ev.car.position === 1 && !ev.car.isPlayer)
            this.hud.commentary(`🎙 ${ev.car.driver} wins in ${this.race.track.city.name}!`);
          break;
        case 'playerFinished': this._onPlayerFinished(); break;
      }
    }
    this.race.events.length = 0;
  }

  _onPlayerFinished() {
    this.audio.checkered();
    this.hud.raceControl('🏁 CHEQUERED FLAG', 5000);
    const pos = this.race.player.position;
    this.hud.commentary(pos === 1 ? '🎙 WHAT A DRIVE! VICTORY!' : `🎙 You bring it home P${pos}.`);
    // save best lap
    if (this.race.player.bestLap) {
      const cityId = this._lastSel.cityId;
      if (!this.bestLaps[cityId] || this.race.player.bestLap < this.bestLaps[cityId]) {
        this.bestLaps[cityId] = this.race.player.bestLap;
        localStorage.setItem('igp_best', JSON.stringify(this.bestLaps));
      }
    }
    document.body.classList.add('cine-on');
    this.camRig.mode = 'tv';   // broadcast cam for the cool-down lap
    if (this._lastSel.isFinale) this._fireworksUntil = this.clock + 10;
    this._resultsTimer = setTimeout(() => {
      if (!this.race) return;
      document.body.classList.remove('cine-on');
      this.hud.hide();
      this.ui.showResults(this.race,
        `${this.race.track.city.icon} ${this.race.track.city.name} — ${this.race.mode === 'timetrial' ? 'TIME TRIAL' : 'RACE RESULTS'}`);
      this.state = 'menu';
    }, 6000);
    this.state = 'finished';
  }

  // ---------- radio flavor ----------
  _radioMessages() {
    const st = this.race.player.state;
    const R = this._radioFlags;
    if (st.tireWear > 0.5 && !R.tire50) { R.tire50 = 1; this.hud.radio('BOX BOX — tires at 50%, manage the wear.'); }
    if (st.tireWear > 0.82 && !R.tire80) { R.tire80 = 1; this.hud.radio('Tires are GONE — be gentle in the high-speed corners!'); }
    if (st.ers < 0.12 && !R.ersLow) { R.ersLow = 1; this.hud.radio('ERS running low — lift and coast to harvest.'); }
    if (st.ers > 0.5) R.ersLow = 0;
    if (st.damage > 0.35 && !R.dmg) { R.dmg = 1; this.hud.radio('We see bodywork damage — keep it clean out there.'); }
    if (this.weatherSys.rainAmount > 0.45 && !R.rain) { R.rain = 1; this.hud.radio('Rain intensity increasing — brake earlier, avoid the puddles.'); }
    if (st.drsAvailable && !R.drs) { R.drs = 1; this.hud.radio('DRS ENABLED — press F in the zone!'); }
    if (st.tireTemp > 118 && !R.temp) { R.temp = 1; this.hud.radio('Tire temps critical — less sliding please!'); }
  }

  // ---------- fireworks ----------
  _initFireworks() {
    const N = this.FW_N = 900;
    this._fwPos = new Float32Array(N * 3);
    this._fwVel = new Float32Array(N * 3);
    this._fwLife = new Float32Array(N);
    this._fwCol = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    this._fwAttr = new THREE.BufferAttribute(this._fwPos, 3).setUsage(THREE.DynamicDrawUsage);
    this._fwColAttr = new THREE.BufferAttribute(this._fwCol, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this._fwAttr);
    g.setAttribute('color', this._fwColAttr);
    this._fw = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.6, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this._fw.frustumCulled = false;
    this._fw.visible = false;
    this.scene.add(this._fw);
    this._fwHead = 0;
    for (let i = 0; i < N; i++) this._fwPos[i * 3 + 1] = -1000;
    this._nextBurst = 0;
    this._fireworksUntil = 0;
  }
  _spawnBurst(center) {
    const colors = [0xff9933, 0xffffff, 0x138808, 0xffd23f, 0xff4a6a];
    const c = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);
    for (let k = 0; k < 90; k++) {
      const i = this._fwHead; this._fwHead = (this._fwHead + 1) % this.FW_N;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      const sp = 18 + Math.random() * 22;
      this._fwPos[i * 3] = center.x; this._fwPos[i * 3 + 1] = center.y; this._fwPos[i * 3 + 2] = center.z;
      this._fwVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this._fwVel[i * 3 + 1] = Math.cos(ph) * sp;
      this._fwVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this._fwLife[i] = 1.4 + Math.random() * 0.8;
      this._fwCol[i * 3] = c.r; this._fwCol[i * 3 + 1] = c.g; this._fwCol[i * 3 + 2] = c.b;
    }
    this._fwColAttr.needsUpdate = true;
  }
  _updateFireworks(dt) {
    if (this.clock < this._fireworksUntil) {
      this._nextBurst -= dt;
      if (this._nextBurst <= 0) {
        this._nextBurst = 0.5 + Math.random() * 0.7;
        const p = this.race.player.state.pos;
        this._spawnBurst(new THREE.Vector3(p.x + (Math.random() - 0.5) * 300, p.y + 90 + Math.random() * 60, p.z + (Math.random() - 0.5) * 300));
        this.audio.crowdSwell(0.3, 1);
      }
    }
    let any = false;
    for (let i = 0; i < this.FW_N; i++) {
      if (this._fwLife[i] <= 0) continue;
      any = true;
      this._fwLife[i] -= dt;
      if (this._fwLife[i] <= 0) { this._fwPos[i * 3 + 1] = -1000; continue; }
      this._fwVel[i * 3 + 1] -= 9 * dt;
      this._fwPos[i * 3] += this._fwVel[i * 3] * dt;
      this._fwPos[i * 3 + 1] += this._fwVel[i * 3 + 1] * dt;
      this._fwPos[i * 3 + 2] += this._fwVel[i * 3 + 2] * dt;
    }
    this._fw.visible = any;
    if (any) this._fwAttr.needsUpdate = true;
  }

  // ---------- frame ----------
  _frame(tms) {
    const now = tms / 1000;
    let dt = Math.min(now - (this._last || now), 0.05);
    this._last = now;
    if (dt <= 0) return;
    this.clock += dt;

    if (this._loading || this.state === 'menu' || this.state === 'loading') return;

    this.input.update(dt);

    // intro cinematic
    if (this.state === 'intro') {
      this.camRig.update(dt, this.race.player, this.track, this.clock);
      if (this.camRig.cinematic === null) this._beginLights();
      // rev ambience
      const st = this.race.player.state;
      this.audio.updateEngine(0.35 + Math.sin(this.clock * 5) * 0.1, 0.3, 0, 0, false);
      this._updateFireworks(dt);
      this.sky.update(dt, this.race.player.state.pos, this.clock);
      this.env.update(dt, this.clock);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }

    // camera cycle
    if (this.input.consume('KeyC')) {
      const label = this.camRig.cycle();
      this.hud.raceControl('📷 ' + label, 1200);
    }
    // reset to track
    if (this.input.consume('KeyR') && (this.state === 'racing' || this.state === 'finished')) {
      const st = this.race.player.state;
      const near = this.track.nearest(st.pos, st.trackIdx);
      const p = this.track.pointAt(near.t), tn = this.track.tangentAt(near.t);
      st.pos.set(p.x, p.y, p.z);
      st.yaw = Math.atan2(tn.x, tn.z);
      st.speed = 0; st.latVel = 0; st.reversing = false;
      this.camRig._pos.set(p.x - tn.x * 7, p.y + 3, p.z - tn.z * 7);
      this.hud.raceControl('⟲ RESET TO TRACK', 1500);
    }
    // stuck? show recovery hint: hold S to reverse, R to reset
    if (this.state === 'racing') {
      const st = this.race.player.state;
      const stuck = Math.abs(st.speed) < 2.5 && this.input.throttle > 0.5 && (st.hitWall || st.wallHitT > 0 || st.offTrack);
      this._stuckTime = stuck ? (this._stuckTime || 0) + dt : 0;
      if (this._stuckTime > 1.2) { this.hud.raceControl('STUCK? HOLD S/↓ TO REVERSE · PRESS R TO RESET', 2600); this._stuckTime = -3.2; }
    }

    // physics (substep for stability)
    const steps = dt > 0.025 ? 2 : 1;
    for (let s = 0; s < steps; s++) {
      this.race.update(dt / steps, {
        throttle: this.input.throttle, brake: this.input.brake,
        steer: this.input.steer, ers: this.input.ers, drs: this.input.drs,
      }, this.camRig.mode);
    }

    this._handleEvents();
    if (this.state === 'racing') this._radioMessages();

    // world updates
    const pPos = this.race.player.state.pos;
    this.sky.update(dt, pPos, this.clock);
    this.weatherSys.update(dt, this.camera, this.race.cars, this.clock);
    this.env.update(dt, this.clock);
    this._updateFireworks(dt);
    this.audio.setRain(this.weatherSys.rainAmount);

    // lightning flash → boost hemi briefly
    if (this.weatherSys.flash > 0) {
      this.sky.hemi.intensity += this.weatherSys.flash * 3.5;
    }

    // camera
    this.camRig.update(dt, this.race.player, this.track, this.clock);

    // HUD
    this.hud.update(this.race, dt, this.camRig.label());

    // audio
    const st = this.race.player.state;
    const rpm01 = clamp((st.rpm - 3800) / 8800, 0, 1);
    this.audio.updateEngine(rpm01, this.state === 'racing' ? this.input.throttle : 0.2,
      clamp(st.speed / 100, 0, 1), st.slide, st.ersDeploying);
    if (st.justShifted) this.audio.shift(st.justShifted > 0);

    this.renderer.render(this.scene, this.camera);
  }
}

window.game = new Game();
