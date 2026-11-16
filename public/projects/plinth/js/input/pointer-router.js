/**
 * input/pointer-router.js — one place that decides what every pointer does.
 *
 * Apple Pencil, fingers and mouse arrive as Pointer Events with different
 * `pointerType`s. The router classifies them and applies these rules:
 *
 *  Pencil      Always belongs to the active tool. It orbits the camera only
 *              when the tool declines the press (Select tool on empty space).
 *  One finger  Belongs to the active tool, unless "Fingers navigate only" is
 *              on (switched on automatically the first time a Pencil is
 *              seen); then a one-finger drag orbits and a tap still selects.
 *  Two fingers Always navigate: drag pans (or orbits, by preference), pinch
 *              zooms, twist turns the view. A second finger landing cancels
 *              whatever the first finger had started, so navigation can never
 *              leave a half-finished edit behind.
 *  Three       Drag does the other of pan / orbit.
 *  Palm        Touches are ignored while the Pencil is down or was near the
 *              screen a moment ago, and when the contact patch is palm-sized.
 *  Mouse       Left: tool. Middle drag: orbit (Shift: pan). Right drag: pan,
 *              right click: context menu. Wheel: zoom at the cursor.
 *
 * Tools receive normalised events { x, y, type, pressure, shift, ctrl, alt }
 * with coordinates in CSS pixels relative to the canvas.
 */

const MOVE_THRESHOLD = { mouse: 3, pen: 5, touch: 9 };
const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 350;
const PALM_GUARD_MS = 500;
const PALM_SIZE = 55;

