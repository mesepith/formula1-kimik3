// CDP driver: loads the game, clicks through menus, starts a race, screenshots.
// Usage: node dev/drive.mjs [scenario]   (run from project root, server on :8642)
// scenario: 'flow' (default) | 'cities' | comma list like 'goa,jaipur'
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PAGE_URL = 'http://localhost:8642/';
const shotDir = new URL('./shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${PORT}`, '--window-size=1600,900',
  '--no-first-run', '--user-data-dir=/tmp/igp-drive-profile', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWS() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { }
    await sleep(250);
  }
  throw new Error('chrome not reachable');
}

let id = 0;
const pending = new Map();
let ws;
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
const consoleMsgs = [];
async function connect() {
  const url = await getWS();
  ws = new WebSocket(url);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleMsgs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EVAL-ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('shot:', name);
}
async function waitState(state, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await evaluate('window.game && window.game.state');
    if (s === state) return true;
    await sleep(400);
  }
  return false;
}
async function key(code, ms = 80) {
  await evaluate(`(function(){ window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'})); setTimeout(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'})), ${ms}); })()`);
}
async function autodriveOn() {
  await evaluate(`(function(){
    const g = window.game;
    if (g._assist) return;
    g._assist = setInterval(() => {
      const st = g.race && g.race.player && g.race.player.state;
      const tr = g.track;
      if (!st || !tr) return;
      const near = tr.nearest(st.pos, st.trackIdx);
      const lookT = (near.t + 34 / tr.length) % 1;
      const p = tr.pointAt(lookT);
      const targetYaw = Math.atan2(p.x - st.pos.x, p.z - st.pos.z);
      let e = targetYaw - st.yaw;
      while (e > Math.PI) e -= 2 * Math.PI;
      while (e < -Math.PI) e += 2 * Math.PI;
      const i = g.input;
      const ds = tr.length / tr.N;
      let vT = 1e9;
      const ahead = Math.max(4, Math.floor(st.speed * 1.4 / ds));
      for (let k = 2; k < ahead; k += 2) vT = Math.min(vT, tr.samples.vMax[(near.i + k) % tr.N]);
      if (!isFinite(vT)) vT = 90;
      i.steer = Math.max(-1, Math.min(1, -e * 2.4));
      if (st.speed > vT * 1.0) { i.throttle = 0; i.brake = 0.85; }
      else { i.throttle = 1; i.brake = 0; }
      i.keys = {};
    }, 50);
  })()`);
}

async function startRace(cityId, weather, time) {
  await evaluate(`document.getElementById('screen-splash').click()`);
  await sleep(300);
  await evaluate(`window.game.startRace({mode:'quick',cityId:'${cityId}',teamId:'tiranga',carIndex:0,weather:${weather ? `'${weather}'` : 'null'},time:${time ? `'${time}'` : 'null'},laps:3,ai:11})`);
  const ok = await waitState("intro", 90000);
  if (!ok) { console.log(cityId, 'INTRO TIMEOUT'); return false; }
  await sleep(1500);
  await key('Enter');
  await waitState('lights', 9000);
  const racing = await waitState('racing', 12000);
  console.log(cityId, 'racing:', racing);
  return racing;
}

async function main() {
  const scenario = process.argv[2] || 'flow';
  await connect();
  await send('Page.navigate', { url: PAGE_URL });
  await sleep(3500);
  console.log('errors after load:', await evaluate('JSON.stringify(window.__errors)'));

  if (scenario === 'flow') {
    await evaluate(`document.getElementById('screen-splash').click()`);
    await sleep(500);
    await shot('02-menu');
    await evaluate(`document.querySelector('[data-action="quick"]').click()`);
    await sleep(400);
    await shot('03-trackselect');
    await evaluate(`document.querySelector('.car-card').click()`); // team (from track select? no—first click a track)
    // actually click first track then first car
    await evaluate(`window.game.ui.openTrackSelect()`);
    await sleep(300);
    await evaluate(`document.querySelector('.track-card').click()`);
    await sleep(300);
    await evaluate(`document.querySelector('.car-card').click()`);
    await sleep(300);
    await shot('05-options');
    await evaluate(`document.getElementById('btn-startrace').click()`);
    const ok = await waitState("intro", 90000);
    console.log('intro:', ok);
    await sleep(2500);
    await shot('06-intro');
    await key('Enter');
    await waitState('lights', 9000);
    await sleep(2500);
    await shot('08-lights');
    const racing = await waitState('racing', 12000);
    console.log('racing:', racing);
    await autodriveOn();
    await sleep(6000);
    await shot('09-racing');
    console.log('speed:', await evaluate('Math.round(window.game.race.player.state.speed*3.6)'),
      'pos:', await evaluate('window.game.race.player.position'),
      'lap:', await evaluate('window.game.race.player.lap'));
    await key('KeyC'); await sleep(600); await shot('10-cockpit');
    await key('KeyC'); await key('KeyC'); await key('KeyC'); await sleep(600); await shot('13-tv');
    await key('KeyC'); await sleep(400);
    await sleep(6000);
    await shot('14-racing2');
    console.log('drawcalls:', await evaluate('window.game.renderer.info.render.calls'),
      'tris:', await evaluate('window.game.renderer.info.render.triangles'));
  } else {
    // cities list
    const cities = scenario === 'cities' ? ['goa', 'jaipur', 'ladakh', 'bengaluru', 'delhi', 'kochi'] : scenario.split(',');
    for (const spec of cities) {
      const [cid, wx, tod] = spec.split(':');
      const ok = await startRace(cid, wx, tod);
      await sleep(1200);
      await shot('city-' + cid + (wx ? '-' + wx : ''));
      await autodriveOn();
      await sleep(7000);
      await shot('city-' + cid + (wx ? '-' + wx : '') + '-drive');
      console.log(cid, 'errors:', await evaluate('JSON.stringify(window.__errors)'));
      await evaluate('clearInterval(window.game._assist); window.game._assist = null;');
    }
  }
  console.log('console problems:', JSON.stringify(consoleMsgs.slice(0, 14)));
  console.log('window errors:', await evaluate('JSON.stringify(window.__errors)'));
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
