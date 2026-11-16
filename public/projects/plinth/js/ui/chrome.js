/**
 * ui/chrome.js — top bar, floating toolbar, orientation cube and status hint.
 */
import { h, icon, iconButton, openMenu } from './dom.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { VIEWS } from '../render/camera.js';
import { formatLength } from '../core/units.js';
import { SKETCH_MODES } from '../tools/sketch.js';
import { PLANES } from '../geometry/planes.js';
import { MODES } from '../modes.js';

// ---------------------------------------------------------------------------
export class TopBar {
  constructor(app, el) {
    this.app = app;
    const { store } = app;
    this.name = h('input.project-name', {
      type: 'text', 'aria-label': 'Project name', spellcheck: false, enterKeyHint: 'done',
      onchange: () => store.setSetting((d) => { d.name = this.name.value.trim() || 'Untitled project'; }),
      onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') this.name.blur(); },
    });
    this.undo = iconButton('undo', 'Undo', () => app.undo());
    this.redo = iconButton('redo', 'Redo', () => app.redo());
    this.snap = iconButton('magnet', 'Snap to grid', () => store.setSetting((d) => { d.grid.snap = !d.grid.snap; }));
    this.pencil = iconButton('pencil', 'Pencil and touch', (e) => this.inputMenu(e.currentTarget));
    this.browser = iconButton('list', 'Objects', () => app.togglePanel('browser'));
    this.properties = iconButton('sliders', 'Properties', () => app.togglePanel('properties'));
    el.replaceChildren(
      h('div.bar-group', {},
        h('span.brand', { html: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 18h16v3H4z" fill="currentColor"/><path d="M7 14h10v3H7z" fill="currentColor" opacity=".7"/><path d="M12 3l5 3v5l-5 3-5-3V6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' }),
        this.name),
      h('div.bar-group', {}, this.undo, this.redo),
      h('div.bar-spacer'),
      this.modes = h('div.mode-switch', { role: 'group', 'aria-label': 'Mode' }, ...Object.entries(MODES).map(([id, m]) =>
        h('button', { type: 'button', 'data-mode': id, title: `${m.label} Mode: ${m.about}`, onclick: () => app.setMode(id) }, h('span', { html: icon(m.icon, 18) }), h('span.mode-label', {}, m.label)))),
      h('div.bar-spacer'),
      h('div.bar-group', {},
        this.snap,
        iconButton('layers', 'View and display', (e) => this.viewMenu(e.currentTarget)),
        this.pencil,
        h('span.bar-sep'),
        this.browser, this.properties,
        iconButton('more', 'Project', (e) => this.projectMenu(e.currentTarget))));
    this.sync();
  }
  sync() {
    const { store, prefs } = this.app;
    for (const b of this.modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === this.app.mode));
    if (document.activeElement !== this.name) this.name.value = store.doc.name;
    this.undo.disabled = !store.canUndo();
    this.redo.disabled = !store.canRedo();
    const last = store.undoStack.at(-1), next = store.redoStack.at(-1);
    this.undo.title = last ? `Undo ${last.label.toLowerCase()}` : 'Nothing to undo';
    this.redo.title = next ? `Redo ${next.label.toLowerCase()}` : 'Nothing to redo';
    this.snap.setAttribute('aria-pressed', String(store.doc.grid.snap));
    this.pencil.setAttribute('aria-pressed', String(!!prefs.fingerNav));
    this.browser.setAttribute('aria-pressed', String(!!prefs.browser));
    this.properties.setAttribute('aria-pressed', String(!!prefs.properties));
  }
  viewMenu(anchor) {
    const { app } = this, p = app.prefs, cam = app.camera;
    const mode = (value, label) => ({ label, checked: p.display === value, action: () => app.setPref('display', value) });
    openMenu([
      { heading: 'Display' },
      mode('edges', 'Shaded with edges'), mode('shaded', 'Shaded'), mode('wire', 'Wireframe'), mode('xray', 'X-ray (transparent)'),
      { separator: true },
      { label: 'Grid', checked: p.grid, action: () => app.setPref('grid', !p.grid) },
      { label: 'Axes', checked: p.axes, action: () => app.setPref('axes', !p.axes) },
      { separator: true },
      { heading: 'Projection' },
      { label: 'Perspective', checked: !cam.ortho, action: () => app.setOrtho(false), hint: '5' },
      { label: 'Orthographic', checked: cam.ortho, action: () => app.setOrtho(true), hint: '5' },
      { separator: true },
      { heading: 'Views' },
      ...Object.entries(VIEWS).map(([key, v]) => ({ label: v.label, action: () => cam.setView(key) })),
      { separator: true },
      { label: 'Fit all', icon: 'fit', action: () => app.fitAll(), hint: 'Home' },
      { label: 'Focus selected', icon: 'fit', action: () => app.focusSelection(), hint: 'F', disabled: !app.store.selection.length },
    ], 0, 0, anchor);
  }
  inputMenu(anchor) {
    const { app } = this, p = app.prefs;
    openMenu([
      { heading: 'One finger' },
      { label: 'Uses the active tool', checked: !p.fingerNav, action: () => app.setPref('fingerNav', false) },
      { label: 'Navigates only (Pencil draws)', checked: !!p.fingerNav, action: () => app.setPref('fingerNav', true) },
      { separator: true },
      { heading: 'Two-finger drag' },
      { label: 'Pans (three fingers orbit)', checked: p.twoFingerDrag !== 'orbit', action: () => app.setPref('twoFingerDrag', 'pan') },
      { label: 'Orbits (three fingers pan)', checked: p.twoFingerDrag === 'orbit', action: () => app.setPref('twoFingerDrag', 'orbit') },
    ], 0, 0, anchor);
  }
  projectMenu(anchor) {
    const { app } = this;
    openMenu([
      { label: 'New project', icon: 'file', action: () => app.newProject() },
      { label: 'Load the example scene', icon: 'cube', action: () => app.loadExample() },
      { separator: true },
      { heading: app.store.selectedBodies().length ? 'Export selected objects' : 'Export all visible objects' },
      { label: 'STL', hint: '3D printing', action: () => app.exportAs('stl') },
      { label: '3MF', hint: 'printing, colours', action: () => app.exportAs('3mf') },
      { label: 'OBJ', hint: 'mesh + materials', action: () => app.exportAs('obj') },
      { label: 'GLB', hint: 'glTF, web and AR', action: () => app.exportAs('glb') },
      { heading: 'Export sketches' },
      { label: 'SVG', hint: 'vector, mm', action: () => app.exportAs('svg') },
      { label: 'DXF', hint: 'CAD, laser', action: () => app.exportAs('dxf') },
      { separator: true },
      { label: 'Select all', action: () => app.selectAll(), hint: 'A' },
      { label: 'Reset panel positions', action: () => app.resetPanels() },
    ], 0, 0, anchor);
  }
}

// ---------------------------------------------------------------------------
/**
 * Toolbar buttons by id. A mode lists the ids it offers (modes.js); nothing
 * outside that list is shown, so incompatible tools cannot be triggered.
 */
// Selection tests used to decide which tools are worth showing.
const bodies = (app) => app.store.selectedBodies().length;
const editSel = (app, kind) => (app.tools.edit.body() && app.tools.edit.element === kind.slice(0, 4) ? app.tools.edit[kind].length : 0);

const TOOL_BUTTONS = {
  select: { icon: 'select', label: 'Select (V)', tool: 'select' },
  // Transform tools need at least one object.
  move: { icon: 'move', label: 'Move (G)', tool: 'move', when: (app) => bodies(app) >= 1 },
  rotate: { icon: 'rotate', label: 'Rotate (R)', tool: 'rotate', when: (app) => bodies(app) >= 1 },
  scale: { icon: 'scale', label: 'Scale (S)', tool: 'scale', when: (app) => bodies(app) >= 1 },
  // Extrude needs a closed sketch face.
  extrude: { icon: 'extrude', label: 'Extrude the selected sketch face (E)', tool: 'extrude', when: (app) => app.store.regionSel.length >= 1 },
  // Booleans need exactly two objects: target first, then the second object.
  union: { icon: 'union', label: 'Add: join the two selected objects into one solid', tool: 'union', when: (app) => bodies(app) === 2 },
  subtract: { icon: 'subtract', label: 'Subtract: cut the second selected object out of the first', tool: 'subtract', when: (app) => bodies(app) === 2 },
  intersect: { icon: 'intersect', label: 'Intersect: keep only the volume the two selected objects share', tool: 'intersect', when: (app) => bodies(app) === 2 },
  // Fillet and chamfer: one object in Object Mode, selected edges in Edit Mode.
  fillet: { icon: 'fillet', label: 'Fillet edges', tool: 'fillet', run: (app) => blend(app, 'fillet'), when: (app) => (app.mode === 'edit' ? editSel(app, 'edges') >= 1 : bodies(app) === 1) },
  chamfer: { icon: 'chamfer', label: 'Chamfer edges', tool: 'chamfer', run: (app) => blend(app, 'chamfer'), when: (app) => (app.mode === 'edit' ? editSel(app, 'edges') >= 1 : bodies(app) === 1) },
  pushpull: { icon: 'pushpull', label: 'Push / pull the selected face', run: (app) => app.tools.edit.startPushPull(), tool: 'pushpull', when: (app) => editSel(app, 'faces') === 1 },
  split: { icon: 'split', label: 'Split faces across the selected edge (loop cut)', run: (app) => app.tools.edit.startSplit(), tool: 'split', when: (app) => editSel(app, 'edges') === 1 },
  combine: { icon: 'combine', label: 'Combine the selected flat faces into one', run: (app) => app.tools.edit.combineFaces(), when: (app) => editSel(app, 'faces') >= 2 },
  vertex: { icon: 'vertex', label: 'Select points (1)', element: 'vertex' },
  edge: { icon: 'edge', label: 'Select edges (2)', element: 'edge' },
  face: { icon: 'face', label: 'Select faces (3)', element: 'face' },
  multi: { icon: 'multi', label: 'Multi-select: taps add to the selection', run: (app) => app.setPref('multiSelect', !app.prefs.multiSelect), pressed: (app) => !!app.prefs.multiSelect, when: (app) => app.store.bodies().length >= 2 || app.mode === 'edit' },
  add: { icon: 'add', label: 'Add a shape', menu: 'addMenu', accent: true, tool: 'create' },
  photo: { icon: 'photo', label: 'Add a reference photo to trace over', run: (app) => app.choosePhoto('xy'), tool: 'photo' },
};
/** Start fillet / chamfer; from Edit Mode, carry the selected edges across. */
function blend(app, kind) {
  const edit = app.tools.edit, picks = app.mode === 'edit' ? edit.edges.slice() : [], id = edit.bodyId;
  app.setTool(kind);
  if (picks.length) app.tool.preload(id, picks);
}

export class Toolbar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.buttons = {};
    this.build();
  }
  /** Rebuild for the current mode. */
  build() {
    const { app } = this, groups = MODES[app.mode].groups, out = [];
    this.buttons = {};
    const signature = [];
    for (const group of groups) {
      // Show a tool only when it can act on the current selection (or is the one in use).
      const shown = group.filter((id) => { const d = TOOL_BUTTONS[id]; return !d.when || d.when(app) || d.tool === app.tool.id; });
      if (!shown.length) continue;
      if (out.length) out.push(h('span.tool-sep'));
      signature.push(shown.join(','));
      for (const id of shown) {
        const def = TOOL_BUTTONS[id];
        const b = iconButton(def.icon, def.label, (e) => {
          if (def.menu) this[def.menu](e.currentTarget);
          else if (def.element) { if (app.tool.id !== 'edit') app.setTool('edit'); app.tools.edit.setElement(def.element); }
          else if (def.run) def.run(app);
          else app.setTool(def.tool);
        }, def.accent ? { className: 'icon-btn accent' } : {});
        this.buttons[id] = b;
        out.push(b);
      }
    }
    this.shown = signature.join('|');
    this.el.replaceChildren(...out);
    this.el.hidden = !out.length;
    this.sync();
  }
  /** Rebuild only if the set of relevant tools changed (selection or document changed). */
  refresh() {
    const { app } = this;
    const now = MODES[app.mode].groups.map((g) => g.filter((id) => { const d = TOOL_BUTTONS[id]; return !d.when || d.when(app) || d.tool === app.tool.id; })).filter((g) => g.length).map((g) => g.join(',')).join('|');
    if (now !== this.shown) this.build(); else this.sync();
  }
  sync() {
    const { app } = this, id = app.tool.id;
    for (const [key, b] of Object.entries(this.buttons)) {
      const def = TOOL_BUTTONS[key];
      const on = def.pressed ? def.pressed(app) : def.element ? app.tools.edit.element === def.element && id === 'edit' : def.tool === id;
      b.setAttribute('aria-pressed', String(on));
    }
  }
  addMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const portrait = r.top > innerHeight * 0.6;
    openMenu([{ heading: 'Add a shape' }, ...Object.entries(PRIMITIVES).map(([type, def]) => ({
      label: def.label, icon: def.icon, action: () => this.app.setTool('create', type),
    }))], portrait ? r.left : r.right + 8, portrait ? r.top - 380 : r.top - 120);
  }
}

