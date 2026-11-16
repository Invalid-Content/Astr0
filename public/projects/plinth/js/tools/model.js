/**
 * tools/model.js — solid modelling tools that work on real geometry:
 *   ExtrudeTool   sketch face(s) -> solid, as a new body or joined to / cut
 *                 from / intersected with existing bodies
 *   BlendTool     fillet or chamfer on selected edges, with a live preview
 *                 computed by the kernel (not a shading effect)
 */
import { Tool, modelMatrix } from './tools.js';
import { v3, m4, ray as rayMath, snap } from '../core/math.js';
import { evaluate, evaluateBody } from '../geometry/kernel.js';
import { PLANES, to3, sketchData } from '../geometry/planes.js';
import { mergeRegions } from '../geometry/sketch2d.js';
import { curvesOf } from '../geometry/topology.js';
import { edgeSpec } from '../geometry/solids.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { formatLength } from '../core/units.js';
import { BODY_COLORS } from '../document/store.js';
import { h, segmented, toast } from '../ui/dom.js';

const CONE = PRIMITIVES.cone.build({ radius: 0.5, topRadius: 0, height: 1 });
const BALL = PRIMITIVES.sphere.build({ radius: 0.5 });
const pickRadius = (ev) => (ev.type === 'touch' ? 22 : ev.type === 'pen' ? 14 : 10);

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return { d: Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)), t };
}

/** Region loop -> extrusion loop data, in coordinates relative to `c`. */
function loopData(loop, c, curvedTag) {
  const p = [], g = [], curved = [];
  let group = -1, prevTag = null;
  loop.pts.forEach((pt, k) => {
    p.push(pt[0] - c[0], pt[1] - c[1]);
    if (loop.tags[k] !== prevTag) { group++; curved.push(curvedTag(loop.tags[k]) ? 1 : 0); prevTag = loop.tags[k]; }
    g.push(group);
  });
  // A closed curve traced from the middle starts and ends in the same wall.
  if (group > 0 && loop.tags[0] === loop.tags[loop.tags.length - 1]) {
    for (let k = g.length - 1; k >= 0 && g[k] === group; k--) g[k] = 0;
    curved.pop();
  }
  return { p: p.map((x) => Math.round(x * 1e6) / 1e6), g, c: curved };
}

/** Nearest visible edge curve under the pointer: { node, curve, key, world } or null. */
export function pickEdge(app, ev, bodyId = null) {
  const { store, camera } = app, tol = pickRadius(ev);
  let best = null;
  // Edges hidden behind a surface are not pickable: compare with what the pointer ray hits first.
  const front = app.pick(ev.x, ev.y);
  const frontDepth = front ? v3.dot(v3.sub(camera.eye, front.point), camera.back) : Infinity;
  for (const node of store.bodies()) {
    if (!store.isVisible(node) || store.isLocked(node) || (bodyId && node.id !== bodyId)) continue;
    const mesh = evaluateBody(node), model = modelMatrix(node);
    for (const curve of curvesOf(mesh)) {
      const world = curve.pts.map((p) => m4.point(model, p));
      const scr = world.map((p) => camera.project(p));
      const n = curve.closed ? scr.length : scr.length - 1;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % scr.length;
        if (scr[k].behind || scr[j].behind) continue;
        const hit = distToSegment(ev.x, ev.y, scr[k], scr[j]);
        if (hit.d > tol) continue;
        const p = v3.lerp(world[k], world[j], hit.t), depth = v3.dot(v3.sub(camera.eye, p), camera.back);
        if (depth > frontDepth + Math.max(frontDepth * 0.01, camera.worldPerPixel(p) * tol * 2)) continue;
        // Prefer the edge nearest the viewer; break near-ties by screen distance.
        const score = depth + hit.d * camera.worldPerPixel(p) * 2;
        if (!best || score < best.score) best = { node, curve, world, score, key: `${node.id}:${curve.pts[0].map((x) => x.toFixed(3))}:${curve.pts[curve.pts.length - 1].map((x) => x.toFixed(3))}:${curve.pts.length}` };
      }
    }
  }
  return best;
}

