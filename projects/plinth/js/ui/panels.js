/**
 * ui/panels.js — object browser, properties panel and contextual tool panel.
 *
 * Each panel exposes build() (structure changed) and sync() (values changed).
 * Panels never mutate the document directly: they call the store or the
 * active tool, which keeps every edit undoable.
 */
import { h, icon, iconButton, numField, segmented, onContext, makeDraggable, toast } from './dom.js';
import { PRIMITIVES } from '../geometry/primitives.js';
import { evaluate, evaluateBody, validateParams } from '../geometry/kernel.js';
import { quat, m4 } from '../core/math.js';
import { formatLength, UNITS } from '../core/units.js';
import { BODY_COLORS } from '../document/store.js';
import { PLANES, sketchData } from '../geometry/planes.js';
import { opLabel } from '../tools/model.js';

const featureInfo = (type) => PRIMITIVES[type] || { label: 'Extrusion', icon: 'extrude', params: [] };
const nodeIcon = (node) => (node.kind === 'collection' ? 'folder' : node.kind === 'image' ? 'photo' : node.kind === 'sketch' ? 'sketch' : featureInfo(node.feature.type).icon);

function panelShell(app, el, key, title, actions = []) {
  const head = h('header.panel-head', {},
    h('h2', {}, title),
    h('div.panel-actions', {}, ...actions,
      iconButton('close', `Hide ${title.toLowerCase()}`, () => app.togglePanel(key, false))));
  const body = h('div.panel-body');
  el.replaceChildren(head, body);
  makeDraggable(el, head, (left, top) => app.setPref(`${key}Pos`, [left, top]));
  return body;
}

// ---------------------------------------------------------------------------
export class Browser {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.renaming = null;
    this.body = panelShell(app, el, 'browser', 'Objects', [
      iconButton('folderAdd', 'New collection', () => {
        const ids = app.store.selectedBodies().map((n) => n.id);
        app.store.select([app.store.addCollection('Collection', ids)]);
      }),
    ]);
    this.build();
  }
  build() {
    const { store } = this.app;
    const rows = [];
    const walk = (parent, depth) => {
      for (const node of store.children(parent)) {
        rows.push(this.row(node, depth));
        if (node.kind === 'collection' && node.open) walk(node.id, depth + 1);
      }
    };
    walk(null, 0);
    if (!rows.length) rows.push(h('p.empty', {}, 'Nothing here yet. Use the + button in the toolbar to add a shape.'));
    this.body.replaceChildren(...rows);
    const input = this.body.querySelector('input.rename');
    if (input) { input.focus(); input.select(); }
  }
  sync() { this.build(); }
  startRename(id) { this.renaming = id; this.app.togglePanel('browser', true); this.build(); }
  row(node, depth) {
    const { store } = this.app, app = this.app;
    const selected = store.selection.includes(node.id);
    const hidden = !store.isVisible(node), locked = store.isLocked(node);
    const isCollection = node.kind === 'collection';
    let name;
    if (this.renaming === node.id) {
      const finish = (save) => {
        if (this.renaming !== node.id) return;
        this.renaming = null;
        const value = name.value.trim();
        if (save && value && value !== node.name) store.patch(node.id, 'Rename', (n) => { n.name = value; });
        else this.build();
      };
      name = h('input.rename', {
        type: 'text', value: node.name, 'aria-label': 'Name', enterKeyHint: 'done',
        onblur: () => finish(true),
        onkeydown: (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        },
        onclick: (e) => e.stopPropagation(),
      });
    } else {
      name = h('span.row-name', {}, node.name);
    }
    const row = h(`div.row${selected ? '.selected' : ''}${hidden ? '.dim' : ''}`, {
      style: `padding-left:${8 + depth * 16}px`, role: 'treeitem', 'aria-selected': String(selected), tabIndex: 0,
      onclick: (e) => {
        if (row.dataset.held) { delete row.dataset.held; return; }
        store.select([node.id], { toggle: e.shiftKey || e.ctrlKey || e.metaKey || app.prefs.multiSelect });
      },
      ondblclick: () => this.startRename(node.id),
      onkeydown: (e) => { if (e.key === 'Enter') store.select([node.id]); },
    },
    isCollection
      ? h(`button.twisty${node.open ? '.open' : ''}`, {
        type: 'button', 'aria-label': node.open ? 'Collapse' : 'Expand', html: icon('chevron', 14),
        onclick: (e) => { e.stopPropagation(); store.setSetting(() => { node.open = !node.open; }); },
      })
      : h('span.twisty-space'),
    h('span.row-icon', { html: icon(nodeIcon(node), 18), style: node.kind === 'body' ? `color:${node.color}` : '' }),
    name,
    h(`button.row-btn${node.locked ? '.on' : ''}`, {
      type: 'button', title: node.locked ? 'Unlock' : 'Lock', 'aria-label': node.locked ? 'Unlock' : 'Lock',
      html: icon(locked ? 'lock' : 'unlock', 16),
      onclick: (e) => { e.stopPropagation(); store.patch(node.id, node.locked ? 'Unlock' : 'Lock', (n) => { n.locked = !n.locked; }); },
    }),
    h(`button.row-btn${node.visible ? '' : '.on'}`, {
      type: 'button', title: node.visible ? 'Hide' : 'Show', 'aria-label': node.visible ? 'Hide' : 'Show',
      html: icon(hidden ? 'eyeOff' : 'eye', 16),
      onclick: (e) => { e.stopPropagation(); store.patch(node.id, node.visible ? 'Hide' : 'Show', (n) => { n.visible = !n.visible; }); },
    }));
    onContext(row, (x, y) => {
      if (!store.selection.includes(node.id)) store.select([node.id]);
      app.openContextMenu(x, y);
    });
    return row;
  }
}

