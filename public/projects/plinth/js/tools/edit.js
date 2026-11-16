/**
 * tools/edit.js — Edit Mode: work on the geometry of one object.
 *
 *   EditTool      pick vertices, edges or faces of the object being edited,
 *                 and move selected points (or the ends of selected edges)
 *                 with the move gizmo or typed distances.
 *                 These are the solid's real topology (faces are tracked
 *                 surfaces, edges are the curves where two surfaces meet,
 *                 vertices are where edges end), never render triangles.
 *   PushPullTool  move a flat face along its normal: outward adds material,
 *                 inward removes it. Computed as a Boolean with the prism
 *                 swept by the face, so the result is real geometry.
 */
import { Tool, modelMatrix } from './tools.js';
import { pickEdge, edgeItem, stretchMatrix } from './model.js';
import { extrudeMesh } from '../geometry/solids.js';
import { v3, m4, ray as rayMath, snap } from '../core/math.js';
import { evaluateBody } from '../geometry/kernel.js';
import { curvesOf } from '../geometry/topology.js';
import { polygonArea, pointInPolygon } from '../geometry/sketch2d.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { formatLength, UNITS } from '../core/units.js';
import { toast, segmented, h } from '../ui/dom.js';

const CONE = PRIMITIVES.cone.build({ radius: 0.5, topRadius: 0, height: 1 });
const TAU = Math.PI * 2;
const pickRadius = (ev) => (ev.type === 'touch' ? 22 : ev.type === 'pen' ? 14 : 10);
const keyOf = (p) => p.map((x) => x.toFixed(3)).join(',');

