// ============ sky.js — sky shader, sun/moon, lighting rig, env map ============
import * as THREE from 'three';
import { clamp, lerp, makeCanvasTexture } from './utils.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // depth = far
}`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 groundColor;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize;
uniform float starAmount; uniform float haze;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col;
  if (h > 0.0) {
    col = mix(horizonColor, topColor, pow(h, 0.62));
  } else {
    col = mix(horizonColor, groundColor, pow(-h, 0.5));
  }
  // sun disc + glow
  float sd = dot(d, normalize(sunDir));
  float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.4, sd);
  float glow = pow(max(sd, 0.0), 24.0) * 0.5 + pow(max(sd, 0.0), 350.0) * 1.4;
  col += sunColor * (disc * 2.2 + glow);
  // stars
  if (starAmount > 0.01 && h > 0.02) {
    vec3 sp = floor(d * 220.0);
    float st = step(0.9985, hash(sp));
    col += vec3(st) * starAmount * (0.4 + 0.6 * hash(sp + 1.0)) * smoothstep(0.02, 0.2, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class SkyRig {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.uniforms = {
      topColor: { value: new THREE.Color(0x2a6ac8) },
      horizonColor: { value: new THREE.Color(0xbcd8f0) },
      groundColor: { value: new THREE.Color(0x3a3f45) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(0xfff2dd) },
      sunSize: { value: 0.0012 },
      starAmount: { value: 0 },
      haze: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(3800, 32, 20);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 400;
    const S = 95;
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8f0, 0x3a3f45, 0.9);
    scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.22);
    scene.add(this.amb);

    // clouds
    this.cloudGroup = new THREE.Group();
    const cloudTex = makeCanvasTexture(128, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 22; i++) {
        const x = 15 + Math.random() * (w - 30), y = 20 + Math.random() * (h - 32);
        const r = 8 + Math.random() * 16;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    });
    const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
    this.clouds = [];
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cloudMat.clone());
      const s = 260 + Math.random() * 480;
      c.scale.set(s, s * 0.42, 1);
      c.position.set((Math.random() - 0.5) * 4200, 340 + Math.random() * 320, (Math.random() - 0.5) * 4200);
      c.rotation.x = -Math.PI / 2;
      c.userData.drift = 1.5 + Math.random() * 2.5;
      this.cloudGroup.add(c);
      this.clouds.push(c);
    }
    scene.add(this.cloudGroup);

    this.nightFactor = 0;
    this._envRT = null;
    this._pmrem = new THREE.PMREMGenerator(renderer);
  }

  set(timeDef, weather, hazeColor) {
    const el = THREE.MathUtils.degToRad(timeDef.sunEl);
    const az = THREE.MathUtils.degToRad(timeDef.sunAz);
    const sunDir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.uniforms.sunDir.value.copy(sunDir);

    const dayness = clamp(sunDir.y * 3.2 + 0.25, 0, 1);   // 1 = full day
    this.nightFactor = 1 - dayness;
    const golden = clamp(1 - Math.abs(sunDir.y - 0.12) * 5, 0, 1) * (dayness > 0.05 ? 1 : 0);

    // base palettes
    const day = { top: 0x2a62b8, hor: 0xb8d4ea, gnd: 0x40464c };
    const gold = { top: 0x2c3a6e, hor: 0xff9a45, gnd: 0x38322c };
    const night = { top: 0x04060e, hor: 0x0e1626, gnd: 0x05070a };
    const mix3 = (a, b, c, t1, t2) => {
      const col = new THREE.Color(a);
      col.lerp(new THREE.Color(b), t1);
      col.lerp(new THREE.Color(c), t2);
      return col;
    };
    let top = mix3(day.top, gold.top, night.top, golden, this.nightFactor);
    let hor = mix3(day.hor, gold.hor, night.hor, golden, this.nightFactor);
    let gnd = mix3(day.gnd, gold.gnd, night.gnd, golden, this.nightFactor);

    // weather modification
    const grey = clamp(weather.cloudCover, 0, 1);
    top.lerp(new THREE.Color(0x4a545e), grey * 0.55 * dayness);
    hor.lerp(new THREE.Color(hazeColor ?? 0x9aa4ae), grey * 0.6 * dayness);
    if (weather.dusty) { hor.lerp(new THREE.Color(0xd8b878), 0.5); top.lerp(new THREE.Color(0x9a8858), 0.3); }
    if (weather.rain > 0) { const d = 0.45 * weather.rain; top.lerp(new THREE.Color(0x2c343c), d); hor.lerp(new THREE.Color(0x5a646e), d); }

    this.uniforms.topColor.value.copy(top);
    this.uniforms.horizonColor.value.copy(hor);
    this.uniforms.groundColor.value.copy(gnd);
    this.uniforms.starAmount.value = this.nightFactor * clamp(1 - weather.cloudCover, 0.15, 1);

    const sunCol = new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xff7a20), golden);
    if (this.nightFactor > 0.85) sunCol.setHex(0xc8d4f0); // moon
    this.uniforms.sunColor.value.copy(sunCol);
    this.uniforms.sunSize.value = this.nightFactor > 0.85 ? 0.0008 : lerp(0.0012, 0.004, golden);

    // lights
    const sunI = Math.max(0, sunDir.y) * 2.8 * weather.sunMul;
    this.sun.intensity = this.nightFactor > 0.85 ? 0.14 : sunI + 0.05;
    this.sun.color.copy(sunCol);
    this.sunDirWorld = this.nightFactor > 0.85
      ? new THREE.Vector3(-0.4, 0.8, -0.3).normalize() : sunDir.clone();
    this.hemi.intensity = lerp(0.10, 0.95, dayness) * lerp(1, 0.7, grey);
    this.amb.intensity = lerp(0.05, 0.22, dayness);
    this.hemi.color.copy(hor);
    this.hemi.groundColor.copy(gnd);

    // clouds tint/coverage
    const cTint = new THREE.Color(0xffffff).lerp(new THREE.Color(0x3a4048), grey * 0.8)
      .lerp(new THREE.Color(0xffb070), golden * 0.55);
    cTint.multiplyScalar(lerp(0.12, 1, dayness));
    this.cloudGroup.children.forEach((c, i) => {
      c.visible = i / 26 < weather.cloudCover * 1.15 + 0.08;
      c.material.color.copy(cTint);
      c.material.opacity = 0.5 + weather.cloudCover * 0.45;
    });

    // fog
    this.fogColor = hor.clone().lerp(new THREE.Color(hazeColor ?? 0x9aa4ae), 0.4);
    if (this.nightFactor > 0.8) this.fogColor.multiplyScalar(0.14);

    // environment map (reflections)
    this._updateEnv(top, hor, gnd, sunCol, sunDir);

    this.exposure = timeDef.exposure * lerp(1, 0.82, grey) * lerp(1, 1.12, this.nightFactor);
  }

  _updateEnv(top, hor, gnd, sunCol, sunDir) {
    const tex = makeCanvasTexture(128, 64, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      const hex = c => '#' + c.getHexString();
      grad.addColorStop(0, hex(top)); grad.addColorStop(0.52, hex(hor)); grad.addColorStop(1, hex(gnd));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
      // sun blob
      const sx = (Math.atan2(sunDir.x, sunDir.z) / (Math.PI * 2) + 0.5) * w;
      const sy = (0.5 - Math.asin(clamp(sunDir.y, -1, 1)) / Math.PI) * h;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
      g.addColorStop(0, hex(sunCol)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 14, 0, 7); ctx.fill();
    }, { srgb: true });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const rt = this._pmrem.fromEquirectangular(tex);
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.scene.environment = rt.texture;
    tex.dispose();
  }

  // shadow camera follows focus
  update(dt, focus, t) {
    if (focus) {
      this.sun.position.copy(focus).addScaledVector(this.sunDirWorld, 180);
      this.sun.target.position.copy(focus);
      this.mesh.position.set(focus.x, 0, focus.z);
      this.cloudGroup.position.set(focus.x, 0, focus.z);
    }
    for (const c of this.clouds) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 2200) c.position.x = -2200;
    }
  }
}
