/**
 * document/store.js — the project document, selection and undo history.
 *
 * The document is plain JSON-serialisable data:
 *   { name, units: { unit, precision }, grid: { spacing, snap, angle },
 *     nodes: [ Node ], nextId }
 *   Node (body):       { id, kind: 'body', name, parent, visible, locked,
 *                        color, feature: { type, params },
 *                        transform: { p: [x,y,z], q: [x,y,z,w], s: [x,y,z] } }
 *                        ops: [boolean | fillet | chamfer]  (optional) }
 *   Node (collection): { id, kind: 'collection', name, parent, visible,
 *                        locked, open }
 *   Node (sketch):     { id, kind: 'sketch', name, parent, visible, locked,
 *                        plane: 'xy'|'xz'|'yz', entities: [Entity], nextEntity }
 *   Node (image):      { id, kind: 'image', name, parent, visible, locked,
 *                        plane, src, aspect, w, x, y, rot, opacity }
 *                        a reference photo; `src` is a key into store.images
 * Node order in the array is the display order in the browser.
 *
 * Every modelling change goes through `commit` (or begin/end for drags), so
 * every change is undoable. History entries are before/after snapshots of the
 * whole document: simple and impossible to get out of sync. The document is
 * small parametric data, not meshes, so snapshots stay cheap.
 */
import { Emitter } from '../core/events.js';
import { defaultParams } from '../geometry/kernel.js';
import { PRIMITIVES } from '../geometry/primitives.js';

const HISTORY_LIMIT = 200;
export const BODY_COLORS = ['#8fa3b8', '#c98f5a', '#7fae8b', '#b58bc2', '#d0b25f', '#6f9fd1', '#c97b7b', '#9aa0a8'];

export function emptyDocument(name = 'Untitled project') {
  return {
    name,
    units: { unit: 'mm', precision: 2 },
    grid: { spacing: 10, snap: true, angle: 15 },
    nodes: [],
    nextId: 1,
  };
}

export class Store extends Emitter {
  constructor() {
    super();
    this.doc = emptyDocument();
    this.selection = [];
    this.photos = new Map();       // photo data (data URLs) by key; kept out of the undo snapshots
    this.regionSel = [];           // selected sketch faces: [{ sketch: nodeId, index }]
    this.undoStack = [];
    this.redoStack = [];
  }

  // ---- queries -----------------------------------------------------------
  node(id) { return this.doc.nodes.find((n) => n.id === id) || null; }
  bodies() { return this.doc.nodes.filter((n) => n.kind === 'body'); }
  images() { return this.doc.nodes.filter((n) => n.kind === 'image'); }
  sketches() { return this.doc.nodes.filter((n) => n.kind === 'sketch'); }
  sketchOn(plane) { return this.doc.nodes.find((n) => n.kind === 'sketch' && n.plane === plane) || null; }
  /**
   * Edit the sketch on a plane as one undo step, creating the sketch node the
   * first time something is drawn there. `fn(sketch)` must replace
   * `sketch.entities` with a new array (never mutate it in place).
   */
  editSketch(plane, label, fn) {
    return this.commit(label, (doc) => {
      let sk = doc.nodes.find((n) => n.kind === 'sketch' && n.plane === plane);
      if (!sk) {
        sk = { id: doc.nextId++, kind: 'sketch', name: `Sketch ${plane.toUpperCase()}`, parent: null, visible: true, locked: false, plane, entities: [], nextEntity: 1 };
        doc.nodes.push(sk);
      }
      fn(sk);
    });
  }
  children(parentId) { return this.doc.nodes.filter((n) => (n.parent || null) === (parentId || null)); }
  selectedNodes() { return this.selection.map((id) => this.node(id)).filter(Boolean); }
  selectedBodies() { return this.selectedNodes().filter((n) => n.kind === 'body'); }
  /** A node is effectively hidden/locked if it or any ancestor is. */
  inherited(node, flag) {
    for (let n = node; n; n = n.parent ? this.node(n.parent) : null) {
      if (flag === 'hidden' ? !n.visible : n.locked) return true;
    }
    return false;
  }
  isVisible(node) { return !this.inherited(node, 'hidden'); }
  isLocked(node) { return this.inherited(node, 'locked'); }
  /** All descendants of a collection (depth-first). */
  descendants(id) {
    const out = [];
    for (const c of this.children(id)) { out.push(c); out.push(...this.descendants(c.id)); }
    return out;
  }
  uniqueName(base) {
    const names = new Set(this.doc.nodes.map((n) => n.name));
    if (!names.has(base)) return base;
    const stem = base.replace(/ \d+$/, '');
    for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
  }

