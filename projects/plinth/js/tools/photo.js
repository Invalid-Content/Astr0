/**
 * tools/photo.js — reference photos for tracing.
 *
 * A photo is a document node (kind 'image') lying flat on one of the main planes:
 *   { plane, src, aspect, w, x, y, rot, opacity }
 * `w` is its width in mm, (x, y) its centre in plane coordinates, `rot` degrees,
 * `aspect` height / width, and `src` a key into store.images (the picture data is
 * kept outside the document so undo snapshots stay small).
 *
 * Photos are only adjustable while this tool is active. Everywhere else they are
 * drawn but never picked, so they cannot get in the way of sketching over them.
 */
import { Tool } from './tools.js';
import { ray as rayMath, DEG } from '../core/math.js';
import { PLANES, to2, to3, imageCorners } from '../geometry/planes.js';
import { formatLength } from '../core/units.js';
import { h, segmented, toast } from '../ui/dom.js';

const reach = (ev) => (ev.type === 'touch' ? 22 : ev.type === 'pen' ? 14 : 11);
const KNOB = 30;   // rotate handle distance above the photo, in screen pixels

export class PhotoTool extends Tool {
  constructor(app) {
    super(app);
    this.id = 'photo';
    this.target = null;      // node id
    this.back = null;        // sketch view to return to when done
    this.drag = null;
    this.cal = null;         // { pts: [[u, v], …] } while setting the scale; u, v in photo widths
    this.fade = null;        // undo token while the opacity slider is moving
  }
  get hint() {
    if (this.cal) return this.cal.pts.length < 2 ? 'Tap two points on the photo whose real distance apart you know.' : 'Type the real distance between the two points.';
    return 'Drag the photo to move it, a corner to resize, the round handle to turn. Drag empty space to orbit.';
  }
  set hint(v) {}

  activate(arg = {}) {
    const { store } = this.app;
    const picked = store.selectedNodes().find((n) => n.kind === 'image');
    this.target = arg.id || (picked && picked.id) || (store.images()[0] || {}).id || null;
    this.back = arg.back || null;
    this.cal = null;
    this.had = !!this.node();
    if (this.target) store.select([this.target]);
  }
  deactivate() {
    if (this.drag) this.pointerCancel();
    this.endFade();
    this.cal = null;
  }
  node() { const n = this.target ? this.app.store.node(this.target) : null; return n && n.kind === 'image' ? n : null; }