// ---------------------------------------------------------------------------
export class Properties {
  constructor(app, el) {
    this.app = app;
    this.body = panelShell(app, el, 'properties', 'Properties');
    this.key = null;
    this.fields = [];
    this.sync();
  }
  /** Rebuild only when the kind of thing being shown changes; otherwise refresh values. */
  sync() {
    const { store } = this.app;
    const nodes = store.selectedNodes(), bf = this.app.bodyFace;
    if (!nodes.length && bf && store.node(bf.id)) {
      const key = `face:${bf.id}:${bf.face}`;
      if (key !== this.key) { this.key = key; this.fields = []; this.body.replaceChildren(...this.faceProps(bf)); }
      else for (const f of this.fields) f.sync();
      return;
    }
    const key = nodes.map((n) => `${n.id}:${n.kind === 'body' ? n.feature.type + (n.ops ? n.ops.map((o) => o.type + (o.off ? '-' : '') + (o.ref || '')).join('') : '') + (evaluateBody(n).error ? '!' : '') : n.kind === 'image' ? `image${n.plane}${n.w}${n.opacity}` : n.kind}`).join(',') + '|' + nodes.length;
    if (key !== this.key) { this.key = key; this.build(nodes); }
    else for (const f of this.fields) f.sync();
  }
  section(title, ...children) {
    return h('section.prop-section', {}, h('h3', {}, title), ...children);
  }
  field(opts) {
    const f = numField({ units: () => this.app.store.doc.units, ...opts });
    this.fields.push(f);
    return f.el;
  }
  build(nodes) {
    this.fields = [];
    const out = [];
    if (nodes.length === 0) out.push(...this.documentSettings());
    else if (nodes.length === 1 && nodes[0].kind === 'body') out.push(...this.bodyProps(nodes[0].id));
    else if (nodes.length === 1 && nodes[0].kind === 'sketch') out.push(...this.sketchProps(nodes[0].id));
    else if (nodes.length === 1 && nodes[0].kind === 'image') out.push(...this.imageProps(nodes[0].id));
    else if (nodes.length === 1) out.push(...this.collectionProps(nodes[0].id));
    else out.push(...this.multiProps(nodes));
    this.body.replaceChildren(...out);
  }

