/**
 * tools/sketch.js — the 2D sketch environment.
 *
 * One tool object with several drawing modes. All input is converted to
 * sketch-plane coordinates, passed through the snapping engine, and turned
 * into mathematical entities (see geometry/sketch2d.js). Nothing here draws
 * geometry of its own: previews are entities too, rendered like the real ones.
 *
 * Input model (same for Pencil, finger and mouse):
 *   - A tap places a point. A drag places two (press and release).
 *   - Line mode reads the whole path of a drag: straight strokes become lines,
 *     curved strokes become arcs or smooth splines, closed strokes become
 *     circles, rectangles or triangles. Each new piece continues from the
 *     last point until the chain is closed or ended.
 */
import { Tool } from './tools.js';
import { ray as rayMath, snap as snapTo } from '../core/math.js';
import { PLANES, to2, to3, sketchData, entitySegments } from '../geometry/planes.js';
import { tessellate, endpoints, arcFrom3, closestOn, intersections, dist2, polar, trimAt } from '../geometry/sketch2d.js';
import { recognise } from '../geometry/fit.js';
import { formatLength, formatNumber } from '../core/units.js';
import { h, segmented, toast } from '../ui/dom.js';

const TAU = Math.PI * 2;
export const SKETCH_MODES = [
  { id: 'select', label: 'Select and edit', icon: 'select' },
  { id: 'line', label: 'Line (drag a curve for arcs and splines)', icon: 'skLine' },
  { id: 'arc3', label: 'Three-point arc', icon: 'skArc3' },
  { id: 'arcc', label: 'Centre-point arc', icon: 'skArcC' },
  { id: 'arct', label: 'Tangent arc', icon: 'skArcT' },
  { id: 'circle', label: 'Circle', icon: 'skCircle' },
  { id: 'rect', label: 'Rectangle', icon: 'skRect' },
  { id: 'rrect', label: 'Rounded rectangle', icon: 'skRRect' },
  { id: 'ellipse', label: 'Ellipse', icon: 'skEllipse' },
  { id: 'triangle', label: 'Triangle', icon: 'skTriangle' },
  { id: 'polygon', label: 'Polygon', icon: 'skPolygon' },
  { id: 'spline', label: 'Spline through points', icon: 'skSpline' },
  { id: 'trim', label: 'Snip: remove a curve, or cut it back to where another curve crosses it', icon: 'scissors' },
];
const NEEDED = { line: 2, rect: 2, rrect: 2, circle: 2, ellipse: 2, polygon: 2, triangle: 2, arc3: 3, arcc: 3, arct: 2, spline: Infinity };
const HINTS = {
  select: 'Tap a curve to select it. Drag a point to reshape, drag a curve to move it.',
  line: 'Tap points or drag strokes. Straight strokes make lines, curved strokes make arcs and splines. Tap the first point to close.',
  arc3: 'Tap the start, the end, then a point the arc passes through.',
  arcc: 'Tap the centre, the start, then sweep to the end.',
  arct: 'Start on the end of a line or arc, then tap where the arc should end.',
  circle: 'Tap the centre and drag out the radius.',
  rect: 'Drag from corner to corner.',
  rrect: 'Drag from corner to corner. Set the corner radius below.',
  ellipse: 'Tap the centre and drag to a corner of its bounding box.',
  triangle: 'Tap the centre and drag to a corner.',
  polygon: 'Tap the centre and drag to a corner. Set the number of sides below.',
  spline: 'Tap points for the curve to pass through. Tap the last point again to finish.',
  trim: 'Tap the part of a curve to remove. It is cut back to the nearest crossings; a curve nothing crosses is removed whole.',
};
const SNAP_LABEL = { close: 'Close shape', end: 'Endpoint', int: 'Intersection', mid: 'Midpoint', centre: 'Centre', origin: 'Origin', perp: 'Perpendicular', tan: 'Tangent', on: 'On curve', grid: '' };
const PRIORITY = { close: 0, end: 1, int: 2, origin: 2, mid: 3, centre: 3, perp: 4, tan: 4, on: 5 };

const lineEnt = (a, b) => ({ type: 'line', a: a.slice(), b: b.slice() });