/** A selectable edge of a body, in the same form pickEdge returns. */
export function edgeItem(node, curve, model = modelMatrix(node)) {
  const fx = (p) => p.map((x) => x.toFixed(3));
  return { kind: 'edge', node, curve, world: curve.pts.map((p) => m4.point(model, p)), key: `${node.id}:${fx(curve.pts[0])}:${fx(curve.pts[curve.pts.length - 1])}:${curve.pts.length}` };
}

/**
 * Matrix that places a unit-height extrusion (z from 0 to 1 along `n`) so it
 * spans `lo`..`hi` along n from `origin`. Stretching one prebuilt mesh this way
 * makes drag previews instant: no geometry is rebuilt while the pointer moves.
 */
export function stretchMatrix(origin, n, lo, hi) {
  const k = hi - lo - 1;
  return new Float32Array([
    1 + k * n[0] * n[0], k * n[1] * n[0], k * n[2] * n[0], 0,
    k * n[0] * n[1], 1 + k * n[1] * n[1], k * n[2] * n[1], 0,
    k * n[0] * n[2], k * n[1] * n[2], 1 + k * n[2] * n[2], 0,
    origin[0] + n[0] * lo, origin[1] + n[1] * lo, origin[2] + n[2] * lo, 1,
  ]);
}