// ---------------------------------------------------------------------------
export class EditTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'edit';
    this.element = 'face';
    this.clear();
    this.bodyId = null;
  }
  get hint() {
    if (!this.body()) return 'Tap an object to edit its geometry.';
    return { face: 'Tap faces to select them. Push / pull moves a flat face in or out.', edge: 'Tap edges to select them; double-tap one to select all the edges round that face. Drag the arrows to move an edge.', vertex: 'Tap corner points to select them, then drag the arrows to move them. Select two to measure.' }[this.element];
  }
  set hint(_) { /* derived */ }
  clear() { this.faces = []; this.edges = []; this.verts = []; this.hot = null; this.loopFace = null; this.loopEdge = null; }
  body() { const n = this.bodyId ? this.app.store.node(this.bodyId) : null; return n && n.kind === 'body' ? n : null; }
  mesh() { return evaluateBody(this.body()); }
  activate() {
    const sel = this.app.store.selectedBodies();
    if (sel.length && sel[0].id !== this.bodyId) { this.bodyId = sel[0].id; this.clear(); }
    if (!this.body()) { this.bodyId = null; this.clear(); }
    this.meshRef = this.body() ? this.mesh() : null;
  }
  deactivate() {
    if (this.drag) this.pointerCancel();
    this.hot = null;
    Object.assign(this.app.gizmo, { visible: false, hover: null, active: null });
  }
  setBody(id) {
    this.bodyId = id;
    this.clear();
    this.meshRef = this.body() ? this.mesh() : null;
    this.app.store.select(id ? [id] : []);
    this.refresh();
  }
  /** Switch between points, edges and faces. Only one kind is ever selected at a time. */
  setElement(el) {
    if (el !== this.element) this.clear();
    this.element = el;
    this.refresh();
  }
  refresh() {
    this.app.ui.toolbar.refresh();
    this.app.ui.toolPanel.build();
    this.app.ui.status.sync();
    this.app.invalidate();
  }
  // ---- moving points --------------------------------------------------------------
  /** World positions the gizmo moves: selected points, or the ends of selected (open) edges. */
  movable() {
    if (this.element === 'vertex') return this.verts.map((v) => v.p);
    if (this.element === 'edge') {
      const seen = new Map();
      for (const e of this.edges) if (!e.curve.closed) for (const p of [e.world[0], e.world[e.world.length - 1]]) seen.set(keyOf(p), p);
      return [...seen.values()];
    }
    return [];
  }
  /** The move step for a world-space displacement, in the body's own coordinates. */
  moveStep(pts, worldDelta) {
    const inv = m4.invert(modelMatrix(this.body()));
    const round = (x) => Math.round(x * 1e6) / 1e6;
    return { type: 'move', pts: pts.map((p) => m4.point(inv, p).map(round)), delta: m4.dir(inv, worldDelta).map(round) };
  }
  /** Apply a move as one undo step and keep the same points selected at their new positions. */
  commitMove(pts, delta) {
    if (v3.len(delta) < 1e-9 || !pts.length) return;
    const body = this.body(), step = this.moveStep(pts, delta);
    const mesh = evaluateBody({ ...body, ops: [...(body.ops || []), step] });
    if (mesh.error) { toast(mesh.error); return; }
    this.app.store.patch(body.id, pts.length === 1 ? 'Move point' : 'Move points', (n) => { n.ops = [...(n.ops || []), step]; });
    this.meshRef = this.mesh();
    if (this.element === 'vertex') this.verts = this.verts.map((v) => { const p = v3.add(v.p, delta); return { kind: 'vertex', key: keyOf(p), p }; });
    else this.edges = [];
    this.preview = null;
    this.refresh();
  }
  override(node) { return this.preview && node.id === this.bodyId ? this.preview : null; }
  pointerDown(ev) {
    const g = this.app.gizmo;
    // In the edge selector a quick second tap is the double-tap that selects a whole face's edges.
    // The gizmo's centre sits on the selected edge, so let such a tap through to the router.
    const last = this.app.router.lastTap;
    if (this.element === 'edge' && last && performance.now() - last.t < 350 && Math.hypot(ev.x - last.x, ev.y - last.y) < 30) return false;
    this.frame();
    const handle = g.hit(ev.x, ev.y, this.app.camera, pickRadius(ev));
    if (!handle) return false;
    const pts = this.movable(), r = this.app.camera.ray(ev.x, ev.y), pivot = g.pivot.slice();
    const d = this.drag = { handle, pts, pivot, delta: [0, 0, 0] };
    if (handle.length === 2) {
      d.normal = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][[0, 1, 2].find((k) => !handle.includes('xyz'[k]))];
      const t = rayMath.plane(r, pivot, d.normal);
      d.hit0 = t === null ? pivot : rayMath.at(r, t);
    } else {
      d.axis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]['xyz'.indexOf(handle)];
      d.s0 = rayMath.closestOnLine(r, pivot, d.axis);
    }
    g.active = handle;
    return true;
  }
  pointerMove(ev) {
    const d = this.drag;
    if (!d) return;
    const { store, camera } = this.app, grid = store.doc.grid, step = grid.snap !== ev.ctrl ? grid.spacing / 2 : 0;
    const r = camera.ray(ev.x, ev.y), L = (v) => formatLength(v, store.doc.units);
    if (d.normal) {
      const t = rayMath.plane(r, d.pivot, d.normal);
      if (t === null || t < 0) return;
      d.delta = v3.sub(rayMath.at(r, t), d.hit0).map((x, k) => (d.normal[k] ? 0 : snap(x, step)));
    } else {
      d.delta = v3.scale(d.axis, snap(rayMath.closestOnLine(r, d.pivot, d.axis) - d.s0, step));
    }
    this.app.setReadout(`ΔX ${L(d.delta[0])}  ΔY ${L(d.delta[1])}  ΔZ ${L(d.delta[2])}`, ev.x, ev.y);
    // Preview with the real geometry, coalescing rapid moves.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.drag) return;
      const body = this.body();
      const node = v3.len(d.delta) > 1e-9 ? { ...body, ops: [...(body.ops || []), this.moveStep(d.pts, d.delta)] } : null;
      this.preview = node && !evaluateBody(node).error ? node : null;
      this.app.invalidate();
    }, 16);
    this.app.invalidate();
  }
  pointerUp() {
    const d = this.drag;
    if (!d) return;
    clearTimeout(this.timer);
    this.drag = null;
    this.app.gizmo.active = null;
    this.app.setReadout(null);
    this.commitMove(d.pts, d.delta);
    this.preview = null;
    this.app.invalidate();
  }
  pointerCancel() {
    clearTimeout(this.timer);
    this.drag = null;
    this.preview = null;
    this.app.gizmo.active = null;
    this.app.setReadout(null);
    this.app.invalidate();
  }

  /** Element selections only make sense for the exact geometry they were picked on. */
  frame() {
    const b = this.body(), g = this.app.gizmo;
    const pts = b && !this.preview ? this.movable() : (this.drag ? this.drag.pts : []);
    g.mode = 'move';
    g.visible = pts.length > 0;
    if (g.visible) {
      let c = pts.reduce((s, p) => v3.add(s, p), [0, 0, 0]);
      c = v3.scale(c, 1 / pts.length);
      if (this.drag) c = v3.add(this.drag.pivot, this.drag.delta);
      g.place(this.app.camera, c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    }
    if (!b) { if (this.bodyId) { this.bodyId = null; this.clear(); this.app.ui.toolPanel.build(); } return; }
    if (this.drag) return;
    const mesh = this.mesh();
    if (mesh !== this.meshRef) { this.meshRef = mesh; this.clear(); this.app.ui.toolPanel.build(); this.app.ui.toolbar.refresh(); }
  }
  /** Corner points of the object: the ends of its open edges (world space). */
  corners() {
    const b = this.body(), model = modelMatrix(b), seen = new Map();
    for (const c of curvesOf(this.mesh())) {
      if (c.closed) continue;
      for (const p of [c.pts[0], c.pts[c.pts.length - 1]]) { const w = m4.point(model, p); seen.set(keyOf(w), w); }
    }
    return [...seen.entries()].map(([key, p]) => ({ key, p }));
  }
  pickAt(ev) {
    const { app } = this, cam = app.camera;
    if (this.element === 'face') {
      const hit = app.pick(ev.x, ev.y);
      return hit && hit.node.id === this.bodyId ? { kind: 'face', face: hit.face, key: `f${hit.face}` } : null;
    }
    if (this.element === 'edge') {
      const e = pickEdge(app, ev, this.bodyId);
      return e ? { kind: 'edge', ...e } : null;
    }
    const front = app.pick(ev.x, ev.y);
    const frontDepth = front ? v3.dot(v3.sub(cam.eye, front.point), cam.back) : Infinity;
    let best = null, bd = pickRadius(ev);
    for (const c of this.corners()) {
      const s = cam.project(c.p), d = Math.hypot(s.x - ev.x, s.y - ev.y);
      const depth = v3.dot(v3.sub(cam.eye, c.p), cam.back);
      if (s.behind || d > bd || depth > frontDepth * 1.01 + cam.worldPerPixel(c.p) * 30) continue;
      bd = d; best = { kind: 'vertex', ...c };
    }
    return best;
  }
  hover(ev) {
    if (!this.body()) { this.app.hoverAt(ev); return; }
    const g = this.app.gizmo, gh = g.hit(ev.x, ev.y, this.app.camera, pickRadius(ev));
    if (gh !== g.hover) { g.hover = gh; this.app.invalidate(); }
    const h = gh ? null : this.pickAt(ev);
    if ((h ? h.key : null) !== (this.hot ? this.hot.key : null)) { this.hot = h; this.app.canvas.style.cursor = h ? 'pointer' : ''; this.app.invalidate(); }
  }
  tap(ev) {
    const { app } = this;
    const bodyHit = app.pick(ev.x, ev.y);
    // No object yet, or a tap on a different object with nothing under the element picker: edit that object.
    const el = this.body() ? this.pickAt(ev) : null;
    if (!el) {
      if (bodyHit && bodyHit.node.id !== this.bodyId) {
        const had = this.faces.length + this.edges.length + this.verts.length;
        // Adding to a selection across objects is never possible: say so instead of silently switching.
        if (had && (ev.shift || ev.ctrl || app.prefs.multiSelect)) {
          toast(`That belongs to a different object (${bodyHit.node.name}). Edit Mode works on one object at a time. To combine faces across two objects, join them first with Add in Object Mode.`);
          return;
        }
        this.setBody(bodyHit.node.id);
        if (this.body()) toast(`Now editing ${bodyHit.node.name}.`);
        return;
      }
      if (!ev.shift && !ev.ctrl && !app.prefs.multiSelect) { this.clear(); this.refresh(); }
      return;
    }
    const additive = ev.shift || ev.ctrl || app.prefs.multiSelect;
    const list = { face: this.faces, edge: this.edges, vertex: this.verts }[el.kind];
    const k = list.findIndex((x) => x.key === el.key);
    if (additive) { if (k >= 0) list.splice(k, 1); else list.push(el); }
    else if (k >= 0 && list.length === 1) list.length = 0;
    else { list.length = 0; list.push(el); }
    this.hot = null;
    this.refresh();
  }
  /**
   * Double-tap an edge (edge selector): select every edge round the face that was tapped.
   * An edge borders two faces; a second double-tap on it switches to the other one.
   */
  doubleTap(ev) {
    const b = this.body();
    if (!b || this.element !== 'edge') return false;
    const e = pickEdge(this.app, ev, this.bodyId);
    if (!e) return false;
    const model = modelMatrix(b), cam = this.app.camera, c = e.curve;
    const loop = (face) => curvesOf(this.mesh()).filter((x) => x.sA === face || x.sB === face).map((x) => edgeItem(b, x, model));
    // Double-tapping the same edge again moves to the face on its other side.
    let face;
    if (this.loopEdge === e.key && (this.loopFace === c.sA || this.loopFace === c.sB)) face = this.loopFace === c.sA ? c.sB : c.sA;
    else {
      // Otherwise the face under the pointer, or the one turned more towards the viewer.
      const hit = this.app.pick(ev.x, ev.y);
      const facing = (n) => v3.dot(v3.norm(m4.dir(model, n)), cam.back);
      face = hit && hit.node.id === b.id && (hit.face === c.sA || hit.face === c.sB) ? hit.face : (facing(c.nA[0]) >= facing(c.nB[0]) ? c.sA : c.sB);
    }
    this.loopFace = face;
    this.loopEdge = e.key;
    this.edges = loop(face);
    this.hot = null;
    this.refresh();
    return true;
  }
  /** Loop cut: split faces with evenly spaced cuts across the one selected edge. */
  startSplit() {
    if (this.edges.length !== 1) { toast('Select exactly one edge to split faces across.'); return; }
    const e = this.edges[0], p = e.curve.pts, a = p[0], z = p[p.length - 1], len = v3.dist(a, z);
    const straight = !e.curve.closed && p.every((q) => v3.len(v3.cross(v3.sub(z, a), v3.sub(q, a))) < 1e-5 * Math.max(1, len * len));
    if (!straight || len < 1e-6) { toast('Splitting needs a straight edge. This one is curved.'); return; }
    this.app.setTool('split', { bodyId: this.bodyId, curve: e.curve });
  }
  cancel() {
    if (this.drag) { this.app.router.cancelPrimary(); return; }
    if (this.faces.length || this.edges.length || this.verts.length) { this.clear(); this.refresh(); }
    else this.app.setMode('object');
  }
  // ---- drawing -------------------------------------------------------------------
  fills(theme) {
    const b = this.body();
    if (!b) return [];
    const mesh = this.mesh(), model = modelMatrix(b), out = [];
    if (this.hot && this.hot.kind === 'face' && !this.faces.some((f) => f.key === this.hot.key)) out.push({ mesh: this.app.faceMesh(mesh, this.hot.face), model, color: [theme.hover[0], theme.hover[1], theme.hover[2], 0.25] });
    for (const f of this.faces) out.push({ mesh: this.app.faceMesh(mesh, f.face), model, color: [theme.select[0], theme.select[1], theme.select[2], 0.55] });
    return out;
  }
  lines(theme) {
    const seg = (e) => { const out = [], n = e.curve.closed ? e.world.length : e.world.length - 1; for (let k = 0; k < n; k++) out.push(...e.world[k], ...e.world[(k + 1) % e.world.length]); return new Float32Array(out); };
    const out = this.edges.map((e) => ({ segments: seg(e), color: theme.select, width: 3.4, onTop: true }));
    if (this.hot && this.hot.kind === 'edge' && !this.edges.some((e) => e.key === this.hot.key)) out.push({ segments: seg(this.hot), color: theme.hover, width: 4, onTop: true });
    return out;
  }
  drawOverlay(g) {
    if (!this.body() || this.element !== 'vertex') return;
    const cam = this.app.camera;
    for (const c of this.corners()) {
      const s = cam.project(c.p);
      if (s.behind) continue;
      const on = this.verts.some((v) => v.key === c.key), hot = this.hot && this.hot.key === c.key;
      g.beginPath(); g.arc(s.x, s.y, on ? 6 : hot ? 5.5 : 3.2, 0, TAU);
      g.fillStyle = on ? g.theme.snap : g.theme.point; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = g.theme.surface; g.stroke();
    }
    if (this.verts.length === 2) {
      const [a, b] = this.verts.map((v) => cam.project(v.p));
      g.setLineDash([5, 4]); g.strokeStyle = g.theme.snap; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      g.label(formatLength(v3.dist(this.verts[0].p, this.verts[1].p), this.app.store.doc.units), (a.x + b.x) / 2, (a.y + b.y) / 2, g.theme.snap, true);
    }
  }
  // ---- panel -----------------------------------------------------------------------
  panel(api) {
    const { app } = this, b = this.body(), u = app.store.doc.units, L = (v) => formatLength(v, u);
    if (!b) return { title: 'Edit Mode', empty: 'Tap an object to edit its geometry.' };
    const title = `Editing ${b.name}`;
    if (this.element === 'face') {
      if (!this.faces.length) return { title, empty: 'Tap a face to select it.' };
      const area = this.faces.reduce((s, f) => s + app.faceArea(b, f.face), 0) / UNITS[u.unit].mm ** 2;
      return { title, empty: `${this.faces.length} ${this.faces.length === 1 ? 'face' : 'faces'} selected. Area ${area.toFixed(u.precision)} ${UNITS[u.unit].label}².`,
        actions: this.faces.length === 1 ? [api.button('Push / pull', () => this.startPushPull(), true)] : [api.button('Combine faces', () => this.combineFaces(), true)] };
    }
    if (this.element === 'edge') {
      if (!this.edges.length) return { title, empty: 'Tap an edge to select it.' };
      let len = 0;
      for (const e of this.edges) { const n = e.curve.closed ? e.world.length : e.world.length - 1; for (let k = 0; k < n; k++) len += v3.dist(e.world[k], e.world[(k + 1) % e.world.length]); }
      const go = (kind) => { const picks = this.edges.slice(), id = this.bodyId; app.setTool(kind); app.tool.preload(id, picks); };
      const note = document.createElement('p');
      note.className = 'tool-note';
      note.textContent = `${this.edges.length} ${this.edges.length === 1 ? 'edge' : 'edges'}, length ${L(len)}`;
      return { title, rows: [...(this.movable().length ? this.moveFields(api) : []), note],
        actions: [...(this.movable().length ? [api.button('Move', () => this.commitMove(this.movable(), this.by.slice()))] : []), api.button('Fillet', () => go('fillet'), true), api.button('Chamfer', () => go('chamfer')), ...(this.edges.length === 1 ? [api.button('Split faces…', () => this.startSplit())] : [])] };
    }
    if (!this.verts.length) return { title, empty: 'Tap a corner point to select it.' };
    const note = document.createElement('p');
    note.className = 'tool-note';
    if (this.verts.length === 2) {
      const [p, q] = this.verts.map((v) => v.p);
      note.textContent = `Distance ${L(v3.dist(p, q))}  (ΔX ${L(q[0] - p[0])}, ΔY ${L(q[1] - p[1])}, ΔZ ${L(q[2] - p[2])})`;
    } else {
      const p = this.verts[this.verts.length - 1].p;
      note.textContent = `${this.verts.length === 1 ? 'Point' : `${this.verts.length} points, last`} at X ${L(p[0])}, Y ${L(p[1])}, Z ${L(p[2])}`;
    }
    return { title, rows: [...this.moveFields(api), note], actions: [api.button('Move', () => this.commitMove(this.movable(), this.by.slice()), true)] };
  }
  /** Typed distances for an exact move. */
  moveFields(api) {
    if (!this.by) this.by = [0, 0, 0];
    return ['X', 'Y', 'Z'].map((axis, k) => api.field({ label: `Move ${axis}`, axis: axis.toLowerCase(), get: () => this.by[k], set: (v) => { this.by[k] = v; } }));
  }
  /** Combine the selected faces into one, if they are coplanar and share edges. */
  combineFaces() {
    if (this.faces.length < 2) { toast('Select two or more neighbouring flat faces to combine.'); return; }
    const body = this.body(), step = { type: 'merge', faces: this.faces.map((f) => f.face) };
    const mesh = evaluateBody({ ...body, ops: [...(body.ops || []), step] });
    if (mesh.error) { toast(mesh.error); return; }
    this.app.store.patch(body.id, 'Combine faces', (n) => { n.ops = [...(n.ops || []), step]; });
    // Leave the new single face selected.
    this.meshRef = this.mesh();
    const face = Math.min(...step.faces);
    this.faces = [{ kind: 'face', face, key: `f${face}` }];
    this.refresh();
  }
  startPushPull() {
    if (this.faces.length !== 1) { toast('Select exactly one face to push or pull.'); return; }
    const face = this.faces[0].face, id = this.bodyId;
    this.app.setTool('pushpull', { bodyId: id, face });
  }
}

