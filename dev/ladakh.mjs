// Ladakh scan: start a solo race, then free-cam around the whole lap screenshotting.
// Run: node dev/ladakh.mjs   (server on :8642)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9371;
const shotDir = new URL('./shots/', import.meta.url).pathname;
mkdirSync(shotDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${PORT}`, '--window-size=1400,860', '--force-device-scale-factor=1',
  '--no-first-run', '--user-data-dir=/tmp/igp-ladakh-profile', 'about:blank',
], { stdio: 'ignore' });

let id = 0; const pending = new Map(); let ws;
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) console.log('EVAL-ERR', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shotDir}${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('shot:', name);
}
async function waitState(state, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await ev('window.game && window.game.state');
    if (s === state) return true;
    await sleep(400);
  }
  return false;
}

async function main() {
  let wsUrl;
  for (let i = 0; i < 50; i++) {
    try { const l = await (await fetch(`http://localhost:${PORT}/json`)).json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch { }
    await sleep(250);
  }
  ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  ws.onmessage = (evv) => {
    const m = JSON.parse(evv.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8642/' });
  await sleep(4500);
  await ev(`document.getElementById('screen-splash').click()`);
  await sleep(300);
  await ev(`window.game.startRace({mode:'quick',cityId:'ladakh',teamId:'tiranga',carIndex:0,weather:'highcloud',time:'morning',laps:3,ai:0})`);
  const ok = await waitState('intro', 60000);
  console.log('intro reached:', ok);
  // freeze the game loop: stop the animation loop so our manual renders stick
  await ev(`(function(){ const g=window.game; g.renderer.setAnimationLoop(null); })()`);
  await sleep(300);
  const N = 12;
  for (let k = 0; k < N; k++) {
    const t = k / N;
    await ev(`(function(){
      const g = window.game; const tr = g.track;
      const p = tr.pointAt(${t}), tn = tr.tangentAt(${t});
      const c = g.camRig.cam;
      c.position.set(p.x - tn.x*52, p.y + 38, p.z - tn.z*52);
      c.lookAt(p.x + tn.x*40, p.y, p.z + tn.z*40);
      c.fov = 64; c.updateProjectionMatrix();
      g.renderer.render(g.scene, c);
    })()`);
    await sleep(250);
    await shot(`ladakh-scan-${String(k).padStart(2, '0')}`);
  }
  // overview orbit (4 high angles)
  for (let a = 0; a < 4; a++) {
    await ev(`(function(){
      const g = window.game; const tr = g.track;
      const s = tr.samples; let cx=0,cz=0,my=-1e9,ny=1e9,n=0;
      for (let i=0;i<tr.N;i+=8){cx+=s.px[i];cz+=s.pz[i];my=Math.max(my,s.py[i]);ny=Math.min(ny,s.py[i]);n++;}
      cx/=n; cz/=n;
      const ang=${a}*Math.PI/2 + 0.4;
      const c = g.camRig.cam;
      c.position.set(cx+Math.cos(ang)*430, my+360, cz+Math.sin(ang)*430);
      c.lookAt(cx, (my+ny)/2 - 20, cz); c.fov=50; c.updateProjectionMatrix();
      g.renderer.render(g.scene, c);
    })()`);
    await sleep(250);
    await shot(`ladakh-orbit-${a}`);
  }
  console.log('done');
  chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
