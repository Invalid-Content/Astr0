/**
 * render/gizmo.js — move / rotate / scale manipulator: geometry, drawing
 * and screen-space hit testing. The transform tool owns the drag maths;
 * this module only knows what the handles look like and where they are.
 *
 * Handle ids
 *   move:   'x' 'y' 'z' (axis arrows)   'yz' 'xz' 'xy' (plane squares)
 *   rotate: 'x' 'y' 'z' (rings around that axis)
 *   scale:  'x' 'y' 'z' (axis boxes)    'u' (uniform, centre box)
 */
import { v3 } from '../core/math.js';
import { PRIMITIVES } from '../geometry/primitives.js';

const COLORS = { x: [0.9, 0.26, 0.26], y: [0.27, 0.7, 0.3], z: [0.22, 0.5, 0.98], u: [0.95, 0.95, 0.97] };
const HOT = [1, 0.78, 0.2];
const AXIS_IDS = ['x', 'y', 'z'];
const SIZE_PX = 86;
const RING_STEPS = 72;

const CONE = PRIMITIVES.cone.build({ radius: 0.5, topRadius: 0, height: 1 });
const CUBE = PRIMITIVES.box.build({ width: 1, depth: 1, height: 1 });
const SQUARE = PRIMITIVES.plane.build({ width: 1, depth: 1 });

/** Matrix with columns u·sx, v·sy, w·sz and translation p. */
function frame(u, v, w, p, sx, sy, sz) {
  return new Float32Array([
    u[0] * sx, u[1] * sx, u[2] * sx, 0,
    v[0] * sy, v[1] * sy, v[2] * sy, 0,
    w[0] * sz, w[1] * sz, w[2] * sz, 0,
    p[0], p[1], p[2], 1,
  ]);
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

export class Gizmo {
  constructor() {
    this.mode = 'move';
    this.visible = false;
    this.pivot = [0, 0, 0];
    this.basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    this.size = 1;          // world length of an axis handle
    this.hover = null;      // handle id under the pointer
    this.active = null;     // handle id being dragged
  }

  /** Keep a constant on-screen size. Call once per frame before draw/hit. */
  place(camera, pivot, basis) {
    this.pivot = pivot;
    this.basis = basis;
    this.size = camera.worldPerPixel(pivot) * SIZE_PX;
  }

  axisEnd(i, k = 1) { return v3.addScaled(this.pivot, this.basis[i], this.size * k); }

  /** World points around the ring for axis i. */
  ring(i) {
    const u = this.basis[(i + 1) % 3], v = this.basis[(i + 2) % 3], r = this.size * 0.95;
    const pts = [];
    for (let k = 0; k <= RING_STEPS; k++) {
      const a = (k / RING_STEPS) * Math.PI * 2;
      pts.push(v3.add(this.pivot, v3.add(v3.scale(u, Math.cos(a) * r), v3.scale(v, Math.sin(a) * r))));
    }
    return pts;
  }

  color(id) {
    const base = id.length === 2 ? COLORS[AXIS_IDS.find((a) => !id.includes(a))] : COLORS[id];
    if (this.active === id || (!this.active && this.hover === id)) return [...HOT, 1];
    return [...base, this.active ? 0.25 : 0.95];
  }

  draw(draw) {
    if (!this.visible) return;
    const s = this.size;
    if (this.mode === 'rotate') {
      for (let i = 0; i < 3; i++) {
        const pts = this.ring(i), seg = [];
        for (let k = 0; k < pts.length - 1; k++) seg.push(...pts[k], ...pts[k + 1]);
        const id = AXIS_IDS[i];
        draw.lines(seg, this.color(id), this.active === id || this.hover === id ? 3.4 : 2.4);
      }
      return;
    }
    for (let i = 0; i < 3; i++) {
      const id = AXIS_IDS[i], col = this.color(id);
      const u = this.basis[(i + 1) % 3], v = this.basis[(i + 2) % 3], w = this.basis[i];
      draw.lines([...this.axisEnd(i, 0.16), ...this.axisEnd(i, 0.86)], col, 2.6);
      if (this.mode === 'move') {
        draw.mesh(CONE, frame(u, v, w, this.axisEnd(i, 0.9), s * 0.13, s * 0.13, s * 0.24), col);
        // Plane handle spanned by the two other axes.
        const pid = AXIS_IDS.filter((a) => a !== id).join('');
        const centre = v3.add(this.pivot, v3.scale(v3.add(u, v), s * 0.36));
        const pc = this.color(pid);
        draw.mesh(SQUARE, frame(u, v, w, centre, s * 0.2, s * 0.2, 1), [pc[0], pc[1], pc[2], pc[3] * 0.55]);
      } else {
        draw.mesh(CUBE, frame(u, v, w, this.axisEnd(i, 0.9), s * 0.12, s * 0.12, s * 0.12), col);
      }
    }
    if (this.mode === 'scale') {
      const [u, v, w] = this.basis;
      draw.mesh(CUBE, frame(u, v, w, this.pivot, s * 0.15, s * 0.15, s * 0.15), this.color('u'));
    }
  }

  /**
   * Handle under a viewport point, or null. `tolerance` is the pick radius
   * in CSS pixels (larger for fingers than for Pencil or mouse).
   */
  hit(x, y, camera, tolerance = 10) {
    if (!this.visible) return null;
    let best = null, bestD = Infinity;
    const consider = (id, d, limit = tolerance) => {
      if (d <= limit && d < bestD) { best = id; bestD = d; }
    };
    const centre = camera.project(this.pivot);
    if (this.mode === 'rotate') {
      for (let i = 0; i < 3; i++) {
        const pts = this.ring(i).map((p) => camera.project(p));
        let d = Infinity;
        for (let k = 0; k < pts.length - 1; k++) d = Math.min(d, distToSegment(x, y, pts[k], pts[k + 1]));
        consider(AXIS_IDS[i], d);
      }
      return best;
    }
    for (let i = 0; i < 3; i++) {
      const a = camera.project(this.axisEnd(i, 0.16)), b = camera.project(this.axisEnd(i, 1.02));
      consider(AXIS_IDS[i], distToSegment(x, y, a, b));
      if (this.mode === 'move') {
        const u = this.basis[(i + 1) % 3], v = this.basis[(i + 2) % 3];
        const c = camera.project(v3.add(this.pivot, v3.scale(v3.add(u, v), this.size * 0.36)));
        // Squares win over nearby axes: scale their distance down.
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= SIZE_PX * 0.13 + tolerance * 0.4) consider(AXIS_IDS.filter((_, k) => k !== i).join(''), d * 0.3, Infinity);
      }
    }
    if (this.mode === 'scale') {
      const d = Math.hypot(x - centre.x, y - centre.y);
      if (d <= SIZE_PX * 0.1 + tolerance * 0.5) consider('u', d * 0.3, Infinity);
    }
    return best;
  }
}