// ---------------------------------------------------------------------------
/** Outline of one flat face, as extrusion data in a frame attached to the face. */
export function faceProfile(mesh, face) {
  const pieces = [];
  for (const c of curvesOf(mesh)) {
    if (c.sA !== face && c.sB !== face) continue;
    // Curves are stored with surface A on the left; walk so this face is on the left.
    const pts = c.sA === face ? c.pts : c.pts.slice().reverse();
    const straight = pts.length <= 2 || pts.every((p, k) => k < 2 || v3.len(v3.cross(v3.sub(pts[1], pts[0]), v3.sub(p, pts[0]))) < 1e-6 * v3.dist(pts[1], pts[0]) * Math.max(1, v3.dist(p, pts[0])));
    pieces.push({ pts: c.closed ? [...pts, pts[0]] : pts, curved: !straight });
  }
  if (!pieces.length) return null;
  // Chain the pieces into closed loops.
  const loops = [], left = pieces.slice();
  while (left.length) {
    const first = left.shift(), loop = { pts: first.pts.slice(0, -1), g: first.pts.slice(0, -1).map(() => 0), c: [first.curved ? 1 : 0] };
    let end = first.pts[first.pts.length - 1];
    const start = first.pts[0];
    for (let guard = 0; guard < 10000 && keyOf(end) !== keyOf(start); guard++) {
      const k = left.findIndex((p) => keyOf(p.pts[0]) === keyOf(end));
      if (k < 0) return null;
      const next = left.splice(k, 1)[0];
      loop.c.push(next.curved ? 1 : 0);
      for (const p of next.pts.slice(0, -1)) { loop.pts.push(p); loop.g.push(loop.c.length - 1); }
      end = next.pts[next.pts.length - 1];
    }
    loops.push(loop);
  }
  // Plane of the face from one of its triangles.
  const t = mesh.triFace.indexOf(face), i = mesh.indices[t * 3] * 3;
  const n = v3.norm([mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]);
  const o = loops[0].pts[0];
  const u = v3.norm(v3.sub(loops[0].pts[1], o)), v = v3.cross(n, u);
  let flat = true;
  for (const l of loops) {
    l.p2 = l.pts.map((p) => { const d = v3.sub(p, o); if (Math.abs(v3.dot(d, n)) > 1e-3) flat = false; return [v3.dot(d, u), v3.dot(d, v)]; });
    l.area = polygonArea(l.p2);
  }
  if (!flat) return null;
  const outer = loops.filter((l) => l.area > 0).sort((a, b) => b.area - a.area)[0];
  if (!outer) return null;
  const holes = loops.filter((l) => l.area < 0 && pointInPolygon(l.p2[0], outer.p2));
  // Drop points that only subdivide a straight side (left over from earlier cuts).
  const data = (l) => {
    const m = l.p2.length, p = [], g = [];
    for (let k = 0; k < m; k++) {
      const a = l.p2[(k - 1 + m) % m], b = l.p2[k], c = l.p2[(k + 1) % m];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const straight = Math.abs(cross) < 1e-7 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) + 1e-12;
      if (straight && l.g[(k - 1 + m) % m] === l.g[k] && !l.c[l.g[k]]) continue;
      p.push(Math.round(b[0] * 1e6) / 1e6, Math.round(b[1] * 1e6) / 1e6);
      g.push(l.g[k]);
    }
    return { p, g, c: l.c };
  };
  let cx = 0, cy = 0;
  for (const p of outer.p2) { cx += p[0]; cy += p[1]; }
  cx /= outer.p2.length; cy /= outer.p2.length;
  return { o, u, v, n, loops: [data(outer), ...holes.map(data)], centre: v3.add(o, v3.add(v3.scale(u, cx), v3.scale(v, cy))) };
}

