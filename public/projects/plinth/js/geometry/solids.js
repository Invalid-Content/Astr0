/**
 * geometry/solids.js — solid features built on real geometry:
 *   extrudeMesh()      region (outer loop + holes) -> prism with tracked faces
 *   applyOp()          boolean / fillet / chamfer applied to a body mesh
 *   edgeSpec()         freeze an edge curve into the data a fillet op stores
 *
 * Fillet and chamfer work by sweeping a cutter profile along the edge and
 * combining it with the body: for a convex edge the cutter (corner minus the
 * rolling circle) is subtracted; for a concave edge the same profile is added.
 */
import { v3 } from '../core/math.js';
import { triangulate } from './sketch2d.js';
import { makePolygon, boolean, splitPolygon } from './csg.js';
import { meshToPolys, polysToMesh, polysOf, maxSurface, curvesOf, analyse, withSeams, seamKey } from './topology.js';
import { movePoints } from './deform.js';

// ---------------------------------------------------------------------------
/**
 * Extrusion.
 * params: { u, v, n: plane axes (unit vectors), z0, z1: extent along n,
 *           loops: [{ p:[x0,y0,x1,y1…], g:[group per segment], c:[group is curved] }] }
 * The first loop is the outer boundary (counter-clockwise), the rest are holes
 * (clockwise). Segments sharing a group form one wall surface; curved groups
 * get smooth normals.
 */
export function extrudeMesh({ u, v, n, z0, z1, loops }) {
  const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
  const P = [], N = [], I = [], F = [], E = [];
  const at = (x, y, z) => [u[0] * x + v[0] * y + n[0] * z, u[1] * x + v[1] * y + n[1] * z, u[2] * x + v[2] * y + n[2] * z];
  const dir = (x, y) => [u[0] * x + v[0] * y, u[1] * x + v[1] * y, u[2] * x + v[2] * y];
  const push = (p, nn) => { P.push(p[0], p[1], p[2]); N.push(nn[0], nn[1], nn[2]); return P.length / 3 - 1; };
  let surface = 2, groupBase = 0;
  const rings = loops.map((l) => { const pts = []; for (let k = 0; k < l.p.length; k += 2) pts.push([l.p[k], l.p[k + 1]]); return pts; });

  // Caps.
  const cap = triangulate(rings[0], rings.slice(1));
  for (const [z, nn, face, flip] of [[hi, n, 0, false], [lo, v3.scale(n, -1), 1, true]]) {
    const ids = cap.pts.map(([x, y]) => push(at(x, y, z), nn));
    for (let t = 0; t < cap.tris.length; t += 3) {
      const a = ids[cap.tris[t]], b = ids[cap.tris[t + 1]], c = ids[cap.tris[t + 2]];
      if (flip) I.push(a, c, b); else I.push(a, b, c);
      F.push(face);
    }
  }
  // Walls.
  loops.forEach((loop, li) => {
    const pts = rings[li], m = pts.length;
    const segN = pts.map((p, k) => {
      const q = pts[(k + 1) % m], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      return [dy / l, -dx / l];
    });
    const smoothAt = (k) => {                  // vertex k joins segment k-1 and segment k
      const prev = (k - 1 + m) % m;
      return loop.g[prev] === loop.g[k] && loop.c[loop.g[k]];
    };
    const vertN = (k, seg) => {
      if (!smoothAt(k)) return segN[seg];
      const a = segN[(k - 1 + m) % m], b = segN[k], l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
      return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
    };
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m, p = pts[k], q = pts[j];
      const n0 = vertN(k, k), n1 = vertN(j, k);
      const a = push(at(p[0], p[1], lo), dir(n0[0], n0[1])), b = push(at(q[0], q[1], lo), dir(n1[0], n1[1]));
      const c = push(at(q[0], q[1], hi), dir(n1[0], n1[1])), d = push(at(p[0], p[1], hi), dir(n0[0], n0[1]));
      I.push(a, b, c, a, c, d);
      const s = surface + groupBase + loop.g[k];
      F.push(s, s);
      E.push(...at(p[0], p[1], lo), ...at(q[0], q[1], lo), ...at(p[0], p[1], hi), ...at(q[0], q[1], hi));
      if (!smoothAt(k)) E.push(...at(p[0], p[1], lo), ...at(p[0], p[1], hi));
    }
    groupBase += loop.c.length;
  });
  const positions = new Float32Array(P);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < positions.length; k += 3) for (let a = 0; a < 3; a++) { if (positions[k + a] < min[a]) min[a] = positions[k + a]; if (positions[k + a] > max[a]) max[a] = positions[k + a]; }
  return { positions, normals: new Float32Array(N), indices: new Uint32Array(I), triFace: new Uint16Array(F), edges: new Float32Array(E), iso: new Float32Array(0), min, max };
}

