/**
 * geometry/sketch2d.js — the mathematical model of a 2D sketch.
 *
 * Entities (coordinates in the sketch plane, millimetres):
 *   line    { a:[x,y], b:[x,y] }
 *   arc     { c:[x,y], r, a0, a1 }      counter-clockwise from angle a0 to a1
 *   circle  { c:[x,y], r }
 *   ellipse { c:[x,y], rx, ry, rot }
 *   spline  { pts:[[x,y]…], closed }    smooth curve through its points
 * Every entity also has { id, cons } — `cons` marks construction geometry,
 * which guides drawing but never forms faces.
 *
 * This module turns entities into polylines, finds intersections, and
 * resolves the sketch into closed regions (faces) with holes.
 */

const TAU = Math.PI * 2;
export const CIRCLE_STEPS = 64;
const WELD = 1e-5;

export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const polar = (c, r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
export const isCurved = (e) => e.type !== 'line';

/** Catmull-Rom point on the span p1→p2. */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** Polyline for an entity: { pts, closed }. Closed curves do not repeat the first point. */
export function tessellate(e) {
  switch (e.type) {
    case 'line': return { pts: [e.a, e.b], closed: false };
    case 'circle': {
      const pts = [];
      for (let k = 0; k < CIRCLE_STEPS; k++) pts.push(polar(e.c, e.r, (k / CIRCLE_STEPS) * TAU));
      return { pts, closed: true };
    }
    case 'arc': {
      const sweep = e.a1 - e.a0, n = Math.max(2, Math.ceil(sweep / (TAU / CIRCLE_STEPS)));
      const pts = [];
      for (let k = 0; k <= n; k++) pts.push(polar(e.c, e.r, e.a0 + (sweep * k) / n));
      return { pts, closed: false };
    }
    case 'ellipse': {
      const pts = [], cr = Math.cos(e.rot || 0), sr = Math.sin(e.rot || 0);
      for (let k = 0; k < CIRCLE_STEPS; k++) {
        const a = (k / CIRCLE_STEPS) * TAU, x = e.rx * Math.cos(a), y = e.ry * Math.sin(a);
        pts.push([e.c[0] + x * cr - y * sr, e.c[1] + x * sr + y * cr]);
      }
      return { pts, closed: true };
    }
    case 'spline': {
      const P = e.pts, n = P.length, pts = [];
      if (n < 3) return { pts: P.slice(), closed: false };
      const at = (i) => (e.closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
      const spans = e.closed ? n : n - 1;
      for (let i = 0; i < spans; i++) {
        for (let s = 0; s < 10; s++) pts.push(catmull(at(i - 1), at(i), at(i + 1), at(i + 2), s / 10));
      }
      if (!e.closed) pts.push(P[n - 1]);
      return { pts, closed: !!e.closed };
    }
    default: return { pts: [], closed: false };
  }
}

/** Open ends of an entity (nothing for closed curves). */
export function endpoints(e) {
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'arc') return [polar(e.c, e.r, e.a0), polar(e.c, e.r, e.a1)];
  if (e.type === 'spline' && !e.closed) return [e.pts[0], e.pts[e.pts.length - 1]];
  return [];
}

/** Arc through three points (start, any point on the arc, end), or null if collinear. */
export function arcFrom3(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], m2 = m[0] * m[0] + m[1] * m[1], b2 = b[0] * b[0] + b[1] * b[1];
  const c = [(a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d, (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d];
  const r = dist2(c, a);
  const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const norm = (x) => ((x % TAU) + TAU) % TAU;
  let a0 = ang(a), a1 = ang(b);
  // Go counter-clockwise from a to b if the middle point lies on that sweep; otherwise swap.
  if (norm(ang(m) - a0) > norm(a1 - a0)) [a0, a1] = [a1, a0];
  a1 = a0 + norm(a1 - a0);
  return { type: 'arc', c, r, a0, a1 };
}

/** Closest point on an entity to p, with its distance. */
export function closestOn(e, p) {
  const { pts, closed } = tessellate(e);
  let best = null, bd = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t], d = dist2(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  // Exact answers for circles and arcs avoid the facet error.
  if (e.type === 'circle') {
    const d = dist2(p, e.c) || 1;
    best = [e.c[0] + ((p[0] - e.c[0]) / d) * e.r, e.c[1] + ((p[1] - e.c[1]) / d) * e.r];
    bd = Math.abs(d - e.r);
  }
  return { point: best, dist: bd };
}

function segSeg(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx, qx = c[0] - a[0], qy = c[1] - a[1];
  const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (Math.abs(den) < 1e-12 * scale) {
    // Parallel: if collinear, report where each segment's ends fall on the other.
    if (Math.abs(qx * ry - qy * rx) > 1e-9 * Math.hypot(rx, ry)) return null;
    const l2 = rx * rx + ry * ry, m2 = sx * sx + sy * sy, out = { ts: [], us: [] };
    for (const p of [c, d]) { const t = ((p[0] - a[0]) * rx + (p[1] - a[1]) * ry) / l2; if (t > 1e-9 && t < 1 - 1e-9) out.ts.push(t); }
    for (const p of [a, b]) { const u = ((p[0] - c[0]) * sx + (p[1] - c[1]) * sy) / m2; if (u > 1e-9 && u < 1 - 1e-9) out.us.push(u); }
    return out.ts.length || out.us.length ? out : null;
  }
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  const e = 1e-9;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { ts: [t], us: [u] };
}

/** All intersection points between the drawn (non-construction or all) entities. For snapping. */
export function intersections(entities) {
  const polys = entities.map((e) => tessellate(e));
  const out = [];
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i], B = polys[j];
      const na = A.closed ? A.pts.length : A.pts.length - 1, nb = B.closed ? B.pts.length : B.pts.length - 1;
      for (let x = 0; x < na; x++) {
        const a = A.pts[x], b = A.pts[(x + 1) % A.pts.length];
        for (let y = 0; y < nb; y++) {
          const c = B.pts[y], d = B.pts[(y + 1) % B.pts.length];
          if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])
            || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
          const hit = segSeg(a, b, c, d);
          if (hit && hit.ts.length === 1 && hit.us.length === 1) out.push([a[0] + (b[0] - a[0]) * hit.ts[0], a[1] + (b[1] - a[1]) * hit.ts[0]]);
        }
      }
    }
  }
  return out;
}