  documentSettings() {
    const { store } = this.app;
    const unit = segmented(Object.entries(UNITS).map(([value, u]) => ({ value, label: u.label })),
      () => store.doc.units.unit, (v) => store.setSetting((d) => { d.units.unit = v; }), 'Units');
    const precision = segmented([0, 1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })),
      () => store.doc.units.precision, (v) => store.setSetting((d) => { d.units.precision = +v; }), 'Decimal places');
    const angle = segmented([5, 15, 30, 45, 90].map((v) => ({ value: v, label: v + '°' })),
      () => store.doc.grid.angle, (v) => store.setSetting((d) => { d.grid.angle = +v; }), 'Angle snap');
    const snapToggle = segmented([{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }],
      () => String(store.doc.grid.snap), (v) => store.setSetting((d) => { d.grid.snap = v === 'true'; }), 'Snap to grid');
    this.fields.push(unit, precision, angle, snapToggle);
    return [
      h('p.prop-lead', {}, 'Nothing selected. These settings apply to the whole project.'),
      this.section('Units', h('div.prop-row', {}, h('span.prop-label', {}, 'Length'), unit.el),
        h('div.prop-row', {}, h('span.prop-label', {}, 'Decimals'), precision.el)),
      this.section('Grid and snapping',
        this.field({ label: 'Grid spacing', get: () => store.doc.grid.spacing, set: (v) => (v > 0 ? store.setSetting((d) => { d.grid.spacing = v; }) : 'Grid spacing must be greater than zero.') }),
        h('div.prop-row', {}, h('span.prop-label', {}, 'Snap to grid'), snapToggle.el),
        h('div.prop-row', {}, h('span.prop-label', {}, 'Angle snap'), angle.el)),
    ];
  }

  bodyProps(id) {
    const { store } = this.app;
    const node = () => store.node(id);
    const def = featureInfo(node().feature.type);
    const params = def.params.map((p) => this.field({
      label: p.label, kind: p.kind,
      get: () => node().feature.params[p.key],
      set: (v) => {
        const next = { ...node().feature.params, [p.key]: v };
        const problem = validateParams(node().feature.type, next);
        if (problem) return problem;
        store.patch(id, `Edit ${p.label.toLowerCase()}`, (n) => { n.feature.params = next; });
      },
    }));
    const euler = () => quat.toEuler(node().transform.q);
    const vec = (title, labelFor, kind, get, set) => h('div.prop-vec', {}, h('span.prop-label', {}, title),
      ...['X', 'Y', 'Z'].map((axis, k) => this.field({ label: axis, kind, axis: axis.toLowerCase(), get: () => get()[k], set: (v) => set(k, v) })));
    const size = h('p.prop-note');
    this.fields.push({
      sync: () => {
        const n = node();
        if (!n) return;
        const m = evaluateBody(n), u = store.doc.units;
        const d = [0, 1, 2].map((k) => formatLength((m.max[k] - m.min[k]) * Math.abs(n.transform.s[k]), u, false));
        size.textContent = `Size ${d.join(' × ')} ${UNITS[u.unit].label}`;
      },
    });
    this.fields.at(-1).sync();
    const swatches = h('div.swatches', {},
      ...BODY_COLORS.map((c) => h('button.swatch', {
        type: 'button', style: `background:${c}`, title: c, 'aria-label': `Colour ${c}`,
        onclick: () => store.patch(id, 'Change colour', (n) => { n.color = c; }),
      })),
      h('label.swatch.custom', { title: 'Custom colour' },
        h('input', { type: 'color', value: node().color, 'aria-label': 'Custom colour', onchange: (e) => store.patch(id, 'Change colour', (n) => { n.color = e.target.value; }) })));
    if (node().feature.type === 'extrude') {
      params.push(this.field({
        label: 'Distance',
        get: () => { const p = node().feature.params; return Math.abs(p.z1 - p.z0); },
        set: (v) => {
          if (!(v > 0)) return 'Distance must be greater than zero.';
          const p = node().feature.params, k = v / Math.abs(p.z1 - p.z0);
          store.patch(id, 'Edit extrusion distance', (n) => { n.feature = { ...n.feature, params: { ...p, z0: p.z0 * k, z1: p.z1 * k } }; });
        },
      }));
    }
    const features = this.featureList(id);
    return [
      this.section(def.label, ...params, size),
      ...features,
      this.section('Transform',
        vec('Position', 'p', 'length', () => node().transform.p, (k, v) => store.patch(id, 'Move', (n) => { n.transform.p[k] = v; })),
        vec('Rotation', 'r', 'angle', euler, (k, v) => {
          const e = euler(); e[k] = v;
          store.patch(id, 'Rotate', (n) => { n.transform.q = quat.fromEuler(e); });
        }),
        vec('Scale', 's', 'factor', () => node().transform.s, (k, v) => (v === 0 ? 'Scale cannot be zero.' : void store.patch(id, 'Scale', (n) => { n.transform.s[k] = v; })))),
      this.section('Appearance', swatches),
    ];
  }

  /** A single selected face of a solid. */
  faceProps(bf) {
    const { store } = this.app, app = this.app;
    const note = h('p.prop-note');
    this.fields.push({
      sync: () => {
        const node = store.node(bf.id);
        if (!node) return;
        const u = store.doc.units, k = UNITS[u.unit].mm;
        note.textContent = `Area ${formatLength(app.faceArea(node, bf.face) / k, { unit: 'mm', precision: u.precision }, false)} ${UNITS[u.unit].label}²`;
      },
    });
    this.fields.at(-1).sync();
    return [this.section(`Face of ${store.node(bf.id).name}`, note,
      h('div.button-col', {}, h('button.btn', { type: 'button', onclick: () => store.select([bf.id]) }, 'Select the whole object')),
      h('p.prop-lead', {}, 'Double-tap an object to select all of it. Move, rotate and scale work on whole objects.'))];
  }

  /** Operations applied to a body, in order, each editable or removable. */
  featureList(id) {
    const { store } = this.app, node = () => store.node(id);
    const ops = node().ops || [];
    if (!ops.length) return [];
    const mesh = evaluateBody(node());
    const setOp = (k, patch, label) => store.patch(id, label, (n) => { n.ops = n.ops.map((o, i) => (i === k ? { ...o, ...patch } : o)); });
    const rows = ops.map((op, k) => {
      const failed = mesh.error && mesh.failedOp === k, skipped = mesh.error && mesh.failedOp < k;
      const remove = iconButton('trash', `Remove this ${opLabel(op).toLowerCase()}`, () => store.patch(id, `Remove ${opLabel(op).toLowerCase()}`, (n) => { n.ops = n.ops.filter((_, i) => i !== k); }));
      const linked = op.ref ? store.node(op.ref) : null;
      const what = op.ref ? ` with ${linked ? linked.name : 'a deleted object'} (linked)` : op.type === 'boolean' ? (op.tool && op.tool.feature ? ' with an object' : ' with an extrusion') : '';
      let control = h('span.feature-name', {}, `${k + 1}. ${opLabel(op)}${what}`);
      const toggle = iconButton(op.off ? 'eyeOff' : 'eye', op.off ? 'Switch this step back on' : 'Switch this step off', () => setOp(k, { off: op.off ? undefined : true }, op.off ? 'Switch step on' : 'Switch step off'));
      // A linked step follows its object; "Apply" freezes the current shape into the body.
      const apply = op.ref && linked ? h('button.btn.small', { type: 'button', title: 'Make this step permanent and unlink the object', onclick: () => {
        const mm = (t) => m4.compose(t.p, t.q, t.s), target = node();
        const matrix = Array.from(m4.mul(m4.invert(mm(target.transform)), mm(linked.transform))).map((x) => Math.round(x * 1e9) / 1e9);
        store.commit('Apply linked step', (doc) => {
          for (const n of doc.nodes) {
            if (n.id === id) n.ops = n.ops.map((o, i) => (i === k ? { type: 'boolean', op: o.op, tool: { feature: linked.feature, ops: linked.ops }, matrix } : o));
            if (n.id === linked.id) delete n.role;
          }
        });
      } }, 'Apply') : null;
      if (op.type === 'fillet') control = this.field({ label: `${k + 1}. Fillet radius`, get: () => (node().ops[k] || op).radius, set: (v) => (v > 0 ? void setOp(k, { radius: v }, 'Edit fillet radius') : 'Radius must be greater than zero.') });
      if (op.type === 'chamfer') control = this.field({ label: `${k + 1}. Chamfer distance`, get: () => (node().ops[k] || op).distance, set: (v) => (v > 0 ? void setOp(k, { distance: v }, 'Edit chamfer distance') : 'Distance must be greater than zero.') });
      return h(`div.feature-row${failed ? '.failed' : ''}${skipped || op.off ? '.skipped' : ''}`, {}, control, apply, toggle, remove);
    });
    const out = [this.section('Features', ...rows)];
    if (mesh.error) {
      out[0].append(h('p.prop-error', {}, `Step ${mesh.failedOp + 1} could not be rebuilt, so it and the steps after it are not applied. ${mesh.error}`));
    }
    return out;
  }

  sketchProps(id) {
    const { store } = this.app, app = this.app;
    const node = store.node(id), d = sketchData(node), plane = PLANES[node.plane];
    const view = { xy: 'top', xz: 'front', yz: 'right' }[node.plane];
    return [this.section(`Sketch on the ${plane.label.toLowerCase()}`,
      h('p.prop-note', {}, `${node.entities.length} ${node.entities.length === 1 ? 'curve' : 'curves'}, ${d.regions.length} closed ${d.regions.length === 1 ? 'face' : 'faces'}${d.open.size ? `, ${d.open.size} open` : ''}`),
      h('div.button-col', {}, h('button.btn.primary', { type: 'button', onclick: () => app.enterSketch(view) }, 'Edit sketch')),
      h('p.prop-lead', {}, 'In the 3D view, tap a closed face of this sketch to extrude it.'))];
  }

  imageProps(id) {
    const { store } = this.app, app = this.app, node = store.node(id), u = store.doc.units;
    return [this.section(`Reference photo on the ${PLANES[node.plane].label.toLowerCase()}`,
      h('p.prop-note', {}, `${formatLength(node.w, u)} wide, ${formatLength(node.w * node.aspect, u)} high, ${Math.round(node.opacity * 100)}% opaque.`),
      h('div.button-col', {}, h('button.btn.primary', { type: 'button', onclick: () => app.setTool('photo', { id }) }, 'Adjust photo')),
      h('p.prop-lead', {}, 'Photos are for tracing: sketch on the same plane and draw over it. They are not exported.'))];
  }

  collectionProps(id) {
    const { store } = this.app;
    const count = store.descendants(id).filter((n) => n.kind === 'body').length;
    return [this.section('Collection', h('p.prop-note', {}, `${count} ${count === 1 ? 'object' : 'objects'} inside. Hiding or locking the collection applies to everything in it.`))];
  }

  multiProps(nodes) {
    const { store } = this.app, app = this.app;
    const ids = nodes.map((n) => n.id);
    return [
      this.section(`${nodes.length} items selected`,
        h('div.button-col', {},
          h('button.btn', { type: 'button', onclick: () => store.select([store.addCollection('Collection', store.selectedBodies().map((n) => n.id))]) }, 'Group into a collection'),
          h('button.btn', { type: 'button', onclick: () => app.duplicateSelection() }, 'Duplicate'),
          h('button.btn.danger', { type: 'button', onclick: () => app.deleteSelection() }, 'Delete'))),
      this.section('Appearance', h('div.swatches', {},
        ...BODY_COLORS.map((c) => h('button.swatch', {
          type: 'button', style: `background:${c}`, 'aria-label': `Colour ${c}`,
          onclick: () => store.patch(ids, 'Change colour', (n) => { if (n.kind === 'body') n.color = c; }),
        })))),
    ];
  }
}

