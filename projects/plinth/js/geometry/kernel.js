/**
 * geometry/kernel.js — the single entry point for turning a feature
 * definition into renderable, pickable geometry.
 *
 * Everything else in the app treats geometry as opaque: it hands a feature
 * ({ type, params }) to `evaluate` and gets a Mesh back. Later phases replace
 * the internals (sketch features, booleans, fillets) without touching callers.
 */
import { PRIMITIVES } from './primitives.js';
import { extrudeMesh, applyOp } from './solids.js';
import { m4 } from '../core/math.js';

const cache = new Map();
const CACHE_LIMIT = 300;

/** Evaluate a base feature (primitive or extrusion) to a mesh. Cached by parameter values. */
export function evaluate(feature) {
  const hit = fast.get(feature.params);
  if (hit && hit.type === feature.type) return hit.mesh;
  const key = feature.type + JSON.stringify(feature.params);
  let mesh = cache.get(key);
  if (!mesh) {
    if (feature.type === 'extrude') mesh = extrudeMesh(feature.params);
    else {
      const def = PRIMITIVES[feature.type];
      if (!def) throw new Error(`Unknown feature type "${feature.type}"`);
      mesh = def.build(feature.params);
    }
    remember(key, mesh);
  }
  fast.set(feature.params, { type: feature.type, mesh });
  return mesh;
}

// Two cache levels: object identity (free, used every frame) and value keys
// (survive undo/redo, which replaces the document objects).
const fast = new WeakMap();
const bodyFast = new WeakMap();
function remember(key, mesh) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, mesh);
}

/**
 * Evaluate a body: its base feature followed by its operations (booleans,
 * fillets, chamfers) in order. If an operation can no longer be computed the
 * result is the last valid mesh, with `error` and `failedOp` set so the UI
 * can explain instead of showing corrupt geometry.
 *
 * Convention: `node.ops` and `feature.params` are replaced, never mutated,
 * when they change, so identity can be used as a cache key.
 */
let defaultResolve = null;
/** Tell the kernel how to look up other bodies by id (for linked steps). */
export function setResolver(fn) { defaultResolve = fn; }

export function evaluateBody(node, resolve = defaultResolve, depth = 0) {
  const ops = node.ops;
  if (!ops || !ops.length) return evaluate(node.feature);
  // Linked steps depend on another body: fold its identity and both transforms into the cache check.
  let sig = '';
  if (ops.some((o) => o.ref)) {
    sig = ops.map((o) => {
      if (!o.ref || o.off) return '';
      const r = resolve && resolve(o.ref);
      return r ? `${oid(r.feature.params)}:${oid(r.ops || NONE)}:${JSON.stringify(r.transform)}:${JSON.stringify(node.transform)}` : 'missing';
    }).join('|');
  }
  const hit = bodyFast.get(ops);
  if (hit && hit.params === node.feature.params && hit.sig === sig) return hit.mesh;
  let mesh = evaluate(node.feature);
  let key = node.feature.type + JSON.stringify(node.feature.params);
  for (let k = 0; k < ops.length; k++) {
    let op = ops[k];
    if (op.off) continue;                       // step switched off
    let tool = null, problem = null;
    if (op.ref) {
      const r = resolve && resolve(op.ref);
      if (!r || depth > 3) problem = 'The object this step is linked to no longer exists. Remove the step, or undo the deletion.';
      else {
        tool = evaluateBody(r, resolve, depth + 1);
        const matrix = Array.from(m4.mul(m4.invert(compose(node)), compose(r)));
        op = { ...op, matrix };
        key += '|ref' + r.feature.type + JSON.stringify(r.feature.params) + JSON.stringify(r.ops || 0) + matrix.map((x) => x.toFixed(6)).join(',') + op.op;
      }
    } else {
      if (op.tool) tool = op.tool.feature ? evaluateBody(op.tool) : evaluate(op.tool);
      key += '|' + JSON.stringify(ops[k]);
    }
    let next = problem ? { ...mesh, error: problem, failedOp: k } : cache.get(key);
    if (!next) {
      try {
        next = applyOp(mesh, op, tool);
      } catch (err) {
        next = { ...mesh, error: err.message, failedOp: k };
      }
      remember(key, next);
    }
    if (next.error) { mesh = next; break; }
    mesh = next;
  }
  bodyFast.set(ops, { params: node.feature.params, sig, mesh });
  return mesh;
}
const NONE = [];
const ids = new WeakMap();
let nextOid = 1;
function oid(obj) { let v = ids.get(obj); if (!v) ids.set(obj, v = nextOid++); return v; }
const compose = (node) => m4.compose(node.transform.p, node.transform.q, node.transform.s);

export const defaultParams = (type) =>
  Object.fromEntries(PRIMITIVES[type].params.map((p) => [p.key, p.default]));

/**
 * Check a parameter set. Returns null when valid, otherwise a sentence
 * explaining what is wrong, so the UI never builds broken geometry silently.
 */
export function validateParams(type, params) {
  const def = PRIMITIVES[type];
  for (const p of def.params) {
    const v = params[p.key];
    if (!Number.isFinite(v)) return `${p.label} needs a number.`;
    if (p.min !== undefined && v < p.min) return `${p.label} must be ${p.min > 0.001 ? 'at least ' + p.min : p.min === 0 ? 'zero or more' : 'greater than zero'}.`;
    if (p.max !== undefined && v > p.max) return `${p.label} can be at most ${p.max}.`;
  }
  return def.validate ? def.validate(params) : null;
}

/**
 * Nearest ray hit on a mesh in its local space.
 * Returns { t, face, normal } or null. Möller–Trumbore, two-sided.
 */
export function raycastMesh(mesh, o, d) {
  const P = mesh.positions, I = mesh.indices;
  let best = null;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-9 && (!best || t < best.t)) {
      best = { t, face: mesh.triFace[k / 3], normal: [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x] };
    }
  }
  return best;
}
