/**
 * app.js — composition root. Creates the subsystems and wires them together:
 *
 *   document/store   project data, selection, undo history
 *   geometry/kernel  feature → mesh evaluation and ray casting
 *   render/*         WebGL2 renderer, camera, gizmo
 *   input/*          pointer routing for Pencil, touch and mouse
 *   tools/*          select, transform and create tools
 *   ui/*             top bar, toolbar, panels, menus
 *   storage/*        autosave
 *
 * Subsystems talk to each other only through this object.
 */
import { v3, m4, ray as rayMath } from './core/math.js';
import { Store, emptyDocument } from './document/store.js';
import { evaluate, evaluateBody, raycastMesh, setResolver } from './geometry/kernel.js';
import { PRIMITIVES } from './geometry/primitives.js';
import { Camera, VIEWS } from './render/camera.js';
import { PLANES, VIEW_PLANE, to2, sketchData, imageCorners } from './geometry/planes.js';
import { pointInRegion } from './geometry/sketch2d.js';
import { Renderer, hexToRgb } from './render/renderer.js';
import { Gizmo } from './render/gizmo.js';
import { PointerRouter } from './input/pointer-router.js';
import { SelectTool, TransformTool, CreateTool, modelMatrix } from './tools/tools.js';
import { SketchTool } from './tools/sketch.js';
import { ExtrudeTool, BlendTool } from './tools/model.js';
import { BooleanTool } from './tools/boolean.js';
import { EditTool, PushPullTool, SplitTool } from './tools/edit.js';
import { MODES } from './modes.js';
import { toast, openMenu, closeMenu } from './ui/dom.js';
import { Browser, Properties, ToolPanel } from './ui/panels.js';
import { TopBar, Toolbar, SketchBar, ViewCube, StatusBar } from './ui/chrome.js';
import { loadAutosave, saveAutosave } from './storage/autosave.js';
import { PhotoTool } from './tools/photo.js';
import { curvesOf } from './geometry/topology.js';
import { exportModel, exportSketches, zip, safe } from './io/export.js';

const PREF_KEY = 'plinth.prefs';
const DEFAULT_PREFS = {
  display: 'edges', grid: true, axes: true,
  fingerNav: false, twoFingerDrag: 'pan', multiSelect: false,
  browser: true, properties: true, browserPos: null, propertiesPos: null,
};

const THEMES = {
  light: {
    background: [0.918, 0.927, 0.941], gridMinor: [0.1, 0.16, 0.3, 0.1], gridMajor: [0.1, 0.16, 0.3, 0.2],
    edge: [0.07, 0.09, 0.13, 0.85], wireEdge: [0.07, 0.09, 0.13, 0.85],
    select: [1, 0.45, 0.08, 1], hover: [0.16, 0.42, 0.95, 0.85],
    sketch: [0.1, 0.33, 0.85, 1], sketchOpen: [0.72, 0.3, 0.62, 1], sketchCons: [0.35, 0.4, 0.5, 0.6],
    preview: [0.1, 0.33, 0.85, 1], bad: [0.8, 0.15, 0.1, 1],
    css: { point: '#1a54d9', accent: '#1a54d9', snap: '#c2410c', good: '#15803d', surface: '#ffffff', label: '#14171d', labelText: '#ffffff' },
  },
  dark: {
    background: [0.098, 0.106, 0.125], gridMinor: [0.7, 0.8, 1, 0.07], gridMajor: [0.7, 0.8, 1, 0.15],
    edge: [0.03, 0.04, 0.06, 0.9], wireEdge: [0.82, 0.86, 0.94, 0.8],
    select: [1, 0.55, 0.15, 1], hover: [0.45, 0.65, 1, 0.9],
    sketch: [0.5, 0.68, 1, 1], sketchOpen: [0.9, 0.55, 0.85, 1], sketchCons: [0.65, 0.7, 0.8, 0.55],
    preview: [0.6, 0.76, 1, 1], bad: [1, 0.42, 0.35, 1],
    css: { point: '#8fb0ff', accent: '#8fb0ff', snap: '#fdba74', good: '#86efac', surface: '#1b1d23', label: '#e8ebf1', labelText: '#14171d' },
  },
};