export class PushPullTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'pushpull';
    this.hint = 'Drag the arrow or type a distance. Outward adds material, inward removes it.';
    this.dist = 10;
  }
  activate({ bodyId, face }) {
    this.bodyId = bodyId;
    this.drag = null;
    this.error = null;
    const body = this.body();
    this.profile = body ? faceProfile(evaluateBody(body), face) : null;
    if (!this.profile) this.error = 'Push / pull works on flat faces. This face is curved, or its outline could not be traced.';
    // Unit prism of the face, stretched for the instant preview shown while dragging.
    else this.unit = extrudeMesh({ u: this.profile.u, v: this.profile.v, n: this.profile.n, z0: 0, z1: 1, loops: this.profile.loops });
    this.update();
  }
  deactivate() { this.preview = null; this.app.setReadout(null); }
  body() { return this.app.store.node(this.bodyId); }
  update() {
    this.preview = null;
    const body = this.body(), pr = this.profile;
    if (body && pr && Math.abs(this.dist) > 1e-9) {
      // The prism starts exactly on the face: coincident faces cancel cleanly in the Boolean,
      // whereas a small overlap would slice thin slivers off neighbouring rounded surfaces.
      const out = this.dist > 0, pad = 0;
      const step = {
        type: 'boolean', op: out ? 'union' : 'subtract',
        tool: { type: 'extrude', params: { u: pr.u, v: pr.v, n: pr.n, z0: out ? -pad : this.dist, z1: out ? this.dist : pad, loops: pr.loops } },
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...pr.o.map((x) => Math.round(x * 1e6) / 1e6), 1],
      };
      const node = { ...body, ops: [...(body.ops || []), step] };
      const mesh = evaluateBody(node);
      this.error = mesh.error || null;
      if (!mesh.error) this.preview = node;
    }
    this.app.refreshToolPanel();
    this.app.invalidate();
  }
  override(node) { return !this.drag && this.preview && node.id === this.bodyId ? this.preview : null; }
  /** While dragging, show the swept prism only; the exact result is computed on release. */
  previewItems() {
    const body = this.body(), pr = this.profile;
    if (!this.drag || !body || !pr || Math.abs(this.dist) < 1e-9) return [];
    const local = stretchMatrix(pr.o, pr.n, Math.min(0, this.dist), Math.max(0, this.dist));
    return [{ mesh: this.unit, model: m4.mul(modelMatrix(body), local), color: this.dist > 0 ? [0.56, 0.64, 0.72] : [0.85, 0.42, 0.36] }];
  }
  handle() {
    const body = this.body(), pr = this.profile;
    if (!body || !pr) return null;
    const model = modelMatrix(body), cam = this.app.camera;
    const n = v3.norm(m4.dir(model, pr.n)), base = m4.point(model, v3.addScaled(pr.centre, pr.n, this.dist));
    const len = cam.worldPerPixel(base) * 64, sign = this.dist < 0 ? -1 : 1;
    return { base, n, len, sign, tip: v3.addScaled(base, n, len * sign), scale: v3.len(m4.dir(model, pr.n)) };
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
    const cam = this.app.camera, a = cam.project(hd.base), b = cam.project(v3.addScaled(hd.tip, hd.n, hd.len * 0.2 * hd.sign));
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((ev.x - a.x) * dx + (ev.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(ev.x - (a.x + dx * t), ev.y - (a.y + dy * t)) < pickRadius(ev);
  }
  hover(ev) { const hot = this.overHandle(ev); if (hot !== this.hot) { this.hot = hot; this.app.canvas.style.cursor = hot ? 'pointer' : ''; this.app.invalidate(); } }
  pointerDown(ev) {
    if (!this.overHandle(ev)) return false;
    const hd = this.handle();
    this.drag = { s0: rayMath.closestOnLine(this.app.camera.ray(ev.x, ev.y), hd.base, hd.n), dist0: this.dist, scale: hd.scale || 1, base: hd.base, n: hd.n };
    return true;
  }
  pointerMove(ev) {
    const d = this.drag;
    if (!d) return;
    const g = this.app.store.doc.grid;
    const s = rayMath.closestOnLine(this.app.camera.ray(ev.x, ev.y), d.base, d.n) - d.s0;
    this.dist = snap(d.dist0 + s / d.scale, g.snap !== ev.ctrl ? g.spacing / 2 : 0);
    this.app.setReadout(formatLength(this.dist, this.app.store.doc.units), ev.x, ev.y);
    this.app.refreshToolPanel();
    this.app.invalidate();
  }
  pointerUp() { this.drag = null; this.app.setReadout(null); clearTimeout(this.timer); this.update(); }
  pointerCancel() { if (this.drag) this.dist = this.drag.dist0; this.drag = null; this.app.setReadout(null); this.update(); }
  tap() {}
  cancel() { if (this.drag) this.app.router.cancelPrimary(); else this.app.setTool('edit'); }
  confirm() {
    clearTimeout(this.timer);
    this.update();
    if (this.error) { toast(this.error); return; }
    if (!this.preview) { toast('Set a distance other than zero.'); return; }
    const ops = this.preview.ops, id = this.bodyId;
    this.app.store.patch(id, 'Push / pull', (n) => { n.ops = ops; });
    this.app.setTool('edit');
  }
  panel(api) {
    if (!this.profile) return { title: 'Push / pull', empty: this.error, actions: [api.button('Back', () => this.cancel())] };
    const note = document.createElement('p');
    note.className = 'tool-note';
    const sync = () => { note.textContent = this.error || (this.dist > 0 ? 'Adds material' : 'Removes material'); note.classList.toggle('bad', !!this.error); };
    sync();
    return {
      title: 'Push / pull',
      rows: [api.field({ label: 'Distance', get: () => this.dist, set: (v) => { this.dist = v; this.update(); } }), note],
      actions: [api.button('Cancel', () => this.cancel()), api.button('Apply', () => this.confirm(), true)],
      onSync: sync,
    };
  }
}

// ---------------------------------------------------------------------------
/**
 * Split faces ("loop cut"): evenly spaced cuts across one straight edge, through a single
 * face or all the way round the object. The preview is the real result of the step.
 */
export class SplitTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'split';
    this.hint = 'Choose how many cuts and how far they go. The orange lines show where the faces will be split.';
    this.count = 1;
    this.scope = 'ring';
  }
  activate({ bodyId, curve }) {
    this.bodyId = bodyId;
    this.curve = curve;
    // "This face only" starts on whichever of the edge's two faces is turned towards the viewer.
    const body = this.body(), model = modelMatrix(body), cam = this.app.camera;
    const facing = (n) => v3.dot(v3.norm(m4.dir(model, n)), cam.back);
    this.side = facing(curve.nA[0]) >= facing(curve.nB[0]) ? 0 : 1;
    this.update();
  }
  deactivate() { this.preview = null; this.cuts = null; }
  body() { return this.app.store.node(this.bodyId); }
  face() { return [this.curve.sA, this.curve.sB][this.side]; }
  step() {
    const p = this.curve.pts, round = (q) => q.map((x) => Math.round(x * 1e6) / 1e6);
    return { type: 'split', a: round(p[0]), b: round(p[p.length - 1]), count: this.count, scope: this.scope, face: this.face(), faces: [this.curve.sA, this.curve.sB] };
  }
  update() {
    const body = this.body();
    this.preview = null; this.cuts = null; this.error = null;
    if (body) {
      const node = { ...body, ops: [...(body.ops || []), this.step()] };
      const mesh = evaluateBody(node);
      this.error = mesh.error || null;
      if (!mesh.error) { this.preview = node; this.cuts = mesh.cuts; this.made = new Set(mesh.triFace).size - new Set(evaluateBody(body).triFace).size; }
    }
    this.app.refreshToolPanel();
    this.app.invalidate();
  }
  override(node) { return this.preview && node.id === this.bodyId ? this.preview : null; }
  fills(theme) {
    const body = this.body();
    if (!body || this.scope !== 'face') return [];
    return [{ mesh: this.app.faceMesh(evaluateBody(body), this.face()), model: modelMatrix(body), color: [theme.hover[0], theme.hover[1], theme.hover[2], 0.18] }];
  }
  lines(theme) {
    const body = this.body();
    if (!body) return [];
    const model = modelMatrix(body), p = this.curve.pts;
    const out = [{ segments: new Float32Array([...p[0], ...p[p.length - 1]]), model, color: theme.hover, width: 3.4, onTop: true }];
    if (this.cuts && this.cuts.length) out.push({ segments: this.cuts, model, color: theme.select, width: 3, onTop: true });
    return out;
  }
  tap() {}
  hover() {}
  cancel() { this.app.setTool('edit'); }
  confirm() {
    this.update();
    if (this.error || !this.preview) { toast(this.error || 'Nothing to split.'); return; }
    const ops = this.preview.ops;
    this.app.store.patch(this.bodyId, 'Split faces', (n) => { n.ops = ops; });
    this.app.setTool('edit');
  }
  panel(api) {
    const scope = segmented([{ value: 'ring', label: 'All round' }, { value: 'face', label: 'This face only' }], () => this.scope, (v) => { this.scope = v; this.update(); this.app.ui.toolPanel.build(); }, 'How far the cuts go');
    const note = h('p.tool-note');
    const sync = () => {
      note.textContent = this.error || `${this.count} ${this.count === 1 ? 'cut' : 'cuts'}, evenly spaced: makes ${this.made} new ${this.made === 1 ? 'face' : 'faces'}.`;
      note.classList.toggle('bad', !!this.error);
    };
    sync();
    return {
      title: 'Split faces',
      rows: [
        api.field({ label: 'Cuts', kind: 'count', get: () => this.count, set: (v) => { if (v < 1 || v > 64) return 'Choose between 1 and 64 cuts.'; this.count = v; this.update(); } }),
        h('div.field', { style: 'width:auto' }, h('span.field-label', {}, 'Cut through'), scope.el),
        note,
      ],
      actions: [
        ...(this.scope === 'face' ? [api.button('Other face', () => { this.side = 1 - this.side; this.update(); })] : []),
        api.button('Cancel', () => this.cancel()), api.button('Split', () => this.confirm(), true),
      ],
      onSync: sync,
    };
  }
}