  // ---- history -----------------------------------------------------------
  /** Start an interactive change. Returns a token to pass to end/abort. */
  begin() { return JSON.stringify(this.doc); }
  /** Announce a live (not yet committed) change, e.g. during a drag. */
  touch() { this.emit('change', { live: true }); }
  /** Finish an interactive change and record it as one undo step. */
  end(token, label) {
    const after = JSON.stringify(this.doc);
    if (after === token) return false;
    this.undoStack.push({ label, before: token, after });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit('change', { label });
    return true;
  }
  /** Throw away an interactive change. */
  abort(token) {
    this.doc = JSON.parse(token);
    this.pruneSelection();
    this.emit('change', { live: true });
  }
  /** Apply `fn(doc)` as one undoable step. */
  commit(label, fn) {
    const token = this.begin();
    fn(this.doc);
    return this.end(token, label);
  }
  /** Change document settings without creating an undo step. */
  setSetting(fn) {
    fn(this.doc);
    this.emit('change', { setting: true });
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push(step);
    this.restore(step.before);
    return step.label;
  }
  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push(step);
    this.restore(step.after);
    return step.label;
  }
  restore(json) {
    // Unit and grid settings are preferences, not modelling steps: keep the current ones.
    const { units, grid, name } = this.doc;
    this.doc = { ...JSON.parse(json), units, grid, name };
    this.regionSel = [];
    this.pruneSelection();
    this.emit('change', { history: true });
  }
  /** Replace the whole document (new project / load). Clears history. */
  load(doc) {
    this.doc = doc;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.selection = [];
    this.regionSel = [];
    this.emit('change', { loaded: true });
    this.emit('selection');
  }

  // ---- selection (not part of undo history) --------------------------------
  select(ids, { add = false, toggle = false } = {}) {
    ids = [].concat(ids).filter((id) => this.node(id));
    let next;
    if (toggle) {
      next = this.selection.slice();
      for (const id of ids) {
        const k = next.indexOf(id);
        if (k >= 0) next.splice(k, 1); else next.push(id);
      }
    } else if (add) {
      next = [...new Set([...this.selection, ...ids])];
    } else {
      next = ids;
    }
    const same = next.length === this.selection.length && next.every((id, k) => id === this.selection[k]);
    if (same && !this.regionSel.length) return;
    this.selection = next;
    if (!add && !toggle) this.regionSel = [];
    this.emit('selection');
  }
  /** Select sketch faces (closed regions). Replaces the node selection unless toggling. */
  selectRegions(items, { toggle = false } = {}) {
    let next = items;
    if (toggle) {
      next = this.regionSel.slice();
      for (const it of items) {
        const k = next.findIndex((r) => r.sketch === it.sketch && r.index === it.index);
        if (k >= 0) next.splice(k, 1); else next.push(it);
      }
      // Faces to extrude together must come from one sketch.
      if (items.length) next = next.filter((r) => r.sketch === items[0].sketch);
    }
    if (!next.length && !this.regionSel.length) return;
    this.regionSel = next;
    if (next.length) this.selection = [];
    this.emit('selection');
  }
  pruneSelection() {
    const kept = this.selection.filter((id) => this.node(id));
    const regions = this.regionSel.filter((r) => this.node(r.sketch));
    if (kept.length !== this.selection.length || regions.length !== this.regionSel.length) {
      this.selection = kept;
      this.regionSel = regions;
      this.emit('selection');
    }
  }

  // ---- modelling operations ------------------------------------------------
  /** Build a body node (not yet inserted). */
  makeBody(type, params = defaultParams(type), position = [0, 0, 0]) {
    const count = this.bodies().length;
    return {
      id: 0,
      kind: 'body',
      name: PRIMITIVES[type].label,   // callers may rename (e.g. extrusions)
      parent: null,
      visible: true,
      locked: false,
      color: BODY_COLORS[count % BODY_COLORS.length],
      feature: { type, params: { ...params } },
      transform: { p: position.slice(), q: [0, 0, 0, 1], s: [1, 1, 1] },
    };
  }
  addBody(node, label) {
    let id;
    this.commit(label || `Add ${node.name.toLowerCase()}`, (doc) => {
      id = doc.nextId++;
      doc.nodes.push({ ...node, id, name: this.uniqueName(node.name) });
    });
    return id;
  }
  addCollection(name = 'Collection', memberIds = []) {
    let id;
    this.commit('New collection', (doc) => {
      id = doc.nextId++;
      const node = { id, kind: 'collection', name: this.uniqueName(name), parent: null, visible: true, locked: false, open: true };
      const first = doc.nodes.findIndex((n) => memberIds.includes(n.id));
      doc.nodes.splice(first >= 0 ? first : doc.nodes.length, 0, node);
      for (const n of doc.nodes) if (memberIds.includes(n.id)) n.parent = id;
    });
    return id;
  }
  moveToCollection(ids, parentId) {
    this.commit(parentId ? 'Move to collection' : 'Move out of collection', (doc) => {
      for (const n of doc.nodes) {
        if (ids.includes(n.id) && n.id !== parentId && n.kind !== 'collection') n.parent = parentId || null;
      }
    });
  }
  remove(ids) {
    const doomed = new Set(ids);
    for (const id of ids) for (const d of this.descendants(id)) doomed.add(d.id);
    const count = doomed.size;
    this.commit(count > 1 ? `Delete ${count} items` : 'Delete', (doc) => {
      doc.nodes = doc.nodes.filter((n) => !doomed.has(n.id));
    });
    this.pruneSelection();
  }
  /** Duplicate bodies, offset slightly so the copy is visible. Returns new ids. */
  duplicate(ids, offset = [0, 0, 0]) {
    const created = [];
    this.commit(ids.length > 1 ? `Duplicate ${ids.length} items` : 'Duplicate', (doc) => {
      for (const id of ids) {
        const src = doc.nodes.find((n) => n.id === id);
        if (!src || src.kind !== 'body') continue;
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = doc.nextId++;
        copy.name = this.uniqueName(src.name);
        copy.locked = false;
        copy.transform.p = copy.transform.p.map((v, k) => v + offset[k]);
        doc.nodes.splice(doc.nodes.indexOf(src) + 1, 0, copy);
        created.push(copy.id);
      }
    });
    return created;
  }
  /** Patch one or more nodes as a single undo step. */
  patch(ids, label, fn) {
    ids = [].concat(ids);
    return this.commit(label, (doc) => {
      for (const n of doc.nodes) if (ids.includes(n.id)) fn(n);
    });
  }
}
