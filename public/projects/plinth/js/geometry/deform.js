/**
 * geometry/deform.js — move corner points of a solid.
 *
 * The solid is first made conforming (every polygon edge split at every
 * vertex lying on it, then each polygon fanned around its centre), so
 * neighbouring pieces share exact vertices and the shape stays closed
 * whatever moves. Then:
 *   - the chosen corner points take the full displacement,
 *   - points along an edge that ends at a moved corner follow in proportion
 *     to their distance along the edge (so straight edges stay straight),
 *   - points inside the faces next to those edges follow a smooth blend of
 *     their face's boundary (inverse-distance weighting),
 *   - surfaces that do not touch a moved edge are left exactly as they were.
 */
import { v3 } from '../core/math.js';
import { makePolygon } from './csg.js';
import { weldSplit, polysOf, curvesOf, polysToMesh } from './topology.js';

export function movePoints(mesh, op) {
  const polys = polysOf(mesh), curves = curvesOf(mesh);
  const { verts, rings, onEdge, locate } = weldSplit(polys);
  const picked = new Set();
  for (const p of op.pts) { const id = locate(p); if (id >= 0) picked.add(id); }
  if (!picked.size) throw new Error('The points this step moved no longer exist on the body. Remove the step, or undo the change that removed them.');
  const delta = op.delta;

  // Displacement along edges that end at a moved corner; note which surfaces they border.
  const disp = new Map(), boundary = new Map();     // vertex id -> vector ; surface -> Set(vertex id)
  const affected = new Set();
  const chains = curves.map((c) => ({ c, ids: c.pts.map((p) => locate(p)) }));
  for (const { c, ids } of chains) {
    const d0 = !c.closed && picked.has(ids[0]) ? 1 : 0, d1 = !c.closed && picked.has(ids[ids.length - 1]) ? 1 : 0;
    if (d0 || d1) {
      affected.add(c.sA); affected.add(c.sB);
      const len = [0];
      for (let k = 1; k < c.pts.length; k++) len.push(len[k - 1] + v3.dist(c.pts[k - 1], c.pts[k]));
      const total = len[len.length - 1] || 1;
      ids.forEach((id, k) => { const t = len[k] / total, w = d0 * (1 - t) + d1 * t; if (id >= 0) disp.set(id, v3.scale(delta, w)); });
    }
  }
  for (const { c, ids } of chains) {
    for (const s of [c.sA, c.sB]) {
      if (!affected.has(s)) continue;
      if (!boundary.has(s)) boundary.set(s, new Set());
      for (const id of ids) if (id >= 0) boundary.get(s).add(id);
    }
  }
  const zero = [0, 0, 0];
  const dOf = (id) => disp.get(id) || zero;

  // Per affected surface, set up the blend used for points inside the face. Flat (or nearly
  // flat) faces use mean value coordinates over their outline, which reproduce straight-line
  // behaviour exactly, so a face whose corners move stays an even, uncreased surface.
  // Surfaces that wrap around (cylinder walls) fall back to inverse-distance weighting.
  const setup = new Map();
  for (const s of affected) {
    let nx = 0, ny = 0, nz = 0, area = 0;
    for (const poly of polys) {
      if (poly.s !== s) continue;
      let ax = 0, ay = 0, az = 0;
      for (let k = 1; k < poly.v.length - 1; k++) { const c = v3.cross(v3.sub(poly.v[k].p, poly.v[0].p), v3.sub(poly.v[k + 1].p, poly.v[0].p)); ax += c[0]; ay += c[1]; az += c[2]; }
      nx += ax; ny += ay; nz += az; area += Math.hypot(ax, ay, az);
    }
    const flatness = Math.hypot(nx, ny, nz) / (area || 1);
    // Outline loops, walked with the face on the left.
    const pieces = chains.filter(({ c }) => c.sA === s || c.sB === s).map(({ c, ids }) => {
      const list = c.sA === s ? ids.slice() : ids.slice().reverse();
      return c.closed ? [...list, list[0]] : list;
    });
    const loops = [];
    let ok = flatness > 0.7 && pieces.every((l) => l.every((id) => id >= 0));
    while (ok && pieces.length) {
      const loop = pieces.shift().slice();
      for (let guard = 0; loop[loop.length - 1] !== loop[0]; guard++) {
        const k = pieces.findIndex((q) => q[0] === loop[loop.length - 1]);
        if (k < 0 || guard > 10000) { ok = false; break; }
        loop.push(...pieces.splice(k, 1)[0].slice(1));
      }
      loop.pop();
      if (loop.length >= 3) loops.push(loop);
    }
    if (!ok || !loops.length) { setup.set(s, null); continue; }
    const n = v3.norm([nx, ny, nz]), o = verts[loops[0][0]];
    const u = v3.norm(v3.cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), w = v3.cross(n, u);
    const flat2 = (p) => { const d = v3.sub(p, o); return [v3.dot(d, u), v3.dot(d, w)]; };
    setup.set(s, { flat2, loops: loops.map((l) => ({ xy: l.map((id) => flat2(verts[id])), d: l.map(dOf) })) });
  }
  function meanValue(cfg, p) {
    const [x, y] = cfg.flat2(p);
    let sx = 0, sy = 0, sz = 0, wsum = 0;
    for (const { xy, d } of cfg.loops) {
      const m = xy.length, r = new Array(m), t = new Array(m);
      for (let k = 0; k < m; k++) r[k] = Math.hypot(xy[k][0] - x, xy[k][1] - y);
      for (let k = 0; k < m; k++) {
        const j = (k + 1) % m;
        if (r[k] < 1e-9) return d[k];
        const ax = xy[k][0] - x, ay = xy[k][1] - y, bx = xy[j][0] - x, by = xy[j][1] - y;
        const cross = ax * by - ay * bx, dot = ax * bx + ay * by;
        if (Math.abs(cross) < 1e-12 * (r[k] * r[j] + 1e-12)) {
          if (dot < 0) { const f = r[k] / (r[k] + r[j]); return v3.lerp(d[k], d[j], f); }   // on this outline segment
          t[k] = 0;
        } else t[k] = (r[k] * r[j] - dot) / cross;
      }
      for (let k = 0; k < m; k++) {
        const wgt = (t[(k - 1 + m) % m] + t[k]) / r[k];
        wsum += wgt; sx += wgt * d[k][0]; sy += wgt * d[k][1]; sz += wgt * d[k][2];
      }
    }
    return Math.abs(wsum) > 1e-12 ? [sx / wsum, sy / wsum, sz / wsum] : zero;
  }
  /** Displacement of any point of an affected surface: exact on its boundary, blended inside. */
  const field = (s, id, p) => {
    if (id >= 0 && disp.has(id)) return disp.get(id);
    const edge = boundary.get(s);
    if (!edge || (id >= 0 && edge.has(id))) return zero;
    const cfg = setup.get(s);
    if (cfg) return meanValue(cfg, p);
    let wx = 0, wy = 0, wz = 0, wsum = 0;
    for (const b of edge) {
      const q = verts[b], d2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d2 < 1e-12) return disp.get(b) || zero;
      const w = 1 / d2, d = disp.get(b);
      wsum += w;
      if (d) { wx += w * d[0]; wy += w * d[1]; wz += w * d[2]; }
    }
    return wsum ? [wx / wsum, wy / wsum, wz / wsum] : zero;
  };

  const out = [], smooth = new Map();     // "surface:vertex" -> accumulated normal
  const tris = [];
  polys.forEach((poly, pi) => {
    if (!affected.has(poly.s)) { out.push(poly); return; }
    // Conforming ring: original corners plus every vertex lying on an edge.
    const ring = rings[pi], n = ring.length, pts = [];
    for (let k = 0; k < n; k++) {
      const i = ring[k], j = ring[(k + 1) % n];
      pts.push(i);
      if (i !== j) for (const [id] of onEdge(i, j)) pts.push(id);
    }
    const moved = pts.map((id) => v3.add(verts[id], field(poly.s, id, verts[id])));
    if (pts.length === 3) {
      // Already a conforming triangle: keep it as one piece.
      const fn = v3.cross(v3.sub(moved[1], moved[0]), v3.sub(moved[2], moved[0]));
      if (v3.len(fn) < 1e-12) return;
      tris.push({ s: poly.s, p: moved, keys: pts, fn });
      for (const key of pts) { const id = poly.s + ':' + key, acc = smooth.get(id); smooth.set(id, acc ? v3.add(acc, fn) : fn); }
      return;
    }
    let c = [0, 0, 0];
    for (const id of pts) c = v3.add(c, verts[id]);
    c = v3.scale(c, 1 / pts.length);
    const centre = v3.add(c, field(poly.s, -1, c));
    for (let k = 0; k < pts.length; k++) {
      const j = (k + 1) % pts.length;
      if (pts[k] === pts[j]) continue;
      const a = moved[k], b = moved[j];
      const fn = v3.cross(v3.sub(a, centre), v3.sub(b, centre));
      if (v3.len(fn) < 1e-12) continue;
      const tri = { s: poly.s, p: [centre, a, b], keys: [`c${pi}`, pts[k], pts[j]], fn };
      tris.push(tri);
      for (const key of tri.keys) {
        const id = poly.s + ':' + key, acc = smooth.get(id);
        smooth.set(id, acc ? v3.add(acc, fn) : fn);       // area-weighted
      }
    }
  });
  // Faces that bent are shaded smoothly within themselves; edges between faces stay sharp.
  for (const t of tris) {
    const poly = makePolygon(t.p.map((p, k) => ({ p, n: v3.norm(smooth.get(t.s + ':' + t.keys[k])) })), t.s);
    if (poly) out.push(poly);
  }
  return polysToMesh(out);
}
