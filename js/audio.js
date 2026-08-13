// ============ audio.js — synthesized racing audio (Web Audio) ============
import { clamp, lerp } from './utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // ---------- engine ----------
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass'; engFilter.frequency.value = 2600; engFilter.Q.value = 2;
    this.engFilter = engFilter;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.detune.value = 18;
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'square';
    const g3 = ctx.createGain(); g3.gain.value = 0.35;
    this.osc1.connect(engFilter); this.osc2.connect(engFilter);
    this.osc3.connect(g3); g3.connect(engFilter);
    engFilter.connect(shaper); shaper.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.osc1.start(); this.osc2.start(); this.osc3.start();

    // ---------- noise sources (tires / wind / rain / crowd) ----------
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; nd[i] = (last + 0.02 * w) / 1.02; last = nd[i]; nd[i] *= 3.5; }
    this._noiseBuf = noiseBuf;
    const whiteBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const wd = whiteBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this._whiteBuf = whiteBuf;

    const mkNoise = (buf, type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { src, f, g };
    };
    this.skid = mkNoise(whiteBuf, 'bandpass', 900, 1.4);
    this.wind = mkNoise(noiseBuf, 'lowpass', 500, 0.6);
    this.rain = mkNoise(whiteBuf, 'highpass', 1800, 0.4);
    this.crowd = mkNoise(noiseBuf, 'bandpass', 300, 0.5);
    this.crowdBase = 0.05;

    this.started = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // rpm 0..1, throttle 0..1
  updateEngine(rpm01, throttle, speed01, slide, ersOn) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const base = 55 + rpm01 * 640;
    this.osc1.frequency.setTargetAtTime(base, t, 0.02);
    this.osc2.frequency.setTargetAtTime(base * 1.005, t, 0.02);
    this.osc3.frequency.setTargetAtTime(base / 2, t, 0.02);
    this.engFilter.frequency.setTargetAtTime(900 + rpm01 * 4200 + throttle * 900, t, 0.03);
    this.engineGain.gain.setTargetAtTime(0.10 + throttle * 0.16 + rpm01 * 0.1 + (ersOn ? 0.04 : 0), t, 0.04);
    this.skid.g.gain.setTargetAtTime(clamp(slide, 0, 1) * 0.20, t, 0.05);
    this.skid.f.frequency.setTargetAtTime(700 + speed01 * 700, t, 0.1);
    this.wind.g.gain.setTargetAtTime(speed01 * speed01 * 0.30, t, 0.1);
  }

  setRain(amount) {
    if (!this.started) return;
    this.rain.g.gain.setTargetAtTime(amount * 0.14, this.ctx.currentTime, 0.4);
  }
  crowdSwell(amount = 0.5, decay = 1.5) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.crowd.g.gain.cancelScheduledValues(t);
    this.crowd.g.gain.setTargetAtTime(this.crowdBase + amount * 0.4, t, 0.15);
    this.crowd.g.gain.setTargetAtTime(this.crowdBase, t + decay * 0.4, decay);
  }
  setCrowdBase(v) { this.crowdBase = v; if (this.started) this.crowd.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); }

  _beep(freq, dur, gain = 0.25, type = 'sine') {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  lightBeep() { this._beep(740, 0.14, 0.22, 'square'); }
  lightsOut() { this._beep(520, 0.55, 0.3, 'square'); this.crowdSwell(0.8, 3); }
  shift(up = true) { this._beep(up ? 190 : 150, 0.06, 0.12, 'sawtooth'); }
  drs() { this._beep(980, 0.09, 0.12); }
  overtake() { this._beep(660, 0.1, 0.14); setTimeout(() => this._beep(880, 0.14, 0.14), 110); }
  positionLost() { this._beep(440, 0.18, 0.12); }
  fastestLap() { this._beep(660, 0.12, 0.16); setTimeout(() => this._beep(830, 0.12, 0.16), 130); setTimeout(() => this._beep(990, 0.2, 0.16), 260); }
  checkered() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._beep(f, 0.3, 0.2), i * 160)); this.crowdSwell(1, 5); }
  hit() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  thunder() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(60, t + 1.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 2.4);
  }
}
