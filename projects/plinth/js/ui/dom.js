/**
 * ui/dom.js — small DOM toolkit shared by the interface modules:
 * element builder, icon set, numeric field, popover menu, toasts.
 */
import { formatLength, formatNumber, parseLength, parseExpression, UNITS } from '../core/units.js';

/** h('button.primary', { onclick }, 'Label', childNode) */
export function h(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const ICONS = {
  select: '<path d="M5 3l14 7-6 2-2 6z"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>',
  scale: '<path d="M4 20h7M4 20v-7M4 20L20 4M13 4h7v7"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  sphere: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/>',
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/>',
  cone: '<path d="M12 3L5 18c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8zM5 18c0-1.5 3.1-2.8 7-2.8s7 1.3 7 2.8"/>',
  torus: '<ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="11" rx="3.6" ry="1.6"/>',
  plane: '<path d="M3 16l6-8h12l-6 8z"/>',
  pyramid: '<path d="M12 3l8 14-8 4-8-4zM12 3v18"/>',
  prism: '<path d="M7 4h10l3 4-3 4H7L4 8zM4 8v8l3 4h10l3-4V8M7 12v8M17 12v8"/>',
  undo: '<path d="M8 5L3 10l5 5M3 10h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M16 5l5 5-5 5M21 10H10a5 5 0 0 0 0 10h3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.3C3.6 8.1 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.2-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderAdd: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.500h5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.500 4.500L19 7.500"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  pencil: '<path d="M4 20l1-4L16.500 4.500a2.100 2.100 0 0 1 3 3L8 19zM14.500 6.500l3 3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  multi: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  rename: '<path d="M4 18h16M6 14l8-8 3 3-8 8H6z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  sketch: '<path d="M3 17l4-10 10 3 4 7zM7 7l2 7M17 10l-8 4"/><circle cx="9" cy="14" r="1.300" fill="currentColor"/>',
  extrude: '<path d="M5 17l7 3 7-3-7-3zM5 17V9l7-3 7 3v8M12 6v8M12 2v3M10 3.500L12 2l2 1.500"/>',
  fillet: '<path d="M4 20V11a7 7 0 0 1 7-7h9v16z"/><path d="M4 4h3M4 4v3" opacity=".45"/>',
  chamfer: '<path d="M4 20V11l7-7h9v16z"/><path d="M4 4h3M4 4v3" opacity=".45"/>',
  union: '<path d="M4 4h10v6h6v10H10v-6H4z"/>',
  subtract: '<path d="M4 4h10v6h-4v4H4z"/><path d="M14 10h6v10H10v-6" stroke-dasharray="2.500 2.500"/>',
  intersect: '<path d="M10 10h4v4h-4z" fill="currentColor" fill-opacity=".35"/><path d="M14 10V4H4v10h6M10 14v6h10V10h-6" stroke-dasharray="2.500 2.500"/>',
  editMode: '<path d="M5 8l7-4 7 4v8l-7 4-7-4z"/><circle cx="5" cy="8" r="1.700" fill="currentColor"/><circle cx="12" cy="4" r="1.700" fill="currentColor"/><circle cx="19" cy="8" r="1.700" fill="currentColor"/><circle cx="12" cy="20" r="1.700" fill="currentColor"/>',
  vertex: '<path d="M5 19L12 6l7 13z" opacity=".4"/><circle cx="12" cy="6" r="2.600" fill="currentColor"/>',
  edge: '<path d="M5 19l14 0L12 6z" opacity=".4"/><path d="M5 19L12 6" stroke-width="2.800"/>',
  face: '<path d="M5 19L12 6l7 13z" fill="currentColor" fill-opacity=".45"/>',
  pushpull: '<path d="M5 20h14M7 14h10v6H7zM12 14V3M9 6l3-3 3 3"/>',
  combine: '<path d="M3 6h18v12H3z"/><path d="M12 6v3M12 15v3" /><path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>',
  split: '<path d="M4 6l8-3 8 3v12l-8 3-8-3z"/><path d="M4 12l8 3 8-3" stroke-dasharray="2.5 2"/>',
  scissors: '<circle cx="6" cy="7" r="2.800"/><circle cx="6" cy="17" r="2.800"/><path d="M8.300 8.500L20 17M8.300 15.500L20 7"/>',
  skLine: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.800" fill="currentColor"/><circle cx="19" cy="5" r="1.800" fill="currentColor"/>',
  skArc3: '<path d="M4 18A11 11 0 0 1 20 18"/><circle cx="4" cy="18" r="1.800" fill="currentColor"/><circle cx="20" cy="18" r="1.800" fill="currentColor"/><circle cx="12" cy="9.700" r="1.800" fill="currentColor"/>',
  skArcC: '<path d="M5 18A13 13 0 0 1 18 5"/><path d="M18 18L5 18M18 18V5" opacity=".45"/><circle cx="18" cy="18" r="1.800" fill="currentColor"/>',
  skArcT: '<path d="M3 19h8a8 8 0 0 0 8-8V5"/><circle cx="11" cy="19" r="1.800" fill="currentColor"/>',
  skCircle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.300" fill="currentColor"/>',
  skRect: '<rect x="4" y="6" width="16" height="12"/>',
  skRRect: '<rect x="4" y="6" width="16" height="12" rx="4"/>',
  skEllipse: '<ellipse cx="12" cy="12" rx="9" ry="5.500"/>',
  skTriangle: '<path d="M12 4l8.500 15h-17z"/>',
  skPolygon: '<path d="M12 3l7.800 4.500v9L12 21l-7.800-4.500v-9z"/>',
  skSpline: '<path d="M3 17c4-12 7 6 10-2s5-9 8-8"/><circle cx="3" cy="17" r="1.800" fill="currentColor"/><circle cx="21" cy="7" r="1.800" fill="currentColor"/>',
};
export const icon = (name, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/** Icon button with an accessible label. */
export function iconButton(name, label, onclick, extra = {}) {
  return h('button.icon-btn', { type: 'button', title: label, 'aria-label': label, html: icon(name), onclick, ...extra });
}

// ---- toasts ----------------------------------------------------------------
export function toast(message) {
  const host = document.getElementById('toasts');
  const el = h('div.toast', { role: 'status' }, message);
  host.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// ---- numeric field -----------------------------------------------------------
let fieldSeq = 0;
/**
 * Labelled numeric input.
 *   kind: 'length' (stored in mm, typed in display units, accepts "1in", "10/3")
 *         'angle' (degrees) · 'factor' · 'count' (integer)
 *   get():       current value
 *   set(value):  apply; may return a sentence describing why it was rejected
 *   units():     current { unit, precision }
 */
export function numField({ label, kind = 'length', get, set, units, axis }) {
  const id = `f${++fieldSeq}`;
  const input = h('input', { id, type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'done' });
  const suffix = h('span.suffix');
  const el = h(`label.field${axis ? '.axis-' + axis : ''}`, { htmlFor: id }, h('span.field-label', {}, label), h('span.field-box', {}, input, suffix));
  const show = () => {
    const v = get(), u = units ? units() : { unit: 'mm', precision: 2 };
    if (kind === 'length') { input.value = formatLength(v, u, false); suffix.textContent = UNITS[u.unit].label; }
    else if (kind === 'angle') { input.value = formatNumber(v, 2); suffix.textContent = '°'; }
    else if (kind === 'count') { input.value = String(Math.round(v)); suffix.textContent = ''; }
    else { input.value = formatNumber(v, 3); suffix.textContent = '×'; }
    el.classList.remove('invalid');
  };
  const commit = () => {
    const text = input.value;
    let v = kind === 'length' ? parseLength(text, units()) : parseExpression(text);
    if (kind === 'count') v = Math.round(v);
    let problem = Number.isFinite(v) ? null : `“${text}” is not a number. Try 25, 1in or 120/3.`;
    if (!problem && v !== get()) { const r = set(v); problem = typeof r === 'string' ? r : null; }
    if (problem) {
      el.classList.add('invalid');
      toast(problem);
      setTimeout(show, 900);
    } else {
      show();
    }
  };
  input.addEventListener('change', commit);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); e.stopPropagation(); }
    if (e.key === 'Escape') { show(); input.blur(); e.stopPropagation(); }
  });
  show();
  return { el, sync: () => { if (document.activeElement !== input) show(); } };
}