// ---------------------------------------------------------------------------
export class ExtrudeTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'extrude';
    this.hint = 'Drag the arrow or type a distance. Choose whether to make a new body, join, cut or intersect, then confirm.';
    this.state = { dist: 20, dist2: 10, mode: 'one', op: 'new' };
    this.parts = [];
  }
  activate() { this.drag = null; this.rebuild(); }
  deactivate() { this.parts = []; this.drag = null; this.app.setReadout(null); }
  /** Build one extrusion profile per connected group of selected faces. */
  rebuild() {
    this.parts = [];
    const sel = this.app.faceSel;
    if (!sel.length) { this.app.invalidate(); return; }
    const node = this.app.store.node(sel[0].sketch);
    if (!node) return;
    const data = sketchData(node), plane = data.plane;
    const regions = sel.filter((f) => f.sketch === node.id).map((f) => data.regions[f.index]).filter(Boolean);
    const byId = new Map(node.entities.map((e) => [e.id, e]));
    const curved = (tag) => byId.get(tag) && byId.get(tag).type !== 'line';
    for (const r of mergeRegions(regions)) {
      const xs = r.outer.pts.map((p) => p[0]), ys = r.outer.pts.map((p) => p[1]);
      const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      const loops = [r.outer, ...r.holes].map((l) => loopData(l, c, curved));
      // Built once per selection; the preview only stretches it.
      const unit = evaluate({ type: 'extrude', params: { u: plane.u, v: plane.v, n: plane.n, z0: 0, z1: 1, loops } });
      this.parts.push({ plane, origin: to3(plane, c), loops, unit });
    }
    this.sync();
  }
  extent() {
    const s = this.state;
    if (s.mode === 'sym') return [-s.dist / 2, s.dist / 2];
    if (s.mode === 'two') return [-s.dist2, s.dist];
    return [0, s.dist];
  }
  /** Preview / result nodes for the current settings. */
  sync() {
    const [z0, z1] = this.extent();
    this.nodes = Math.abs(z1 - z0) < 1e-9 ? [] : this.parts.map((part, k) => ({
      id: 0, kind: 'body', name: 'Extrusion', parent: null, visible: true, locked: false,
      color: this.state.op === 'cut' ? '#d86a5c' : BODY_COLORS[(this.app.store.bodies().length + k) % BODY_COLORS.length],
      feature: { type: 'extrude', params: { u: part.plane.u, v: part.plane.v, n: part.plane.n, z0, z1, loops: part.loops } },
      transform: { p: part.origin.slice(), q: [0, 0, 0, 1], s: [1, 1, 1] },
    }));
    this.app.invalidate();
  }
  /** The preview is the prebuilt unit prism stretched to the current distance. */
  previewItems() {
    const [z0, z1] = this.extent(), lo = Math.min(z0, z1), hi = Math.max(z0, z1);
    if (hi - lo < 1e-9) return [];
    const color = this.state.op === 'cut' ? [0.85, 0.42, 0.36] : [0.56, 0.64, 0.72];
    return this.parts.map((part) => ({ mesh: part.unit, model: stretchMatrix(part.origin, part.plane.n, lo, hi), color }));
  }
  /** Arrow handle: base on the face, tip at the far end of the extrusion. */
  handle() {
    const part = this.parts[0];
    if (!part) return null;
    const cam = this.app.camera, [, z1] = this.extent();
    const base = v3.addScaled(part.origin, part.plane.n, z1);
    const len = cam.worldPerPixel(base) * 64;
    const sign = this.state.dist < 0 ? -1 : 1;
    return { base, tip: v3.addScaled(base, part.plane.n, len * sign), n: part.plane.n, len, sign };
  }
  drawGizmo(draw) {
    const hd = this.handle();
    if (!hd) return;
    const col = this.drag || this.hot ? [1, 0.78, 0.2, 1] : [0.16, 0.45, 0.98, 1];
    draw.lines([...hd.base, ...hd.tip], col, 3);
    const n = v3.scale(hd.n, hd.sign), u = v3.norm(v3.cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), w = v3.cross(n, u), s = hd.len;
    draw.mesh(CONE, new Float32Array([u[0] * s * 0.22, u[1] * s * 0.22, u[2] * s * 0.22, 0, w[0] * s * 0.22, w[1] * s * 0.22, w[2] * s * 0.22, 0, n[0] * s * 0.34, n[1] * s * 0.34, n[2] * s * 0.34, 0, hd.tip[0], hd.tip[1], hd.tip[2], 1]), col);
  }
  overHandle(ev) {
    const hd = this.handle();
    if (!hd) return false;
    const cam = this.app.camera;
    return distToSegment(ev.x, ev.y, cam.project(hd.base), cam.project(v3.addScaled(hd.tip, hd.n, hd.len * 0.2 * hd.sign))).d < pickRadius(ev);
  }
  hover(ev) {
    const hot = this.overHandle(ev);
    if (hot !== this.hot) { this.hot = hot; this.app.invalidate(); }
    if (!hot) this.app.hoverAt(ev); else this.app.setHover(null);
  }
  pointerDown(ev) {
    if (!this.overHandle(ev)) return false;
    const part = this.parts[0], r = this.app.camera.ray(ev.x, ev.y);
    this.drag = { s0: rayMath.closestOnLine(r, part.origin, part.plane.n), dist0: this.state.dist, before: { ...this.state } };
    return true;
  }
  pointerMove(ev) {
    if (!this.drag) return;
    const part = this.parts[0], g = this.app.store.doc.grid;
    const s = rayMath.closestOnLine(this.app.camera.ray(ev.x, ev.y), part.origin, part.plane.n) - this.drag.s0;
    const k = this.state.mode === 'sym' ? 2 : 1;
    this.state.dist = snap(this.drag.dist0 + s * k, g.snap !== ev.ctrl ? g.spacing / 2 : 0);
    this.app.setReadout(formatLength(this.state.dist, this.app.store.doc.units), ev.x, ev.y);
    this.sync();
    this.app.refreshToolPanel();
  }
  pointerUp() { this.drag = null; this.app.setReadout(null); this.app.invalidate(); }
  pointerCancel() { if (this.drag) Object.assign(this.state, this.drag.before); this.drag = null; this.app.setReadout(null); this.sync(); this.app.refreshToolPanel(); }
  tap(ev) { this.app.selectAt(ev); this.rebuild(); this.app.ui.toolPanel.build(); }
  cancel() { if (this.drag) this.app.router.cancelPrimary(); else this.app.setTool('select'); }

  confirm() {
    const { store } = this.app, s = this.state;
    if (!this.parts.length) { toast('Select a sketch face first.'); return; }
    if (!this.nodes.length) { toast('Set a distance other than zero.'); return; }
    const addBodies = (label) => {
      const ids = [];
      store.commit(label, (doc) => {
        for (const n of this.nodes) { const id = doc.nextId++; ids.push(id); doc.nodes.push({ ...n, id, name: store.uniqueName('Extrusion'), color: BODY_COLORS[doc.nodes.filter((x) => x.kind === 'body').length % BODY_COLORS.length] }); }
      });
      return ids;
    };
    let result;
    if (s.op === 'new') {
      result = addBodies('Extrude');
    } else {
      // Find the bodies the extrusion actually reaches.
      const plan = [];
      for (const tool of this.nodes) {
        const tb = this.app.bounds([tool]);
        for (const body of store.bodies()) {
          if (!store.isVisible(body) || store.isLocked(body)) continue;
          const bb = this.app.bounds([body]);
          if (!bb || [0, 1, 2].some((a) => tb.min[a] > bb.max[a] + 1e-6 || bb.min[a] > tb.max[a] + 1e-6)) continue;
          if (s.op === 'join' && plan.some((p) => p.tool === tool)) continue;      // join into the first body only
          plan.push({ tool, body });
        }
      }
      if (!plan.length) {
        if (s.op !== 'join') { toast(s.op === 'cut' ? 'The extrusion does not reach any body, so there is nothing to cut. Drag the arrow into a body.' : 'The extrusion does not overlap any body.'); return; }
        result = addBodies('Extrude');
        toast('Nothing to join to here, so this became a new body.');
      } else {
        const opName = { join: 'union', cut: 'subtract', intersect: 'intersect' }[s.op];
        const next = new Map();
        for (const { tool, body } of plan) {
          const matrix = Array.from(m4.mul(m4.invert(modelMatrix(body)), modelMatrix(tool))).map((x) => Math.round(x * 1e9) / 1e9);
          const ops = [...(next.get(body.id) || body.ops || []), { type: 'boolean', op: opName, tool: tool.feature, matrix }];
          const mesh = evaluateBody({ ...body, ops });
          if (mesh.error) { toast(`${body.name}: ${mesh.error}`); return; }
          next.set(body.id, ops);
        }
        store.commit({ join: 'Extrude and join', cut: 'Extrude cut', intersect: 'Extrude and intersect' }[s.op], (doc) => {
          for (const n of doc.nodes) if (next.has(n.id)) n.ops = next.get(n.id);
        });
        result = [...next.keys()];
      }
    }
    this.app.faceSel = [];
    this.app.setTool('select');
    store.select(result);
  }

  panel(api) {
    const s = this.state;
    if (!this.parts.length) return { title: 'Extrude', empty: 'Tap a closed sketch face to extrude it.' };
    const rows = [api.field({ label: 'Distance', get: () => s.dist, set: (v) => { s.dist = v; this.sync(); } })];
    if (s.mode === 'two') rows.push(api.field({ label: 'Other side', get: () => s.dist2, set: (v) => { s.dist2 = v; this.sync(); } }));
    const mode = segmented([{ value: 'one', label: 'One side' }, { value: 'sym', label: 'Symmetric' }, { value: 'two', label: 'Two sides' }], () => s.mode, (v) => { s.mode = v; this.sync(); this.app.ui.toolPanel.build(); }, 'Direction');
    const op = segmented([{ value: 'new', label: 'New body' }, { value: 'join', label: 'Join' }, { value: 'cut', label: 'Cut' }, { value: 'intersect', label: 'Intersect' }], () => s.op, (v) => { s.op = v; this.sync(); }, 'Result');
    rows.push(h('div.field', {}, h('span.field-label', {}, 'Direction'), mode.el), h('div.field', {}, h('span.field-label', {}, 'Result'), op.el));
    return { title: 'Extrude', rows, actions: [api.button('Cancel', () => this.cancel()), api.button('Extrude', () => this.confirm(), true)] };
  }
}

