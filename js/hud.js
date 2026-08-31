// ============ hud.js — race HUD ============
import { clamp, fmtTime, fmtGap } from './utils.js';
import { hexColor } from './utils.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this._msgTimer = null; this._radioTimer = null; this._commTimer = null;
    this._mapPts = null;
    this._mapTimer = 0;
    this._towerTimer = 0;
    this._towerRows = [];
    this.mapCtx = $('minimap').getContext('2d');
  }
  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  setupRace(race, weatherDef, laps) {
    $('lap-total').textContent = race.mode === 'timetrial' ? '∞' : laps;
    $('wx-icon').textContent = weatherDef.icon;
    $('wx-text').textContent = weatherDef.name;
    $('map-city').textContent = race.track.city.name;
    $('t-last').textContent = '--:--.---';
    $('t-best').textContent = '--:--.---';
    $('session-flag').className = 'flag-green';
    $('session-flag').textContent = 'GRID';
    // tower
    const tower = $('tower');
    tower.innerHTML = '';
    this._towerRows = [];
    for (const car of race.cars) {
      const row = document.createElement('div');
      row.className = 'tower-row' + (car.isPlayer ? ' player' : '');
      row.style.borderLeftColor = hexColor(car.team.primary);
      row.innerHTML = `<span class="pos"></span><span class="tname"></span><span class="tgap"></span>`;
      tower.appendChild(row);
      this._towerRows.push({ row, car, pos: row.children[0], name: row.children[1], gap: row.children[2] });
    }
    this.buildMinimap(race.track);
  }

  buildMinimap(track) {
    const s = track.samples, N = track.N;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i += 2) {
      minX = Math.min(minX, s.px[i]); maxX = Math.max(maxX, s.px[i]);
      minZ = Math.min(minZ, s.pz[i]); maxZ = Math.max(maxZ, s.pz[i]);
    }
    const pad = 18, W = 220, H = 220;
    const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    this._mapPts = [];
    for (let i = 0; i < N; i += 4) {
      this._mapPts.push([
        pad + (s.px[i] - minX) * sc + (W - pad * 2 - (maxX - minX) * sc) / 2,
        pad + (s.pz[i] - minZ) * sc + (H - pad * 2 - (maxZ - minZ) * sc) / 2]);
    }
    this._mapScale = sc; this._mapMin = [minX, minZ]; this._mapPad = pad;
  }
  _mapXY(x, z) {
    const [minX, minZ] = this._mapMin, sc = this._mapScale, pad = this._mapPad;
    const W = 220, H = 220;
    return [pad + (x - minX) * sc, pad + (z - minZ) * sc];
  }

  update(race, dt, camLabel) {
    const player = race.player, st = player.state;
    // tach
    $('speed').textContent = Math.round(Math.abs(st.speed) * 3.6);
    $('gear').textContent = st.reversing ? 'R' : st.gear;
    const rpm01 = clamp((st.rpm - 3800) / (12600 - 3800), 0, 1);
    $('rpm-bar').style.width = (rpm01 * 100).toFixed(1) + '%';
    const ersBar = $('ers-bar');
    ersBar.style.width = (st.ers * 100).toFixed(0) + '%';
    ersBar.classList.toggle('deploying', st.ersDeploying);
    const drs = $('drs-light');
    drs.className = st.drsOpen ? 'open' : (st.drsAvailable ? 'avail' : '');
    drs.id = 'drs-light';
    drs.textContent = st.drsOpen ? 'DRS OPEN' : (st.drsAvailable ? 'DRS READY' : 'DRS');
    // tires
    const tireCol = w => w < 0.35 ? '#3a7' : w < 0.65 ? '#da3' : '#d43';
    $('tire-fl').style.background = tireCol(st.tireWear);
    $('tire-fr').style.background = tireCol(st.tireWear);
    $('tire-rl').style.background = tireCol(st.tireWear);
    $('tire-rr').style.background = tireCol(st.tireWear);
    // laps
    $('lap-cur').textContent = race.mode === 'timetrial' ? player.lap : Math.min(player.lap, race.laps) || 1;
    // times
    $('t-last').textContent = fmtTime(player.lastLap);
    $('t-best').textContent = fmtTime(player.bestLap);
    const flag = $('session-flag');
    if (race.state === 'racing') { flag.className = 'flag-green'; flag.textContent = 'GREEN'; }
    else if (race.state === 'finished') { flag.className = 'flag-checkered'; flag.textContent = 'FINISH'; }
    else if (race.state === 'lights') { flag.className = 'flag-yellow'; flag.textContent = 'START'; }
    // gap
    const order = race._order;
    const pi = order.indexOf(player);
    if (pi > 0 && player.gapAhead != null) $('t-gap').textContent = '+' + player.gapAhead.toFixed(1) + 's';
    else $('t-gap').textContent = pi === 0 ? 'LEADER' : '—';

    $('cam-label').textContent = camLabel || '';
    $('offtrack-warn').classList.toggle('hidden', !st.offTrack || race.state !== 'racing');

    // tower (throttled)
    this._towerTimer -= dt;
    if (this._towerTimer <= 0) {
      this._towerTimer = 0.25;
      for (const tr of this._towerRows) {
        tr.pos.textContent = tr.car.position;
        tr.name.textContent = tr.car.driver;
        if (tr.car.finished) tr.gap.textContent = 'FIN';
        else if (tr.car.position === 1) tr.gap.textContent = 'LAP ' + tr.car.lap;
        else tr.gap.textContent = tr.car.gapAhead != null ? '+' + tr.car.gapAhead.toFixed(1) : '';
        tr.row.classList.toggle('fastest', race.fastestLap.car === tr.car);
      }
      // order rows visually
      const sorted = [...this._towerRows].sort((a, b) => a.car.position - b.car.position);
      const tower = $('tower');
      sorted.forEach(tr => tower.appendChild(tr.row));
    }

    // minimap (throttled)
    this._mapTimer -= dt;
    if (this._mapTimer <= 0 && this._mapPts) {
      this._mapTimer = 0.08;
      const ctx = this.mapCtx;
      ctx.clearRect(0, 0, 220, 220);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath();
      this._mapPts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath(); ctx.stroke();
      for (const car of race.cars) {
        const [x, y] = this._mapXY(car.state.pos.x, car.state.pos.z);
        ctx.fillStyle = car.isPlayer ? '#ff7a00' : (car.position === 1 ? '#ffd23f' : '#c8d0d8');
        ctx.beginPath();
        ctx.arc(x, y, car.isPlayer ? 5 : 3.5, 0, 7);
        ctx.fill();
        if (car.isPlayer) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
  }

  // ---------- overlays ----------
  showLights() { $('lights-wrap').classList.remove('hidden'); }
  setLight(n) {
    const lights = document.querySelectorAll('#lights .light');
    lights.forEach((l, i) => l.classList.toggle('on', i < n));
  }
  lightsOut() {
    document.querySelectorAll('#lights .light').forEach(l => l.classList.remove('on'));
    setTimeout(() => $('lights-wrap').classList.add('hidden'), 400);
    const b = $('start-banner');
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 1600);
  }
  hideLights() { $('lights-wrap').classList.add('hidden'); }

  raceControl(txt, dur = 4000) {
    const el = $('race-control');
    el.textContent = txt;
    el.classList.remove('hidden');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.add('hidden'), dur);
  }
  radio(txt, dur = 4500) {
    const el = $('radio');
    $('radio-text').textContent = txt;
    el.classList.remove('hidden');
    clearTimeout(this._radioTimer);
    this._radioTimer = setTimeout(() => el.classList.add('hidden'), dur);
  }
  commentary(txt, dur = 5000) {
    const el = $('commentary');
    el.textContent = txt;
    clearTimeout(this._commTimer);
    this._commTimer = setTimeout(() => { el.textContent = ''; }, dur);
  }
  sector(i, cls) {
    const el = $('sec' + i);
    el.className = 'sector ' + cls;
    setTimeout(() => { el.className = 'sector'; }, 3000);
  }
  setSkipHint(v) { $('skip-hint').classList.toggle('hidden', !v); }
}
