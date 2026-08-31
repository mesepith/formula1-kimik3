// Validates all 11 cities: geometry builds cleanly, lengths, elevation, DRS zones.
// Run: node dev/validate.mjs   (needs server on :8642)
import { spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-swiftshader', '--mute-audio',
  '--remote-debugging-port=9340', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) });
async function main() {
  let wsUrl;
  for (let i = 0; i < 40; i++) { try { const l = await (await fetch('http://localhost:9340/json')).json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break } } catch { } await sleep(250) }
  ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  const errs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } if (m.method === 'Runtime.exceptionThrown') errs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8642/' });
  await sleep(5000);
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)) : r.result?.value };
  await ev(`document.getElementById('screen-splash').click()`);
  await sleep(200);

  const results = await ev(`(async()=>{
    const {CITIES}=await import('./js/config.js');
    const {Track}=await import('./js/track.js');
    const {buildEnvironment}=await import('./js/scenery.js');
    const out={};
    const scene = { add(){}, remove(){} };
    for (const city of CITIES){
      try{
        const track=new Track(scene,city);
        const s=track.samples,N=track.N;
        let minY=1e9,maxY=-1e9;
        for(let i=0;i<N;i++){minY=Math.min(minY,s.py[i]);maxY=Math.max(maxY,s.py[i]);}
        // check AI speed profile sanity
        let vMin=1e9,vMax=0;
        for(let i=0;i<N;i++){const v=s.vMax[i];if(v<vMin)vMin=v;if(v>vMax)vMax=v;}
        const env=buildEnvironment(scene,track,city);
        out[city.id]={ ok:true,
          lenKm:(track.length/1000).toFixed(2),
          elevDelta:+(maxY-minY).toFixed(1),
          drs:track.drsZones.length,
          grid:track.grid.length,
          aiV:[Math.round(vMin*3.6), Math.round(vMax*3.6)],
          anim:env.animated.length, mats:env.nightMats.length
        };
      }catch(e){ out[city.id]={ok:false,error:e.message,at:(e.stack||'').split('\\n')[1]}; }
    }
    return out;
  })()`);
  console.log(JSON.stringify(results, null, 1));
  console.log('page errors:', errs.slice(0, 5));
  chrome.kill(); process.exit(0);
}
main().catch(e => { console.error(e); chrome.kill(); process.exit(1) });