/** Segmented control. options: [{ value, label }] */
export function segmented(options, get, set, label) {
  const el = h('div.segmented', { role: 'group', 'aria-label': label });
  const sync = () => {
    for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(get())));
  };
  for (const o of options) {
    el.append(h('button', { type: 'button', 'data-value': o.value, onclick: () => { set(o.value); sync(); } }, o.label));
  }
  sync();
  return { el, sync };
}

// ---- popover menu ----------------------------------------------------------
let closeCurrent = null;
export function closeMenu() { if (closeCurrent) closeCurrent(); }
/**
 * Open a menu at viewport coordinates.
 * items: { label, icon, action, checked, danger, disabled, hint }
 *        | { separator: true } | { heading: 'text' }
 */
export function openMenu(items, x, y, anchor) {
  closeMenu();
  const layer = document.getElementById('menu-layer');
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { menu.append(h('div.menu-sep')); continue; }
    if (it.heading) { menu.append(h('div.menu-heading', {}, it.heading)); continue; }
    menu.append(h(`button.menu-item${it.danger ? '.danger' : ''}`, {
      type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
      'aria-checked': it.checked === undefined ? null : String(!!it.checked),
      disabled: !!it.disabled,
      onclick: () => { close(); it.action(); },
    },
    h('span.menu-icon', { html: it.checked ? icon('check', 18) : it.icon ? icon(it.icon, 18) : '' }),
    h('span.menu-label', {}, it.label),
    it.hint ? h('span.menu-hint', {}, it.hint) : null));
  }
  layer.append(menu);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.left; y = r.bottom + 6;
    if (x + menu.offsetWidth > innerWidth - 8) x = r.right - menu.offsetWidth;
  }
  menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
  const onDown = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); e.stopPropagation(); } };
  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    closeCurrent = null;
  }
  closeCurrent = close;
  // Defer so the press that opened the menu does not close it.
  setTimeout(() => {
    if (closeCurrent !== close) return;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return close;
}

/** Fire `fn(x, y)` on right-click or a 550 ms touch / Pencil hold. */
export function onContext(el, fn) {
  let timer = 0, sx = 0, sy = 0;
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); fn(e.clientX, e.clientY); });
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { el.dataset.held = '1'; fn(sx, sy); }, 550);
  });
  const stop = () => clearTimeout(timer);
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 9) stop(); });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', stop);
}

/** Let a floating panel be dragged by its header. Calls `onMoved(left, top)`. */
export function makeDraggable(panel, handle, onMoved) {
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input')) return;
    const r = panel.getBoundingClientRect(), host = panel.offsetParent.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left - host.left, top: r.top - host.top, host };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const left = Math.max(4, Math.min(start.left + e.clientX - start.x, start.host.width - panel.offsetWidth - 4));
    const top = Math.max(4, Math.min(start.top + e.clientY - start.y, start.host.height - 44));
    Object.assign(panel.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
    start.moved = [left, top];
  });
  const end = () => { if (start && start.moved && onMoved) onMoved(...start.moved); start = null; };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
