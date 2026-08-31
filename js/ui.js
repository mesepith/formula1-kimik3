// ============ ui.js — menus & screens ============
import { CITIES, TEAMS, WEATHERS, TIMES_OF_DAY, GAME, INDIAN_GP_CITY } from './config.js';
import { fmtTime, hexColor, clamp } from './utils.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.sel = { mode: 'quick', cityId: 'mumbai', teamId: 'tiranga', carIndex: 0, weather: null, time: null, laps: GAME.lapsDefault, ai: GAME.aiCountDefault };
    this._buildMenuList();
    $('screen-splash').addEventListener('click', () => { this.h.onEnter(); this.showScreen('screen-menu'); });
    document.querySelectorAll('#screen-menu .menu-btn').forEach(b => {
      b.addEventListener('click', () => this._menuAction(b.dataset.action));
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => this.showScreen('screen-menu')));
    $('btn-startrace').addEventListener('click', () => this.h.onStartRace(this.sel));
    $('btn-resume').addEventListener('click', () => this.h.onResume());
    $('btn-restart').addEventListener('click', () => this.h.onRestart());
    $('btn-quit').addEventListener('click', () => this.h.onQuit());
    $('btn-controls').addEventListener('click', () => {
      $('pause-main-box').classList.add('hidden');
      $('pause-controls').classList.remove('hidden');
    });
    $('btn-controls-back').addEventListener('click', () => {
      $('pause-controls').classList.add('hidden');
      $('pause-main-box').classList.remove('hidden');
    });
    $('btn-results-continue').addEventListener('click', () => this.h.onResultsContinue());
    $('btn-results-retry').addEventListener('click', () => this.h.onRestart());
    $('btn-results-menu').addEventListener('click', () => this.h.onQuit());
    $('btn-standings-continue').addEventListener('click', () => this.h.onStandingsContinue());
    $('btn-nextround').addEventListener('click', () => this.h.onCareerNext());
    $('btn-podium-continue').addEventListener('click', () => this.h.onPodiumContinue());
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (id) $(id).classList.add('active');
  }
  hideAll() { this.showScreen(null); }

  _buildMenuList() {
    const list = $('mp-list');
    list.innerHTML = '';
    CITIES.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'mp-item';
      div.innerHTML = `<span class="rnd">R${String(i + 1).padStart(2, '0')}</span>
        <span class="dot" style="background:#${c.env.buildings.palette[0].toString(16).padStart(6, '0')}"></span>
        <span>${c.icon} ${c.name}</span><span style="margin-left:auto;opacity:.5;font-size:10px">${c.lengthKm} KM</span>`;
      list.appendChild(div);
    });
  }

  _menuAction(action) {
    if (action === 'howto') { this.showScreen('screen-howto'); return; }
    this.sel.mode = action;
    this.h.onMenuSound?.();
    if (action === 'career' || action === 'championship') {
      this.h.onNewSeason(action);   // main decides flow → car select
    } else {
      this.openTrackSelect();
    }
  }

  openTrackSelect() {
    $('track-head').textContent = this.sel.mode === 'timetrial' ? 'TIME TRIAL — SELECT CIRCUIT' : 'QUICK RACE — SELECT CIRCUIT';
    const grid = $('track-grid');
    grid.innerHTML = '';
    for (const c of CITIES) {
      const card = document.createElement('div');
      card.className = 'track-card' + (c.id === INDIAN_GP_CITY ? ' gp' : '');
      // thumbnail canvas with track shape
      const cv = document.createElement('canvas');
      cv.width = 250; cv.height = 86;
      cv.className = 'tc-art';
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 250, 86);
      const pc = '#' + c.env.buildings.palette[0].toString(16).padStart(6, '0');
      g.addColorStop(0, '#141a26'); g.addColorStop(1, '#0c1018');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 250, 86);
      // track outline
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const p of c.points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
      const sc = Math.min(200 / (maxX - minX), 62 / (maxZ - minZ));
      ctx.strokeStyle = pc; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.shadowColor = pc; ctx.shadowBlur = 8;
      ctx.beginPath();
      c.points.forEach((p, i) => {
        const x = 25 + (p[0] - minX) * sc + (200 - (maxX - minX) * sc) / 2;
        const y = 12 + (p[1] - minZ) * sc + (62 - (maxZ - minZ) * sc) / 2;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath(); ctx.stroke();
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend', `
        <div class="tc-num">${String(CITIES.indexOf(c) + 1).padStart(2, '0')}</div>
        <div class="tc-meta">${c.icon} ${c.lengthKm} KM</div>
        <div class="tc-name">${c.name}</div>
        <div class="tc-desc">${c.title} — ${c.desc}</div>`);
      card.addEventListener('click', () => { this.sel.cityId = c.id; this.h.onMenuSound?.(); this.openCarSelect(); });
      grid.appendChild(card);
    }
    this.showScreen('screen-track');
  }

  openCarSelect() {
    const grid = $('car-grid');
    grid.innerHTML = '';
    for (const t of TEAMS) {
      const card = document.createElement('div');
      card.className = 'car-card';
      const p = hexColor(t.primary), s = hexColor(t.secondary), a = hexColor(t.accent);
      card.innerHTML = `
        <div class="cc-swatch" style="background:linear-gradient(120deg,${p} 0 55%,${s} 55% 82%,${a} 82%)">
          <span class="cc-num">${t.numbers[0]}</span></div>
        <div class="cc-name">${t.name}</div>
        <div class="cc-drivers">${t.drivers.join(' · ')} — ${t.desc}</div>`;
      card.addEventListener('click', () => {
        this.sel.teamId = t.id;
        this.h.onMenuSound?.();
        if (this.sel.mode === 'career' || this.sel.mode === 'championship') this.h.onSeasonTeamChosen(t.id);
        else this.openOptions();
      });
      grid.appendChild(card);
    }
    this.showScreen('screen-car');
  }

  openOptions(isChampionshipRound = false, cityFixed = null) {
    const wRow = $('opt-weather'), tRow = $('opt-time'), lRow = $('opt-laps'), aRow = $('opt-ai');
    const mk = (row, items, key, def) => {
      row.innerHTML = '';
      items.forEach(it => {
        const chip = document.createElement('div');
        chip.className = 'opt-chip';
        chip.textContent = it.icon ? `${it.icon} ${it.name}` : it.name;
        if ((this.sel[key] ?? def) === it.id) chip.classList.add('sel');
        chip.addEventListener('click', () => {
          this.sel[key] = it.id;
          row.querySelectorAll('.opt-chip').forEach(c => c.classList.remove('sel'));
          chip.classList.add('sel');
        });
        row.appendChild(chip);
      });
      if (this.sel[key] == null) this.sel[key] = def;
    };
    const city = CITIES.find(c => c.id === (cityFixed || this.sel.cityId));
    mk(wRow, WEATHERS, 'weather', city.weatherDefault);
    mk(tRow, TIMES_OF_DAY, 'time', city.timeDefault);
    mk(lRow, [2, 3, 5, 7].map(l => ({ id: l, name: l + ' LAPS' })), 'laps', GAME.lapsDefault);
    mk(aRow, [5, 8, 11, 15].map(n => ({ id: n, name: n + ' CARS' })), 'ai', GAME.aiCountDefault);
    $('track-head') && null;
    this.showScreen('screen-options');
  }

  // ---------- results ----------
  showResults(race, title) {
    $('results-title').textContent = title || 'RACE RESULTS';
    const tbl = $('results-table');
    const res = race.results();
    let html = `<tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>BEST LAP</th><th>STATUS</th><th>PTS</th></tr>`;
    for (const r of res) {
      html += `<tr class="${r.isPlayer ? 'player-row' : ''} ${r.pos === 1 ? 'p1' : ''}">
        <td>${r.pos}</td><td>${r.isPlayer ? '⭐ ' : ''}${r.driver}</td>
        <td><span class="teamdot" style="background:${hexColor(r.team.primary)}"></span>${r.team.name}</td>
        <td>${fmtTime(r.bestLap)}</td>
        <td>${r.finished ? 'Finished' : 'Running'}</td><td>${r.points}</td></tr>`;
    }
    tbl.innerHTML = html;
    $('btn-results-retry').style.display = (race.mode === 'quick' || race.mode === 'timetrial') ? '' : 'none';
    this.showScreen('screen-results');
  }

  showStandings(champ, title) {
    const tbl = $('standings-table');
    let html = `<tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>POINTS</th><th>WINS</th></tr>`;
    champ.standings.forEach((s, i) => {
      html += `<tr class="${s.isPlayer ? 'player-row' : ''} ${i === 0 ? 'p1' : ''}">
        <td>${i + 1}</td><td>${s.isPlayer ? '⭐ ' : ''}${s.driver}</td>
        <td><span class="teamdot" style="background:${hexColor(s.team.primary)}"></span>${s.team.name}</td>
        <td><b>${s.points}</b></td><td>${s.wins}</td></tr>`;
    });
    tbl.innerHTML = html;
    this.showScreen('screen-standings');
  }

  showCareer(champ, upgrades, rdPoints) {
    const round = champ.round + 1;
    const nextCity = CITIES[champ.round % CITIES.length];
    $('career-info').innerHTML = `
      <b>SEASON ${champ.season} · ROUND ${round}/${CITIES.length}</b> — Next: <b>${nextCity.icon} ${nextCity.name}</b> (${nextCity.title})<br>
      You have <b style="color:#7ef0ff">${rdPoints} R&amp;D points</b>. Spend them on upgrades before the next race.`;
    const list = $('upgrade-list');
    list.innerHTML = '';
    const defs = [
      ['engine', '⚙ ENGINE', '+22 kW per level'],
      ['aero', '🌬 AERO', '+4.5% downforce per level'],
      ['tires', '🛞 TIRES', '+2% grip per level'],
    ];
    for (const [key, name, desc] of defs) {
      const lvl = upgrades[key];
      const cost = lvl + 1;
      const row = document.createElement('div');
      row.className = 'upg-row';
      row.innerHTML = `<span class="uname">${name}</span>
        <span class="upips">${[0, 1, 2, 3, 4].map(i => `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('')}</span>
        <span style="font-size:11px;opacity:.6;width:170px">${desc}</span>`;
      const btn = document.createElement('button');
      btn.textContent = lvl >= 5 ? 'MAX' : `UPGRADE (${cost} PTS)`;
      btn.disabled = lvl >= 5 || rdPoints < cost;
      btn.addEventListener('click', () => this.h.onBuyUpgrade(key));
      row.appendChild(btn);
      list.appendChild(row);
    }
    this.showScreen('screen-career');
  }

  showPodium(top3, isChampion, playerWon) {
    $('pod-1').textContent = top3[0] || '—';
    $('pod-2').textContent = top3[1] || '—';
    $('pod-3').textContent = top3[2] || '—';
    document.querySelector('.podium-title').textContent = isChampion
      ? (playerWon ? '🏆 YOU ARE THE INDIAN GRAND PRIX CHAMPION! 🏆' : '🏆 THE INDIAN GRAND PRIX 🏆')
      : '🏁 RACE PODIUM';
    this.showScreen('screen-podium');
  }

  setBestLap(ms) {
    $('menu-best').textContent = ms ? 'BEST LAP: ' + fmtTime(ms) : 'BEST LAP: —';
  }
}