// ---------------------------------------------------------------------------
const FACES = [
  { view: 'top', n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
  { view: 'bottom', n: [0, 0, -1], r: [1, 0, 0], u: [0, -1, 0] },
  { view: 'front', n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] },
  { view: 'back', n: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1] },
  { view: 'right', n: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1] },
  { view: 'left', n: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1] },
];

/** Orientation cube built from six CSS-transformed faces. Tap a face to snap the view; drag to orbit. */
export class ViewCube {
  constructor(app, el) {
    this.app = app;
    this.size = 56;
    this.cube = h('div.cube');
    this.faces = FACES.map((f) => {
      const face = h('button.cube-face', { type: 'button', 'aria-label': `Sketch on the ${VIEWS[f.view].label.toLowerCase()} view`, title: 'Tap to sketch on this plane', 'data-view': f.view }, VIEWS[f.view].label);
      this.cube.append(face);
      return face;
    });
    this.proj = h('button.chip', { type: 'button', title: 'Switch between perspective and orthographic (5)', onclick: () => { if (app.tool.id !== 'sketch') app.setOrtho(!app.camera.ortho); } });
    el.replaceChildren(this.cube, h('div.cube-actions', {},
      iconButton('cube', 'Isometric 3D view', () => { app.exitSketch(); app.camera.setView('iso'); }),
      iconButton('fit', 'Fit all (Home)', () => app.fitAll()),
      this.proj));
    let drag = null;
    this.cube.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false, view: e.target.dataset.view };
      this.cube.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.cube.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      app.camera.orbit(dx * 1.6, dy * 1.6);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = () => {
      // Tapping a face of the cube opens that plane for sketching.
      if (drag && !drag.moved && drag.view) app.enterSketch(drag.view);
      drag = null;
    };
    this.cube.addEventListener('pointerup', end);
    this.cube.addEventListener('pointercancel', () => { drag = null; });
    this.update();
  }
  update() {
    const cam = this.app.camera, hs = this.size / 2;
    // World → CSS space: x right, y down, z toward the viewer.
    const toCss = (v) => [
      v[0] * cam.right[0] + v[1] * cam.right[1] + v[2] * cam.right[2],
      -(v[0] * cam.up[0] + v[1] * cam.up[1] + v[2] * cam.up[2]),
      v[0] * cam.back[0] + v[1] * cam.back[1] + v[2] * cam.back[2],
    ];
    FACES.forEach((f, k) => {
      const cx = toCss(f.r), cy = toCss(f.u.map((v) => -v)), cz = toCss(f.n);
      const t = cz.map((v) => v * hs);
      const m = [cx[0], cx[1], cx[2], 0, cy[0], cy[1], cy[2], 0, cz[0], cz[1], cz[2], 0, t[0], t[1], t[2], 1];
      const el = this.faces[k];
      el.style.transform = `matrix3d(${m.map((v) => v.toFixed(5)).join(',')})`;
      // Fade faces that point away so the cube reads as solid.
      el.style.visibility = cz[2] > -0.02 ? 'visible' : 'hidden';
      el.style.opacity = String(0.55 + 0.45 * Math.max(0, cz[2]));
    });
    this.proj.textContent = cam.ortho ? 'Ortho' : 'Persp';
  }
}