class App {
  constructor() {
    this.prefs = { ...DEFAULT_PREFS, ...this.readPrefs() };
    this.prefs.multiSelect = false;
    if (innerWidth < 720) { this.prefs.browser = false; this.prefs.properties = false; }
    this.store = new Store();
    this.camera = new Camera();
    this.canvas = document.getElementById('viewport');
    this.renderer = new Renderer(this.canvas);
    this.pictures = new Map();        // photo key -> { ready, source } decoded for drawing
    this.__curvesOf = curvesOf;
    this.gizmo = new Gizmo();
    this.hoverId = null;
    this.dirty = false;

    this.tools = {
      select: new SelectTool(this),
      move: new TransformTool(this, 'move'),
      rotate: new TransformTool(this, 'rotate'),
      scale: new TransformTool(this, 'scale'),
      create: new CreateTool(this),
      sketch: new SketchTool(this),
      extrude: new ExtrudeTool(this),
      fillet: new BlendTool(this, 'fillet'),
      chamfer: new BlendTool(this, 'chamfer'),
      union: new BooleanTool(this, 'union'),
      subtract: new BooleanTool(this, 'subtract'),
      intersect: new BooleanTool(this, 'intersect'),
      edit: new EditTool(this),
      pushpull: new PushPullTool(this),
      photo: new PhotoTool(this),
      split: new SplitTool(this),
    };
    this.mode = 'object';
    setResolver((id) => this.store.node(id));
    this.hoverFace = null;
    this.bodyFace = null;          // selected face of a solid: { id, face, mesh }
    this.hoverBodyFace = null;
    this.faceMeshes = new WeakMap();
    this.tool = this.tools.select;

    this.router = new PointerRouter(this.canvas, {
      camera: this.camera,
      prefs: this.prefs,
      tool: () => this.tool,
      onHover: (ev) => { this.showPenCursor(ev); this.tool.hover(ev); },
      onHoverEnd: () => { this.showPenCursor(null); this.setHover(null); if (this.hoverBodyFace || this.hoverFace) { this.hoverBodyFace = null; this.hoverFace = null; this.invalidate(); } },
      onContextMenu: (ev) => this.contextMenuAt(ev),
      onDoubleTap: (ev) => { if (!(this.tool.doubleTap && this.tool.doubleTap(ev))) this.focusAt(ev); },
      onPenDetected: () => this.penDetected(),
      onNavigate: () => closeMenu(),
    });

    const $ = (id) => document.getElementById(id);
    this.readout = $('readout');
    this.overlay = $('overlay');
    this.penCursor = $('pen-cursor');
    this.ui = {
      top: new TopBar(this, $('topbar')),
      toolbar: new Toolbar(this, $('toolbar')),
      sketchBar: new SketchBar(this, $('sketchbar')),
      browser: new Browser(this, $('browser')),
      properties: new Properties(this, $('properties')),
      toolPanel: new ToolPanel(this, $('toolpanel')),
      cube: new ViewCube(this, $('viewcube')),
      status: new StatusBar(this, $('hint')),
    };
    this.applyPanelPrefs();
    this.ui.toolPanel.build();

    this.store.on('change', (info = {}) => this.onDocChange(info));
    this.store.on('selection', () => this.onSelection());
    this.camera.onChange = () => this.invalidate();

    new ResizeObserver(() => this.resize()).observe(this.canvas);
    // Dropping an image file on the viewport adds it as a reference photo.
    this.canvas.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    this.canvas.addEventListener('drop', (e) => {
      const file = e.dataTransfer && [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      const sketching = this.tool.id === 'sketch';
      this.importPhoto(file, sketching ? this.tools.sketch.plane : 'xy', sketching ? this.lastSketchView : null);
    });
    addEventListener('keydown', (e) => this.onKey(e));
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', () => this.applyTheme());
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });

    this.applyTheme();
    this.resize();
    this.ui.status.sync();
  }

  // ---- startup -------------------------------------------------------------
  async start() {
    const saved = await loadAutosave();
    const photos = await loadAutosave('photos');
    if (photos) { this.store.photos = new Map(Object.entries(photos)); this.photoKeys = Object.keys(photos).sort().join(','); }
    if (saved && saved.doc && Array.isArray(saved.doc.nodes)) {
      this.store.load(saved.doc);
      this.camera.setPose(saved.camera);
    } else {
      this.loadExample(false);
    }
    this.invalidate();
  }
  /** A small starter assembly so the app opens in a working state. */
  loadExample(announce = true) {
    const doc = emptyDocument('Example assembly');
    const add = (name, type, params, p, color) => doc.nodes.push({
      id: doc.nextId++, kind: 'body', name, parent: null, visible: true, locked: false, color,
      feature: { type, params }, transform: { p, q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    add('Base plate', 'box', { width: 90, depth: 60, height: 10 }, [0, 0, 5], '#8fa3b8');
    add('Post', 'cylinder', { radius: 12, height: 40 }, [-22, 0, 30], '#c98f5a');
    add('Collar', 'torus', { radius: 16, tube: 4 }, [-22, 0, 14], '#d0b25f');
    add('Hex boss', 'prism', { sides: 6, radius: 12, height: 14 }, [24, 8, 17], '#7fae8b');
    this.store.load(doc);
    this.camera.setPose({ az: -52, el: 28, target: [0, 0, 18], distance: 330, ortho: false });
    if (announce) toast('Example scene loaded.');
    this.scheduleSave();
  }
  newProject() {
    this.setTool('select');
    this.store.photos.clear();
    this.pictures.clear();
    this.store.load(emptyDocument());
    this.camera.setPose({ az: -45, el: 30, target: [0, 0, 0], distance: 300, ortho: false });
    toast('New project. The previous one is no longer stored.');
    this.scheduleSave();
  }

  // ---- preferences -----------------------------------------------------------
  readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
  }
  setPref(key, value) {
    this.prefs[key] = value;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch { /* storage unavailable */ }
    this.ui.top.sync();
    this.ui.toolbar.sync();
    this.ui.status.sync();
    this.invalidate();
  }
  togglePanel(key, on = !this.prefs[key]) {
    this.setPref(key, on);
    this.applyPanelPrefs();
  }
  applyPanelPrefs() {
    for (const key of ['browser', 'properties']) {
      const el = document.getElementById(key), pos = this.prefs[`${key}Pos`];
      el.hidden = !this.prefs[key];
      if (pos && innerWidth >= 720) Object.assign(el.style, { left: pos[0] + 'px', top: pos[1] + 'px', right: 'auto' });
      else Object.assign(el.style, { left: '', top: '', right: '' });
    }
  }
  resetPanels() {
    this.prefs.browserPos = this.prefs.propertiesPos = null;
    this.prefs.browser = this.prefs.properties = true;
    this.setPref('browser', true);
    this.applyPanelPrefs();
  }
  penDetected() {
    if (this.prefs.penSeen) return;
    // First Pencil contact: reserve fingers for navigation, as in Pencil-first apps.
    this.prefs.penSeen = true;
    this.setPref('fingerNav', true);
    toast('Pencil detected. Fingers now navigate; the Pencil selects and draws. Change this under the pencil icon.');
  }
  applyTheme() {
    const name = getComputedStyle(document.documentElement).getPropertyValue('--theme').trim() === 'dark' ? 'dark' : 'light';
    this.renderer.setTheme(THEMES[name]);
    this.invalidate();
  }

  // ---- reference photos ---------------------------------------------------------
  /** Decoded picture for a photo key, or null while it is still loading. */
  picture(key) {
    const have = this.pictures.get(key);
    if (have) return have.ready ? have.source : null;
    const data = this.store.photos.get(key);
    if (!data) return null;
    const img = new Image(), entry = { ready: false, source: img };
    this.pictures.set(key, entry);
    img.onload = () => { entry.ready = true; this.invalidate(); };
    img.src = data;
    return null;
  }
  /** Ask for an image file, then place it on `plane`. `back` = sketch view to return to afterwards. */
  choosePhoto(plane = 'xy', back = null) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => { if (input.files[0]) this.importPhoto(input.files[0], plane, back); };
    input.click();
  }
  async importPhoto(file, plane = 'xy', back = null) {
    if (!file.type.startsWith('image/')) { toast('That file is not an image. Choose a JPEG, PNG or similar.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      // Keep photos to a size every device handles, and store them with the project.
      const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      const png = file.type === 'image/png';
      const g = canvas.getContext('2d');
      if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); }
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      const key = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.store.photos.set(key, canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86));
      this.pictures.set(key, { ready: true, source: canvas });
      // Start at about half the width of the view, centred on what the camera is looking at.
      const cam = this.camera, pl = PLANES[plane];
      const aspect = canvas.height / canvas.width;
      const span = cam.worldPerPixel() * Math.min(cam.width, cam.height / aspect) * 0.55;
      const w = Number(Math.max(1, span).toPrecision(2));
      const c = [0, 1, 2].map((i) => cam.target[i] - pl.o[i]);
      const dot = (a) => c[0] * a[0] + c[1] * a[1] + c[2] * a[2];
      let id = null;
      this.store.commit('Add photo', (doc) => {
        id = doc.nextId++;
        doc.nodes.push({ id, kind: 'image', name: this.store.uniqueName((file.name || 'Photo').replace(/\.[^.]+$/, '') || 'Photo'), parent: null, visible: true, locked: false,
          plane, src: key, aspect, w, x: dot(pl.u), y: dot(pl.v), rot: 0, opacity: 0.6 });
      });
      this.store.select([id]);
      this.setTool('photo', { id, back });
      toast('Photo added. Move and size it, then use Set scale to make it true size.');
    } catch {
      toast('That image could not be opened. Try a JPEG or PNG.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  /** Sketch bar button: adjust the photo on this sketch plane, or add one. */
  photoFromSketch() {
    const plane = this.tools.sketch.plane, back = this.lastSketchView;
    const here = this.store.images().find((n) => n.plane === plane && this.store.isVisible(n));
    if (here) this.setTool('photo', { id: here.id, back }); else this.choosePhoto(plane, back);
  }

  // ---- rendering -------------------------------------------------------------
  invalidate() {
    if (this.dirty || this.inFrame) return;
    this.dirty = true;
    requestAnimationFrame((now) => this.renderFrame(now));
  }
  resize() {
    const { width, height } = this.renderer.resize();
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
    this.camera.setViewport(width, height);
    this.invalidate();
  }
  /** Ids that should draw as selected: selected bodies plus bodies inside selected collections. */
  selectedSet() {
    const set = new Set(this.store.selection);
    for (const id of this.store.selection) for (const d of this.store.descendants(id)) set.add(d.id);
    return set;
  }
  renderFrame(now) {
    this.dirty = false;
    this.inFrame = true;                // camera updates below must not queue extra frames
    const animating = this.camera.tick(now);
    const { store } = this;
    const selected = this.selectedSet();
    const items = [];
    let radius = 100;
    const theme = this.renderer.theme, sketching = this.tool.id === 'sketch' ? this.tool.plane : null;
    for (const real of store.bodies()) {
      if (!store.isVisible(real)) continue;
      // A tool may substitute a preview of the body (fillet and chamfer do).
      const node = (this.tool.override && this.tool.override(real)) || real;
      const mesh = evaluateBody(node);
      const style = (this.tool.itemStyle && this.tool.itemStyle(real)) || (real.role === 'cutter' ? { alpha: 0.2 } : null);
      if (style && style.hide) continue;
      const item = { mesh, model: modelMatrix(node), color: hexToRgb(node.color), selected: selected.has(node.id), hovered: node.id === this.hoverId };
      // Linked cutters and the second object of a Boolean are drawn see-through.
      if (style) Object.assign(item, { ghost: true, plain: true, alpha: style.alpha, color: style.color || item.color });
      items.push(item);
      radius = Math.max(radius, v3.len(node.transform.p) + v3.len(v3.mul(v3.sub(mesh.max, mesh.min), node.transform.s)));
    }
    for (const it of this.tool.previewItems()) {
      // A preview is either a node to evaluate, or a ready mesh with its own matrix (fast previews).
      if (it.mesh) items.push({ mesh: it.mesh, model: it.model, color: it.color, ghost: true });
      else items.push({ mesh: evaluateBody(it.node), model: modelMatrix(it.node), color: hexToRgb(it.node.color), ghost: it.ghost });
    }
    if (Math.abs(radius - this.camera.sceneRadius) > 1) { this.camera.sceneRadius = radius; this.camera.update(); }
    // Sketches: closed profiles get a translucent fill; open ones are drawn in a different colour.
    const fills = [], lines = [];
    for (const sk of store.sketches()) {
      if (!store.isVisible(sk)) continue;
      const d = sketchData(sk), onTop = sk.plane === sketching, picked = selected.has(sk.id);
      d.fills.forEach((mesh, index) => {
        const sel = store.regionSel.some((r) => r.sketch === sk.id && r.index === index);
        const hov = this.hoverFace && this.hoverFace.sketch === sk.id && this.hoverFace.index === index;
        const c = sel ? theme.select : theme.sketch;
        fills.push({ mesh, color: [c[0], c[1], c[2], sel ? 0.45 : hov ? 0.3 : 0.13] });
      });
      lines.push({ segments: d.closedSeg, color: picked ? theme.select : theme.sketch, width: 1.8, onTop },
        { segments: d.openSeg, color: picked ? theme.select : theme.sketchOpen, width: 1.8, onTop },
        { segments: d.consSeg, color: theme.sketchCons, width: 1.1, onTop });
    }
    // Selected / hovered face of a solid.
    for (const [bf, alpha, c] of [[this.hoverBodyFace, 0.22, theme.hover], [this.bodyFace, 0.55, theme.select]]) {
      const node = bf && store.node(bf.id);
      if (!node || !store.isVisible(node)) continue;
      const mesh = evaluateBody(node);
      if (bf === this.bodyFace && mesh !== bf.mesh) { this.bodyFace = null; continue; }
      fills.push({ mesh: this.faceMesh(mesh, bf.face), model: modelMatrix(node), color: [c[0], c[1], c[2], alpha] });
    }
    // Reference photos, and an outline round any that are selected in the object list.
    const images = [];
    for (const node of store.images()) {
      if (!store.isVisible(node)) continue;
      const source = this.picture(node.src);
      const { c3 } = imageCorners(node);
      if (source) images.push({ key: node.src, source, corners: c3, alpha: node.opacity });
      if (selected.has(node.id) && this.tool.id !== 'photo') {
        lines.push({ segments: new Float32Array([0, 1, 1, 3, 3, 2, 2, 0].flatMap((k) => c3[k])), color: theme.select, width: 1.6, onTop: true });
      }
    }
    this.tool.frame();
    if (this.tool.fills) fills.push(...this.tool.fills(theme));
    if (this.tool.lines) lines.push(...this.tool.lines(theme));
    this.renderer.render(this.camera, {
      items, fills, lines, images,
      display: this.prefs.display,
      grid: { visible: this.prefs.grid || !!sketching, spacing: store.doc.grid.spacing, plane: sketching ? PLANES[sketching] : PLANES.xy, boost: sketching ? 2 : 1 },
      axes: this.prefs.axes,
      overlay: (draw) => { this.gizmo.draw(draw); if (this.tool.drawGizmo) this.tool.drawGizmo(draw); },
    });
    this.drawOverlay();
    this.ui.cube.update();
    this.ui.status.sync();
    this.inFrame = false;
    if (animating) this.invalidate();
  }

  // ---- picking ---------------------------------------------------------------
  /** Nearest visible, unlocked body under a viewport point. */
  pick(x, y) {
    const r = this.camera.ray(x, y), { store } = this;
    let best = null;
    for (const node of store.bodies()) {
      if (!store.isVisible(node) || store.isLocked(node)) continue;
      const mesh = evaluateBody(node), model = modelMatrix(node), inv = m4.invert(model);
      const o = m4.point(inv, r.o), d = m4.dir(inv, r.d);
      if (!rayMath.aabb({ o, d }, mesh.min, mesh.max)) continue;
      const hit = raycastMesh(mesh, o, d);
      if (hit && (!best || hit.t < best.t)) {
        const nm = m4.normalMatrix(model), n = hit.normal;
        let normal = v3.norm([nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2], nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2], nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2]]);
        if (v3.dot(normal, r.d) > 0) normal = v3.scale(normal, -1);
        best = { t: hit.t, node, face: hit.face, normal, point: rayMath.at(r, hit.t) };
      }
    }
    return best;
  }
  /** Point on the ground plane (Z = 0) under a viewport point, or null. */
  groundPoint(x, y) {
    const r = this.camera.ray(x, y);
    const t = rayMath.plane(r, [0, 0, 0], [0, 0, 1]);
    if (t === null || t < 0 || t > this.camera.distance * 40 + 1e4) return null;
    return rayMath.at(r, t);
  }
  snapStep() { return this.store.doc.grid.spacing; }
  /** The triangles of one face of a body mesh, as a drawable mesh (cached). */
  faceMesh(mesh, face) {
    let byFace = this.faceMeshes.get(mesh);
    if (!byFace) this.faceMeshes.set(mesh, byFace = new Map());
    let sub = byFace.get(face);
    if (!sub) {
      const idx = [];
      for (let t = 0; t < mesh.triFace.length; t++) if (mesh.triFace[t] === face) idx.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]);
      sub = { positions: mesh.positions, normals: mesh.normals, indices: new Uint32Array(idx), triFace: new Uint16Array(idx.length / 3), edges: new Float32Array(0), iso: new Float32Array(0) };
      byFace.set(face, sub);
    }
    return sub;
  }
  /** Area of a body face in world units. */
  faceArea(node, face) {
    const mesh = evaluateBody(node), model = modelMatrix(node), sub = this.faceMesh(mesh, face), P = mesh.positions;
    let area = 0;
    for (let k = 0; k < sub.indices.length; k += 3) {
      const [a, b, c] = [0, 1, 2].map((j) => m4.point(model, [P[sub.indices[k + j] * 3], P[sub.indices[k + j] * 3 + 1], P[sub.indices[k + j] * 3 + 2]]));
      area += v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2;
    }
    return area;
  }
  setBodyFace(bf) {
    this.bodyFace = bf;
    this.ui.properties.sync();
    this.invalidate();
  }
  /** Smallest sketch face under a viewport point: { sketch, index, t } or null. */
  pickFace(x, y) {
    const r = this.camera.ray(x, y), { store } = this;
    let best = null;
    for (const sk of store.sketches()) {
      if (!store.isVisible(sk) || store.isLocked(sk)) continue;
      const d = sketchData(sk), t = rayMath.plane(r, d.plane.o, d.plane.n);
      if (t === null || t < 0) continue;
      const p = to2(d.plane, rayMath.at(r, t));
      d.regions.forEach((region, index) => {
        if (!pointInRegion(p, region)) return;
        if (!best || t < best.t - 1e-6 || (Math.abs(t - best.t) <= 1e-6 && region.area < best.area)) best = { sketch: sk.id, index, t, area: region.area, ents: sk.entities };
      });
    }
    return best;
  }
  /** What is under the pointer in 3D mode: a sketch face in front of (or lying on) a body wins. */
  pickAny(x, y) {
    const body = this.pick(x, y), face = this.pickFace(x, y);
    if (face && (!body || face.t <= body.t + 1e-3)) return { face };
    return body ? { body } : {};
  }
  drawOverlay() {
    const g = this.overlay.getContext('2d'), dpr = this.renderer.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.camera.width, this.camera.height);
    if (!this.tool.drawOverlay) return;
    const css = this.renderer.theme.css;
    g.theme = css;
    g.font = '500 12px "IBM Plex Mono", ui-monospace, Menlo, monospace';
    /** Small pill label. `centre` centres it on (x, y). */
    g.label = (text, x, y, color = null, centre = false) => {
      const w = g.measureText(text).width + 12;
      const left = centre ? x - w / 2 : x, top = centre ? y - 10 : y - 10;
      g.fillStyle = color || css.label;
      g.beginPath();
      g.roundRect(left, top, w, 20, 6);
      g.fill();
      g.fillStyle = css.labelText;
      g.textBaseline = 'middle';
      g.fillText(text, left + 6, top + 10.500);
    };
    this.tool.drawOverlay(g);
  }
  get faceSel() { return this.store.regionSel; }
  set faceSel(v) { this.store.selectRegions(v); }

  // ---- selection and hover -----------------------------------------------------
  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.invalidate();
  }
  hoverAt(ev) {
    const hit = this.pickAny(ev.x, ev.y);
    const face = hit.face || null;
    if ((face ? `${face.sketch}:${face.index}` : '') !== (this.hoverFace ? `${this.hoverFace.sketch}:${this.hoverFace.index}` : '')) {
      this.hoverFace = face;
      this.invalidate();
    }
    this.setHover(hit.body ? hit.body.node.id : null);
    if (face) this.canvas.style.cursor = 'pointer';
  }
  /** `wholeObjects`: tools that act on objects (move, rotate, scale) select the object on one tap. */
  selectAt(ev, wholeObjects = true) {
    const hit = this.pickAny(ev.x, ev.y);
    const additive = ev.shift || ev.ctrl || this.prefs.multiSelect;
    if (hit.face) {
      // One face of a sketch, not the whole sketch.
      const item = { sketch: hit.face.sketch, index: hit.face.index, ents: hit.face.ents };
      this.store.selectRegions([item], { toggle: additive });
    } else if (hit.body) {
      if (this.store.regionSel.length) this.store.selectRegions([]);
      if (additive || wholeObjects) {
        // Shift / multi-select and the transform tools work on whole objects.
        this.store.select([hit.body.node.id], { toggle: additive });
      } else {
        // One tap selects the face; a second tap (double-tap) selects the whole object.
        this.store.select([]);
        this.setBodyFace({ id: hit.body.node.id, face: hit.body.face, mesh: evaluateBody(hit.body.node) });
      }
    } else if (!additive) {
      this.store.selectRegions([]);
      this.store.select([]);
      this.setBodyFace(null);
    }
  }
  selectAll() {
    this.store.select(this.store.bodies().filter((n) => this.store.isVisible(n) && !this.store.isLocked(n)).map((n) => n.id));
  }
  showPenCursor(ev) {
    const show = !!ev && ev.type === 'pen';
    this.penCursor.hidden = !show;
    if (show) this.penCursor.style.transform = `translate(${ev.x}px, ${ev.y}px)`;
  }
  setReadout(text, x = 0, y = 0) {
    this.readout.hidden = !text;
    if (!text) return;
    this.readout.textContent = text;
    const w = this.readout.offsetWidth;
    this.readout.style.transform = `translate(${Math.max(8, Math.min(x + 18, this.camera.width - w - 8))}px, ${Math.max(8, y - 44)}px)`;
  }

  // ---- tools -----------------------------------------------------------------
  /**
   * Switch modelling mode. Each mode (see modes.js) has its own tools,
   * selection rules and panels; the document and geometry are shared.
   */
  setMode(id) {
    if (!MODES[id] || id === this.mode) return;
    if (id === 'sketch') { this.enterSketch(this.lastSketchView || 'top'); return; }
    this.mode = id;
    this.setTool(MODES[id].tool);
  }
  setTool(id, arg) {
    this.router.cancelPrimary();
    // Tools that finish by "going back to Select" return to the mode's own home tool.
    if (id === 'select' && this.mode === 'edit') id = 'edit';
    if (id === 'sketch') this.mode = 'sketch';
    else if (this.mode === 'sketch') this.mode = 'object';
    if (this.tool.id === 'sketch' && id !== 'sketch') this.leaveSketchView();
    this.hoverFace = null;
    this.tool.deactivate();
    this.tool = this.tools[id];
    this.tool.activate(arg);
    this.setHover(null);
    this.hoverBodyFace = null;
    this.ui.toolbar.build();
    this.ui.top.sync();
    this.ui.sketchBar.sync();
    this.ui.toolPanel.build();
    this.ui.status.sync();
    this.invalidate();
  }
  refreshToolPanel() { this.ui.toolPanel.sync(); }

  // ---- sketch mode -------------------------------------------------------------
  /**
   * Enter (or switch) sketch mode looking at `view` ('top', 'front', 'right'
   * or their opposites). The camera turns square-on, switches to orthographic
   * and locks, so one-finger and mouse drags can only pan, never tilt.
   */
  enterSketch(view) {
    const plane = VIEW_PLANE[view];
    if (!plane) return;
    this.lastSketchView = view;
    const cam = this.camera;
    if (this.tool.id !== 'sketch') {
      this.beforeSketch = { pose: cam.getPose() };
      this.setTool('sketch', { plane });
    } else {
      this.tool.switchPlane(plane);
      this.ui.sketchBar.sync();
      this.ui.toolPanel.build();
    }
    cam.locked = false;
    cam.setOrtho(true);
    cam.animateTo({ az: VIEWS[view].az, el: VIEWS[view].el });
    cam.locked = true;
    document.getElementById('stage').classList.add('sketching');
    this.ui.top.sync();
  }
  exitSketch() { if (this.tool.id === 'sketch') this.setTool('select'); }
  leaveSketchView() {
    const cam = this.camera, before = this.beforeSketch;
    cam.locked = false;
    document.getElementById('stage').classList.remove('sketching');
    if (before) {
      cam.setOrtho(before.pose.ortho);
      // Keep what the user was looking at; just tilt back to the earlier viewing angle.
      cam.animateTo({ az: before.pose.az, el: before.pose.el });
    }
    this.beforeSketch = null;
  }

  // ---- commands --------------------------------------------------------------
  undo() {
    if (['create', 'extrude', 'fillet', 'chamfer', 'union', 'subtract', 'intersect', 'pushpull', 'split'].includes(this.tool.id)) this.setTool('select');
    if (this.tool.id === 'sketch') { this.tool.reset(); this.tool.selected = []; }
    const label = this.store.undo();
    if (label) toast(`Undid ${label.toLowerCase()}`);
  }
  redo() {
    const label = this.store.redo();
    if (label) toast(`Redid ${label.toLowerCase()}`);
  }
  deleteSelection() {
    const ids = this.store.selectedNodes().filter((n) => !this.store.isLocked(n)).map((n) => n.id);
    if (ids.length) this.store.remove(ids);
    else if (this.store.selection.length) toast('Locked objects cannot be deleted. Unlock them first.');
  }
  duplicateSelection() {
    const ids = this.store.selectedBodies().map((n) => n.id);
    if (!ids.length) return;
    const step = this.store.doc.grid.spacing;
    this.store.select(this.store.duplicate(ids, [step, step, 0]));
  }
  setOrtho(on) {
    this.camera.setOrtho(on);
    this.ui.top.sync();
  }
  /** Bounding sphere of bodies (world space), or null. */
  bounds(nodes) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], any = false;
    for (const node of nodes) {
      const mesh = evaluateBody(node), model = modelMatrix(node);
      for (let k = 0; k < 8; k++) {
        const p = m4.point(model, [k & 1 ? mesh.max[0] : mesh.min[0], k & 2 ? mesh.max[1] : mesh.min[1], k & 4 ? mesh.max[2] : mesh.min[2]]);
        min = min.map((v, a) => Math.min(v, p[a]));
        max = max.map((v, a) => Math.max(v, p[a]));
        any = true;
      }
    }
    return any ? { center: v3.scale(v3.add(min, max), 0.5), radius: v3.dist(min, max) / 2, min, max } : null;
  }
  fitAll() {
    const b = this.bounds(this.store.bodies().filter((n) => this.store.isVisible(n)));
    if (b) this.camera.frame(b.center, b.radius);
    else this.camera.animateTo({ target: [0, 0, 0], distance: 300 });
  }
  focusSelection() {
    const set = this.selectedSet();
    const b = this.bounds(this.store.bodies().filter((n) => set.has(n.id)));
    if (b) this.camera.frame(b.center, b.radius * 1.6);
  }
  focusAt(ev) {
    if (this.tool.id === 'sketch') return;
    const hit = this.pick(ev.x, ev.y);
    if (!hit) { this.fitAll(); return; }
    // Double-tap an object in Object Mode: open its geometry in Edit Mode.
    if (this.mode !== 'object') return;
    this.store.select([hit.node.id]);
    this.setMode('edit');
  }

  // ---- export -----------------------------------------------------------------
  /**
   * Export solids ('stl' | 'obj' | 'glb' | '3mf') or sketches ('svg' | 'dxf').
   * Exports the selection if there is one of the right kind, otherwise
   * everything visible. Inside claude.ai the file is offered through the
   * page's download capability, which only accepts certain file types, so
   * model files are delivered inside a .zip; elsewhere the file downloads
   * directly.
   */
  async exportAs(format) {
    const { store } = this, base = safe(store.doc.name);
    const sketchFormat = format === 'svg' || format === 'dxf';
    let files, what;
    try {
      if (sketchFormat) {
        const chosen = store.selectedNodes().filter((n) => n.kind === 'sketch');
        const sketches = (chosen.length ? chosen : store.sketches().filter((n) => store.isVisible(n))).filter((n) => n.entities.length);
        if (!sketches.length) { toast('There are no sketches to export yet. Draw one in CAD Sketch mode first.'); return; }
        files = exportSketches(format, sketches, base);
        what = `${sketches.length} ${sketches.length === 1 ? 'sketch' : 'sketches'}`;
      } else {
        const chosen = store.selectedBodies();
        const nodes = (chosen.length ? chosen : store.bodies().filter((n) => store.isVisible(n) && n.role !== 'cutter'));
        if (!nodes.length) { toast('There are no objects to export yet.'); return; }
        files = exportModel(format, nodes.map((n) => ({ name: n.name, color: n.color, mesh: evaluateBody(n), matrix: modelMatrix(n) })), base);
        what = chosen.length ? `${nodes.length} selected ${nodes.length === 1 ? 'object' : 'objects'}` : `all ${nodes.length} visible ${nodes.length === 1 ? 'object' : 'objects'}`;
      }
    } catch (err) {
      toast(`The export could not be created: ${err.message}`);
      return;
    }
    const host = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
    if (host) {
      // The host accepts .svg and .zip but not .stl/.obj/.glb/.3mf/.dxf, so those travel in a zip.
      const direct = format === 'svg';
      const filename = direct ? files[0].name : `${base}-${format}.zip`;
      const data = direct ? files[0].data : new Blob([zip(files)]);
      try {
        await host.save({ filename, data });
        toast(`Exported ${what} as ${filename}.${direct ? '' : ` Unzip it to get the .${format} file.`}`);
      } catch (err) {
        if (err && err.code === 'declined') return;
        toast(err && err.code === 'rate_limited' ? 'A save prompt is already open. Answer it, then try again.' : `The file could not be saved here (${(err && err.code) || 'unavailable'}).`);
      }
      return;
    }
    // Outside claude.ai (for example self-hosted): an ordinary browser download.
    try {
      const one = files.length === 1;
      const blob = new Blob([one ? files[0].data : zip(files)]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = one ? files[0].name : `${base}-${format}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Exported ${what} as ${a.download}.`);
    } catch {
      toast('This view cannot save files. Open the app in the Claude app or a browser tab and try again.');
    }
  }

  // ---- context menu ------------------------------------------------------------
  contextMenuAt(ev) {
    if (this.tool.id === 'sketch') return;
    const hit = this.pick(ev.x, ev.y);
    if (hit && !this.store.selection.includes(hit.node.id)) this.store.select([hit.node.id]);
    if (!hit) this.store.select([]);
    const r = this.canvas.getBoundingClientRect();
    this.openContextMenu(r.left + ev.x, r.top + ev.y);
  }
  openContextMenu(x, y) {
    const { store } = this, nodes = store.selectedNodes();
    if (!nodes.length) {
      openMenu([
        { heading: 'Add a shape' },
        ...Object.entries(PRIMITIVES).map(([type, def]) => ({ label: def.label, icon: def.icon, action: () => this.setTool('create', type) })),
        { separator: true },
        { label: 'Fit all', icon: 'fit', action: () => this.fitAll() },
        { label: 'Select all', action: () => this.selectAll() },
      ], x, y);
      return;
    }
    const ids = nodes.map((n) => n.id), bodies = nodes.filter((n) => n.kind === 'body');
    const allHidden = nodes.every((n) => !n.visible), allLocked = nodes.every((n) => n.locked);
    const collections = store.doc.nodes.filter((n) => n.kind === 'collection' && !ids.includes(n.id));
    openMenu([
      nodes.length === 1 && { label: 'Rename', icon: 'rename', action: () => this.ui.browser.startRename(ids[0]) },
      bodies.length && { label: 'Duplicate', icon: 'multi', action: () => this.duplicateSelection(), hint: 'Ctrl D' },
      { label: 'Focus', icon: 'fit', action: () => this.focusSelection(), hint: 'F' },
      { separator: true },
      { label: allHidden ? 'Show' : 'Hide', icon: allHidden ? 'eye' : 'eyeOff', action: () => store.patch(ids, allHidden ? 'Show' : 'Hide', (n) => { n.visible = allHidden; }), hint: 'H' },
      { label: allLocked ? 'Unlock' : 'Lock', icon: allLocked ? 'unlock' : 'lock', action: () => store.patch(ids, allLocked ? 'Unlock' : 'Lock', (n) => { n.locked = !allLocked; }) },
      bodies.length && { separator: true },
      bodies.length && { heading: 'Collection' },
      ...(bodies.length ? collections.map((c) => ({ label: `Move to ${c.name}`, icon: 'folder', action: () => store.moveToCollection(ids, c.id) })) : []),
      bodies.length && { label: 'New collection from selection', icon: 'folderAdd', action: () => store.select([store.addCollection('Collection', bodies.map((n) => n.id))]) },
      bodies.some((n) => n.parent) && { label: 'Remove from collection', action: () => store.moveToCollection(ids, null) },
      { separator: true },
      { label: 'Delete', icon: 'trash', danger: true, action: () => this.deleteSelection(), hint: 'Del' },
    ], x, y);
  }

  // ---- document events -----------------------------------------------------------
  onDocChange(info) {
    this.invalidate();
    // A selected face is only meaningful for the exact sketch geometry it was picked on.
    if (this.store.regionSel.some((r) => { const n = this.store.node(r.sketch); return !n || n.entities !== r.ents; })) {
      this.store.regionSel = [];
      if (this.tool.id === 'extrude') this.setTool('select');
    }
    if (info.live) { this.ui.properties.sync(); return; }
    if (this.tool.onDocChange) this.tool.onDocChange();
    this.ui.toolbar.refresh();
    this.ui.top.sync();
    this.ui.browser.sync();
    this.ui.properties.sync();
    this.ui.toolPanel.sync();
    this.ui.status.sync();
    this.scheduleSave();
  }
  onSelection() {
    this.ui.toolbar.refresh();
    if (this.store.selection.length || this.store.regionSel.length) this.bodyFace = null;
    this.ui.browser.sync();
    this.ui.properties.sync();
    if (this.tool.id === 'select') this.ui.toolPanel.build(); else this.ui.toolPanel.sync();
    this.ui.top.sync();
    this.invalidate();
  }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 700);
  }
  save() {
    clearTimeout(this.saveTimer);
    // Photo data is large, so it is stored separately and only rewritten when the set changes.
    const keys = [...new Set(this.store.images().map((n) => n.src))].filter((k) => this.store.photos.has(k)).sort();
    if (keys.join(',') !== (this.photoKeys || '')) {
      this.photoKeys = keys.join(',');
      saveAutosave(Object.fromEntries(keys.map((k) => [k, this.store.photos.get(k)])), 'photos');
    }
    saveAutosave({ doc: this.store.doc, camera: this.camera.getPose(), savedAt: Date.now() });
  }

  // ---- keyboard --------------------------------------------------------------
  onKey(e) {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    const run = (fn) => { e.preventDefault(); fn(); };
    if (mod && key === 'z') return run(() => (e.shiftKey ? this.redo() : this.undo()));
    if (mod && key === 'y') return run(() => this.redo());
    if (mod && key === 'd') return run(() => this.duplicateSelection());
    if (mod && key === 'a') return run(() => this.selectAll());
    if (mod || e.altKey) return;
    if (this.tool.id === 'sketch') {
      // While sketching, only the keys that belong to the sketch are active.
      if (key === 'escape') return run(() => this.tool.cancel());
      if (key === 'enter') return run(() => this.tool.confirm());
      if (key === 'delete' || key === 'backspace') return run(() => this.tool.deleteSelected());
      return;
    }
    if (key === 'tab') return run(() => this.setMode(this.mode === 'object' ? 'edit' : 'object'));
    if (this.mode === 'edit') {
      // Edit Mode has its own keys; object shortcuts (move, delete, hide…) are off.
      if (key === 'escape') return run(() => this.tool.cancel());
      if (key === 'enter') return run(() => this.tool.confirm());
      const el = { 1: 'vertex', 2: 'edge', 3: 'face' }[key];
      if (el && this.tool.id === 'edit') return run(() => this.tool.setElement(el));
      if (key === 'f') return run(() => this.focusSelection());
      return;
    }
    const views = { 1: 'front', 3: 'right', 7: 'top', 9: 'back', 0: 'iso' };
    switch (key) {
      case 'escape': return run(() => { if (this.tool.id === 'select') { this.store.select([]); this.store.selectRegions([]); this.setBodyFace(null); } else this.tool.cancel(); });
      case 'enter': return run(() => this.tool.confirm());
      case 'v': return run(() => this.setTool('select'));
      case 'g': return run(() => this.setTool('move'));
      case 'r': return run(() => this.setTool('rotate'));
      case 's': return run(() => this.setTool('scale'));
      case 'e': return run(() => this.setTool('extrude'));
      case 'delete': case 'backspace': return run(() => this.deleteSelection());
      case 'f': return run(() => this.focusSelection());
      case 'home': return run(() => this.fitAll());
      case 'a': return run(() => this.selectAll());
      case '5': return run(() => this.setOrtho(!this.camera.ortho));
      case 'h': return run(() => {
        const ids = this.store.selection.slice();
        if (ids.length) this.store.patch(ids, 'Hide', (n) => { n.visible = false; });
      });
      default:
        if (views[key]) run(() => this.camera.setView(views[key]));
    }
  }
}

function boot() {
  try {
    const app = new App();
    window.plinth = app;            // handy for debugging from the console
    app.start();
  } catch (err) {
    console.error(err);
    const el = document.getElementById('fatal');
    el.hidden = false;
    el.querySelector('p').textContent = err.message.includes('WebGL2')
      ? 'This browser does not support WebGL2, which the 3D viewport needs. Try a current version of Safari, Chrome, Edge or Firefox.'
      : `The app could not start: ${err.message}`;
  }
}
boot();