// ---------------------------------------------------------------------------
/** Is a point inside a closed mesh? Counts crossings of an arbitrary ray. */
export function pointInside(mesh, p) {
  const P = mesh.positions, I = mesh.indices, d = [0.5257311, 0.3249197, 0.7861514];
  let count = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const tx = p[0] - P[a], ty = p[1] - P[a + 1], tz = p[2] - P[a + 2];
    const uu = (tx * px + ty * py + tz * pz) / det;
    if (uu < 0 || uu >= 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const vv = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
    if (vv < 0 || uu + vv >= 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) / det > 1e-9) count++;
  }
  return count % 2 === 1;
}

/**
 * Freeze an edge curve (from topology.curvesOf) into a plain-data spec:
 * { closed, convex, st: [p(3), tA(3), tB(3), nA(3), nB(3)] per station }
 * tA / tB point from the edge into each neighbouring face, across the edge.
 */
export function edgeSpec(curve) {
  const { pts, nA, nB, closed } = curve, m = pts.length;
  // Drop interior stations of straight runs so straight edges sweep in one piece.
  const keep = [];
  for (let k = 0; k < m; k++) {
    if (!closed && (k === 0 || k === m - 1)) { keep.push(k); continue; }
    const a = pts[(k - 1 + m) % m], b = pts[k], c = pts[(k + 1) % m];
    const d0 = v3.norm(v3.sub(b, a)), d1 = v3.norm(v3.sub(c, b));
    // Points that merely subdivide a straight stretch (left by earlier cuts) are not real stations.
    if (v3.dot(d0, d1) < 1 - 1e-9) keep.push(k);
  }
  if (keep.length < 2) keep.splice(0, keep.length, 0, m - 1);
  const st = [];
  keep.forEach((k, i) => {
    const prev = pts[keep[(i - 1 + keep.length) % keep.length]], nextP = pts[keep[(i + 1) % keep.length]];
    let d;
    if (closed || (i > 0 && i < keep.length - 1)) d = v3.norm(v3.sub(nextP, prev));
    else d = i === 0 ? v3.norm(v3.sub(nextP, pts[k])) : v3.norm(v3.sub(pts[k], prev));
    const a = v3.norm(nA[k]), b = v3.norm(nB[k]);
    const tA = v3.norm(v3.cross(a, d)), tB = v3.norm(v3.cross(b, v3.scale(d, -1)));
    st.push(...pts[k], ...tA, ...tB, ...a, ...b);
  });
  const mid = Math.floor(keep.length / 2) * 15;
  const convex = v3.dot(st.slice(mid + 12, mid + 15), st.slice(mid + 3, mid + 6)) < 0;
  return { closed, convex, st: st.map((x) => Math.round(x * 1e6) / 1e6) };
}

/**
 * Build the swept cutter for one edge as a closed polygon list.
 * `la`, `lb`: setback along each face; `round`: true for a fillet arc, false
 * for a straight chamfer. `extend`: [start, end] lengthen the open ends.
 */
