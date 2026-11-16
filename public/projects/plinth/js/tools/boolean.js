/**
 * tools/boolean.js — Add (union), Subtract (difference) and Intersect between
 * two whole objects. The first object selected is the target, the second is
 * the tool (cutter). The preview is the kernel's actual result, shown in place
 * of the target; nothing in the document changes until the user confirms.
 */
import { Tool, modelMatrix } from './tools.js';
import { m4 } from '../core/math.js';
import { evaluateBody } from '../geometry/kernel.js';
import { volume } from '../geometry/solids.js';
import { polysOf } from '../geometry/topology.js';
import { h, segmented, toast } from '../ui/dom.js';

const INFO = {
  union: { title: 'Add', verb: 'Add', second: 'Added object', hint: 'Select two objects that overlap or touch. They become one solid.' },
  subtract: { title: 'Subtract', verb: 'Subtract', second: 'Cutter', hint: 'Select the object to cut first, then the cutting object. The second is removed from the first.' },
  intersect: { title: 'Intersect', verb: 'Intersect', second: 'Second object', hint: 'Select two overlapping objects. Only the volume they share is kept.' },
};

export class BooleanTool extends Tool {
  constructor(app, kind) {
    super(app);
    this.id = kind;
    this.kind = kind;
    this.hint = INFO[kind].hint;
    this.opts = { after: 'delete', name: '' };
    this.preview = null;
    this.error = null;
    this.warning = null;
  }
  activate() { this.opts = { after: 'delete', name: '' }; this.update(); }
  deactivate() { this.preview = null; this.error = null; }
  /** [target, tool] in selection order, or null unless exactly two bodies are selected. */
  pair() {
    const sel = this.app.store.selectedBodies();
    return sel.length === 2 ? sel : null;
  }
  step(a, b) {
    const matrix = Array.from(m4.mul(m4.invert(modelMatrix(a)), modelMatrix(b))).map((x) => Math.round(x * 1e9) / 1e9);
    return { type: 'boolean', op: this.kind, tool: { feature: b.feature, ops: b.ops }, matrix };
  }
  /** Run the real operation for the preview and check the result. */
  update() {
    this.preview = null; this.error = null; this.warning = null;
    const pair = this.pair();
    if (pair) {
      const [a, b] = pair;
      const node = { ...a, ops: [...(a.ops || []), this.step(a, b)] };
      const before = evaluateBody(a), tool = evaluateBody(b), mesh = evaluateBody(node);
      if (mesh.error) this.error = mesh.error;
      else {
        const va = Math.abs(volume(polysOf(before))), vb = Math.abs(volume(polysOf(tool))), vr = Math.abs(volume(mesh.polys));
        const eps = Math.max(va, vb) * 1e-7;
        if (this.kind === 'union' && mesh.parts > 1 && vr > va + vb - eps) this.error = 'These objects do not overlap or touch, so adding them would not make one connected solid. Move them together first.';
        else if (this.kind === 'subtract' && vr > va - eps) this.error = 'The second object does not overlap the first, so no volume can be removed. Move it into the target first.';
        else if (!(vr > eps)) this.error = 'Nothing would be left of the target.';
        else {
          this.preview = node;
          if (mesh.open) this.warning = `The result has ${mesh.open} open ${mesh.open === 1 ? 'edge' : 'edges'}, so it may not be a watertight solid. Try moving the objects slightly so their faces do not coincide.`;
        }
      }
    }
    this.app.refreshToolPanel();
    this.app.invalidate();
  }
  onDocChange() { if (this.app.tool === this) this.update(); }
  /** The target is drawn as the previewed result. */
  override(node) { const p = this.pair(); return this.preview && p && node.id === p[0].id ? this.preview : null; }
  /** The second object: hidden for Add (it is part of the preview), ghosted otherwise. */
  itemStyle(node) {
    const p = this.pair();
    if (!p || node.id !== p[1].id) return null;
    if (this.preview && this.kind === 'union') return { hide: true };
    return { alpha: 0.22, color: this.kind === 'subtract' ? [0.85, 0.3, 0.25] : [0.3, 0.5, 0.9] };
  }
  hover(ev) { this.app.hoverAt(ev); }
  /** Taps add or remove whole objects, so no modifier key is needed to pick the pair. */
  tap(ev) {
    const hit = this.app.pick(ev.x, ev.y), { store } = this.app;
    if (!hit) return;
    const id = hit.node.id;
    if (!store.selection.includes(id) && store.selectedBodies().length >= 2) { toast('These tools work on exactly two objects. Tap one of the selected objects to deselect it first.'); return; }
    store.select([id], { toggle: true });
    this.update();
    this.app.ui.toolPanel.build();
  }
  drawOverlay(g) {
    const sel = this.app.store.selectedBodies();
    sel.slice(0, 2).forEach((node, k) => {
      const b = this.app.bounds([node]);
      if (!b) return;
      const s = this.app.camera.project(b.center);
      g.label(k === 0 ? '1  Target' : `2  ${INFO[this.kind].second}`, s.x, s.y + (k === 0 ? -16 : 10), k === 0 ? null : g.theme.snap, true);
    });
  }
  cancel() { this.app.setTool('select'); }
  confirm() {
    this.update();
    const pair = this.pair();
    if (!pair) { toast('Select exactly two objects first: the target, then the second object.'); return; }
    if (this.error) { toast(this.error); return; }
    const { store } = this.app, [a, b] = pair, { after, name } = this.opts;
    const step = after === 'linked' ? { type: 'boolean', op: this.kind, ref: b.id } : this.step(a, b);
    let result = a.id;
    store.commit(INFO[this.kind].verb, (doc) => {
      const A = doc.nodes.find((n) => n.id === a.id), B = doc.nodes.find((n) => n.id === b.id);
      if (after === 'keepboth') {
        // Leave both originals alone; the result is a new object.
        const copy = JSON.parse(JSON.stringify(A));
        copy.id = result = doc.nextId++;
        copy.ops = [...(A.ops || []), step];
        copy.name = name || store.uniqueName(`${A.name} ${INFO[this.kind].title.toLowerCase()}`);
        doc.nodes.splice(doc.nodes.indexOf(A) + 1, 0, copy);
        return;
      }
      A.ops = [...(A.ops || []), step];
      if (name) A.name = name;
      if (after === 'delete') doc.nodes = doc.nodes.filter((n) => n !== B);
      if (after === 'linked') B.role = 'cutter';
    });
    this.app.setTool('select');
    store.select([result]);
  }
  panel(api) {
    const info = INFO[this.kind], sel = this.app.store.selectedBodies();
    if (sel.length !== 2) {
      return { title: info.title, empty: sel.length < 2 ? `${sel.length} of 2 objects selected. Tap the target first, then the second object.` : 'More than two objects are selected. Tap objects to deselect until two remain.', actions: [api.button('Cancel', () => this.cancel())] };
    }
    const o = this.opts;
    const nameInput = h('input', { type: 'text', value: o.name, placeholder: sel[0].name, 'aria-label': 'Result name', enterKeyHint: 'done', oninput: (e) => { o.name = e.target.value.trim(); }, onkeydown: (e) => e.stopPropagation() });
    const after = segmented(this.kind === 'union'
      ? [{ value: 'delete', label: 'Replace both' }, { value: 'keepboth', label: 'Keep originals' }, { value: 'linked', label: 'Keep linked' }]
      : [{ value: 'delete', label: 'Delete it' }, { value: 'keep', label: 'Keep it' }, { value: 'linked', label: 'Keep linked' }],
    () => o.after, (v) => { o.after = v; }, 'Afterwards');
    const note = h('p.tool-note');
    const sync = () => {
      note.textContent = this.error || this.warning || `Target: ${sel[0].name}. ${info.second}: ${sel[1].name}.`;
      note.classList.toggle('bad', !!this.error);
    };
    sync();
    return {
      title: info.title,
      rows: [
        h('label.field', {}, h('span.field-label', {}, 'Result name'), h('span.field-box', {}, nameInput)),
        h('div.field', {}, h('span.field-label', {}, this.kind === 'union' ? 'Originals' : `${info.second} afterwards`), after.el),
        note,
      ],
      actions: [api.button('Cancel', () => this.cancel()), api.button(info.verb, () => this.confirm(), true)],
      onSync: sync,
    };
  }
}