export function polygonArea(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export const pointInRegion = (p, region) =>
  pointInPolygon(p, region.outer.pts) && !region.holes.some((h) => pointInPolygon(p, h.pts));

/**
 * Resolve entities into closed regions.
 *
 * Method: flatten every curve to segments, split all segments at their mutual
 * intersections, weld coincident points, drop dangling ends (open profiles),
 * then walk the resulting planar graph to find its bounded faces. Outer
 * boundaries of separate pieces that lie inside another face become holes.
 *
 * Returns { regions, open } where each region is
 *   { outer: Loop, holes: [Loop], area }  and  Loop = { pts, ids, tags }
 * (`ids` are welded vertex ids, `tags[k]` is the entity id of the edge leaving
 * pts[k]); `open` lists entity ids that are not part of any closed loop.
 */
export function computeRegions(entities) {
  const drawn = entities.filter((e) => !e.cons);
  const segs = [], ends = [];
  for (const e of drawn) {
    const { pts, closed } = tessellate(e);
    const n = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) segs.push({ a: pts[k], b: pts[(k + 1) % pts.length], tag: e.id, curved: e.type !== 'line', cuts: [], pins: [] });
    if (!closed && pts.length) ends.push({ p: pts[0], tag: e.id }, { p: pts[pts.length - 1], tag: e.id });
  }
  // Split at intersections.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j];
      if (Math.max(s.a[0], s.b[0]) < Math.min(t.a[0], t.b[0]) - WELD || Math.max(t.a[0], t.b[0]) < Math.min(s.a[0], s.b[0]) - WELD
        || Math.max(s.a[1], s.b[1]) < Math.min(t.a[1], t.b[1]) - WELD || Math.max(t.a[1], t.b[1]) < Math.min(s.a[1], s.b[1]) - WELD) continue;
      const hit = segSeg(s.a, s.b, t.a, t.b);
      if (!hit) continue;
      s.cuts.push(...hit.ts);
      t.cuts.push(...hit.us);
    }
  }
  // A curve end that stops on a faceted curve (an arc, circle or spline) sits on the true curve,
  // a hair off its straight facets. Pin such ends onto the facet so the profile still closes.
  for (const end of ends) {
    for (const s of segs) {
      if (!s.curved || s.tag === end.tag) continue;
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = ((end.p[0] - s.a[0]) * dx + (end.p[1] - s.a[1]) * dy) / l2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const d = Math.hypot(s.a[0] + dx * t - end.p[0], s.a[1] + dy * t - end.p[1]);
      if (d > 1e-12 && d <= 0.013 * Math.sqrt(l2)) s.pins.push({ t, p: end.p });
    }
  }
  // Weld points on a fine grid (checking neighbouring cells).
  const verts = [], grid = new Map(), cell = WELD * 4;
  const vid = (p) => {
    const gx = Math.round(p[0] / cell), gy = Math.round(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${gx + dx},${gy + dy}`);
      if (list) for (const id of list) if (dist2(verts[id], p) <= WELD * 2) return id;
    }
    verts.push(p);
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(verts.length - 1);
    return verts.length - 1;
  };
  const edges = new Map();           // "u,v" (u<v) -> { u, v, tag }
  for (const s of segs) {
    const stops = [...s.cuts.filter((t) => t > 1e-9 && t < 1 - 1e-9).map((t) => ({ t })), ...s.pins].sort((x, y) => x.t - y.t);
    const ts = [{ t: 0 }, ...stops, { t: 1 }];
    let prev = vid(s.a);
    for (let k = 1; k < ts.length; k++) {
      const { t, p } = ts[k];
      const cur = vid(p || (t === 1 ? s.b : [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]));
      if (cur !== prev) {
        const key = prev < cur ? `${prev},${cur}` : `${cur},${prev}`;
        if (!edges.has(key)) edges.set(key, { u: prev, v: cur, tag: s.tag });
      }
      prev = cur;
    }
  }
  // Prune dangling edges until every vertex has degree >= 2.
  const adj = verts.map(() => new Set());
  for (const e of edges.values()) { adj[e.u].add(e.v); adj[e.v].add(e.u); }
  const closedTags = new Set(), allTags = new Set(drawn.map((e) => e.id));
  const stack = [];
  adj.forEach((s, v) => { if (s.size === 1) stack.push(v); });
  while (stack.length) {
    const v = stack.pop();
    if (adj[v].size !== 1) continue;
    const u = adj[v].values().next().value;
    adj[v].delete(u); adj[u].delete(v);
    edges.delete(v < u ? `${v},${u}` : `${u},${v}`);
    if (adj[u].size === 1) stack.push(u);
  }
  for (const e of edges.values()) closedTags.add(e.tag);
  const tagOf = (u, v) => edges.get(u < v ? `${u},${v}` : `${v},${u}`).tag;

  // Connected components (for hole assignment).
  const comp = verts.map((_, k) => k);
  const find = (x) => { while (comp[x] !== x) { comp[x] = comp[comp[x]]; x = comp[x]; } return x; };
  for (const e of edges.values()) comp[find(e.u)] = find(e.v);

  // Sort neighbours by angle, then trace faces keeping the interior on the left.
  const order = adj.map((s, v) => [...s].sort((p, q) =>
    Math.atan2(verts[p][1] - verts[v][1], verts[p][0] - verts[v][0]) - Math.atan2(verts[q][1] - verts[v][1], verts[q][0] - verts[v][0])));
  const used = new Set(), cycles = [];
  for (const e of edges.values()) {
    for (const [s0, s1] of [[e.u, e.v], [e.v, e.u]]) {
      if (used.has(`${s0}>${s1}`)) continue;
      const ids = [];
      let u = s0, v = s1, guard = 0;
      while (!used.has(`${u}>${v}`) && guard++ < 100000) {
        used.add(`${u}>${v}`);
        ids.push(u);
        const ring = order[v], k = ring.indexOf(u);
        const w = ring[(k - 1 + ring.length) % ring.length];   // next edge clockwise from the one we arrived on
        u = v; v = w;
      }
      const pts = ids.map((id) => verts[id]);
      cycles.push({ ids, pts, tags: ids.map((id, k) => tagOf(id, ids[(k + 1) % ids.length])), area: polygonArea(pts), comp: find(s0) });
    }
  }
  const faces = cycles.filter((c) => c.area > 1e-9).map((c) => ({ outer: c, holes: [], area: c.area, comp: c.comp }));
  for (const h of cycles.filter((c) => c.area < -1e-9)) {
    let host = null;
    for (const f of faces) {
      if (f.comp === h.comp || !pointInPolygon(h.pts[0], f.outer.pts)) continue;
      if (!host || f.outer.area < host.outer.area) host = f;
    }
    if (host) { host.holes.push(h); host.area += h.area; }
  }
  return {
    regions: faces.map(({ outer, holes, area }) => ({ outer, holes, area })),
    open: [...allTags].filter((t) => !closedTags.has(t)),
  };
}

/**
 * Merge several regions from one computeRegions() call into the outlines of
 * their union: shared boundaries cancel, the rest is re-chained into loops.
 */
export function mergeRegions(regions) {
  if (regions.length === 1) return regions;
  const half = new Map();
  const info = new Map();
  for (const r of regions) {
    for (const loop of [r.outer, ...r.holes]) {
      loop.ids.forEach((u, k) => {
        const v = loop.ids[(k + 1) % loop.ids.length];
        if (half.has(`${v}>${u}`)) half.delete(`${v}>${u}`);
        else half.set(`${u}>${v}`, { u, v, tag: loop.tags[k] });
        info.set(u, loop.pts[k]);
      });
    }
  }
  const out = new Map();
  for (const h of half.values()) { if (!out.has(h.u)) out.set(h.u, []); out.get(h.u).push(h); }
  const loops = [];
  for (const start of half.values()) {
    if (start.done) continue;
    const ids = [], tags = [];
    let h = start;
    while (h && !h.done) {
      h.done = true;
      ids.push(h.u); tags.push(h.tag);
      h = (out.get(h.v) || []).find((x) => !x.done) || null;
    }
    const pts = ids.map((id) => info.get(id));
    loops.push({ ids, pts, tags, area: polygonArea(pts) });
  }
  const faces = loops.filter((l) => l.area > 0).map((l) => ({ outer: l, holes: [], area: l.area }));
  for (const h of loops.filter((l) => l.area < 0)) {
    let host = null;
    for (const f of faces) if (pointInPolygon(h.pts[0], f.outer.pts) && (!host || f.outer.area < host.outer.area)) host = f;
    if (host) { host.holes.push(h); host.area += h.area; }
  }
  return faces;
}

/**
 * Triangulate a polygon with holes by ear clipping. Holes are first joined to
 * the outer loop with bridge edges. Returns { pts, tris } where pts is the
 * outer loop followed by each hole, and tris indexes into it.
 */
export function triangulate(outer, holes = []) {
  const pts = [...outer];
  let ring = outer.map((_, k) => k);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const properCross = (a, b, c, d) => {
    const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
  };
  const holeRings = holes.map((h) => {
    const base = pts.length;
    pts.push(...h);
    return h.map((_, k) => base + k);
  }).sort((a, b) => Math.max(...b.map((i) => pts[i][0])) - Math.max(...a.map((i) => pts[i][0])));
  for (const hr of holeRings) {
    // Bridge from the hole's rightmost vertex to the nearest outer vertex it can see.
    let hi = 0;
    hr.forEach((i, k) => { if (pts[i][0] > pts[hr[hi]][0]) hi = k; });
    const m = pts[hr[hi]];
    const blockers = [ring, ...holeRings];
    let best = -1, bd = Infinity;
    ring.forEach((i, k) => {
      const p = pts[i], d = dist2(p, m);
      if (d >= bd) return;
      for (const br of blockers) {
        for (let e = 0; e < br.length; e++) {
          const a = br[e], b = br[(e + 1) % br.length];
          if (a === i || b === i || a === hr[hi] || b === hr[hi]) continue;
          if (properCross(m, p, pts[a], pts[b])) return;
        }
      }
      best = k; bd = d;
    });
    if (best < 0) best = 0;
    const rotated = [...hr.slice(hi), ...hr.slice(0, hi), hr[hi]];
    ring = [...ring.slice(0, best + 1), ...rotated, ...ring.slice(best)];
  }
  const tris = [];
  let guard = ring.length * ring.length + 100;
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false, flattest = 0, flatVal = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const ia = ring[(k - 1 + ring.length) % ring.length], ib = ring[k], ic = ring[(k + 1) % ring.length];
      const a = pts[ia], b = pts[ib], c = pts[ic], cr = cross(a, b, c);
      if (Math.abs(cr) < flatVal) { flatVal = Math.abs(cr); flattest = k; }
      if (cr <= 1e-12) continue;
      let ear = true;
      for (const j of ring) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j];
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push(ia, ib, ic);
      ring.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) ring.splice(flattest, 1);    // degenerate corner: drop it and carry on
  }
  if (ring.length === 3) tris.push(ring[0], ring[1], ring[2]);
  return { pts, tris };
}

// ---------------------------------------------------------------------------
// Trimming

const norm = (x) => ((x % TAU) + TAU) % TAU;
/** An entity as exact pieces: straight segments and circular arcs. */
function pieces(e) {
  if (e.type === 'line') return [{ a: e.a, b: e.b }];
  if (e.type === 'circle') return [{ c: e.c, r: e.r, a0: 0, sweep: TAU }];
  if (e.type === 'arc') return [{ c: e.c, r: e.r, a0: e.a0, sweep: e.a1 - e.a0 }];
  const { pts, closed } = tessellate(e), out = [];
  for (let k = 0; k < (closed ? pts.length : pts.length - 1); k++) out.push({ a: pts[k], b: pts[(k + 1) % pts.length] });
  return out;
}
const onArc = (q, p) => { const u = norm(Math.atan2(p[1] - q.c[1], p[0] - q.c[0]) - q.a0); return u <= q.sweep + 1e-9 || u >= TAU - 1e-9; };
/** Points where two exact pieces meet. */
function meet(p, q) {
  const out = [];
  if (p.a && q.a) {
    const rx = p.b[0] - p.a[0], ry = p.b[1] - p.a[1], sx = q.b[0] - q.a[0], sy = q.b[1] - q.a[1], den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return out;
    const t = ((q.a[0] - p.a[0]) * sy - (q.a[1] - p.a[1]) * sx) / den, u = ((q.a[0] - p.a[0]) * ry - (q.a[1] - p.a[1]) * rx) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) out.push([p.a[0] + rx * t, p.a[1] + ry * t]);
  } else if (p.a || q.a) {
    const l = p.a ? p : q, k = p.a ? q : p;
    const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], fx = l.a[0] - k.c[0], fy = l.a[1] - k.c[1];
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - k.r * k.r, disc = B * B - 4 * A * C;
    if (A < 1e-18 || disc < 0) return out;
    for (const sgn of disc < 1e-12 ? [0] : [-1, 1]) {
      const t = (-B + sgn * Math.sqrt(disc)) / (2 * A);
      const pt = [l.a[0] + dx * t, l.a[1] + dy * t];
      if (t >= -1e-9 && t <= 1 + 1e-9 && onArc(k, pt)) out.push(pt);
    }
  } else {
    const d = dist2(p.c, q.c);
    if (d < 1e-9 || d > p.r + q.r || d < Math.abs(p.r - q.r)) return out;
    const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const mx = p.c[0] + (a * (q.c[0] - p.c[0])) / d, my = p.c[1] + (a * (q.c[1] - p.c[1])) / d;
    for (const sgn of h < 1e-9 ? [0] : [-1, 1]) {
      const pt = [mx + (sgn * h * (q.c[1] - p.c[1])) / d, my - (sgn * h * (q.c[0] - p.c[0])) / d];
      if (onArc(p, pt) && onArc(q, pt)) out.push(pt);
    }
  }
  return out;
}

/**
 * Trim an entity at the point that was clicked: the stretch between the
 * nearest crossings with other curves on either side is removed. If nothing
 * crosses it, the whole entity goes. Returns
 *   { keep: [entities without ids], removed: entity }   (removed is for highlighting)
 * or null if `id` is not found.
 */
export function trimAt(entities, id, click) {
  const e = entities.find((x) => x.id === id);
  if (!e) return null;
  const mine = pieces(e), hits = [];
  for (const other of entities) {
    if (other.id === id) continue;
    for (const q of pieces(other)) for (const p of mine) hits.push(...meet(p, q));
  }
  const base = { cons: e.cons };
  if (e.type === 'line') {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy || 1;
    const par = (p) => ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2, at = (t) => [e.a[0] + dx * t, e.a[1] + dy * t];
    const cuts = hits.map(par).filter((t) => t > 1e-7 && t < 1 - 1e-7), tc = par(click);
    const lo = Math.max(0, ...cuts.filter((t) => t <= tc)), hi = Math.min(1, ...cuts.filter((t) => t > tc));
    const keep = [];
    if (lo > 0) keep.push({ ...base, type: 'line', a: e.a, b: at(lo) });
    if (hi < 1) keep.push({ ...base, type: 'line', a: at(hi), b: e.b });
    return { keep, removed: { type: 'line', a: at(lo), b: at(hi) } };
  }
  if (e.type === 'arc' || e.type === 'circle') {
    const full = e.type === 'circle', a0 = full ? 0 : e.a0, sweep = full ? TAU : e.a1 - e.a0;
    const par = (p) => norm(Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) - a0);
    let cuts = [...new Set(hits.map(par).filter((u) => full || (u > 1e-7 && u < sweep - 1e-7)).map((u) => Math.round(u * 1e9) / 1e9))].sort((x, y) => x - y);
    const tc = Math.min(par(click), full ? TAU : sweep);
    const arc = (u0, u1) => ({ ...base, type: 'arc', c: e.c, r: e.r, a0: a0 + u0, a1: a0 + u1 });
    if (full) {
      if (cuts.length < 2) return { keep: [], removed: e };
      const below = cuts.filter((u) => u <= tc), above = cuts.filter((u) => u > tc);
      const lo = below.length ? below[below.length - 1] : cuts[cuts.length - 1] - TAU, hi = above.length ? above[0] : cuts[0] + TAU;
      return { keep: [arc(hi, lo + TAU)], removed: arc(lo, hi) };
    }
    const lo = Math.max(0, ...cuts.filter((u) => u <= tc)), hi = Math.min(sweep, ...cuts.filter((u) => u > tc));
    const keep = [];
    if (lo > 0) keep.push(arc(0, lo));
    if (hi < sweep) keep.push(arc(hi, sweep));
    return { keep, removed: arc(lo, hi) };
  }
  // Ellipses and splines: work along the faceted path; what remains becomes a spline through it.
  const { pts, closed } = tessellate(e), n = closed ? pts.length : pts.length - 1;
  const par = (p) => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
      if (d < bd) { bd = d; best = k + t; }
    }
    return best;
  };
  const at = (u) => { const k = Math.min(n - 1, Math.floor(u)), t = u - k, a = pts[k % pts.length], b = pts[(k + 1) % pts.length]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  const cuts = [...new Set(hits.map(par).filter((u) => closed || (u > 1e-6 && u < n - 1e-6)).map((u) => Math.round(u * 1e6) / 1e6))].sort((x, y) => x - y);
  const tc = par(click);
  /** Spline through the path from u0 to u1 (u1 may exceed n on closed curves). */
  const span = (u0, u1) => {
    const out = [at(u0 % n || 0)];
    for (let k = Math.floor(u0) + 1; k < u1; k++) out.push(pts[k % pts.length]);
    out.push(at(u1 > n ? u1 - n : u1));
    // Thin dense runs a little; the curve is smooth so every other facet point is enough.
    const thin = out.length > 16 ? out.filter((_, k) => k === 0 || k === out.length - 1 || k % 2 === 0) : out;
    return thin.length === 2 ? { ...base, type: 'line', a: thin[0], b: thin[1] } : { ...base, type: 'spline', pts: thin, closed: false };
  };
  if (closed) {
    if (cuts.length < 2) return { keep: [], removed: e };
    const below = cuts.filter((u) => u <= tc), above = cuts.filter((u) => u > tc);
    const lo = below.length ? below[below.length - 1] : cuts[cuts.length - 1] - n, hi = above.length ? above[0] : cuts[0] + n;
    return { keep: [span(hi, lo + n)], removed: span(lo < 0 ? lo + n : lo, lo < 0 ? hi + n : hi) };
  }
  const lo = Math.max(0, ...cuts.filter((u) => u <= tc)), hi = Math.min(n, ...cuts.filter((u) => u > tc));
  const keep = [];
  if (lo > 0) keep.push(span(0, lo));
  if (hi < n) keep.push(span(hi, n));
  return { keep, removed: span(lo, hi) };
}
