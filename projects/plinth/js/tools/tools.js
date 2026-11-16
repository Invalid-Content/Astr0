/**
 * tools/tools.js — the viewport tools.
 *
 * Tool contract (called by the pointer router and the app):
 *   activate(arg) / deactivate()
 *   pointerDown(ev) -> boolean   true = the tool takes this drag; false = the
 *                                press falls through to camera orbit
 *   pointerMove(ev) / pointerUp(ev) / pointerCancel()   for a taken drag
 *   tap(ev)                      a press released without moving (not taken)
 *   hover(ev)                    mouse or Pencil hover
 *   confirm() / cancel()         Enter / Escape and the panel buttons
 *   frame()                      called before each render (gizmo placement)
 *   previewItems()               extra render items (creation preview)
 *   hint                         one-line instruction shown in the status bar
 *
 * Every change a tool makes goes through the store, so it is undoable, and
 * every drag can be cancelled (Escape, or a second finger landing).
 */
import { v3, quat, m4, ray as rayMath, snap, DEG } from '../core/math.js';
import { evaluate, defaultParams, validateParams } from '../geometry/kernel.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { formatLength, formatNumber } from '../core/units.js';

const WORLD = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const AXIS = { x: 0, y: 1, z: 2 };
const pickRadius = (ev) => (ev.type === 'touch' ? 20 : ev.type === 'pen' ? 13 : 10);
const clone = (t) => ({ p: t.p.slice(), q: t.q.slice(), s: t.s.slice() });

export class Tool {
  constructor(app) { this.app = app; this.hint = ''; }
  activate() {}
  deactivate() {}
  pointerDown() { return false; }
  pointerMove() {}
  pointerUp() {}
  pointerCancel() {}
  tap(ev) { this.app.selectAt(ev); }
  hover(ev) { this.app.hoverAt(ev); }
  confirm() {}
  cancel() {}
  frame() {}
  previewItems() { return []; }
}

// ---------------------------------------------------------------------------
export class SelectTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'select';
    this.hint = 'Tap an object to select it. Double-tap to edit its geometry. Drag empty space to orbit.';
  }
}

// ---------------------------------------------------------------------------
/** Move, rotate or scale the selected bodies with a gizmo or typed values. */
export class TransformTool extends Tool {
  constructor(app, mode) {
    super(app);
    this.id = mode;
    this.mode = mode;
    this.drag = null;
    this.hint = {
      move: 'Drag an arrow to move along an axis, or a square to move in a plane. Type exact distances below.',
      rotate: 'Drag a ring to rotate about that axis. Type an exact angle below.',
      scale: 'Drag a box to scale along an axis, or the centre box to scale evenly.',
    }[mode];
  }
  activate() { this.app.gizmo.mode = this.mode; }
  tap(ev) { this.app.selectAt(ev, true); }
  deactivate() {
    if (this.drag) this.pointerCancel();
    Object.assign(this.app.gizmo, { visible: false, hover: null, active: null });
  }
  targets() {
    const { store } = this.app;
    return store.selectedBodies().filter((n) => !store.isLocked(n));
  }
  pivot(nodes = this.targets()) {
    const sum = nodes.reduce((s, n) => v3.add(s, n.transform.p), [0, 0, 0]);
    return v3.scale(sum, 1 / Math.max(1, nodes.length));
  }
  /** Scale works along the object's own axes; move and rotate use world axes. */
  basis(nodes = this.targets()) {
    if (this.mode !== 'scale' || !nodes.length) return WORLD;
    return WORLD.map((a) => quat.rotate(nodes[0].transform.q, a));
  }
  frame() {
    const g = this.app.gizmo, nodes = this.targets();
    g.visible = nodes.length > 0;
    if (!g.visible) return;
    if (this.drag) g.place(this.app.camera, this.drag.pivot, this.drag.basis);
    else g.place(this.app.camera, this.pivot(nodes), this.basis(nodes));
  }
  hover(ev) {
    const g = this.app.gizmo;
    const h = g.hit(ev.x, ev.y, this.app.camera, pickRadius(ev));
    if (h !== g.hover) { g.hover = h; this.app.invalidate(); }
    if (h) this.app.setHover(null); else this.app.hoverAt(ev);
  }

