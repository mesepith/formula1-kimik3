// Reproduce the exact reported bug: car at extreme left (against wall / on verge),
// press F4, click where the car is — must show road info.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-swiftshader', '--mute-audio',
  '--remote-debugging-port=9342', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) });
async function main() {
  let wsUrl;
  for (let i = 0; i < 40; i++) { try { const l = await (await fetch('http://localhost:9342/json')).json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break } } catch { } await sleep(250) }
  ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  const errs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } if (m.method === 'Runtime.exceptionThrown') errs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8642/' });
  await sleep(5000);
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)) : r.result?.value };
  await ev(`document.getElementById('screen-splash').click()`);
  await sleep(300);

  const out = await ev(`(async()=>{
    const game = window.game ?? Array.from(Object.values(window)).find(o => o && typeof o === 'object' && o.startRace && o.dbg);
    if (!game) return 'GAME NOT FOUND — window.game missing';
    if (!game.startRace) return 'GAME FOUND BUT NO startRace';
    game.startRace({ mode:'quick', cityId:'ladakh', teamId:'tiranga', weather:'highcloud', time:'morning', laps:3, ai:3 });
    await new Promise(r=>setTimeout(r,3500));
    // skip the intro cinematic so camRig owns the camera like real gameplay
    game.camRig.skipCinematic();
    game.state = 'racing';
    // put the car at the extreme left against the wall, like the user's screenshot
    const st = game.race.player.state;
    const tr = game.track, s = tr.samples;
    const hw = tr.halfWidth;
    const n0 = tr.nearest({x: st.pos.x, z: st.pos.z}, st.trackIdx);
    const i = n0.i;
    const latLeft = -(hw + 2.6);         // extreme left, on verge near wall
    st.pos.x = s.px[i] + s.rx[i] * latLeft;
    st.pos.z = s.pz[i] + s.rz[i] * latLeft;
    st.pos.y = s.py[i];
    st.latVel = 0; st.speed = 0;
    // let a couple frames run so camRig chase camera settles behind the car
    await new Promise(r=>setTimeout(r,1200));
    game.dbg.setEnabled(true);
    game.dbg.toggle(true);

    // project the car's own position (left verge) to screen and click it
    const cam = game.camera;
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const me = cam.matrixWorldInverse.elements, pm = cam.projectionMatrix.elements;
    const proj = (wx,wy,wz)=>{
      const tx = me[0]*wx + me[4]*wy + me[8]*wz + me[12];
      const ty = me[1]*wx + me[5]*wy + me[9]*wz + me[13];
      const tz = me[2]*wx + me[6]*wy + me[10]*wz + me[14];
      const cw = pm[3]*tx + pm[7]*ty + pm[11]*tz + pm[15];
      return [ (pm[0]*tx + pm[4]*ty + pm[8]*tz + pm[12])/cw, (pm[1]*tx + pm[5]*ty + pm[9]*tz + pm[13])/cw ];
    };
    // point a few metres ahead of the car, on the left verge
    const i2 = (i + Math.round(18/(tr.length/tr.N))) % tr.N;
    const wx = s.px[i2] + s.rx[i2]*latLeft, wz = s.pz[i2] + s.rz[i2]*latLeft, wy = s.py[i2];
    const [nx, ny] = proj(wx, wy, wz);
    const r2 = document.getElementById('gl').getBoundingClientRect();
    const sx = r2.left + (nx*0.5+0.5)*r2.width, sy = r2.top + (-ny*0.5+0.5)*r2.height;
    document.getElementById('gl').dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
    await new Promise(r=>setTimeout(r,200));
    const panel = document.getElementById('road-debug-panel');
    const txt = panel.innerText||'';
    const last = game.dbg.last();
    return {
      clickAt: [sx|0, sy|0],
      worldTarget: [wx|0, wy|0, wz|0],
      panelShown: !panel.classList.contains('hidden'),
      isError: txt.startsWith('⚠'),
      text: txt.slice(0, 320),
      last: last ? { lat:+last.lat.toFixed(2), surface:last.surface, distM:last.distM } : null,
      camPos: [cam.position.x|0, cam.position.y|0, cam.position.z|0],
      carPos: [st.pos.x|0, st.pos.y|0, st.pos.z|0],
      carLat: +(st.lat||0).toFixed?.(2),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  console.log('errors:', errs.length ? errs : 'none');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.data) fs.writeFileSync('/tmp/road-debug-kerb.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot → /tmp/road-debug-kerb.png');
  chrome.kill();
  process.exit(0);
}
main();