  // ---- geometry ----------------------------------------------------------------
  planePoint(ev, node) {
    const pl = PLANES[node.plane], r = this.app.camera.ray(ev.x, ev.y);
    const t = rayMath.plane(r, pl.o, pl.n);
    return t === null ? null : to2(pl, rayMath.at(r, t));
  }
  /** Plane point -> photo coordinates (origin at the centre, x along the width). */
  local(node, p) {
    const a = -node.rot * DEG, dx = p[0] - node.x, dy = p[1] - node.y;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }
  world(node, l) {
    const a = node.rot * DEG;
    return to3(PLANES[node.plane], [node.x + l[0] * Math.cos(a) - l[1] * Math.sin(a), node.y + l[0] * Math.sin(a) + l[1] * Math.cos(a)]);
  }
  knob(node) { return [0, node.w * node.aspect / 2 + KNOB * this.app.camera.worldPerPixel(this.world(node, [0, 0]))]; }
  /** What is under the pointer: a corner, the rotate handle, the photo, or nothing. */
  hit(ev, node) {
    const cam = this.app.camera, r = reach(ev);
    const near = (l) => { const s = cam.project(this.world(node, l)); return !s.behind && Math.hypot(s.x - ev.x, s.y - ev.y) <= r; };
    const hw = node.w / 2, hh = node.w * node.aspect / 2;
    if (near(this.knob(node))) return 'rotate';
    if ([[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].some(near)) return 'scale';
    const p = this.planePoint(ev, node);
    if (!p) return null;
    const l = this.local(node, p);
    return Math.abs(l[0]) <= hw && Math.abs(l[1]) <= hh ? 'move' : null;
  }

  // ---- pointer -------------------------------------------------------------------
  pointerDown(ev) {
    const node = this.node();
    if (!node || this.cal) return false;
    const kind = this.hit(ev, node);
    if (!kind) return false;
    if (this.app.store.isLocked(node)) { toast('This photo is locked. Unlock it in the object list to adjust it.'); return false; }
    const start = this.planePoint(ev, node);
    if (!start) return false;
    this.endFade();
    this.drag = { kind, start, token: this.app.store.begin(), x: node.x, y: node.y, w: node.w, rot: node.rot };
    return true;
  }
  pointerMove(ev) {
    const d = this.drag, node = this.node();
    if (!d || !node) return;
    const p = this.planePoint(ev, node);
    if (!p) return;
    if (d.kind === 'move') {
      node.x = d.x + p[0] - d.start[0];
      node.y = d.y + p[1] - d.start[1];
    } else if (d.kind === 'scale') {
      const from = Math.hypot(d.start[0] - d.x, d.start[1] - d.y) || 1;
      node.w = Math.max(0.1, d.w * Math.hypot(p[0] - d.x, p[1] - d.y) / from);
      this.app.setReadout(`W ${formatLength(node.w, this.app.store.doc.units)}`, ev.x, ev.y);
    } else {
      const turn = (Math.atan2(p[1] - d.y, p[0] - d.x) - Math.atan2(d.start[1] - d.y, d.start[0] - d.x)) / DEG;
      let rot = (((d.rot + turn) % 360) + 540) % 360 - 180;
      const square = Math.round(rot / 90) * 90;
      if (Math.abs(rot - square) < 3) rot = square;       // settle on right angles
      node.rot = rot;
      this.app.setReadout(`${rot.toFixed(1)}°`, ev.x, ev.y);
    }
    this.app.store.touch();
  }
  pointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.app.setReadout(null);
    this.app.store.end(d.token, { move: 'Move photo', scale: 'Resize photo', rotate: 'Rotate photo' }[d.kind]);
  }
  pointerCancel() {
    if (!this.drag) return;
    this.app.store.abort(this.drag.token);
    this.drag = null;
    this.app.setReadout(null);
  }
  tap(ev) {
    const node = this.node();
    if (!node || !this.cal || this.cal.pts.length >= 2) return;
    const p = this.planePoint(ev, node);
    if (!p) return;
    const l = this.local(node, p);
    this.cal.pts.push([l[0] / node.w, l[1] / node.w]);
    this.app.ui.toolPanel.build();
    this.app.ui.status.sync();
    this.app.invalidate();
  }
  hover() {}

  // ---- commands -------------------------------------------------------------------
  patch(label, fn) { if (this.node()) this.app.store.patch(this.target, label, fn); }
  measured() {
    const node = this.node(), c = this.cal;
    if (!node || !c || c.pts.length < 2) return 0;
    return Math.hypot(c.pts[0][0] - c.pts[1][0], c.pts[0][1] - c.pts[1][1]) * node.w;
  }
  startScale() { this.cal = { pts: [] }; this.app.ui.toolPanel.build(); this.app.ui.status.sync(); this.app.invalidate(); }
  stopScale() { this.cal = null; this.app.ui.toolPanel.build(); this.app.ui.status.sync(); this.app.invalidate(); }
  applyScale(real) {
    const got = this.measured();
    if (!(real > 0)) return 'The distance must be more than zero.';
    if (got < 1e-9) return 'The two points are in the same place. Tap two different points.';
    this.patch('Set photo scale', (n) => { n.w *= real / got; });
    toast('Photo resized to true scale.');
    this.stopScale();
    return null;
  }
  endFade() { if (this.fade) { this.app.store.end(this.fade, 'Change photo opacity'); this.fade = null; } }
  remove() {
    const node = this.node();
    if (!node) return;
    this.app.store.remove([node.id]);
    this.target = (this.app.store.images()[0] || {}).id || null;
    if (this.target) this.app.store.select([this.target]);
    this.app.ui.toolPanel.build();
  }
  confirm() { if (this.drag) return; const back = this.back; this.back = null; if (back) this.app.enterSketch(back); else this.app.setTool('select'); }
  cancel() { if (this.drag) this.pointerCancel(); else if (this.cal) this.stopScale(); else this.confirm(); }