export class PointerRouter {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} host  { camera, prefs, tool(), onHover, onHoverEnd,
   *                         onContextMenu, onDoubleTap, onPenDetected, onNavigate }
   */
  constructor(canvas, host) {
    this.canvas = canvas;
    this.host = host;
    this.touches = new Map();      // active, non-palm touch points
    this.ignored = new Set();      // palm or leftover pointers
    this.primary = null;           // the single pointer driving a tool or a one-pointer navigation
    this.gesture = null;           // multi-touch navigation state
    this.penDown = false;
    this.lastPen = -Infinity;
    this.lastTap = null;

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.down(e), opts);
    canvas.addEventListener('pointermove', (e) => this.move(e), opts);
    canvas.addEventListener('pointerup', (e) => this.up(e, false), opts);
    canvas.addEventListener('pointercancel', (e) => this.up(e, true), opts);
    canvas.addEventListener('pointerleave', (e) => { if (!this.primary) host.onHoverEnd(); });
    canvas.addEventListener('wheel', (e) => this.wheel(e), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari's own pinch/rotate gestures would zoom the page.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      canvas.addEventListener(type, (e) => e.preventDefault(), opts);
    }
    // iOS Safari only honours touch-action partially; stop its pan/zoom explicitly.
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), opts);
  }

  event(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      type: e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse',
      pressure: e.pressure,
      shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey,
      button: e.button,
    };
  }

  isPalm(e, now) {
    return this.penDown || now - this.lastPen < PALM_GUARD_MS || e.width > PALM_SIZE || e.height > PALM_SIZE;
  }

  // ---- pointer down ----------------------------------------------------------
  down(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const ev = this.event(e), now = performance.now();

    if (ev.type === 'pen') {
      this.lastPen = now;
      this.penDown = true;
      this.host.onPenDetected();
      // Anything already touching the glass is the resting hand.
      if (this.primary) this.cancelPrimary();
      this.gesture = null;
      for (const id of this.touches.keys()) this.ignored.add(id);
      this.touches.clear();
      this.startPrimary(e, ev);
      return;
    }
    if (ev.type === 'touch') {
      if (this.isPalm(e, now)) { this.ignored.add(e.pointerId); return; }
      this.touches.set(e.pointerId, { x: ev.x, y: ev.y });
      if (this.touches.size === 1) {
        this.startPrimary(e, ev);
      } else {
        this.cancelPrimary();
        this.startGesture();
      }
      return;
    }
    if (!this.primary) this.startPrimary(e, ev);
  }

  startPrimary(e, ev) {
    const p = {
      id: e.pointerId, type: ev.type,
      startX: ev.x, startY: ev.y, x: ev.x, y: ev.y,
      moved: false, mode: 'orbit', contextOnTap: false, timer: 0, last: ev,
    };
    this.primary = p;
    this.host.onHoverEnd();
    if (ev.button === 1) {
      p.mode = ev.shift ? 'pan' : 'orbit';
      p.noTap = true;
    } else if (ev.button === 2) {
      p.mode = 'pan';
      p.contextOnTap = true;
    } else if (ev.type === 'touch' && this.host.prefs.fingerNav) {
      p.mode = 'orbit';
    } else {
      p.mode = this.host.tool().pointerDown(ev) ? 'tool' : 'orbit';
    }
    if (p.mode !== 'tool' && ev.type !== 'mouse') {
      p.timer = setTimeout(() => {
        if (this.primary !== p || p.moved) return;
        p.mode = 'dead';
        this.host.onContextMenu(p.last);
      }, LONG_PRESS_MS);
    }
  }

  cancelPrimary() {
    const p = this.primary;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.mode === 'tool') this.host.tool().pointerCancel();
    this.primary = null;
  }

  // ---- pointer move ----------------------------------------------------------
  move(e) {
    const ev = this.event(e);
    if (this.ignored.has(e.pointerId)) return;
    const p = this.primary;
    if (ev.type === 'pen') this.lastPen = performance.now();

    if (this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: ev.x, y: ev.y });
      if (this.gesture) { this.updateGesture(); return; }
    }
    if (!p || p.id !== e.pointerId) {
      // Hovering: mouse without buttons, or Pencil above the glass.
      if (ev.type !== 'touch' && !p && !this.gesture) this.host.onHover(ev);
      return;
    }
    e.preventDefault();
    const dx = ev.x - p.x, dy = ev.y - p.y;
    p.x = ev.x; p.y = ev.y; p.last = ev;
    if (!p.moved && Math.hypot(ev.x - p.startX, ev.y - p.startY) > MOVE_THRESHOLD[p.type]) {
      p.moved = true;
      clearTimeout(p.timer);
    }
    if (p.mode === 'tool') {
      this.host.tool().pointerMove(ev);
    } else if (p.moved && p.mode === 'orbit') {
      this.host.camera.orbit(dx, dy);
      this.host.onNavigate();
    } else if (p.moved && p.mode === 'pan') {
      this.host.camera.pan(dx, dy);
      this.host.onNavigate();
    }
  }

  // ---- pointer up / cancel ---------------------------------------------------
  up(e, cancelled) {
    const ev = this.event(e);
    if (ev.type === 'pen') { this.penDown = false; this.lastPen = performance.now(); }
    this.ignored.delete(e.pointerId);
    if (this.touches.delete(e.pointerId) && this.gesture) {
      if (this.touches.size >= 2) {
        this.startGesture();
      } else {
        // The remaining finger does nothing until it lifts.
        this.gesture = null;
        for (const id of this.touches.keys()) this.ignored.add(id);
        this.touches.clear();
      }
      return;
    }
    const p = this.primary;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.timer);
    this.primary = null;
    const tool = this.host.tool();
    if (p.mode === 'tool') {
      if (cancelled) tool.pointerCancel(); else tool.pointerUp(ev);
      return;
    }
    if (cancelled || p.moved || p.mode === 'dead' || p.noTap) return;
    if (p.contextOnTap) { this.host.onContextMenu(ev); return; }
    const now = performance.now(), last = this.lastTap;
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(ev.x - last.x, ev.y - last.y) < 30) {
      this.lastTap = null;
      this.host.onDoubleTap(ev);
      return;
    }
    this.lastTap = { t: now, x: ev.x, y: ev.y };
    tool.tap(ev);
  }

  // ---- multi-touch navigation --------------------------------------------------
  measure() {
    const pts = [...this.touches.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    return { cx, cy, dist: Math.hypot(dx, dy) || 1, angle: Math.atan2(dy, dx), count: pts.length };
  }
  startGesture() {
    this.gesture = { ...this.measure(), twist: 0, applied: 0 };
    this.host.onHoverEnd();
  }
  updateGesture() {
    const g = this.gesture, m = this.measure(), cam = this.host.camera;
    const dx = m.cx - g.cx, dy = m.cy - g.cy;
    const twoFingerPans = this.host.prefs.twoFingerDrag !== 'orbit';
    const pan = m.count === 2 ? twoFingerPans : !twoFingerPans;
    if (pan) cam.pan(dx, dy); else cam.orbit(dx, dy);
    if (m.count === 2) {
      cam.zoom(g.dist / m.dist, m.cx, m.cy);
      // Twist turns the view about the vertical axis, after a small dead zone
      // so an ordinary pinch does not also rotate.
      let da = m.angle - g.angle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      g.twist += da;
      const beyond = Math.sign(g.twist) * Math.max(0, Math.abs(g.twist) - 0.14);
      if (beyond !== g.applied) {
        cam.az += ((beyond - g.applied) * 180 / Math.PI) * (cam.el >= 0 ? 1 : -1);
        g.applied = beyond;
        cam.update();
      }
    }
    Object.assign(g, m);   // twist and applied are kept
    this.host.onNavigate();
  }

  // ---- wheel -------------------------------------------------------------------
  wheel(e) {
    e.preventDefault();
    const ev = this.event(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const k = e.ctrlKey ? 0.01 : 0.0016;      // ctrl+wheel is a trackpad pinch
    this.host.camera.zoom(Math.exp(e.deltaY * unit * k), ev.x, ev.y);
    this.host.onNavigate();
  }
}