function sweepCutter(spec, la, lb, round, extend, firstSurface) {
  const sgn = spec.convex ? 1 : -1, count = spec.st.length / 15;
  const eps = Math.max(0.004, Math.min(la, lb) * 0.02);
  const rings = [], arcNormals = [];
  let arcCount = 0;
  for (let k = 0; k < count; k++) {
    const o = k * 15, g = (i) => spec.st.slice(o + i, o + i + 3);
    const E = g(0), tA = g(3), tB = g(6), nA = g(9), nB = g(12);
    const TA = v3.addScaled(E, tA, la), TB = v3.addScaled(E, tB, lb);
    const ring = [TA, v3.addScaled(TA, nA, sgn * eps), v3.addScaled(E, v3.add(nA, nB), sgn * eps), v3.addScaled(TB, nB, sgn * eps), TB];
    const normals = [];
    if (round) {
      // Circle tangent to both faces: centre on the bisector.
      const cosT = Math.max(-0.999, Math.min(0.999, v3.dot(tA, tB))), half = Math.acos(cosT) / 2;
      const r = la * Math.tan(half), C = v3.addScaled(E, v3.norm(v3.add(tA, tB)), r / Math.sin(half));
      const a = v3.sub(TB, C), b = v3.sub(TA, C), omega = Math.PI - 2 * half;
      const steps = Math.max(3, Math.ceil(omega / (Math.PI / 20)));
      arcCount = steps - 1;
      normals.push(v3.scale(v3.norm(a), -1));
      for (let s = 1; s < steps; s++) {
        const t = s / steps, w0 = Math.sin((1 - t) * omega) / Math.sin(omega), w1 = Math.sin(t * omega) / Math.sin(omega);
        const d = v3.add(v3.scale(a, w0), v3.scale(b, w1));
        ring.push(v3.add(C, d));
        normals.push(v3.scale(v3.norm(d), -1));
      }
      normals.push(v3.scale(v3.norm(b), -1));
    }
    rings.push(ring);
    arcNormals.push(normals);
  }
  // Lengthen open ends so the cutter passes cleanly through the end faces.
  if (!spec.closed) {
    const shift = (ring, other, amount) => {
      const d = v3.norm(v3.sub(ring[2], other[2]));
      return ring.map((p) => v3.addScaled(p, d, amount));
    };
    if (extend[0]) rings[0] = shift(rings[0], rings[1], extend[0]);
    if (extend[1]) rings[count - 1] = shift(rings[count - 1], rings[count - 2], extend[1]);
  }
  const m = rings[0].length, tris = [];
  const add = (a, b, c, s, na, nb, nc) => tris.push({ p: [a, b, c], s, n: na ? [na, nb, nc] : null });
  const spans = spec.closed ? count : count - 1;
  for (let k = 0; k < spans; k++) {
    const r0 = rings[k], r1 = rings[(k + 1) % count], n0 = arcNormals[k], n1 = arcNormals[(k + 1) % count];
    for (let e = 0; e < m; e++) {
      const f = (e + 1) % m;
      // Ring edges 4.. (TB → arc → TA) form the blend surface; the rest are flat flaps.
      const blend = e >= 4;
      const s = firstSurface + (blend ? 4 : e);
      if (blend && round) {
        const i0 = e - 4, i1 = i0 + 1;
        add(r0[e], r0[f], r1[f], s, n0[i0], n0[i1], n1[i1]);
        add(r0[e], r1[f], r1[e], s, n0[i0], n1[i1], n1[i0]);
      } else {
        add(r0[e], r0[f], r1[f], s);
        add(r0[e], r1[f], r1[e], s);
      }
    }
  }
  if (!spec.closed) {
    // Caps: fans from the outer corner, wound opposite ways at the two ends.
    for (let e = 0; e < m; e++) {
      const f = (e + 1) % m;
      if (e === 2 || f === 2) continue;
      add(rings[0][2], rings[0][f], rings[0][e], firstSurface + 5);
      add(rings[count - 1][2], rings[count - 1][e], rings[count - 1][f], firstSurface + 6);
    }
  }
  // The construction is consistently wound; make it face outward (positive volume).
  let vol = 0;
  for (const t of tris) vol += v3.dot(t.p[0], v3.cross(t.p[1], t.p[2]));
  const polys = [];
  for (const t of tris) {
    let [a, b, c] = t.p, nn = t.n;
    if (vol < 0) { [b, c] = [c, b]; if (nn) nn = [nn[0], nn[2], nn[1]]; }
    const fn = v3.cross(v3.sub(b, a), v3.sub(c, a));
    if (v3.len(fn) < 1e-14) continue;
    const flat = v3.norm(fn);
    const poly = makePolygon([{ p: a, n: nn ? nn[0] : flat }, { p: b, n: nn ? nn[1] : flat }, { p: c, n: nn ? nn[2] : flat }], t.s);
    if (poly) polys.push(poly);
  }
  return polys;
}

