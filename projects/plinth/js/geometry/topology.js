/**
 * geometry/topology.js — recover faces and edges from polygon soup.
 *
 * Boolean results arrive as loose convex polygons with T-junctions (one long
 * edge facing several short ones). This module:
 *   1. welds vertices,
 *   2. repairs T-junctions by splitting each polygon edge at every welded
 *      vertex lying on it, so neighbouring polygons share exact sub-edges,
 *   3. marks an edge as a real (feature) edge where the two polygons across
 *      it belong to different surfaces,
 *   4. chains feature edges into curves, each with the surface normals on
 *      both sides — the data fillet and chamfer need.
 *
 * It also converts between render meshes and polygon lists.
 */
import { makePolygon } from './csg.js';

/** Render mesh -> polygon list (one polygon per triangle). */
export function meshToPolys(mesh, matrix = null, surfaceOffset = 0) {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices, out = [];
  let nm = null, flip = false;
  if (matrix) {
    // Normal transform: inverse transpose of the upper 3×3.
    const a = matrix[0], b = matrix[1], c = matrix[2], d = matrix[4], e = matrix[5], f = matrix[6], g = matrix[8], h = matrix[9], i = matrix[10];
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
    nm = [A, B, C, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d].map((x) => x / det);
    flip = det < 0;
  }
  const vert = (k) => {
    let p = [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], n = [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]];
    if (matrix) {
      p = [matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12], matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13], matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14]];
      n = [nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2], nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2], nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
    }
    return { p, n };
  };
  for (let t = 0; t < I.length; t += 3) {
    const vs = [vert(I[t]), vert(I[t + 1]), vert(I[t + 2])];
    if (flip) vs.reverse();
    const poly = makePolygon(vs, mesh.triFace[t / 3] + surfaceOffset);
    if (poly) out.push(poly);
  }
  return out;
}

export const maxSurface = (polys) => polys.reduce((m, p) => Math.max(m, p.s), -1);

/**
 * Analyse a polygon list.
 * Returns { segments: Float32Array (feature edges, xyz pairs), curves: [Curve] }
 * Curve = { closed, sA, sB, pts:[[x,y,z]…], nA:[…], nB:[…] } where surface A
 * lies to the left when walking along pts seen from outside the solid.
 */
/**
 * Weld the vertices of a polygon list and prepare T-junction lookup.
 * Returns { verts, tol, rings, onEdge, locate } where rings[k] are the welded
 * vertex ids of polygon k, onEdge(i, j) lists the welded vertices lying on
 * the segment i→j as [id, t] pairs, and locate(p) finds a welded id (or -1).
 */
