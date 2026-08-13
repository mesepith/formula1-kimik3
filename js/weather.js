// ============ weather.js — rain, spray, smoke, sparks, lightning ============
import * as THREE from 'three';
import { clamp, lerp, makeCanvasTexture } from './utils.js';

function softDotTexture() {
  return makeCanvasTexture(32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { srgb: false });
}

class ParticlePool {
  constructor(scene, count, { size, color, opacity, blending = THREE.NormalBlending }) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);   // remaining
    this.maxLife = new Float32Array(count);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    this.mat = new THREE.PointsMaterial({
      size, color, transparent: true, opacity, depthWrite: false,
      blending, map: softDotTexture(), sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    // park far underground
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -1000;
  }
  emit(x, y, z, vx, vy, vz, life) {
    const i = this.head; this.head = (this.head + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
  }
  update(dt, gravity = 0, drag = 0) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -1000; continue; }
      this.vel[i * 3 + 1] -= gravity * dt;
      if (drag) {
        const f = Math.max(0, 1 - drag * dt);
        this.vel[i * 3] *= f; this.vel[i * 3 + 1] *= f; this.vel[i * 3 + 2] *= f;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.visible = any;
    if (any) this.attr.needsUpdate = true;
  }
}

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.def = null;
    this.grip = 1;
    this.rainAmount = 0;       // smoothed
    this.wetness = 0;          // smoothed
    this.flash = 0;            // lightning flash 1→0
    this._nextBolt = 6;
    this.onThunder = null;     // callback

    // rain
    const RAIN_N = this.RAIN_N = 2600;
    this.rainPos = new Float32Array(RAIN_N * 3);
    const rg = new THREE.BufferGeometry();
    this.rainAttr = new THREE.BufferAttribute(this.rainPos, 3);
    this.rainAttr.setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', this.rainAttr);
    this.rainMat = new THREE.PointsMaterial({
      size: 0.14, color: 0xaac4dd, transparent: true, opacity: 0.55,
      depthWrite: false, map: softDotTexture(), sizeAttenuation: true,
    });
    this.rain = new THREE.Points(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);

    // pools
    this.spray = new ParticlePool(scene, 1400, { size: 0.9, color: 0xbcc8d4, opacity: 0.16 });
    this.smoke = new ParticlePool(scene, 700, { size: 1.1, color: 0x555a60, opacity: 0.22 });
    this.sparks = new ParticlePool(scene, 400, { size: 0.16, color: 0xffb040, opacity: 0.9, blending: THREE.AdditiveBlending });

    this.puddleGroup = new THREE.Group();
    scene.add(this.puddleGroup);
  }

  set(def, track) {
    this.def = def;
    // clear puddles
    while (this.puddleGroup.children.length) {
      const c = this.puddleGroup.children.pop();
      this.puddleGroup.remove(c);
      c.geometry?.dispose(); c.material?.dispose();
    }
    if (def.rain > 0 && track) {
      const rng = () => Math.random();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a3540, roughness: 0.04, metalness: 0.65,
        transparent: true, opacity: 0.5,
      });
      const geo = new THREE.CircleGeometry(1, 10);
      for (let i = 0; i < 90 * def.rain; i++) {
        const t = rng();
        const p = track.pointAt(t), r = track.rightAt(t);
        const lat = (rng() * 2 - 1) * (track.halfWidth - 1);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(p.x + r.x * lat, p.y + 0.012, p.z + r.z * lat);
        const sc = 0.6 + rng() * 1.8;
        m.scale.set(sc * (1 + rng()), sc, 1);
        this.puddleGroup.add(m);
      }
    }
  }

  update(dt, camera, cars, t) {
    const def = this.def;
    if (!def) return;
    // smooth transitions
    this.rainAmount = lerp(this.rainAmount, def.rain, 1 - Math.exp(-0.4 * dt));
    this.wetness = lerp(this.wetness, def.rain > 0 ? Math.min(1, def.rain + 0.3) : 0, 1 - Math.exp(-0.25 * dt));
    this.grip = lerp(this.grip, def.grip, 1 - Math.exp(-0.5 * dt));

    // ---- rain fall around camera ----
    if (this.rainAmount > 0.03) {
      this.rain.visible = true;
      const N = Math.floor(this.RAIN_N * this.rainAmount);
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < this.RAIN_N; i++) {
        if (i < N) {
          let y = this.rainPos[i * 3 + 1];
          y -= (38 + (i % 7) * 3) * dt;
          if (y < cy - 14 || this.rainPos[i * 3 + 1] < -500) {
            y = cy + 14 + Math.random() * 16;
            this.rainPos[i * 3] = cx + (Math.random() - 0.5) * 70;
            this.rainPos[i * 3 + 2] = cz + (Math.random() - 0.5) * 70;
          }
          this.rainPos[i * 3 + 1] = y;
        } else {
          this.rainPos[i * 3 + 1] = -1000;
        }
      }
      this.rainMat.opacity = 0.3 + this.rainAmount * 0.35;
      this.rainAttr.needsUpdate = true;
    } else this.rain.visible = false;

    // ---- per-car spray / smoke / sparks ----
    for (const car of cars) {
      const st = car.state;
      const sp = st.speed;
      if (sp < 8) continue;
      const fwdX = Math.sin(st.yaw), fwdZ = Math.cos(st.yaw);
      const rearX = st.pos.x - fwdX * 2.2, rearZ = st.pos.z - fwdZ * 2.2;
      // spray when wet
      if (this.wetness > 0.25) {
        const n = Math.min(3, Math.floor(sp / 28) + 1);
        for (let k = 0; k < n; k++) {
          this.spray.emit(
            rearX + (Math.random() - 0.5) * 1.6, st.pos.y + 0.15, rearZ + (Math.random() - 0.5) * 1.6,
            -fwdX * sp * 0.32 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2.5 + sp * 0.02, -fwdZ * sp * 0.32 + (Math.random() - 0.5) * 2,
            0.5 + Math.random() * 0.4);
        }
      }
      // tire smoke when sliding
      if (st.slide > 0.3 || (st.offTrack && sp > 20)) {
        for (let k = 0; k < 2; k++) {
          this.smoke.emit(
            rearX + (Math.random() - 0.5) * 2.0, st.pos.y + 0.1, rearZ + (Math.random() - 0.5) * 2.0,
            (Math.random() - 0.5) * 3, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 3,
            0.6 + Math.random() * 0.5);
        }
      }
      // sparks on wall hit / kerb at speed
      if (st.hitWall || (st.onKerb && sp > 45 && Math.random() < 0.25)) {
        for (let k = 0; k < 4; k++) {
          this.sparks.emit(
            st.pos.x + (Math.random() - 0.5) * 1.4, st.pos.y + 0.05, st.pos.z + (Math.random() - 0.5) * 1.4,
            -fwdX * sp * 0.4 + (Math.random() - 0.5) * 6, 1 + Math.random() * 3, -fwdZ * sp * 0.4 + (Math.random() - 0.5) * 6,
            0.3 + Math.random() * 0.3);
        }
      }
    }
    this.spray.update(dt, 6, 2.5);
    this.smoke.update(dt, -1.5, 1.8);   // smoke rises
    this.sparks.update(dt, 18, 0.5);

    // ---- lightning ----
    if (def.lightning) {
      this._nextBolt -= dt;
      if (this._nextBolt <= 0) {
        this.flash = 1;
        this._nextBolt = 3 + Math.random() * 8;
        if (this.onThunder) this.onThunder();
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }
}