/** Signed volume of a polygon list (positive when faces point outward). */
export function volume(polys) {
  let vol = 0;
  for (const poly of polys) {
    for (let k = 1; k < poly.v.length - 1; k++) vol += v3.dot(poly.v[0].p, v3.cross(poly.v[k].p, poly.v[k + 1].p));
  }
  return vol / 6;
}

function blend(mesh, op) {
  const round = op.type === 'fillet';
  const size = round ? op.radius : op.distance;
  if (!(size > 0)) throw new Error(round ? 'The fillet radius must be greater than zero.' : 'The chamfer distance must be greater than zero.');
  let polys = polysOf(mesh);
  const before = Math.abs(volume(polys));
  for (const spec of op.edges) {
    const count = spec.st.length / 15, g = (k, i) => spec.st.slice(k * 15 + i, k * 15 + i + 3);
    const sgn = spec.convex ? 1 : -1;
    // Setbacks. A fillet of radius r on faces meeting at angle θ sets back r / tan(θ/2).
    const cosT = Math.max(-0.999, Math.min(0.999, v3.dot(g(0, 3), g(0, 6)))), half = Math.acos(cosT) / 2;
    const la = round ? size / Math.tan(half) : size;
    const lb = round ? la : size * Math.tan(((op.angle ?? 45) * Math.PI) / 180);
    // The setback must still land on both faces, at every station.
    const delta = Math.max(1e-3, la * 1e-3);
    for (let k = 0; k < count; k += Math.max(1, Math.floor(count / 8))) {
      for (const [t, nn, l] of [[g(k, 3), g(k, 9), la], [g(k, 6), g(k, 12), lb]]) {
        // Probe just short of the setback line, nudged toward the neighbouring station so it
        // sits inside the face rather than on its boundary.
        const other = k + 1 < count ? k + 1 : k - 1;
        const along = v3.norm(v3.sub(g(other, 0), g(k, 0)));
        const base = v3.addScaled(v3.addScaled(g(k, 0), t, l * 0.985), along, delta * 3);
        const inside = pointInside(mesh, v3.addScaled(base, nn, -delta)), outside = !pointInside(mesh, v3.addScaled(base, nn, delta));
        if (!inside || !outside) {
          throw new Error(round
            ? 'This radius is too large for the selected edge: the rounding would run past the neighbouring face. Try a smaller radius.'
            : 'This chamfer is too large for the selected edge. Try a smaller distance.');
        }
      }
    }
    // On curved edges the setback lines must not fold back on themselves.
    for (let k = 0; k + 1 < count + (spec.closed ? 1 : 0) && count > 2; k++) {
      const j = (k + 1) % count, step = v3.sub(g(j, 0), g(k, 0));
      for (const [i, l] of [[3, la], [6, lb]]) {
        const moved = v3.sub(v3.addScaled(g(j, 0), g(j, i), l), v3.addScaled(g(k, 0), g(k, i), l));
        if (v3.dot(moved, step) <= 1e-9) throw new Error(round ? 'This radius is too large for the curvature of the selected edge. Try a smaller radius.' : 'This chamfer is too large for the curvature of the selected edge.');
      }
    }
    // Lengthen an open end where the edge runs out into open space (convex) or into material (concave).
    const extend = [0, 0];
    if (!spec.closed) {
      const len = Math.max(0.02, la * 0.05);
      for (const [end, k, other] of [[0, 0, 1], [1, count - 1, count - 2]]) {
        const out = v3.norm(v3.sub(g(k, 0), g(other, 0)));
        const probe = v3.addScaled(v3.addScaled(g(k, 0), out, len * 0.5), v3.add(g(k, 3), g(k, 6)), Math.min(la, lb) * 0.3);
        const filled = pointInside(mesh, probe);
        if (spec.convex ? !filled : filled) extend[end] = len;
      }
    }
    const cutter = sweepCutter(spec, la, lb, round, extend, maxSurface(polys) + 1);
    polys = boolean(polys, cutter, sgn > 0 ? 'subtract' : 'union');
  }
  if (!polys.length) throw new Error('The operation removed the whole body.');
  const after = Math.abs(volume(polys));
  if (!Number.isFinite(after) || after < before * 1e-6) throw new Error('The operation did not produce a valid solid.');
  return polysToMesh(polys);
}