// ---------------------------------------------------------------------------
export class BlendTool extends Tool {
  constructor(app, kind) {
    super(app);
    this.id = kind;
    this.kind = kind;
    this.size = kind === 'fillet' ? 3 : 2;
    this.angle = 45;
    this.hint = kind === 'fillet'
      ? 'Tap edges to round them. Drag the handle or type a radius, then confirm.'
      : 'Tap edges to bevel them. Drag the handle or type a distance, then confirm.';
    this.clear();
  }
  clear() { this.bodyId = null; this.edges = []; this.hoverEdge = null; this.preview = null; this.error = null; this.drag = null; }
  activate() { this.clear(); }
  deactivate() { clearTimeout(this.timer); this.clear(); this.app.setReadout(null); }
  body() { return this.bodyId ? this.app.store.node(this.bodyId) : null; }

  pickEdge(ev) { return pickEdge(this.app, ev, this.bodyId); }
  /** Start with edges already chosen (from Edit Mode). */
  preload(bodyId, picks) {
    this.bodyId = bodyId;
    this.edges = picks.map((e) => ({ key: e.key, spec: edgeSpec(e.curve), segments: this.segments(e.world, e.curve.closed), mid: e.world[Math.floor(e.world.length / 2)] }));
    this.update();
    this.app.ui.toolPanel.build();
  }
  segments(world, closed) {
    const out = [], n = closed ? world.length : world.length - 1;
    for (let k = 0; k < n; k++) out.push(...world[k], ...world[(k + 1) % world.length]);
    return new Float32Array(out);
  }
  hover(ev) {
    const hot = this.overHandle(ev);
    const e = hot ? null : this.pickEdge(ev);
    if (hot !== this.hot || (e ? e.key : null) !== (this.hoverEdge ? this.hoverEdge.key : null)) {
      this.hot = hot;
      this.hoverEdge = e;
      this.app.canvas.style.cursor = e || hot ? 'pointer' : '';
      this.app.invalidate();
    }
  }
  tap(ev) {
    const e = this.pickEdge(ev);
    if (!e) return;
    const k = this.edges.findIndex((x) => x.key === e.key);
    if (k >= 0) this.edges.splice(k, 1);
    else {
      this.bodyId = e.node.id;
      this.edges.push({ key: e.key, spec: edgeSpec(e.curve), segments: this.segments(e.world, e.curve.closed), mid: e.world[Math.floor(e.world.length / 2)] });
    }
    if (!this.edges.length) this.bodyId = null;
    this.hoverEdge = null;
    this.update();
    this.app.ui.toolPanel.build();
  }
  op() {
    return this.kind === 'fillet'
      ? { type: 'fillet', radius: this.size, edges: this.edges.map((e) => e.spec) }
      : { type: 'chamfer', distance: this.size, angle: this.angle, edges: this.edges.map((e) => e.spec) };
  }
  /** Recompute the real geometry for the preview. */
  update() {
    const body = this.body();
    this.error = null;
    this.preview = null;
    if (body && this.edges.length) {
      const node = { ...body, ops: [...(body.ops || []), this.op()] };
      const mesh = evaluateBody(node);
      if (mesh.error) this.error = mesh.error; else this.preview = node;
    }
    this.app.refreshToolPanel();
    this.app.invalidate();
  }
  /** Coalesce rapid changes (dragging) into one recompute. */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 40);
  }
  /** The renderer shows the previewed geometry in place of the body. */
  override(node) { return this.preview && node.id === this.bodyId ? this.preview : null; }
  lines(theme) {
    const out = this.edges.map((e) => ({ segments: e.segments, color: this.error ? theme.bad : theme.select, width: 3, onTop: true }));
    if (this.hoverEdge && !this.edges.some((e) => e.key === this.hoverEdge.key)) out.push({ segments: this.segments(this.hoverEdge.world, this.hoverEdge.curve.closed), color: theme.hover, width: 4, onTop: true });
    return out;
  }
  // Drag handle: sits beside the first selected edge; dragging away from the edge grows the size.
  handle() {
    const e = this.edges[0], body = this.body();
    if (!e || !body) return null;
    const cam = this.app.camera, st = e.spec.st, k = Math.floor(st.length / 30) * 15;
    const model = modelMatrix(body);
    const p = m4.point(model, st.slice(k, k + 3));
    const inward = v3.norm(m4.dir(model, v3.add(st.slice(k + 3, k + 6), st.slice(k + 6, k + 9))));
    const a = cam.project(p), b = cam.project(v3.addScaled(p, inward, cam.worldPerPixel(p) * 40));
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 4) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
    const wpp = cam.worldPerPixel(p);
    return { p, dir: [dx, dy], wpp, pos: v3.add(p, v3.add(v3.scale(cam.right, -dx * wpp * 44), v3.scale(cam.up, dy * wpp * 44))) };
  }
  overHandle(ev) {
    const hd = this.handle();
    if (!hd) return false;
    const s = this.app.camera.project(hd.pos);
    return Math.hypot(ev.x - s.x, ev.y - s.y) < pickRadius(ev) + 6;
  }
  drawGizmo(draw) {
    const hd = this.handle();
    if (!hd) return;
    const col = this.drag || this.hot ? [1, 0.78, 0.2, 1] : [0.16, 0.45, 0.98, 1];
    draw.lines([...hd.p, ...hd.pos], col, 2);
    const s = hd.wpp * 15, cam = this.app.camera;
    draw.mesh(BALL, new Float32Array([cam.right[0] * s, cam.right[1] * s, cam.right[2] * s, 0, cam.up[0] * s, cam.up[1] * s, cam.up[2] * s, 0, cam.back[0] * s, cam.back[1] * s, cam.back[2] * s, 0, hd.pos[0], hd.pos[1], hd.pos[2], 1]), col);
  }
  pointerDown(ev) {
    if (!this.overHandle(ev)) return false;
    const hd = this.handle();
    this.drag = { x: ev.x, y: ev.y, size0: this.size, dir: hd.dir, wpp: hd.wpp };
    return true;
  }
  pointerMove(ev) {
    const d = this.drag;
    if (!d) return;
    const g = this.app.store.doc.grid;
    // Dragging the handle away from the edge (out of the body) grows the size.
    const travel = -((ev.x - d.x) * d.dir[0] + (ev.y - d.y) * d.dir[1]) * d.wpp;
    this.size = Math.max(0.05, snap(d.size0 + travel, g.snap !== ev.ctrl ? Math.max(g.spacing / 20, 0.1) : 0));
    this.app.setReadout(`${this.kind === 'fillet' ? 'R' : 'D'} ${formatLength(this.size, this.app.store.doc.units)}`, ev.x, ev.y);
    this.app.refreshToolPanel();
    this.schedule();
  }
  pointerUp() { this.drag = null; this.app.setReadout(null); clearTimeout(this.timer); this.update(); }
  pointerCancel() { if (this.drag) this.size = this.drag.size0; this.drag = null; this.app.setReadout(null); this.update(); }
  cancel() { if (this.drag) this.app.router.cancelPrimary(); else this.app.setTool('select'); }
  confirm() {
    clearTimeout(this.timer);
    this.update();
    const body = this.body();
    if (!body || !this.edges.length) { toast('Tap at least one edge first.'); return; }
    if (this.error) { toast(this.error); return; }
    const op = this.op(), id = body.id;
    this.app.store.patch(id, this.kind === 'fillet' ? 'Fillet' : 'Chamfer', (n) => { n.ops = [...(n.ops || []), op]; });
    this.app.setTool('select');
    this.app.store.select([id]);
  }
  panel(api) {
    const fillet = this.kind === 'fillet', title = fillet ? 'Fillet' : 'Chamfer';
    if (!this.edges.length) return { title, empty: 'Tap one or more edges of a solid.' };
    const rows = [api.field({ label: fillet ? 'Radius' : 'Distance', get: () => this.size, set: (v) => (v > 0 ? void (this.size = v, this.update()) : `${fillet ? 'Radius' : 'Distance'} must be greater than zero.`) })];
    if (!fillet) rows.push(api.field({ label: 'Angle', kind: 'angle', get: () => this.angle, set: (v) => (v > 0 && v < 90 ? void (this.angle = v, this.update()) : 'Use an angle between 0° and 90°.') }));
    const note = h(`p.tool-note${this.error ? '.bad' : ''}`, {}, this.error || `${this.edges.length} ${this.edges.length === 1 ? 'edge' : 'edges'} selected`);
    rows.push(note);
    return {
      title, rows,
      actions: [api.button('Cancel', () => this.cancel()), api.button(`Apply ${title.toLowerCase()}`, () => this.confirm(), true)],
      onSync: () => { note.textContent = this.error || `${this.edges.length} ${this.edges.length === 1 ? 'edge' : 'edges'} selected`; note.classList.toggle('bad', !!this.error); },
    };
  }
}

/** Human-readable name of a stored operation, for the properties panel. */
export function opLabel(op) {
  if (op.type === 'fillet') return 'Fillet';
  if (op.type === 'chamfer') return 'Chamfer';
  if (op.type === 'merge') return 'Combine faces';
  if (op.type === 'split') return `Split faces (${op.count} ${op.count === 1 ? 'cut' : 'cuts'}${op.scope === 'ring' ? ', all round' : ''})`;
  if (op.type === 'move') return `Move ${op.pts.length === 1 ? 'point' : 'points'}`;
  return { union: 'Join', subtract: 'Cut', intersect: 'Intersect' }[op.op];
}
