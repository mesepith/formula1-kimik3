// ============ input.js — keyboard + gamepad ============
export class Input {
  constructor() {
    this.keys = {};
    this.throttle = 0; this.brake = 0; this.steer = 0;
    this.ers = false; this.drs = false;
    this._steerCur = 0;
    this.pressed = {};   // edge-triggered
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.pressed[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  }
  consume(code) { const p = this.pressed[code]; this.pressed[code] = false; return !!p; }
  clearFrame() { this.pressed = {}; }

  update(dt) {
    const k = this.keys;
    // gamepad
    let gpThrottle = 0, gpBrake = 0, gpSteer = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      gpSteer = p.axes[0] || 0;
      gpThrottle = p.buttons[7]?.value || 0;
      gpBrake = p.buttons[6]?.value || 0;
      if (p.buttons[0]?.pressed) this.pressed['Space'] = true;
      if (p.buttons[1]?.pressed) this.pressed['KeyF'] = true;
      if (p.buttons[3]?.pressed) this.pressed['KeyC'] = true;
      break;
    }
    const t = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) || gpThrottle;
    const b = (k['KeyS'] || k['ArrowDown'] ? 1 : 0) || gpBrake;
    const sl = (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    const sr = (k['KeyD'] || k['ArrowRight'] ? 1 : 0);
    let steerTarget = (sl - sr) * -1 + gpSteer; // left = negative? we use +steer = right
    steerTarget = Math.max(-1, Math.min(1, steerTarget));
    // smooth steering for keyboard
    const rate = 5.5;
    if (Math.abs(steerTarget) > 0.01) {
      this._steerCur += Math.sign(steerTarget - this._steerCur) * rate * dt;
      if (Math.abs(this._steerCur) > Math.abs(steerTarget) && Math.sign(steerTarget - this._steerCur) !== Math.sign(this._steerCur)) this._steerCur = steerTarget;
    } else {
      this._steerCur -= this._steerCur * Math.min(1, 7 * dt);
    }
    this._steerCur = Math.max(-1, Math.min(1, this._steerCur));
    this.steer = -this._steerCur; // +steer turns right
    this.throttle = t;
    this.brake = b;
    this.ers = !!k['Space'];
    this.drs = !!k['KeyF'];
  }
}