  // ---- drawing ----------------------------------------------------------------------
  frame() {
    const has = !!this.node();
    if (has !== this.had) { this.had = has; this.cal = null; this.app.ui.toolPanel.build(); }   // undo removed or restored it
  }
  lines(theme) {
    const node = this.node();
    if (!node) return [];
    const { c3 } = imageCorners(node), seg = [];
    for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0]]) seg.push(...c3[a], ...c3[b]);
    if (!this.cal) seg.push(...this.world(node, [0, node.w * node.aspect / 2]), ...this.world(node, this.knob(node)));
    return [{ segments: new Float32Array(seg), color: theme.select, width: 1.6, onTop: true }];
  }
  drawOverlay(g) {
    const node = this.node();
    if (!node) return;
    const cam = this.app.camera, hw = node.w / 2, hh = node.w * node.aspect / 2;
    const dot = (l, r, fill) => {
      const s = cam.project(this.world(node, l));
      if (s.behind) return null;
      g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = g.theme.accent; g.stroke();
      return s;
    };
    if (!this.cal) {
      if (this.app.store.isLocked(node)) return;
      for (const l of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) dot(l, 5.5, g.theme.surface);
      dot(this.knob(node), 6.5, g.theme.accent);
      return;
    }
    const pts = this.cal.pts.map((p) => dot([p[0] * node.w, p[1] * node.w], 5, g.theme.snap)).filter(Boolean);
    if (pts.length === 2) {
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[1].x, pts[1].y);
      g.strokeStyle = g.theme.snap; g.lineWidth = 1.5; g.stroke();
      g.label(formatLength(this.measured(), this.app.store.doc.units), (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2 - 16, g.theme.snap, true);
    }
  }

  // ---- panel ------------------------------------------------------------------------
  panel(api) {
    const { app } = this, node = this.node();
    const done = api.button('Done', () => this.confirm(), true);
    if (!node) {
      return { title: 'Reference photo', empty: 'No photo in this project yet. Choose one to trace over.', actions: [api.button('Choose a photo…', () => app.choosePhoto(this.back ? app.tools.sketch.plane : 'xy', this.back)), done] };
    }
    if (this.cal) {
      const two = this.cal.pts.length === 2;
      const rows = [h('p.tool-note', {}, two ? 'Type how far apart these two points really are. The photo is resized to match.' : `Tap two points on the photo whose real distance apart you know (${this.cal.pts.length} of 2).`)];
      if (two) rows.push(api.field({ label: 'Real distance', kind: 'length', get: () => this.measured(), set: (v) => this.applyScale(v) }));
      return { title: 'Set photo scale', rows, actions: [api.button('Cancel', () => this.stopScale()), two ? api.button('Pick again', () => this.startScale()) : null].filter(Boolean) };
    }
    const get = () => this.node() || node;
    const plane = segmented([{ value: 'xy', label: 'Top' }, { value: 'xz', label: 'Front' }, { value: 'yz', label: 'Side' }],
      () => get().plane, (v) => this.patch('Move photo to another plane', (n) => { n.plane = v; }), 'Plane');
    const slider = h('input', {
      type: 'range', min: 5, max: 100, step: 1, value: Math.round(node.opacity * 100), 'aria-label': 'Opacity', style: 'width:100%',
      oninput: (e) => {
        const n = this.node();
        if (!n) return;
        if (!this.fade) this.fade = app.store.begin();
        n.opacity = e.target.value / 100;
        app.store.touch();
      },
      onchange: () => this.endFade(),
    });
    return {
      title: node.name,
      rows: [
        h('div.field', { style: 'width:auto' }, h('span.field-label', {}, 'Plane'), plane.el),
        api.field({ label: 'Width', kind: 'length', get: () => get().w, set: (v) => (v > 0 ? void this.patch('Resize photo', (n) => { n.w = v; }) : 'The width must be more than zero.') }),
        api.field({ label: 'Height', kind: 'length', get: () => get().w * get().aspect, set: (v) => (v > 0 ? void this.patch('Resize photo', (n) => { n.w = v / n.aspect; }) : 'The height must be more than zero.') }),
        api.field({ label: 'Turn', kind: 'angle', get: () => get().rot, set: (v) => void this.patch('Rotate photo', (n) => { n.rot = v; }) }),
        h('label.field', { style: 'width:120px' }, h('span.field-label', {}, 'Opacity'), slider),
      ],
      actions: [
        api.button('Delete', () => this.remove(), false, true),
        api.button('Add another…', () => app.choosePhoto(node.plane, this.back)),
        api.button('Set scale…', () => this.startScale()),
        done,
      ],
      onSync: () => { plane.sync(); const n = this.node(); if (n && !this.fade) slider.value = Math.round(n.opacity * 100); },
    };
  }
}