/**
 * Combine neighbouring faces that lie in the same plane into one face.
 * op: { type:'merge', faces:[surface ids] }. Refuses faces that are not
 * coplanar or do not share an edge, so nothing is merged by mistake.
 */
function mergeFaces(mesh, op) {
  const polys = polysOf(mesh), ids = new Set(op.faces);
  const mine = polys.filter((p) => ids.has(p.s));
  if (new Set(mine.map((p) => p.s)).size < 2) throw new Error('The faces this step combined no longer exist separately. Remove the step.');
  // Same plane: normals within about half a degree and no step between the faces.
  const ref = mine[0];
  let size = 0;
  for (const p of mine) for (const v of p.v) size = Math.max(size, v3.dist(v.p, ref.v[0].p));
  for (const p of mine) {
    if (v3.dot(p.pn, ref.pn) < 0.99996) throw new Error('These faces are at different angles, so they cannot be combined into one flat face.');
    for (const v of p.v) if (Math.abs(v3.dot(v.p, ref.pn) - ref.w) > Math.max(1e-3, size * 2e-4)) throw new Error('These faces are parallel but not level with each other, so they cannot be combined.');
  }
  // Next to each other: every face must be reachable from the first across shared edges.
  const link = new Map([...ids].map((s) => [s, s]));
  const find = (s) => { while (link.get(s) !== s) s = link.get(s); return s; };
  for (const c of curvesOf(mesh)) if (ids.has(c.sA) && ids.has(c.sB)) link.set(find(c.sA), find(c.sB));
  // Faces that are exactly level meet along edges the analysis reports as mergeable pairs.
  for (const [x, y] of analyse(polys).merge) if (ids.has(x) && ids.has(y)) link.set(find(x), find(y));
  if (new Set([...ids].map(find)).size > 1) throw new Error('These faces do not share an edge. Only faces that are next to each other can be combined.');
  const target = Math.min(...ids);
  return polysToMesh(polys.map((p) => (ids.has(p.s) ? { ...p, s: target, pn: ref.pn, w: ref.w } : p)));
}

/**
 * Split faces with evenly spaced cuts across a straight edge (a "loop cut").
 * op: { type:'split', a, b, count, scope:'ring'|'face', face, faces:[sA, sB] }
 *   a, b    ends of the edge, in the body's own coordinates. The cuts are planes at right
 *           angles to it, at k / (count + 1) of the way along.
 *   scope   'face': only `face` is cut. 'ring': every face the cut passes through, working
 *           outwards from the two faces of the edge across the edges the cut crosses.
 * Each piece becomes its own face. Pieces of a flat face are recorded as seams so they are
 * not merged back together. The mesh also carries `cuts`, the new edges, for previews.
 */
