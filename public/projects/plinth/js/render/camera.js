/**
 * render/camera.js — turntable orbit camera with perspective and
 * orthographic projection, animated view changes and ray generation.
 *
 * The camera orbits `target` at `distance`, described by azimuth (around
 * world Z) and elevation (above the XY plane). The basis is built directly
 * from those angles, so straight-down views have no singularity.
 */
import { v3, m4, clamp, DEG } from '../core/math.js';

export const VIEWS = {
  front: { az: -90, el: 0, label: 'Front' },
  back: { az: 90, el: 0, label: 'Back' },
  right: { az: 0, el: 0, label: 'Right' },
  left: { az: 180, el: 0, label: 'Left' },
  top: { az: -90, el: 90, label: 'Top' },
  bottom: { az: -90, el: -90, label: 'Bottom' },
  iso: { az: -45, el: 35.264, label: 'Isometric' },
};

const FOV = 35 * DEG;

export class Camera {
  constructor() {
    this.target = [0, 0, 0];
    this.distance = 300;
    this.az = -45;
    this.el = 30;
    this.ortho = false;
    this.width = 1;   // viewport size in CSS pixels
    this.height = 1;
    this.sceneRadius = 500;
    this.anim = null;
    this.locked = false;
    this.onChange = () => {};
    this.update();
  }

  setViewport(w, h) { this.width = Math.max(1, w); this.height = Math.max(1, h); this.update(); }

  /** Recompute basis and matrices. Call after changing any parameter. */
  update() {
    const a = this.az * DEG, e = this.el * DEG;
    const ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(a), sa = Math.sin(a);
    this.back = [ce * ca, ce * sa, se];           // from target toward the eye
    this.right = [-sa, ca, 0];
    this.up = v3.cross(this.back, this.right);
    const reach = this.distance + this.sceneRadius * 2;
    const aspect = this.width / this.height;
    if (this.ortho) {
      // Eye sits far back so nothing is clipped; size comes from `distance`.
      const eyeDist = Math.max(reach, this.distance * 4);
      this.eye = v3.addScaled(this.target, this.back, eyeDist);
      this.halfH = this.distance * Math.tan(FOV / 2);
      this.proj = m4.ortho(this.halfH * aspect, this.halfH, eyeDist * 0.001, eyeDist * 2 + this.sceneRadius * 4);
    } else {
      this.eye = v3.addScaled(this.target, this.back, this.distance);
      const near = this.near = Math.max(this.distance * 0.02, 0.01);
      this.proj = m4.perspective(FOV, aspect, near, this.distance * 60 + this.sceneRadius * 6);
    }
    this.view = m4.view(this.eye, this.right, this.up, this.back);
    this.viewProj = m4.mul(this.proj, this.view);
    this.invViewProj = m4.invert(this.viewProj);
    this.onChange();
  }

  /** World-space ray through a viewport point (CSS pixels). */
  ray(x, y) {
    const nx = (x / this.width) * 2 - 1, ny = 1 - (y / this.height) * 2;
    const near = m4.point(this.invViewProj, [nx, ny, -1]);
    const far = m4.point(this.invViewProj, [nx, ny, 1]);
    return { o: near, d: v3.norm(v3.sub(far, near)) };
  }

  /** Project a world point to viewport CSS pixels. `behind` is true if it is behind the eye. */
  project(p) {
    const m = this.viewProj;
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const c = m4.point(m, p);
    return { x: (c[0] * 0.5 + 0.5) * this.width, y: (0.5 - c[1] * 0.5) * this.height, behind: w <= 0 };
  }

  /** World units covered by one CSS pixel at a world point. */
  worldPerPixel(p = this.target) {
    if (this.ortho) return (2 * this.halfH) / this.height;
    const depth = Math.max(v3.dot(v3.sub(this.eye, p), this.back), 1e-6);
    return (2 * depth * Math.tan(FOV / 2)) / this.height;
  }

  // ---- navigation ----------------------------------------------------------
  orbit(dx, dy) {
    if (this.locked) { this.pan(dx, dy); return; }   // sketch mode: the view stays square-on
    this.stop();
    this.az -= dx * 0.4;
    this.el = clamp(this.el + dy * 0.4, -90, 90);
    this.update();
  }
  pan(dx, dy) {
    this.stop();
    const k = this.worldPerPixel();
    this.target = v3.add(this.target, v3.add(v3.scale(this.right, -dx * k), v3.scale(this.up, dy * k)));
    this.update();
  }
  /** Zoom by `factor` (<1 zooms in) keeping the point under (x, y) fixed. */
  zoom(factor, x = this.width / 2, y = this.height / 2) {
    this.stop();
    const before = this.focalPoint(x, y);
    this.distance = clamp(this.distance * factor, 0.5, 1e6);
    this.update();
    const after = this.focalPoint(x, y);
    this.target = v3.add(this.target, v3.sub(before, after));
    this.update();
  }
  /** Point under a viewport position on the plane through the target facing the camera. */
  focalPoint(x, y) {
    const r = this.ray(x, y);
    const denom = v3.dot(r.d, this.back);
    const t = v3.dot(v3.sub(this.target, r.o), this.back) / (denom || -1);
    return v3.addScaled(r.o, r.d, t);
  }
  setOrtho(on) {
    this.stop();
    this.ortho = on;
    this.update();
  }

  // ---- animated transitions --------------------------------------------------
  stop() { this.anim = null; }
  /** Animate to a new pose. Any of az, el, target, distance may be given. */
  animateTo(pose, ms = 320) {
    const from = { az: this.az, el: this.el, target: this.target.slice(), distance: this.distance };
    const to = { ...from, ...pose };
    // Take the short way round in azimuth.
    to.az = from.az + ((((to.az - from.az) % 360) + 540) % 360) - 180;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || ms <= 0) {
      Object.assign(this, { az: to.az, el: to.el, target: to.target.slice(), distance: to.distance });
      this.update();
      return;
    }
    this.anim = { from, to, start: performance.now(), ms };
    this.onChange();
  }
  /** Advance the animation. Returns true while still animating. */
  tick(now) {
    if (!this.anim) return false;
    const { from, to, start, ms } = this.anim;
    const t = clamp((now - start) / ms, 0, 1);
    const k = 1 - Math.pow(1 - t, 3);
    this.az = from.az + (to.az - from.az) * k;
    this.el = from.el + (to.el - from.el) * k;
    this.distance = from.distance + (to.distance - from.distance) * k;
    this.target = v3.lerp(from.target, to.target, k);
    if (t >= 1) {
      this.anim = null;
      this.az = ((this.az + 180) % 360 + 360) % 360 - 180;
    }
    this.update();
    return !!this.anim;
  }
  setView(name) {
    const v = VIEWS[name];
    if (v) this.animateTo({ az: v.az, el: v.el });
  }
  /** Frame a bounding sphere. */
  frame(center, radius, animate = true) {
    const aspect = this.width / this.height;
    const fit = Math.max(radius, 1) / Math.sin(FOV / 2) / Math.min(1, aspect) * 1.15;
    this.animateTo({ target: center.slice(), distance: fit }, animate ? 320 : 0);
  }
  /** Serializable pose, for autosave. */
  getPose() { return { az: this.az, el: this.el, target: this.target, distance: this.distance, ortho: this.ortho }; }
  setPose(p) {
    if (!p) return;
    this.az = p.az; this.el = p.el; this.target = p.target.slice(); this.distance = p.distance; this.ortho = !!p.ortho;
    this.update();
  }
}