// ---------------------------------------------------------------------------
/** Sketch toolbar: shown only in sketch mode, with the drawing tools and the way out. */
export class SketchBar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.buttons = {};
    this.plane = h('span.sketch-plane');
    const tools = SKETCH_MODES.map((m) => (this.buttons[m.id] = iconButton(m.icon, m.label, () => app.tools.sketch.setMode(m.id))));
    el.replaceChildren(this.plane, h('span.bar-sep'), h('div.sketch-tools', {}, ...tools), h('span.bar-sep'),
      iconButton('photo', 'Reference photo: add one to trace over, or adjust the one on this plane', () => app.photoFromSketch()),
      h('button.btn.primary', { type: 'button', onclick: () => app.exitSketch() }, 'Done'));
    this.sync();
  }
  sync() {
    const tool = this.app.tools.sketch, on = this.app.tool.id === 'sketch';
    this.el.hidden = !on;
    if (!on) return;
    this.plane.textContent = PLANES[tool.plane].label;
    for (const [id, b] of Object.entries(this.buttons)) b.setAttribute('aria-pressed', String(id === tool.mode));
  }
}

// ---------------------------------------------------------------------------
export class StatusBar {
  constructor(app, el) {
    this.app = app;
    this.hint = h('span.hint-text');
    this.grid = h('span.hint-grid');
    el.replaceChildren(this.hint, this.grid);
  }
  sync() {
    const { app } = this;
    this.hint.textContent = app.tool.hint;
    const minor = app.renderer.gridMinor || app.store.doc.grid.spacing;
    const text = app.prefs.grid ? `Grid ${formatLength(minor, app.store.doc.units)}` : '';
    if (this.grid.textContent !== text) this.grid.textContent = text;
  }
}
