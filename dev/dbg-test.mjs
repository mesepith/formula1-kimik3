// Smoke-test the F4 road-debug tool in headless Chrome.
// Run: node dev/dbg-test.mjs   (needs server on :8642)
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-swiftshader', '--mute-audio',
  '--remote-debugging-port=9341', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) });
async function main() {
  let wsUrl;
  for (let i = 0; i < 40; i++) { try { const l = await (await fetch('http://localhost:9341/json')).json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break } } catch { } await sleep(250) }
  ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  const errs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } if (m.method === 'Runtime.exceptionThrown') errs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8642/' });
  await sleep(5000);
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)) : r.result?.value };

  // enter menu, then start a quick race programmatically
  await ev(`document.getElementById('screen-splash').click()`);
  await sleep(300);
  const r = await ev(`(async()=>{
    const game = window.game;
    if (!game) return 'NO GAME';
    if (!game.dbg) return 'NO DBG';
    // start a quick race on mumbai directly
    game.startRace({ mode:'quick', cityId:'mumbai', teamId:'tiranga', weather:'sunny', time:'afternoon', laps:3, ai:3 });
    await new Promise(r=>setTimeout(r,3000));
    // enable debug (as if F4 were pressed while racing)
    game.dbg.setEnabled(true);
    game.dbg.toggle(true);
    const active = document.getElementById('road-debug').classList.contains('active');
    // simulate a click at screen center to hit the road
    const canvas = document.getElementById('gl');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height*0.62;
    canvas.dispatchEvent(new MouseEvent('click',{clientX:cx,clientY:cy,bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const panel = document.getElementById('road-debug-panel');
    const panelShown = !panel.classList.contains('hidden');
    const markerShown = !document.getElementById('road-debug-marker').classList.contains('hidden');
    const panelText = panel.innerText.slice(0,400);
    // also test console helper
    const last = game.dbg.last();
    game.dbg.toggle(false);
    // Move camera to chase view behind the player's car, so a click at screen center
    // should land on the road just ahead of the car — that's the real usage scenario.
    const st = game.race.player.state;
    const fwdX = Math.sin(st.yaw), fwdZ = Math.cos(st.yaw);
    game.camera.position.set(st.pos.x - fwdX * 8, st.pos.y + 3.2, st.pos.z - fwdZ * 8);
    game.camera.lookAt(st.pos.x + fwdX * 20, st.pos.y + 0.4, st.pos.z + fwdZ * 20);
    game.camera.updateMatrixWorld();
    const canvas2 = document.getElementById('gl');
    const r2 = document.getElementById('gl').getBoundingClientRect();
    game.dbg.toggle(true);
    // click #1: center screen, on the asphalt ahead
    const cx2 = r2.left + r2.width * 0.5, cy2 = r2.top + r2.height * 0.56;
    canvas2.dispatchEvent(new MouseEvent('click', { clientX: cx2, clientY: cy2, bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const panel2 = document.getElementById('road-debug-panel');
    const chaseRes = {
      panelShown: !panel2.classList.contains('hidden'),
      markerShown: !document.getElementById('road-debug-marker').classList.contains('hidden'),
      panelText: panel2.innerText.slice(0, 700),
      last: game.dbg.last() ? (({ city, distM, sampleIdx, surface, vMaxKmh, lat }) => ({ city, distM, sampleIdx, surface, vMaxKmh, lat }))(game.dbg.last()) : null,
    };
    // click #2 & #3: aim synthetically at the left kerb + verge using world→screen
    // projection — guarantees we're testing the kerb band regardless of layout.
    const pick = async (latTarget) => {
      const tr = game.track, stt = game.race.player.state, sss = tr.samples;
      // 26m ahead along the spline, offset latTarget to the left (negative = left)
      const n0 = tr.nearest({x: stt.pos.x, z: stt.pos.z}, stt.trackIdx);
      const idx = (n0.i + Math.round(26 / (tr.length / tr.N))) % tr.N;
      const wx = sss.px[idx] + sss.rx[idx] * latTarget;
      const wz = sss.pz[idx] + sss.rz[idx] * latTarget;
      const wy = sss.py[idx];
      // project world point to screen — replicate THREE.Vector3.project
      const cam = game.camera;
      cam.updateMatrixWorld();
      const pv = { x: wx, y: wy, z: wz };
      // manual projection via camera matrices
      const m = cam.projectionMatrix.elements, me = cam.matrixWorldInverse.elements;
      const tx = me[0]*pv.x + me[4]*pv.y + me[8]*pv.z + me[12];
      const ty = me[1]*pv.x + me[5]*pv.y + me[9]*pv.z + me[13];
      const tz = me[2]*pv.x + me[6]*pv.y + me[10]*pv.z + me[14];
      const cx4 = m[0]*tx + m[4]*ty + m[8]*tz + m[12];
      const cy4 = m[1]*tx + m[5]*ty + m[9]*tz + m[13];
      const cw  = m[3]*tx + m[7]*ty + m[11]*tz + m[15];
      const ndcX = cx4/cw, ndcY = cy4/cw;
      const rr = document.getElementById('gl').getBoundingClientRect();
      const sx = rr.left + (ndcX*0.5+0.5)*rr.width;
      const sy = rr.top + (-ndcY*0.5+0.5)*rr.height;
      document.getElementById('gl').dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const p3 = document.getElementById('road-debug-panel');
      return { targetLat: latTarget, screen:[sx|0, sy|0],
        ok: !p3.classList.contains('hidden') && !p3.innerText.startsWith('⚠'),
        got: game.dbg.last() ? { surface: game.dbg.last().surface, lat: +game.dbg.last().lat.toFixed(2) } : null,
        text: p3.innerText.slice(0, 200) };
    };
    const kerbHit = await pick(-(game.track.halfWidth + 0.6));   // on the kerb band (left)
    const vergeHit = await pick(-(game.track.halfWidth + 2.0));  // on the verge (left)
    const tooFar = await pick(-(game.track.halfWidth + 5.5));    // past the wall — should fail
    return { dbgExists:true, active, panelShown, markerShown, panelText, chaseRes, kerbHit, vergeHit, tooFar,
      last: last ? {city:last.city, distM:last.distM, sampleIdx:last.sampleIdx, surface:last.surface, vMaxKmh:last.vMaxKmh} : null };
  })()`);
  console.log(JSON.stringify(r, null, 2));
  console.log('pageErrors:', errs.length ? errs : 'none');

  // capture a screenshot of the chase view with panel + marker for visual verification
  await send('Page.navigate', { url: 'http://localhost:8642/' });
  await sleep(5000);
  await ev(`document.getElementById('screen-splash').click()`);
  await sleep(300);
  await ev(`(async()=>{
    const game = window.game;
    game.startRace({ mode:'quick', cityId:'mumbai', teamId:'tiranga', weather:'sunny', time:'afternoon', laps:3, ai:3 });
    await new Promise(r=>setTimeout(r,3000));
    const st = game.race.player.state;
    const fwdX = Math.sin(st.yaw), fwdZ = Math.cos(st.yaw);
    game.state = 'racing';
    game.camRig.cinematic = null;
    game.camera.position.set(st.pos.x - fwdX * 8, st.pos.y + 3.2, st.pos.z - fwdZ * 8);
    game.camera.lookAt(st.pos.x + fwdX * 20, st.pos.y + 0.4, st.pos.z + fwdZ * 20);
    game.camera.updateMatrixWorld();
    game.dbg.setEnabled(true);
    game.dbg.toggle(true);
    const r2 = document.getElementById('gl').getBoundingClientRect();
    // aim at the left kerb band so the shot shows the fixed behavior on the kerb itself
    const tr = game.track, sss = tr.samples;
    const n0 = tr.nearest({x: st.pos.x, z: st.pos.z}, st.trackIdx);
    const idx = (n0.i + Math.round(26 / (tr.length / tr.N))) % tr.N;
    const latT = -(tr.halfWidth + 0.6);
    const wx = sss.px[idx] + sss.rx[idx] * latT, wz = sss.pz[idx] + sss.rz[idx] * latT;
    const cam = game.camera, me = cam.matrixWorldInverse.elements, m = cam.projectionMatrix.elements;
    const tx = me[0]*wx + me[4]*sss.py[idx] + me[8]*wz + me[12];
    const ty = me[1]*wx + me[5]*sss.py[idx] + me[9]*wz + me[13];
    const tz = me[2]*wx + me[6]*sss.py[idx] + me[10]*wz + me[14];
    const cw = m[3]*tx + m[7]*ty + m[11]*tz + m[15];
    const ndcX = (m[0]*tx + m[4]*ty + m[8]*tz + m[12])/cw;
    const ndcY = (m[1]*tx + m[5]*ty + m[9]*tz + m[13])/cw;
    const sx = r2.left + (ndcX*0.5+0.5)*r2.width, sy = r2.top + (-ndcY*0.5+0.5)*r2.height;
    document.getElementById('gl').dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
    await new Promise(r=>setTimeout(r,600));
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot && shot.data) (await import('node:fs')).writeFileSync('/tmp/road-debug-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot → /tmp/road-debug-shot.png');
  chrome.kill();
  process.exit(0);
}
main();