  pointerDown(ev) {
    const { gizmo: g, camera, store } = this.app;
    this.frame();
    const handle = g.hit(ev.x, ev.y, camera, pickRadius(ev));
    if (!handle) return false;
    const nodes = this.targets();
    const d = this.drag = {
      handle, token: store.begin(), pivot: g.pivot.slice(), basis: g.basis.map((a) => a.slice()),
      start: new Map(nodes.map((n) => [n.id, clone(n.transform)])), x0: ev.x, y0: ev.y,
    };
    const r = camera.ray(ev.x, ev.y);
    if (this.mode === 'rotate') {
      const i = AXIS[handle];
      // Rotation follows pointer travel along the ring's on-screen tangent,
      // which stays well-behaved even when the ring is seen edge-on.
      let best = null, bestD = Infinity;
      for (const p of g.ring(i)) {
        const s = camera.project(p), dist = Math.hypot(s.x - ev.x, s.y - ev.y);
        if (dist < bestD) { bestD = dist; best = p; }
      }
      const tangent = v3.norm(v3.cross(d.basis[i], v3.sub(best, d.pivot)));
      const a = camera.project(best), b = camera.project(v3.addScaled(best, tangent, g.size * 0.2));
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      d.axis = i;
      d.tangent = [(b.x - a.x) / len, (b.y - a.y) / len];
      d.pxPerRad = (len / (g.size * 0.2)) * g.size * 0.95;
    } else if (handle.length === 2) {
      d.normal = d.basis[[0, 1, 2].find((k) => !handle.includes('xyz'[k]))];
      const t = rayMath.plane(r, d.pivot, d.normal);
      d.hit0 = t === null ? d.pivot : rayMath.at(r, t);
    } else if (handle === 'u') {
      const c = camera.project(d.pivot);
      d.centre = c;
      d.dist0 = Math.max(12, Math.hypot(ev.x - c.x, ev.y - c.y));
    } else {
      d.axis = AXIS[handle];
      d.s0 = rayMath.closestOnLine(r, d.pivot, d.basis[d.axis]);
      if (this.mode === 'scale' && Math.abs(d.s0) < g.size * 0.05) d.s0 = g.size * 0.9;
    }
    g.active = handle;
    this.app.invalidate();
    return true;
  }

  pointerMove(ev) {
    const d = this.drag;
    if (!d) return;
    const { camera, store } = this.app;
    const units = store.doc.units;
    // Holding Ctrl / Cmd flips snapping for this drag.
    const snapping = store.doc.grid.snap !== ev.ctrl;
    const r = camera.ray(ev.x, ev.y);
    let text = '';
    if (this.mode === 'move') {
      const step = snapping ? this.app.snapStep() : 0;
      let delta;
      if (d.normal) {
        const t = rayMath.plane(r, d.pivot, d.normal);
        if (t === null || t < 0) return;
        const raw = v3.sub(rayMath.at(r, t), d.hit0);
        delta = [0, 0, 0];
        for (const a of d.basis) {
          if (a === d.normal) continue;
          delta = v3.addScaled(delta, a, snap(v3.dot(raw, a), step));
        }
        text = 'xyz'.split('').filter((c) => d.handle.includes(c))
          .map((c) => `Δ${c.toUpperCase()} ${formatLength(delta[AXIS[c]], units)}`).join('   ');
      } else {
        const s = snap(rayMath.closestOnLine(r, d.pivot, d.basis[d.axis]) - d.s0, step);
        delta = v3.scale(d.basis[d.axis], s);
        text = `Δ${d.handle.toUpperCase()} ${formatLength(s, units)}`;
      }
      this.each((n, t0) => { n.transform.p = v3.add(t0.p, delta); });
    } else if (this.mode === 'rotate') {
      let angle = ((ev.x - d.x0) * d.tangent[0] + (ev.y - d.y0) * d.tangent[1]) / d.pxPerRad / DEG;
      angle = snap(angle, snapping ? store.doc.grid.angle : 0);
      const dq = quat.fromAxisAngle(d.basis[d.axis], angle * DEG);
      this.each((n, t0) => {
        n.transform.q = quat.normalize(quat.mul(dq, t0.q));
        n.transform.p = v3.add(d.pivot, quat.rotate(dq, v3.sub(t0.p, d.pivot)));
      });
      text = `${formatNumber(angle, 1)}°`;
    } else {
      let f;
      if (d.handle === 'u') f = Math.hypot(ev.x - d.centre.x, ev.y - d.centre.y) / d.dist0;
      else f = rayMath.closestOnLine(r, d.pivot, d.basis[d.axis]) / d.s0;
      f = Math.max(0.01, snapping ? snap(f, 0.05) || 0.05 : f);
      this.each((n, t0) => {
        if (d.handle === 'u') {
          n.transform.s = v3.scale(t0.s, f);
          n.transform.p = v3.add(d.pivot, v3.scale(v3.sub(t0.p, d.pivot), f));
        } else {
          n.transform.s = t0.s.map((v, k) => (k === d.axis ? v * f : v));
        }
      });
      text = `× ${formatNumber(f, 2)}`;
    }
    this.app.setReadout(text, ev.x, ev.y);
    store.touch();
  }
  each(fn) {
    for (const [id, t0] of this.drag.start) {
      const n = this.app.store.node(id);
      if (n) fn(n, t0);
    }
  }
  pointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.app.gizmo.active = null;
    this.app.setReadout(null);
    this.app.store.end(d.token, { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.mode]);
    this.app.invalidate();
  }
  pointerCancel() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.app.gizmo.active = null;
    this.app.setReadout(null);
    this.app.store.abort(d.token);
  }
  cancel() {
    if (this.drag) this.app.router.cancelPrimary();
    else this.app.setTool('select');
  }
  confirm() { this.app.setTool('select'); }

  // ---- exact entry from the tool panel ----------------------------------------
  moveBy(delta) {
    const ids = this.targets().map((n) => n.id);
    this.app.store.patch(ids, 'Move', (n) => { n.transform.p = v3.add(n.transform.p, delta); });
  }
  rotateBy(axis, degrees) {
    const nodes = this.targets(), pivot = this.pivot(nodes);
    const dq = quat.fromAxisAngle(WORLD[axis], degrees * DEG);
    this.app.store.patch(nodes.map((n) => n.id), 'Rotate', (n) => {
      n.transform.q = quat.normalize(quat.mul(dq, n.transform.q));
      n.transform.p = v3.add(pivot, quat.rotate(dq, v3.sub(n.transform.p, pivot)));
    });
  }
  scaleBy(factors) {
    const ids = this.targets().map((n) => n.id);
    this.app.store.patch(ids, 'Scale', (n) => { n.transform.s = v3.mul(n.transform.s, factors); });
  }
}

