// ============ utils.js — helpers ============
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeInOutCubic = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// Format milliseconds → m:ss.mmm
export function fmtTime(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '--:--.---';
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
export function fmtGap(ms) {
  if (ms == null) return '—';
  const s = ms / 1000;
  return (s >= 0 ? '+' : '') + s.toFixed(3);
}

// Canvas texture helper
export function makeCanvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = opts.anisotropy ?? 4;
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Hindi + English label helper for signs
export function drawSignText(ctx, text, x, y, size, color = '#fff', align = 'center') {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
export function vecFromYaw(yaw, out = new THREE.Vector3()) {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

// Simple tween timeline for cinematics
export class Timeline {
  constructor() { this.events = []; this.t = 0; this.duration = 0; }
  // at: seconds, dur: seconds, fn(progress01), easing optional
  add(at, dur, fn, ease = easeInOutCubic) {
    this.events.push({ at, dur, fn, ease, started: false, done: false });
    this.duration = Math.max(this.duration, at + dur);
    return this;
  }
  reset() { this.t = 0; for (const e of this.events) { e.started = false; e.done = false; } }
  update(dt) {
    this.t += dt;
    for (const e of this.events) {
      if (e.done) continue;
      const local = (this.t - e.at) / e.dur;
      if (local >= 1) { e.fn(1); e.done = true; }
      else if (local >= 0) e.fn(e.ease(local));
    }
    return this.t >= this.duration;
  }
}

export function hexColor(n) { return '#' + n.toString(16).padStart(6, '0'); }