// ---------------------------------------------------------------------------
/** Contextual panel for the active tool: exact values plus confirm / cancel. */
export class ToolPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.fields = [];
    this.state = { move: [0, 0, 0], rotate: { axis: 2, angle: 90 }, scale: [1, 1, 1] };
  }
  field(opts) {
    const f = numField({ units: () => this.app.store.doc.units, ...opts });
    this.fields.push(f);
    return f.el;
  }
  sync() { for (const f of this.fields) f.sync(); if (this.onSync) this.onSync(); this.syncEmpty(); }
  syncEmpty() {
    const tool = this.app.tool;
    if (!tool.targets || tool.panel) return;
    this.el.classList.toggle('no-target', tool.targets().length === 0);
  }
  build() {
    const { app } = this, tool = app.tool;
    this.fields = [];
    this.onSync = null;
    this.el.classList.remove('no-target');
    const faces = app.store.regionSel.length;
    // Tools that describe their own panel (sketch, extrude, fillet, chamfer), and the
    // "Extrude" prompt that appears when a sketch face is selected.
    let spec = null;
    const api = {
      field: (opts) => this.field(opts),
      sync: () => this.sync(),
      button: (label, fn, primary = false, danger = false) => h(`button.btn${primary ? '.primary' : ''}${danger ? '.danger' : ''}`, { type: 'button', onclick: fn }, label),
    };
    if (tool.panel) spec = tool.panel(api);
    else if (tool.id === 'select' && faces) {
      spec = { title: faces === 1 ? '1 face selected' : `${faces} faces selected`, rows: [], actions: [api.button('Extrude', () => app.setTool('extrude'), true)] };
    }
    if (spec) {
      this.el.hidden = false;
      this.onSync = spec.onSync || null;
      this.el.replaceChildren(
        h('header.tool-head', {}, h('h2', {}, spec.title)),
        spec.empty ? h('p.tool-empty.show', {}, spec.empty) : h('div.tool-fields', {}, ...(spec.rows || [])),
        h('div.tool-actions', {}, ...(spec.actions || [])));
      return;
    }
    this.el.hidden = tool.id === 'select';
    if (tool.id === 'select') { this.el.replaceChildren(); return; }
    const title = tool.id === 'create' ? `New ${PRIMITIVES[tool.type].label.toLowerCase()}` : { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[tool.id];
    const head = h('header.tool-head', {}, h('h2', {}, title));
    const row = h('div.tool-fields');
    const actions = h('div.tool-actions');
    const s = this.state;
    const need = (fn) => () => {
      if (!tool.targets().length) { toast('Select an object first.'); return; }
      fn();
    };
    if (tool.id === 'create') {
      const def = PRIMITIVES[tool.type];
      for (const p of def.params) {
        row.append(this.field({ label: p.label, kind: p.kind, get: () => tool.node.feature.params[p.key], set: (v) => tool.setParam(p.key, v) }));
      }
      row.append(
        this.field({ label: 'Position X', axis: 'x', get: () => tool.base[0], set: (v) => tool.setBase(0, v) }),
        this.field({ label: 'Position Y', axis: 'y', get: () => tool.base[1], set: (v) => tool.setBase(1, v) }));
      actions.append(
        h('button.btn', { type: 'button', onclick: () => tool.cancel() }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: () => tool.confirm() }, h('span', { html: icon('check', 16) }), `Add ${def.label.toLowerCase()}`));
    } else if (tool.id === 'move') {
      ['X', 'Y', 'Z'].forEach((axis, k) => row.append(this.field({ label: `Move ${axis}`, axis: axis.toLowerCase(), get: () => s.move[k], set: (v) => { s.move[k] = v; } })));
      actions.append(h('button.btn.primary', { type: 'button', onclick: need(() => tool.moveBy(s.move.slice())) }, 'Apply move'));
    } else if (tool.id === 'rotate') {
      const axis = segmented(['X', 'Y', 'Z'].map((label, value) => ({ value, label })), () => s.rotate.axis, (v) => { s.rotate.axis = +v; }, 'Rotation axis');
      row.append(h('div.field', {}, h('span.field-label', {}, 'Axis'), axis.el),
        this.field({ label: 'Angle', kind: 'angle', get: () => s.rotate.angle, set: (v) => { s.rotate.angle = v; } }));
      actions.append(h('button.btn.primary', { type: 'button', onclick: need(() => tool.rotateBy(s.rotate.axis, s.rotate.angle)) }, 'Apply rotation'));
    } else {
      ['X', 'Y', 'Z'].forEach((axis, k) => row.append(this.field({
        label: `Scale ${axis}`, kind: 'factor', axis: axis.toLowerCase(), get: () => s.scale[k],
        set: (v) => (v > 0 ? void (s.scale[k] = v) : 'A scale factor must be greater than zero.'),
      })));
      actions.append(h('button.btn.primary', { type: 'button', onclick: need(() => tool.scaleBy(s.scale.slice())) }, 'Apply scale'));
    }
    if (tool.id !== 'create') actions.prepend(h('button.btn', { type: 'button', onclick: () => app.setTool('select') }, 'Done'));
    const empty = h('p.tool-empty', {}, 'Select an object to use this tool.');
    this.el.replaceChildren(head, row, empty, actions);
    this.syncEmpty();
  }
}