// ---------------------------------------------------------------------------
/**
 * Place a new primitive. A live preview follows the Pencil, finger or mouse
 * across the ground plane (or onto the top of an existing body); dimensions
 * are edited in the tool panel; nothing enters the document until confirmed.
 */
export class CreateTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'create';
    this.node = null;
    this.hint = 'Drag or tap to position the new shape. Set exact dimensions below, then confirm.';
  }
  activate(type) {
    const { store, camera } = this.app;
    this.type = type;
    this.node = store.makeBody(type, defaultParams(type));
    this.error = null;
    // Start where the user is looking, on the ground.
    const c = this.app.groundPoint(camera.width / 2, camera.height / 2) || [camera.target[0], camera.target[1], 0];
    const step = store.doc.grid.snap ? this.app.snapStep() : 0;
    this.base = [snap(c[0], step), snap(c[1], step), 0];
    this.rest();
  }
  deactivate() { this.node = null; this.app.setReadout(null); }
  mesh() { return evaluate(this.node.feature); }
  /** Sit the shape on its base point. */
  rest() {
    this.node.transform.p = [this.base[0], this.base[1], this.base[2] - this.mesh().min[2]];
    this.app.invalidate();
  }
  setParam(key, value) {
    const params = { ...this.node.feature.params, [key]: value };
    const problem = validateParams(this.type, params);
    if (problem) return problem;
    this.node.feature.params = params;
    this.rest();
    return null;
  }
  setBase(axis, value) { this.base[axis] = value; this.rest(); }
  placeAt(ev) {
    const hit = this.app.pick(ev.x, ev.y);
    let p = hit && hit.normal[2] > 0.7 ? hit.point : this.app.groundPoint(ev.x, ev.y);
    if (!p) return;
    const step = this.app.store.doc.grid.snap !== ev.ctrl ? this.app.snapStep() : 0;
    this.base = [snap(p[0], step), snap(p[1], step), hit && hit.normal[2] > 0.7 ? p[2] : 0];
    this.rest();
    const u = this.app.store.doc.units;
    this.app.setReadout(`X ${formatLength(this.base[0], u)}   Y ${formatLength(this.base[1], u)}`, ev.x, ev.y);
    this.app.refreshToolPanel();
  }
  pointerDown(ev) { this.before = this.base.slice(); this.placeAt(ev); return true; }
  pointerMove(ev) { this.placeAt(ev); }
  pointerUp() { this.app.setReadout(null); }
  pointerCancel() { this.base = this.before; this.rest(); this.app.setReadout(null); this.app.refreshToolPanel(); }
  tap(ev) { this.placeAt(ev); this.app.setReadout(null); }
  hover() {}
  previewItems() { return this.node ? [{ node: this.node, ghost: true }] : []; }
  confirm() {
    const problem = validateParams(this.type, this.node.feature.params);
    if (problem) { this.app.toast(problem); return; }
    const id = this.app.store.addBody(this.node);
    this.app.store.select([id]);
    this.app.setTool('select');
  }
  cancel() { this.app.setTool('select'); }
}

/** Model matrix of a node. */
export const modelMatrix = (node) => m4.compose(node.transform.p, node.transform.q, node.transform.s);
export { PRIMITIVES };