export function weldSplit(polys) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const poly of polys) for (const { p } of poly.v) for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const tol = Math.max(2e-4, diag * 2e-7);

  // 1. Weld.
  const verts = [], wcell = tol * 4, wgrid = new Map();
  const weld = (p) => {
    const gx = Math.round(p[0] / wcell), gy = Math.round(p[1] / wcell), gz = Math.round(p[2] / wcell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = wgrid.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz));
      if (list) for (const id of list) { const q = verts[id]; if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol && Math.abs(q[2] - p[2]) <= tol) return id; }
    }
    verts.push(p);
    const key = gx + ',' + gy + ',' + gz;
    let list = wgrid.get(key);
    if (!list) wgrid.set(key, list = []);
    list.push(verts.length - 1);
    return verts.length - 1;
  };
  const rings = polys.map((poly) => poly.v.map((x) => weld(x.p)));

  // 2. Coarse grid of welded vertices for on-edge queries.
  const h = Math.max(diag / 40, tol * 20), grid = new Map();
  const cellOf = (x) => Math.floor(x / h);
  verts.forEach((p, id) => {
    const key = cellOf(p[0]) + ',' + cellOf(p[1]) + ',' + cellOf(p[2]);
    let list = grid.get(key);
    if (!list) grid.set(key, list = []);
    list.push(id);
  });
  const onEdge = (i, j) => {
    const a = verts[i], b = verts[j];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    if (len < tol * 2) return [];
    const found = new Map(), seen = new Set();
    const steps = Math.max(1, Math.ceil(len / (h * 0.9)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = cellOf(a[0] + dx * t), cy = cellOf(a[1] + dy * t), cz = cellOf(a[2] + dz * t);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const key = (cx + ox) + ',' + (cy + oy) + ',' + (cz + oz);
        if (seen.has(key)) continue;
        seen.add(key);
        const list = grid.get(key);
        if (!list) continue;
        for (const id of list) {
          if (id === i || id === j) continue;
          const q = verts[id];
          const u = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy + (q[2] - a[2]) * dz) / (len * len);
          if (u * len <= tol || (1 - u) * len <= tol) continue;
          const ex = a[0] + dx * u - q[0], ey = a[1] + dy * u - q[1], ez = a[2] + dz * u - q[2];
          if (ex * ex + ey * ey + ez * ez <= tol * tol * 4) found.set(id, u);
        }
      }
    }
    return [...found.entries()].sort((x, y) => x[1] - y[1]);
  };

  const locate = (p) => {
    const gx = Math.round(p[0] / wcell), gy = Math.round(p[1] / wcell), gz = Math.round(p[2] / wcell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = wgrid.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz));
      if (list) for (const id of list) { const q = verts[id]; if (Math.abs(q[0] - p[0]) <= tol * 3 && Math.abs(q[1] - p[1]) <= tol * 3 && Math.abs(q[2] - p[2]) <= tol * 3) return id; }
    }
    return -1;
  };
  return { verts, tol, rings, onEdge, locate };
}

// Seams: pairs of flat faces that lie in one plane but must stay separate faces, because
// the user split a face on purpose. Without this, coplanar neighbours merge into one.
// The set travels with the mesh (mesh.seams) and is put in force while an operation runs.
let SEAMS = null;
const seamKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
export { seamKey };
export function withSeams(seams, fn) {
  const before = SEAMS;
  SEAMS = seams && seams.size ? seams : null;
  try { return fn(); } finally { SEAMS = before; }
}