function splitFaces(mesh, op) {
  const polys = polysOf(mesh);
  const d = v3.sub(op.b, op.a), len = v3.len(d);
  if (len < 1e-9) throw new Error('The edge this split was measured from has no length.');
  const n = v3.scale(d, 1 / len), base = v3.dot(n, op.a);
  const count = Math.max(1, Math.min(64, Math.round(op.count)));
  const planes = Array.from({ length: count }, (_, k) => base + len * (k + 1) / (count + 1));
  const present = new Set(polys.map((p) => p.s));
  // Which faces each cut goes through.
  let targets;
  if (op.scope === 'face') {
    if (!present.has(op.face)) throw new Error('The face this step split no longer exists. Remove the step.');
    targets = planes.map(() => new Set([op.face]));
  } else {
    const start = (op.faces || []).filter((s) => present.has(s));
    if (!start.length) throw new Error('The faces this step split no longer exist. Remove the step.');
    const curves = curvesOf(mesh);
    targets = planes.map((w) => {
      const link = new Map();
      for (const c of curves) {
        let lo = Infinity, hi = -Infinity;
        for (const p of c.pts) { const t = v3.dot(n, p) - w; if (t < lo) lo = t; if (t > hi) hi = t; }
        if (lo > -1e-6 || hi < 1e-6) continue;             // this edge is not crossed by the cut
        for (const [x, y] of [[c.sA, c.sB], [c.sB, c.sA]]) { let l = link.get(x); if (!l) link.set(x, l = []); l.push(y); }
      }
      const seen = new Set(start), queue = [...start];
      while (queue.length) for (const y of link.get(queue.pop()) || []) if (!seen.has(y)) { seen.add(y); queue.push(y); }
      return seen;
    });
  }
  // Cut, then give every piece of a face beyond the first its own id.
  let next = maxSurface(polys) + 1, did = 0;
  const ids = new Map(), cuts = [], out = [], seams = new Set(mesh.seams || []);
  for (const poly of polys) {
    const mine = planes.filter((_, k) => targets[k].has(poly.s));
    if (!mine.length) { out.push(poly); continue; }
    let pieces = [poly];
    for (const w of mine) {
      const front = [], back = [];
      for (const p of pieces) {
        const before = front.length + back.length;
        splitPolygon(n, w, p, front, front, front, back);
        if (front.length + back.length - before === 2) {
          did++;
          const on = front[front.length - 1].v.filter((v) => Math.abs(v3.dot(n, v.p) - w) < 1e-5).map((v) => v.p);
          if (on.length >= 2) cuts.push(...on[0], ...on[on.length - 1]);
        }
      }
      pieces = front.concat(back);
    }
    for (const p of pieces) {
      let c = 0;
      for (const v of p.v) c += v3.dot(n, v.p);
      c /= p.v.length;
      const slab = mine.filter((w) => w < c).length;
      if (!slab) { out.push(p); continue; }
      const key = poly.s + ':' + slab;
      if (!ids.has(key)) ids.set(key, next++);
      out.push({ ...p, s: ids.get(key) });
    }
  }
  if (!did) throw new Error('The cut does not pass through that face, so there is nothing to split.');
  // Pieces of one original face must stay apart even though they lie in the same plane.
  const family = new Map();
  for (const [key, id] of ids) { const s = Number(key.split(':')[0]); if (!family.has(s)) family.set(s, [s]); family.get(s).push(id); }
  for (const list of family.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) seams.add(seamKey(list[i], list[j]));
  // A piece also stays apart from whatever its parent face was already kept apart from.
  for (const key of mesh.seams || []) {
    const [x, y] = key.split('|').map(Number);
    for (const id of (family.get(x) || []).slice(1)) seams.add(seamKey(id, y));
    for (const id of (family.get(y) || []).slice(1)) seams.add(seamKey(id, x));
    for (const i of (family.get(x) || []).slice(1)) for (const j of (family.get(y) || []).slice(1)) seams.add(seamKey(i, j));
  }
  const result = withSeams(seams, () => polysToMesh(out));
  result.cuts = new Float32Array(cuts);
  return result;
}

/**
 * Apply one operation to a body mesh and return the new mesh.
 *   { type:'boolean', op:'union'|'subtract'|'intersect', tool: Mesh, matrix }
 *   { type:'fillet', radius, edges:[spec] }
 *   { type:'chamfer', distance, angle, edges:[spec] }
 *   { type:'move', pts:[[x,y,z]…], delta:[dx,dy,dz] }      move corner points
 *   { type:'merge', faces:[surface ids] }                   combine coplanar faces
 *   { type:'split', a, b, count, scope, face, faces }       cut faces across an edge
 * Throws an Error with a user-readable message when the result is invalid.
 */
/** Faces the user split on purpose stay split through every later operation. */
export function applyOp(mesh, op, toolMesh) {
  return withSeams(mesh.seams || null, () => applyStep(mesh, op, toolMesh));
}
function applyStep(mesh, op, toolMesh) {
  if (op.type === 'boolean') {
    const a = polysOf(mesh);
    const b = meshToPolys(toolMesh, op.matrix, maxSurface(a) + 1);
    const out = boolean(a, b, op.op);
    if (!out.length) throw new Error(op.op === 'intersect' ? 'The shapes do not overlap, so nothing would remain.' : 'The cut would remove the whole body.');
    return polysToMesh(out);
  }
  if (op.type === 'move') return movePoints(mesh, op);
  if (op.type === 'merge') return mergeFaces(mesh, op);
  if (op.type === 'split') return splitFaces(mesh, op);
  return blend(mesh, op);
}