export class SketchTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'sketch';
    this.mode = 'line';
    this.plane = 'xy';
    this.construction = false;
    this.recogniseShapes = true;
    this.dims = { sides: 6, corner: 5, w: 0, h: 0, r: 0, len: 0, ang: 0, rot: 0 };
    this.reset();
    this.selected = [];
  }
  get hint() { return HINTS[this.mode]; }
  set hint(_) { /* derived from the mode */ }
  get pl() { return PLANES[this.plane]; }
  get node() { return this.app.store.sketchOn(this.plane); }
  get entities() { const n = this.node; return n ? n.entities : []; }

  activate({ plane }) { this.plane = plane; this.reset(); this.selected = []; }
  deactivate() {
    if (this.edit) this.pointerCancel();
    this.reset();
    this.selected = [];
    this.app.setReadout(null);
  }
  switchPlane(plane) { this.plane = plane; this.reset(); this.selected = []; this.app.invalidate(); }
  reset() {
    this.pts = [];            // points placed for the shape in progress
    this.chainStart = null;   // first point of the current line chain
    this.chainCount = 0;
    this.cursor = null;       // snapped pointer position
    this.snapInfo = null;
    this.stroke = null;       // raw path of the current drag (line mode)
    this.sweep = 0;           // accumulated angle for the centre-point arc
    this.edit = null;         // select-mode drag
    this.hoverEntity = null;
    this.snipPreview = null;
    this.lastClick = null;
  }
  setMode(mode) {
    this.reset();
    this.mode = mode;
    if (mode !== 'select') this.selected = [];
    this.app.ui.sketchBar.sync();
    this.app.ui.toolPanel.build();
    this.app.ui.status.sync();
    this.app.invalidate();
  }
  sides() { return this.mode === 'triangle' ? 3 : Math.max(3, Math.round(this.dims.sides)); }

  // ---- coordinates and snapping ------------------------------------------------
  planePoint(ev) {
    const r = this.app.camera.ray(ev.x, ev.y);
    const t = rayMath.plane(r, this.pl.o, this.pl.n);
    return t === null ? null : to2(this.pl, rayMath.at(r, t));
  }
  tolerance(ev) { return (ev.type === 'touch' ? 16 : 11) * this.app.camera.worldPerPixel(); }
  snapCache() {
    const ents = this.entities;
    if (this._snapFor !== ents) {
      this._snapFor = ents;
      const pts = [];
      for (const e of ents) {
        for (const p of endpoints(e)) pts.push({ p, kind: 'end', id: e.id });
        if (e.type === 'line') pts.push({ p: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], kind: 'mid', id: e.id });
        if (e.type === 'arc') { pts.push({ p: polar(e.c, e.r, (e.a0 + e.a1) / 2), kind: 'mid', id: e.id }); pts.push({ p: e.c, kind: 'centre', id: e.id }); }
        if (e.type === 'circle' || e.type === 'ellipse') pts.push({ p: e.c, kind: 'centre', id: e.id });
      }
      for (const p of intersections(ents)) pts.push({ p, kind: 'int' });
      pts.push({ p: [0, 0], kind: 'origin' });
      this._snap = pts;
    }
    return this._snap;
  }
  /**
   * Snap a raw plane point. `from` is the previous point of the shape in
   * progress (enables alignment, perpendicular and tangent inference);
   * `skip` is a set of entity ids to ignore (the ones being dragged).
   * Returns { p, kind, guides: [[a, b]…] }.
   */
  snapPoint(raw, tol, from = null, skip = null) {
    const grid = this.app.store.doc.grid;
    if (!grid.snap) return { p: raw, kind: null, guides: [] };
    let best = null;
    const consider = (p, kind) => {
      const d = dist2(p, raw);
      if (d > tol) return;
      if (!best || PRIORITY[kind] < PRIORITY[best.kind] || (PRIORITY[kind] === PRIORITY[best.kind] && d < best.d)) best = { p, kind, d };
    };
    if (this.mode === 'line' && this.chainStart && this.chainCount >= 2) consider(this.chainStart, 'close');
    for (const c of this.snapCache()) if (!skip || !c.id || !skip.has(c.id)) consider(c.p, c.kind);
    for (const p of this.pts) consider(p, 'end');
    for (const e of this.entities) {
      if (skip && skip.has(e.id)) continue;
      if (from) {
        if (e.type === 'line') {
          const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy;
          const t = l2 ? ((from[0] - e.a[0]) * dx + (from[1] - e.a[1]) * dy) / l2 : -1;
          if (t > 0 && t < 1) consider([e.a[0] + dx * t, e.a[1] + dy * t], 'perp');
        } else if (e.type === 'circle' || e.type === 'arc') {
          const d = dist2(from, e.c);
          if (d > e.r * 1.0001) {
            const base = Math.atan2(from[1] - e.c[1], from[0] - e.c[0]), off = Math.acos(e.r / d);
            for (const a of [base + off, base - off]) {
              const norm = ((a - (e.a0 || 0)) % TAU + TAU) % TAU;
              if (e.type === 'circle' || norm <= e.a1 - e.a0) consider(polar(e.c, e.r, a), 'tan');
            }
          }
        }
      }
      const c = closestOn(e, raw);
      if (c.point) consider(c.point, 'on');
    }
    if (best) return { p: best.p.slice(), kind: best.kind, guides: [] };
    // No point snap: grid, then horizontal / vertical alignment with the previous point.
    const p = [snapTo(raw[0], grid.spacing), snapTo(raw[1], grid.spacing)];
    const guides = [];
    let kind = 'grid';
    if (from) {
      if (Math.abs(raw[1] - from[1]) < tol * 0.8) { p[1] = from[1]; guides.push([from, p]); kind = 'horizontal'; }
      else if (Math.abs(raw[0] - from[0]) < tol * 0.8) { p[0] = from[0]; guides.push([from, p]); kind = 'vertical'; }
    }
    return { p, kind, guides };
  }
  track(ev) {
    const raw = this.planePoint(ev);
    if (!raw) return null;
    const from = this.pts.length ? this.pts[this.pts.length - 1] : null;
    const s = this.snapPoint(raw, this.tolerance(ev), from);
    // Equal-radius inference while sizing a circle.
    if (this.mode === 'circle' && this.pts.length === 1 && this.app.store.doc.grid.snap) {
      const r = dist2(this.pts[0], s.p);
      for (const e of this.entities) {
        if ((e.type === 'circle' || e.type === 'arc') && Math.abs(e.r - r) < this.tolerance(ev) * 0.6 && r > 0) {
          const k = e.r / r;
          s.p = [this.pts[0][0] + (s.p[0] - this.pts[0][0]) * k, this.pts[0][1] + (s.p[1] - this.pts[0][1]) * k];
          s.kind = 'equal';
        }
      }
    }
    this.cursor = s.p;
    this.snapInfo = s;
    this.raw = raw;
    return s.p;
  }

  // ---- building entities from points --------------------------------------------
  /** Entities for the current mode from a list of points (used for previews and commits). */
  build(pts) {
    const [a, b, c] = pts, d = this.dims, out = [];
    switch (this.mode) {
      case 'line': if (b && dist2(a, b) > 1e-9) out.push(lineEnt(a, b)); break;
      case 'rect': case 'rrect': {
        if (!b) break;
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        if (x1 - x0 < 1e-9 || y1 - y0 < 1e-9) break;
        const r = this.mode === 'rrect' ? Math.min(d.corner, (x1 - x0) / 2, (y1 - y0) / 2) : 0;
        if (r < 1e-9) {
          const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
          q.forEach((p, k) => out.push(lineEnt(p, q[(k + 1) % 4])));
        } else {
          if (x1 - x0 > 2 * r + 1e-9) out.push(lineEnt([x0 + r, y0], [x1 - r, y0]), lineEnt([x1 - r, y1], [x0 + r, y1]));
          if (y1 - y0 > 2 * r + 1e-9) out.push(lineEnt([x1, y0 + r], [x1, y1 - r]), lineEnt([x0, y1 - r], [x0, y0 + r]));
          const q = Math.PI / 2;
          out.push({ type: 'arc', c: [x1 - r, y0 + r], r, a0: -q, a1: 0 }, { type: 'arc', c: [x1 - r, y1 - r], r, a0: 0, a1: q },
            { type: 'arc', c: [x0 + r, y1 - r], r, a0: q, a1: 2 * q }, { type: 'arc', c: [x0 + r, y0 + r], r, a0: 2 * q, a1: 3 * q });
        }
        break;
      }
      case 'circle': if (b && dist2(a, b) > 1e-9) out.push({ type: 'circle', c: a.slice(), r: dist2(a, b) }); break;
      case 'ellipse': if (b && Math.abs(b[0] - a[0]) > 1e-9 && Math.abs(b[1] - a[1]) > 1e-9) out.push({ type: 'ellipse', c: a.slice(), rx: Math.abs(b[0] - a[0]), ry: Math.abs(b[1] - a[1]), rot: 0 }); break;
      case 'polygon': case 'triangle': {
        if (!b || dist2(a, b) < 1e-9) break;
        const n = this.sides(), r = dist2(a, b), base = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const q = Array.from({ length: n }, (_, k) => polar(a, r, base + (k / n) * TAU));
        q.forEach((p, k) => out.push(lineEnt(p, q[(k + 1) % n])));
        break;
      }
      case 'arc3': {
        if (!b) break;
        const arc = c ? arcFrom3(a, c, b) : null;
        out.push(arc || lineEnt(a, b));
        break;
      }
      case 'arcc': {
        if (!b) break;
        const r = dist2(a, b);
        if (r < 1e-9) break;
        if (!c) { out.push({ ...lineEnt(a, b), cons: true }); break; }
        const start = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const sweep = Math.max(-TAU + 0.01, Math.min(TAU - 0.01, this.sweep));
        if (Math.abs(sweep) < 1e-6) break;
        out.push(sweep > 0 ? { type: 'arc', c: a.slice(), r, a0: start, a1: start + sweep } : { type: 'arc', c: a.slice(), r, a0: start + sweep, a1: start });
        break;
      }
      case 'arct': {
        if (!b || !this.tangent) break;
        const t = this.tangent, n = [-t[1], t[0]], dx = b[0] - a[0], dy = b[1] - a[1];
        const den = 2 * (dx * n[0] + dy * n[1]);
        if (Math.abs(den) < 1e-9) { out.push(lineEnt(a, b)); break; }
        const k = (dx * dx + dy * dy) / den, cc = [a[0] + n[0] * k, a[1] + n[1] * k];
        // A point just along the tangent from the start fixes which way round the arc goes.
        const r = Math.abs(k), a0 = Math.atan2(a[1] - cc[1], a[0] - cc[0]), a1 = Math.atan2(b[1] - cc[1], b[0] - cc[0]);
        const ccw = k > 0;
        const norm = (x) => ((x % TAU) + TAU) % TAU;
        out.push(ccw ? { type: 'arc', c: cc, r, a0, a1: a0 + norm(a1 - a0) } : { type: 'arc', c: cc, r, a0: a1, a1: a1 + norm(a0 - a1) });
        break;
      }
      case 'spline': if (pts.length >= 2) out.push({ type: 'spline', pts: pts.map((p) => p.slice()), closed: false }); break;
      default:
    }
    return out;
  }
  /** Entities for a recognised freehand stroke. */
  fromStroke(shape, start, end) {
    switch (shape.kind) {
      case 'line': return [lineEnt(start, end)];
      case 'arc': { const arc = arcFrom3(start, shape.m, end); return [arc || lineEnt(start, end)]; }
      case 'circle': return [{ type: 'circle', c: shape.c, r: shape.r }];
      case 'rect': case 'triangle': return shape.corners.map((p, k) => lineEnt(p, shape.corners[(k + 1) % shape.corners.length]));
      case 'spline': {
        const pts = shape.pts.map((p) => p.slice());
        if (!shape.closed) { pts[0] = start.slice(); pts[pts.length - 1] = end.slice(); }
        return pts.length >= 2 ? [{ type: 'spline', pts, closed: !!shape.closed }] : [];
      }
      default: return [];
    }
  }
  /** Add entities to the sketch as one undo step. */
  commit(ents, label) {
    if (!ents.length) return false;
    const cons = this.construction;
    this.app.store.editSketch(this.plane, label, (sk) => {
      sk.entities = [...sk.entities, ...ents.map((e) => ({ ...e, id: sk.nextEntity++, cons: cons || undefined }))];
    });
    return true;
  }

  // ---- snip -----------------------------------------------------------------------
  /** What a snip at this pointer position would do: { id, keep, removed } or null. */
  snipAt(ev) {
    const raw = this.planePoint(ev);
    const e = raw ? this.hitEntity(raw, this.tolerance(ev) * 1.3) : null;
    if (!e) return null;
    const result = trimAt(this.entities, e.id, closestOn(e, raw).point || raw);
    return result ? { id: e.id, ...result } : null;
  }
  snip(ev) {
    const cut = this.snipAt(ev);
    this.snipPreview = null;
    if (!cut) return;
    this.app.store.editSketch(this.plane, cut.keep.length ? 'Snip curve' : 'Remove curve', (sk) => {
      const out = [];
      for (const e of sk.entities) {
        if (e.id !== cut.id) { out.push(e); continue; }
        // The first remaining piece keeps the curve's id; further pieces are new curves.
        cut.keep.forEach((piece, k) => out.push({ ...piece, id: k === 0 ? e.id : sk.nextEntity++, cons: e.cons }));
      }
      sk.entities = out;
    });
    this.app.invalidate();
  }

  // ---- pointer -----------------------------------------------------------------
  pointerDown(ev) {
    if (this.mode === 'select') return this.editDown(ev);
    if (this.mode === 'trim') { this.snipPreview = this.snipAt(ev); this.app.invalidate(); return true; }
    const p = this.track(ev);
    if (!p) return true;
    this.down = { x: ev.x, y: ev.y, added: false, dragging: false, before: this.pts.slice(), chain: [this.chainStart, this.chainCount] };
    if (this.pts.length === 0) {
      if (this.mode === 'arct' && !this.findTangent(p)) { toast('Start a tangent arc on the end of an existing line or arc.'); return true; }
      this.pts.push(p);
      this.down.added = true;
      if (this.mode === 'line') { this.chainStart = p; this.chainCount = 0; }
    }
    this.stroke = this.mode === 'line' ? [this.raw] : null;
    this.sweepFrom = null;
    this.app.invalidate();
    return true;
  }
  pointerMove(ev) {
    if (this.mode === 'select') return this.editMove(ev);
    if (this.mode === 'trim') { this.snipPreview = this.snipAt(ev); this.app.invalidate(); return; }
    const prev = this.cursor;
    const p = this.track(ev);
    if (!p || !this.down) return;
    if (!this.down.dragging && Math.hypot(ev.x - this.down.x, ev.y - this.down.y) > (ev.type === 'touch' ? 10 : 6)) this.down.dragging = true;
    if (this.stroke && this.down.dragging) this.stroke.push(this.raw);
    this.trackSweep(prev, p);
    this.liveDims();
    this.app.invalidate();
  }
  hover(ev) {
    if (this.mode === 'select') { this.editHover(ev); return; }
    if (this.mode === 'trim') {
      this.snipPreview = this.snipAt(ev);
      this.app.canvas.style.cursor = this.snipPreview ? 'pointer' : '';
      this.app.invalidate();
      return;
    }
    const prev = this.cursor;
    const p = this.track(ev);
    if (p) { this.trackSweep(prev, p); this.liveDims(); }
    this.app.invalidate();
  }
  trackSweep(prev, p) {
    if (this.mode !== 'arcc' || this.pts.length !== 2 || !prev) return;
    const c = this.pts[0];
    let d = Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(prev[1] - c[1], prev[0] - c[0]);
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    this.sweep += d;
  }
  pointerUp(ev) {
    if (this.mode === 'select') return this.editUp(ev);
    if (this.mode === 'trim') return this.snip(ev);
    const d = this.down;
    this.down = null;
    if (!d) return;
    const p = this.track(ev) || this.cursor;
    const now = performance.now();
    if (d.dragging) {
      if (this.mode === 'line' && this.stroke && this.stroke.length > 3) {
        const start = this.pts[this.pts.length - 1];
        const shape = recognise([start, ...this.stroke.slice(1, -1), p], this.tolerance(ev) * 0.55, { shapes: this.recogniseShapes && this.chainCount === 0 });
        this.stroke = null;
        if (shape) return this.finishStroke(shape, start, p);
      }
      this.pts.push(p);
    } else if (!d.added) {
      // A second tap on the same spot ends a chain or a spline.
      const last = this.pts[this.pts.length - 1];
      if (last && dist2(last, p) < 1e-9) { this.stroke = null; return this.finish(); }
      this.pts.push(p);
    }
    this.stroke = null;
    this.lastClick = now;
    this.complete();
  }
  pointerCancel() {
    if (this.mode === 'select') return this.editCancel();
    if (this.mode === 'trim') { this.snipPreview = null; this.app.invalidate(); return; }
    if (this.down) { this.pts = this.down.before; [this.chainStart, this.chainCount] = this.down.chain; }
    this.down = null;
    this.stroke = null;
    this.app.invalidate();
  }
  tap() { if (this.mode === 'select') this.tapEmpty(); }

  finishStroke(shape, start, end) {
    const ents = this.fromStroke(shape, start, end);
    const closedShape = shape.kind === 'circle' || shape.kind === 'rect' || shape.kind === 'triangle' || shape.closed;
    const names = { line: 'line', arc: 'arc', circle: 'circle', rect: 'rectangle', triangle: 'triangle', spline: 'curve' };
    this.commit(ents, `Draw ${names[shape.kind]}`);
    if (closedShape) {
      if (shape.kind !== 'spline') toast(`Recognised a ${names[shape.kind]}.`);
      this.reset();
    } else {
      this.afterSegment(end);
    }
    this.app.invalidate();
  }
  /** Continue a line chain from `end`, or stop if it closed the shape. */
  afterSegment(end) {
    this.chainCount++;
    if (this.chainStart && this.chainCount >= 2 && dist2(end, this.chainStart) < 1e-9) { this.pts = []; this.chainStart = null; this.chainCount = 0; }
    else this.pts = [end];
  }
  /** Commit the shape if it has all its points. */
  complete() {
    const need = NEEDED[this.mode];
    if (this.mode === 'arcc' && this.pts.length === 2) this.sweep = 0;
    if (this.pts.length < need) { this.app.invalidate(); return; }
    const ents = this.build(this.pts);
    const end = this.pts[this.pts.length - 1];
    if (ents.length) this.commit(ents, `Draw ${SKETCH_MODES.find((m) => m.id === this.mode).label.split(' (')[0].toLowerCase()}`);
    if (this.mode === 'line') this.afterSegment(end);
    else { this.pts = []; this.sweep = 0; this.tangent = null; }
    this.app.refreshToolPanel();
    this.app.invalidate();
  }
  /** End the current chain or spline (Enter, or tapping the last point again). */
  finish() {
    if (this.mode === 'spline' && this.pts.length >= 2) this.commit(this.build(this.pts), 'Draw spline');
    this.pts = [];
    this.chainStart = null;
    this.chainCount = 0;
    this.down = null;
    this.app.invalidate();
  }
  confirm() { this.finish(); }
  cancel() {
    if (this.pts.length || this.edit) { if (this.edit) this.app.router.cancelPrimary(); this.reset(); this.app.invalidate(); }
    else if (this.selected.length) { this.selected = []; this.app.ui.toolPanel.build(); this.app.invalidate(); }
    else if (this.mode !== 'select') this.setMode('select');
    else this.app.exitSketch();
  }
  /** Tangent direction at an existing endpoint, for the tangent arc. */
  findTangent(p) {
    this.tangent = null;
    for (const e of this.entities) {
      if (e.type === 'line') {
        const l = dist2(e.a, e.b) || 1, d = [(e.b[0] - e.a[0]) / l, (e.b[1] - e.a[1]) / l];
        if (dist2(e.b, p) < 1e-6) this.tangent = d;
        else if (dist2(e.a, p) < 1e-6) this.tangent = [-d[0], -d[1]];
      } else if (e.type === 'arc') {
        const [s, t] = endpoints(e);
        if (dist2(t, p) < 1e-6) this.tangent = [-Math.sin(e.a1), Math.cos(e.a1)];
        else if (dist2(s, p) < 1e-6) this.tangent = [Math.sin(e.a0), -Math.cos(e.a0)];
      }
      if (this.tangent) return true;
    }
    return false;
  }

  // ---- dimensions ---------------------------------------------------------------
  /** Copy the size of the shape in progress into the panel fields. */
  liveDims() {
    const a = this.pts[0], b = this.cursor, d = this.dims;
    if (!a || !b) return;
    const from = this.pts[this.pts.length - 1];
    d.w = Math.abs(b[0] - a[0]); d.h = Math.abs(b[1] - a[1]);
    d.r = dist2(a, b);
    d.len = dist2(from, b);
    d.ang = (Math.atan2(b[1] - from[1], b[0] - from[0]) * 180) / Math.PI;
    if (this.mode === 'polygon' || this.mode === 'triangle') d.rot = d.ang;
    this.app.refreshToolPanel();
  }
  /** Create the current shape from typed values, anchored at the first point (or the origin). */
  createExact() {
    const d = this.dims, a = this.pts[this.pts.length - 1] || [0, 0];
    const rad = (d.ang * Math.PI) / 180;
    let pts;
    switch (this.mode) {
      case 'line': pts = [a, [a[0] + d.len * Math.cos(rad), a[1] + d.len * Math.sin(rad)]]; break;
      case 'rect': case 'rrect': case 'ellipse': pts = [a, [a[0] + d.w, a[1] + d.h]]; break;
      case 'circle': pts = [a, [a[0] + d.r, a[1]]]; break;
      case 'polygon': case 'triangle': { const t = (d.rot * Math.PI) / 180; pts = [a, [a[0] + d.r * Math.cos(t), a[1] + d.r * Math.sin(t)]]; break; }
      default: return;
    }
    const ents = this.build(pts);
    if (!ents.length) { toast('Enter sizes greater than zero first.'); return; }
    if (this.mode === 'line' && !this.chainStart) { this.chainStart = a; this.chainCount = 0; }
    this.pts = pts;
    this.complete();
  }

  // ---- select mode: pick, drag points, move, delete -------------------------------
  hitEntity(raw, tol) {
    let best = null, bd = tol;
    for (const e of this.entities) {
      const c = closestOn(e, raw);
      if (c.dist < bd) { bd = c.dist; best = e; }
    }
    return best;
  }
  /** Draggable points of an entity: [{ key, p }]. */
  handles(e) {
    if (e.type === 'line') return [{ key: 'a', p: e.a }, { key: 'b', p: e.b }];
    if (e.type === 'arc') { const [s, t] = endpoints(e); return [{ key: 'p0', p: s }, { key: 'p1', p: t }]; }
    if (e.type === 'circle' || e.type === 'ellipse') return [{ key: 'c', p: e.c }];
    return e.pts.map((p, k) => ({ key: k, p }));
  }
  moved(e, key, p) {
    switch (e.type) {
      case 'line': return { ...e, [key]: p };
      case 'arc': {
        const [s, t] = endpoints(e), mid = polar(e.c, e.r, (e.a0 + e.a1) / 2);
        const arc = key === 'p0' ? arcFrom3(p, mid, t) : arcFrom3(s, mid, p);
        return arc ? { ...e, ...arc } : e;
      }
      case 'circle': case 'ellipse': return { ...e, c: p };
      default: return { ...e, pts: e.pts.map((q, k) => (k === key ? p : q)) };
    }
  }
  translated(e, dx, dy) {
    const mv = (p) => [p[0] + dx, p[1] + dy];
    if (e.type === 'line') return { ...e, a: mv(e.a), b: mv(e.b) };
    if (e.type === 'spline') return { ...e, pts: e.pts.map(mv) };
    return { ...e, c: mv(e.c) };
  }
  editDown(ev) {
    const raw = this.planePoint(ev);
    if (!raw) return false;
    const tol = this.tolerance(ev), { store } = this.app;
    // 1. A point: move every coincident point together, so connected curves stay connected.
    let grab = null, gd = tol;
    for (const e of this.entities) for (const hd of this.handles(e)) { const d = dist2(hd.p, raw); if (d < gd) { gd = d; grab = hd.p; } }
    if (grab) {
      const refs = [];
      for (const e of this.entities) for (const hd of this.handles(e)) if (dist2(hd.p, grab) < 1e-6) refs.push({ id: e.id, key: hd.key });
      this.edit = { kind: 'point', refs, token: store.begin(), start: this.entities, skip: new Set(refs.map((r) => r.id)) };
      this.selected = [...new Set([...this.selected.filter(() => ev.shift), ...refs.map((r) => r.id)])];
      this.app.ui.toolPanel.build();
      return true;
    }
    // 2. A curve: select it; dragging moves it (or resizes a circle).
    const e = this.hitEntity(raw, tol);
    if (!e) return false;
    if (ev.shift || ev.ctrl || this.app.prefs.multiSelect) this.selected = this.selected.includes(e.id) ? this.selected.filter((id) => id !== e.id) : [...this.selected, e.id];
    else if (!this.selected.includes(e.id)) this.selected = [e.id];
    this.edit = { kind: e.type === 'circle' && this.selected.length === 1 ? 'radius' : 'move', id: e.id, token: store.begin(), start: this.entities, origin: raw, down: [ev.x, ev.y], moved: false };
    this.app.ui.toolPanel.build();
    this.app.invalidate();
    return true;
  }
  editMove(ev) {
    const ed = this.edit, raw = this.planePoint(ev);
    if (!ed || !raw) return;
    const { store } = this.app, node = this.node, tol = this.tolerance(ev);
    const u = store.doc.units;
    if (ed.kind === 'point') {
      const s = this.snapPoint(raw, tol, null, ed.skip);
      this.cursor = s.p; this.snapInfo = s;
      node.entities = ed.start.map((e) => {
        let out = e;
        for (const r of ed.refs) if (r.id === e.id) out = this.moved(out, r.key, s.p);
        return out;
      });
    } else {
      if (!ed.moved && Math.hypot(ev.x - ed.down[0], ev.y - ed.down[1]) < 6) return;
      ed.moved = true;
      if (ed.kind === 'radius') {
        const src = ed.start.find((e) => e.id === ed.id);
        const s = this.snapPoint(raw, tol, null, new Set([ed.id]));
        const r = dist2(src.c, s.p);
        if (r > 1e-6) node.entities = ed.start.map((e) => (e.id === ed.id ? { ...e, r } : e));
        this.app.setReadout(`R ${formatLength(r, u)}`, ev.x, ev.y);
      } else {
        const g = store.doc.grid, step = g.snap ? g.spacing : 0;
        const dx = snapTo(raw[0] - ed.origin[0], step), dy = snapTo(raw[1] - ed.origin[1], step);
        const ids = new Set(this.selected);
        node.entities = ed.start.map((e) => (ids.has(e.id) ? this.translated(e, dx, dy) : e));
        this.app.setReadout(`ΔX ${formatLength(dx, u)}   ΔY ${formatLength(dy, u)}`, ev.x, ev.y);
      }
    }
    store.touch();
    this.app.refreshToolPanel();
  }
  editUp() {
    const ed = this.edit;
    if (!ed) return;
    this.edit = null;
    this.cursor = null; this.snapInfo = null;
    this.app.setReadout(null);
    this.app.store.end(ed.token, ed.kind === 'point' ? 'Move point' : ed.kind === 'radius' ? 'Change radius' : 'Move curve');
    this.app.ui.toolPanel.build();
    this.app.invalidate();
  }
  editCancel() {
    const ed = this.edit;
    if (!ed) return;
    this.edit = null;
    this.app.setReadout(null);
    this.app.store.abort(ed.token);
  }
  editHover(ev) {
    const raw = this.planePoint(ev);
    const e = raw ? this.hitEntity(raw, this.tolerance(ev)) : null;
    const id = e ? e.id : null;
    if (id !== this.hoverEntity) { this.hoverEntity = id; this.app.canvas.style.cursor = id ? 'pointer' : ''; this.app.invalidate(); }
  }
  tapEmpty() { if (this.selected.length) { this.selected = []; this.app.ui.toolPanel.build(); this.app.invalidate(); } }
  deleteSelected() {
    if (!this.selected.length) return;
    const ids = new Set(this.selected);
    this.app.store.editSketch(this.plane, ids.size > 1 ? `Delete ${ids.size} curves` : 'Delete curve', (sk) => { sk.entities = sk.entities.filter((e) => !ids.has(e.id)); });
    this.selected = [];
    this.app.ui.toolPanel.build();
  }
  duplicateSelected() {
    const ids = new Set(this.selected), step = this.app.store.doc.grid.spacing, made = [];
    this.app.store.editSketch(this.plane, 'Duplicate curves', (sk) => {
      const copies = sk.entities.filter((e) => ids.has(e.id)).map((e) => { const c = { ...this.translated(e, step, step), id: sk.nextEntity++ }; made.push(c.id); return c; });
      sk.entities = [...sk.entities, ...copies];
    });
    this.selected = made;
    this.app.ui.toolPanel.build();
  }
  patchSelected(label, fn) {
    const ids = new Set(this.selected);
    this.app.store.editSketch(this.plane, label, (sk) => { sk.entities = sk.entities.map((e) => (ids.has(e.id) ? fn(e) : e)); });
  }

  // ---- rendering ----------------------------------------------------------------
  /** Extra line batches for the renderer: preview shape, selection, raw stroke. */
  lines(theme) {
    const out = [], pl = this.pl;
    // Snip: show in red exactly what a tap would remove.
    if (this.mode === 'trim' && this.snipPreview) out.push({ segments: entitySegments(pl, [this.snipPreview.removed]), color: theme.bad, width: 4, onTop: true });
    const sel = this.entities.filter((e) => this.selected.includes(e.id) || e.id === this.hoverEntity);
    if (sel.length) out.push({ segments: entitySegments(pl, sel), color: theme.select, width: 3, onTop: true });
    if (this.mode !== 'select' && this.mode !== 'trim' && this.pts.length && this.cursor) {
      const pts = this.mode === 'spline' || this.pts.length < NEEDED[this.mode] ? [...this.pts, this.cursor] : this.pts;
      if (!(this.stroke && this.down && this.down.dragging)) {
        const ents = this.build(pts);
        if (ents.length) out.push({ segments: entitySegments(pl, ents), color: theme.preview, width: 2, onTop: true });
      }
    }
    if (this.stroke && this.stroke.length > 1 && this.down && this.down.dragging) {
      // Show what the stroke will become, over a faint trace of the raw path.
      const start = this.pts[this.pts.length - 1];
      const shape = recognise([start, ...this.stroke.slice(1), this.cursor], this.app.camera.worldPerPixel() * 6, { shapes: this.recogniseShapes && this.chainCount === 0 });
      const raw = [];
      for (let k = 1; k < this.stroke.length; k++) raw.push(...to3(pl, this.stroke[k - 1]), ...to3(pl, this.stroke[k]));
      out.push({ segments: new Float32Array(raw), color: [theme.preview[0], theme.preview[1], theme.preview[2], 0.3], width: 1.5, onTop: true });
      if (shape) out.push({ segments: entitySegments(pl, this.fromStroke(shape, start, this.cursor)), color: theme.preview, width: 2.2, onTop: true });
    }
    return out;
  }
  /** Markers and labels on the 2D overlay canvas. */
  drawOverlay(g) {
    const pl = this.pl, cam = this.app.camera, u = this.app.store.doc.units;
    const S = (p) => cam.project(to3(pl, p));
    // Endpoints of everything on this plane.
    g.fillStyle = g.theme.point;
    for (const e of this.entities) {
      const on = this.selected.includes(e.id);
      for (const hd of this.handles(e)) {
        const s = S(hd.p), r = on ? 4.5 : 2.6;
        g.beginPath(); g.arc(s.x, s.y, r, 0, TAU);
        g.fillStyle = on ? g.theme.select : g.theme.point;
        g.fill();
        if (on) { g.lineWidth = 1.5; g.strokeStyle = g.theme.surface; g.stroke(); }
      }
    }
    for (const p of this.pts) { const s = S(p); g.beginPath(); g.arc(s.x, s.y, 4, 0, TAU); g.fillStyle = g.theme.accent; g.fill(); }
    // Alignment guides and the snap glyph.
    const info = this.snapInfo;
    if (info && this.cursor && (this.mode !== 'select' || this.edit)) {
      g.setLineDash([5, 4]); g.lineWidth = 1; g.strokeStyle = g.theme.snap;
      for (const [a, b] of info.guides) {
        const sa = S(a), sb = S(b), dx = sb.x - sa.x, dy = sb.y - sa.y, l = Math.hypot(dx, dy) || 1;
        g.beginPath(); g.moveTo(sa.x - (dx / l) * 2000, sa.y - (dy / l) * 2000); g.lineTo(sa.x + (dx / l) * 2000, sa.y + (dy / l) * 2000); g.stroke();
      }
      g.setLineDash([]);
      const s = S(this.cursor), k = info.kind;
      g.lineWidth = 1.8; g.strokeStyle = k === 'close' ? g.theme.good : g.theme.snap;
      g.beginPath();
      if (k === 'end') g.rect(s.x - 6, s.y - 6, 12, 12);
      else if (k === 'mid') { g.moveTo(s.x, s.y - 7); g.lineTo(s.x + 7, s.y + 6); g.lineTo(s.x - 7, s.y + 6); g.closePath(); }
      else if (k === 'int') { g.moveTo(s.x - 6, s.y - 6); g.lineTo(s.x + 6, s.y + 6); g.moveTo(s.x + 6, s.y - 6); g.lineTo(s.x - 6, s.y + 6); }
      else if (k === 'centre' || k === 'origin') { g.arc(s.x, s.y, 6, 0, TAU); g.moveTo(s.x - 9, s.y); g.lineTo(s.x + 9, s.y); g.moveTo(s.x, s.y - 9); g.lineTo(s.x, s.y + 9); }
      else if (k === 'perp') { g.moveTo(s.x - 7, s.y + 6); g.lineTo(s.x + 7, s.y + 6); g.moveTo(s.x, s.y + 6); g.lineTo(s.x, s.y - 7); }
      else if (k === 'tan') { g.arc(s.x, s.y + 2, 5, 0, TAU); g.moveTo(s.x - 8, s.y - 4); g.lineTo(s.x + 8, s.y - 4); }
      else if (k === 'close') { g.arc(s.x, s.y, 9, 0, TAU); g.moveTo(s.x + 4, s.y); g.arc(s.x, s.y, 4, 0, TAU); }
      else if (k === 'on' || k === 'equal') g.arc(s.x, s.y, 5, 0, TAU);
      else { g.moveTo(s.x - 5, s.y); g.lineTo(s.x + 5, s.y); g.moveTo(s.x, s.y - 5); g.lineTo(s.x, s.y + 5); }
      g.stroke();
      const label = k === 'horizontal' ? 'Horizontal' : k === 'vertical' ? 'Vertical' : k === 'equal' ? 'Equal radius' : SNAP_LABEL[k];
      if (label) g.label(label, s.x + 14, s.y + 18, k === 'close' ? g.theme.good : g.theme.snap);
    }
    // Live dimensions of the shape in progress.
    if (this.mode !== 'select' && this.pts.length && this.cursor && !(this.down && this.down.dragging && this.stroke)) {
      const a = this.pts[0], b = this.cursor, from = this.pts[this.pts.length - 1], d = this.dims;
      const mid = (p, q) => { const s = S([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); return [s.x, s.y]; };
      const L = (v) => formatLength(v, u);
      if (this.mode === 'line' || this.mode === 'arc3' || this.mode === 'arct') { const m = mid(from, b); g.label(`${L(dist2(from, b))}  ${formatNumber(((d.ang % 360) + 360) % 360, 1)}°`, m[0] + 10, m[1] - 12); }
      else if (this.mode === 'rect' || this.mode === 'rrect') { const m = mid(a, b); g.label(`${L(d.w)} × ${L(d.h)}`, m[0], m[1], null, true); }
      else if (this.mode === 'circle') { const m = mid(a, b); g.label(`R ${L(d.r)}   Ø ${L(d.r * 2)}`, m[0] + 10, m[1] - 12); }
      else if (this.mode === 'ellipse') { const s = S(a); g.label(`${L(d.w * 2)} × ${L(d.h * 2)}`, s.x, s.y, null, true); }
      else if (this.mode === 'polygon' || this.mode === 'triangle') { const m = mid(a, b); g.label(`R ${L(d.r)}`, m[0] + 10, m[1] - 12); }
      else if (this.mode === 'arcc' && this.pts.length === 2) { const s = S(b); g.label(`R ${L(dist2(a, this.pts[1]))}  ${formatNumber(Math.abs((this.sweep * 180) / Math.PI), 1)}°`, s.x + 14, s.y - 12); }
    }
  }

  // ---- contextual panel ------------------------------------------------------------
  panel(api) {
    const d = this.dims, mode = this.mode, rows = [], actions = [];
    const create = (label) => actions.push(api.button(label, () => this.createExact(), true));
    const cons = segmented([{ value: 'false', label: 'Solid' }, { value: 'true', label: 'Construction' }], () => String(this.construction), (v) => { this.construction = v === 'true'; }, 'Line type');
    const typeRow = h('div.field', {}, h('span.field-label', {}, 'Draws as'), cons.el);
    if (mode === 'select') {
      const sel = this.entities.filter((e) => this.selected.includes(e.id));
      if (!sel.length) return { title: 'Edit sketch', empty: 'Tap a curve to select it. Drag points to reshape.' };
      if (sel.length === 1) {
        const e = () => this.entities.find((x) => x.id === this.selected[0]) || sel[0];
        if (sel[0].type === 'line') {
          rows.push(api.field({ label: 'Length', get: () => dist2(e().a, e().b), set: (v) => {
            if (!(v > 0)) return 'Length must be greater than zero.';
            this.patchSelected('Change length', (x) => { const l = dist2(x.a, x.b) || 1; return { ...x, b: [x.a[0] + ((x.b[0] - x.a[0]) / l) * v, x.a[1] + ((x.b[1] - x.a[1]) / l) * v] }; });
          } }));
        } else if (sel[0].type === 'circle' || sel[0].type === 'arc') {
          rows.push(api.field({ label: 'Radius', get: () => e().r, set: (v) => (v > 0 ? void this.patchSelected('Change radius', (x) => ({ ...x, r: v })) : 'Radius must be greater than zero.') }));
        } else if (sel[0].type === 'ellipse') {
          rows.push(api.field({ label: 'Radius X', get: () => e().rx, set: (v) => (v > 0 ? void this.patchSelected('Change ellipse', (x) => ({ ...x, rx: v })) : 'Must be greater than zero.') }),
            api.field({ label: 'Radius Y', get: () => e().ry, set: (v) => (v > 0 ? void this.patchSelected('Change ellipse', (x) => ({ ...x, ry: v })) : 'Must be greater than zero.') }));
        }
      }
      const allCons = sel.every((e) => e.cons);
      actions.push(api.button(allCons ? 'Make solid' : 'Make construction', () => { this.patchSelected('Change line type', (x) => ({ ...x, cons: allCons ? undefined : true })); this.app.ui.toolPanel.build(); }),
        api.button('Duplicate', () => this.duplicateSelected()), api.button('Delete', () => this.deleteSelected(), false, true));
      return { title: sel.length === 1 ? { line: 'Line', arc: 'Arc', circle: 'Circle', ellipse: 'Ellipse', spline: 'Spline' }[sel[0].type] : `${sel.length} curves`, rows, actions };
    }
    if (mode === 'trim') return { title: 'Snip', empty: 'Tap the part of a curve to remove. The red highlight shows what will go.' };
    const title = SKETCH_MODES.find((m) => m.id === mode).label.split(' (')[0];
    if (mode === 'line') {
      rows.push(api.field({ label: 'Length', get: () => d.len, set: (v) => { d.len = v; } }), api.field({ label: 'Angle', kind: 'angle', get: () => d.ang, set: (v) => { d.ang = v; } }));
      const rec = segmented([{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }], () => String(this.recogniseShapes), (v) => { this.recogniseShapes = v === 'true'; }, 'Shape recognition');
      rows.push(h('div.field', {}, h('span.field-label', {}, 'Recognise shapes'), rec.el));
      create('Add line');
    } else if (mode === 'rect' || mode === 'rrect') {
      rows.push(api.field({ label: 'Width', get: () => d.w, set: (v) => { d.w = v; } }), api.field({ label: 'Height', get: () => d.h, set: (v) => { d.h = v; } }));
      if (mode === 'rrect') rows.push(api.field({ label: 'Corner radius', get: () => d.corner, set: (v) => (v >= 0 ? void (d.corner = v) : 'Corner radius cannot be negative.') }));
      create('Add rectangle');
    } else if (mode === 'circle') {
      rows.push(api.field({ label: 'Radius', get: () => d.r, set: (v) => { d.r = v; } }), api.field({ label: 'Diameter', get: () => d.r * 2, set: (v) => { d.r = v / 2; api.sync(); } }));
      create('Add circle');
    } else if (mode === 'ellipse') {
      rows.push(api.field({ label: 'Radius X', get: () => d.w, set: (v) => { d.w = v; } }), api.field({ label: 'Radius Y', get: () => d.h, set: (v) => { d.h = v; } }));
      create('Add ellipse');
    } else if (mode === 'polygon' || mode === 'triangle') {
      if (mode === 'polygon') {
        const presets = segmented([3, 5, 6, 8].map((v) => ({ value: v, label: String(v) })), () => d.sides, (v) => { d.sides = +v; api.sync(); this.app.invalidate(); }, 'Side presets');
        rows.push(h('div.field', {}, h('span.field-label', {}, 'Presets'), presets.el),
          api.field({ label: 'Sides', kind: 'count', get: () => d.sides, set: (v) => (v >= 3 && v <= 64 ? void (d.sides = v, presets.sync(), this.app.invalidate()) : 'Use between 3 and 64 sides.') }));
      }
      rows.push(api.field({ label: 'Corner radius', get: () => d.r, set: (v) => { d.r = v; } }), api.field({ label: 'Rotation', kind: 'angle', get: () => d.rot, set: (v) => { d.rot = v; } }));
      create(mode === 'triangle' ? 'Add triangle' : 'Add polygon');
    } else if (mode === 'spline') {
      actions.push(api.button('Finish curve', () => this.finish(), true));
    }
    rows.push(typeRow);
    return { title, rows, actions };
  }
}