export function analyse(polys) {
  const { verts, tol, rings, onEdge } = weldSplit(polys);

  // 3. Sub-edges and adjacency.
  const N = verts.length, adj = new Map();
  const lerpN = (n0, n1, t) => {
    const n = [n0[0] + (n1[0] - n0[0]) * t, n0[1] + (n1[1] - n0[1]) * t, n0[2] + (n1[2] - n0[2]) * t];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  polys.forEach((poly, pi) => {
    const ring = rings[pi], n = ring.length;
    for (let k = 0; k < n; k++) {
      const i = ring[k], j = ring[(k + 1) % n];
      if (i === j) continue;
      const n0 = poly.v[k].n, n1 = poly.v[(k + 1) % n].n;
      const stops = [[i, 0], ...onEdge(i, j), [j, 1]];
      for (let s = 0; s < stops.length - 1; s++) {
        const [u, tu] = stops[s], [v, tv] = stops[s + 1];
        const key = u < v ? u * N + v : v * N + u;
        let list = adj.get(key);
        if (!list) adj.set(key, list = []);
        list.push({ u, v, s: poly.s, pi, pn: poly.pn, w: poly.w, nu: lerpN(n0, n1, tu), nv: lerpN(n0, n1, tv) });
      }
    }
  });

  // 4. Feature edges: surfaces differ across the edge (or the edge is open).
  //    Also: count open / non-manifold edges, find connected parts, and note pairs of
  //    different surfaces that are really one flat face (coplanar across the edge).
  const feats = [], segments = [], merge = [];
  let open = 0;
  const part = polys.map((_, k) => k);
  const find = (x) => { while (part[x] !== x) { part[x] = part[part[x]]; x = part[x]; } return x; };
  for (const list of adj.values()) {
    const a = list[0], b = list.find((x) => x !== a && x.u === a.v && x.v === a.u) || list[1];
    for (let k = 1; k < list.length; k++) part[find(list[k].pi)] = find(a.pi);
    if (list.length !== 2) open++;
    if (list.length === 2 && a.s === b.s) continue;
    if (list.length === 2 && a.pn[0] * b.pn[0] + a.pn[1] * b.pn[1] + a.pn[2] * b.pn[2] > 1 - 1e-9 && Math.abs(a.w - b.w) < tol * 5
      && a.nu[0] * a.pn[0] + a.nu[1] * a.pn[1] + a.nu[2] * a.pn[2] > 1 - 1e-6 && b.nu[0] * b.pn[0] + b.nu[1] * b.pn[1] + b.nu[2] * b.pn[2] > 1 - 1e-6
      && !(SEAMS && SEAMS.has(seamKey(a.s, b.s)))) {
      merge.push([a.s, b.s]);
      continue;
    }
    const p = verts[a.u], q = verts[a.v];
    segments.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    if (list.length === 2 && b.u === a.v) feats.push({ u: a.u, v: a.v, sA: a.s, sB: b.s, nAu: a.nu, nAv: a.nv, nBu: b.nv, nBv: b.nu });
  }

  // 5. Chain feature edges that continue the same pair of surfaces smoothly.
  const at = new Map();
  const pairKey = (f) => (f.sA < f.sB ? f.sA + '|' + f.sB : f.sB + '|' + f.sA);
  feats.forEach((f) => {
    for (const v of [f.u, f.v]) { let l = at.get(v); if (!l) at.set(v, l = []); l.push(f); }
  });
  const dir = (f, from) => {
    const to = from === f.u ? f.v : f.u, p = verts[from], q = verts[to];
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  /** The single edge that continues `f` through vertex `v`, or null at a corner. */
  const next = (f, v) => {
    const list = at.get(v);
    if (list.length !== 2) return null;
    const g = list[0] === f ? list[1] : list[0];
    if (g === f || pairKey(g) !== pairKey(f)) return null;
    const d0 = dir(f, v === f.u ? f.v : f.u), d1 = dir(g, v);
    return d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2] > 0.82 ? g : null;
  };
  const curves = [], done = new Set();
  for (const f of feats) {
    if (done.has(f)) continue;
    // Walk backwards to the start of the chain (or all the way round a closed one).
    let first = f, start = f.u, closed = false;
    for (let guard = 0; guard < feats.length; guard++) {
      const g = next(first, start);
      if (!g) break;
      if (g === f) { closed = true; break; }
      start = g.u === start ? g.v : g.u;
      first = g;
    }
    // Walk forwards collecting stations. Orientation follows surface f.sA.
    const sA = f.sA, sB = f.sB, pts = [], nA = [], nB = [];
    let e = first, from = start;
    for (let guard = 0; guard <= feats.length && e && !done.has(e); guard++) {
      done.add(e);
      const forward = e.u === from;                 // stored direction runs with e's own surface A
      const sameSide = e.sA === sA;
      pts.push(verts[from]);
      nA.push(sameSide ? (forward ? e.nAu : e.nAv) : (forward ? e.nBu : e.nBv));
      nB.push(sameSide ? (forward ? e.nBu : e.nBv) : (forward ? e.nAu : e.nAv));
      const to = forward ? e.v : e.u;
      const g = next(e, to);
      if (!g || done.has(g)) {
        if (!closed) {
          pts.push(verts[to]);
          nA.push(sameSide ? (forward ? e.nAv : e.nAu) : (forward ? e.nBv : e.nBu));
          nB.push(sameSide ? (forward ? e.nBv : e.nBu) : (forward ? e.nAv : e.nAu));
        }
        // Surface A must be on the left: stored edges run with their own A, so flip if we walked against it.
        if (forward !== sameSide) { pts.reverse(); nA.reverse(); nB.reverse(); }
        break;
      }
      from = to;
      e = g;
    }
    if (pts.length >= 2) curves.push({ closed, sA, sB, pts, nA, nB });
  }
  const parts = new Set(polys.map((_, k) => find(k))).size;
  return { segments: new Float32Array(segments), curves, merge, open, parts };
}

/** Polygon list -> render mesh (same shape as primitive meshes) plus edge curves. */
/**
 * Remove sliver polygons: ones so thin (all corners within tolerance of one
 * line) that they enclose no area. Boolean cuts near tangent surfaces leave
 * these behind; they add nothing to the shape but confuse edge matching.
 */
export function dropSlivers(polys, tol = 4e-4) {
  return polys.filter((poly) => {
    const v = poly.v;
    let ax = 0, ay = 0, az = 0, longest = 0;
    for (let k = 0; k < v.length; k++) {
      const p = v[k].p, q = v[(k + 1) % v.length].p;
      ax += p[1] * q[2] - p[2] * q[1]; ay += p[2] * q[0] - p[0] * q[2]; az += p[0] * q[1] - p[1] * q[0];
      for (let j = k + 1; j < v.length; j++) longest = Math.max(longest, Math.hypot(v[j].p[0] - p[0], v[j].p[1] - p[1], v[j].p[2] - p[2]));
    }
    return longest > 0 && Math.hypot(ax, ay, az) / longest > tol;      // area / length ≈ width
  });
}

export function polysToMesh(polys) {
  polys = dropSlivers(polys);
  const P = [], Nn = [], I = [], F = [];
  // Surface ids must fit the Uint16 face table: renumber if a long history has pushed them up.
  if (polys.some((p) => p.s > 60000)) { const ids = new Map(); polys = polys.map((p) => { if (!ids.has(p.s)) ids.set(p.s, ids.size); return { ...p, s: ids.get(p.s) }; }); }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const poly of polys) {
    const base = P.length / 3;
    for (const { p, n } of poly.v) {
      P.push(p[0], p[1], p[2]);
      Nn.push(n[0], n[1], n[2]);
      for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
    }
    for (let k = 1; k < poly.v.length - 1; k++) { I.push(base, base + k, base + k + 1); F.push(poly.s); }
  }
  let topo = analyse(polys), seams = SEAMS;
  if (topo.merge.length) {
    // Flat faces that meet in the same plane become one face (no seam between them).
    const to = new Map();
    const root = (s) => { while (to.has(s)) s = to.get(s); return s; };
    for (const [a, b] of topo.merge) { const ra = root(a), rb = root(b); if (ra !== rb) to.set(Math.max(ra, rb), Math.min(ra, rb)); }
    polys = polys.map((p) => (to.has(p.s) ? { ...p, s: root(p.s) } : p));
    for (let k = 0; k < F.length; k++) F[k] = root(F[k]);
    // Faces that merged take the lower id: keep the seams pointing at the surviving faces.
    if (seams) seams = new Set([...seams].map((key) => { const [a, b] = key.split('|').map(Number); return seamKey(root(a), root(b)); }));
    topo = withSeams(seams, () => analyse(polys));
  }
  if (!polys.length) { min.fill(0); max.fill(0); }
  return {
    positions: new Float32Array(P), normals: new Float32Array(Nn), indices: new Uint32Array(I), triFace: new Uint16Array(F),
    edges: topo.segments, iso: new Float32Array(0), min, max, curves: topo.curves, polys,
    open: topo.open, parts: topo.parts, seams: seams || null,
  };
}

const topoCache = new WeakMap();
/** Edge curves of any mesh (computed on demand for primitives and extrusions). */
export function curvesOf(mesh) {
  if (mesh.curves) return mesh.curves;
  let c = topoCache.get(mesh);
  if (!c) topoCache.set(mesh, c = analyse(polysOf(mesh)).curves);
  return c;
}
const polyCache = new WeakMap();
export function polysOf(mesh) {
  if (mesh.polys) return mesh.polys;
  let p = polyCache.get(mesh);
  if (!p) polyCache.set(mesh, p = meshToPolys(mesh));
  return p;
}
