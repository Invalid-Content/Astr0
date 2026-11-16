/**
 * geometry/csg.js — Boolean operations on solids using binary space
 * partitioning (after Naylor / Thibault; structure follows Evan Wallace's
 * well-known formulation).
 *
 * A solid is a list of convex polygons:
 *   { v: [{ p:[x,y,z], n:[x,y,z] }…], pn:[x,y,z], w, s }
 * `pn`·x = `w` is the polygon's plane, `s` is the id of the surface the
 * polygon belongs to. Surface ids and vertex normals survive every cut, which
 * is what lets later tools find real faces and edges on the result.
 */
const EPS = 1e-5;
const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

export function makePolygon(verts, s) {
  const a = verts[0].p, b = verts[1].p, c = verts[2].p;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-14) return null;
  nx /= l; ny /= l; nz /= l;
  return { v: verts, pn: [nx, ny, nz], w: nx * a[0] + ny * a[1] + nz * a[2], s };
}

const flipPoly = (poly) => ({
  v: poly.v.map((x) => ({ p: x.p, n: [-x.n[0], -x.n[1], -x.n[2]] })).reverse(),
  pn: [-poly.pn[0], -poly.pn[1], -poly.pn[2]], w: -poly.w, s: poly.s,
});

function lerpVert(a, b, t) {
  const n = [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return { p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t], n: [n[0] / l, n[1] / l, n[2] / l] };
}

export function splitPolygon(pn, w, poly, coFront, coBack, front, back) {
  let type = 0;
  const types = [];
  for (const vert of poly.v) {
    const t = pn[0] * vert.p[0] + pn[1] * vert.p[1] + pn[2] * vert.p[2] - w;
    const k = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
    type |= k;
    types.push(k);
  }
  if (type === COPLANAR) {
    (pn[0] * poly.pn[0] + pn[1] * poly.pn[1] + pn[2] * poly.pn[2] > 0 ? coFront : coBack).push(poly);
  } else if (type === FRONT) {
    front.push(poly);
  } else if (type === BACK) {
    back.push(poly);
  } else {
    const f = [], b = [], n = poly.v.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
      if (ti !== BACK) f.push(vi);
      if (ti !== FRONT) b.push(vi);
      if ((ti | tj) === SPANNING) {
        const di = pn[0] * vi.p[0] + pn[1] * vi.p[1] + pn[2] * vi.p[2] - w;
        const dj = pn[0] * vj.p[0] + pn[1] * vj.p[1] + pn[2] * vj.p[2] - w;
        const x = lerpVert(vi, vj, di / (di - dj));
        f.push(x);
        b.push(x);
      }
    }
    if (f.length >= 3) front.push({ v: f, pn: poly.pn, w: poly.w, s: poly.s });
    if (b.length >= 3) back.push({ v: b, pn: poly.pn, w: poly.w, s: poly.s });
  }
}

class Node {
  constructor(polys) {
    this.pn = null; this.w = 0; this.front = null; this.back = null; this.polys = [];
    if (polys && polys.length) this.build(polys);
  }
  invert() {
    // Iterative, so deep trees (convex solids) cannot exhaust the call stack.
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polys = n.polys.map(flipPoly);
      if (n.pn) { n.pn = [-n.pn[0], -n.pn[1], -n.pn[2]]; n.w = -n.w; }
      const t = n.front; n.front = n.back; n.back = t;
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }
  /** Remove the parts of `polys` that lie inside this solid. */
  clipPolygons(polys) {
    const out = [], stack = [[this, polys]];
    while (stack.length) {
      const [n, list] = stack.pop();
      if (!n.pn) { out.push(...list); continue; }
      const front = [], back = [];
      for (const p of list) splitPolygon(n.pn, n.w, p, front, back, front, back);
      if (n.front) stack.push([n.front, front]); else out.push(...front);
      if (n.back) stack.push([n.back, back]);       // no back subtree: inside the solid, discarded
    }
    return out;
  }
  clipTo(other) {
    const stack = [this];
    while (stack.length) {
      const n = stack.pop();
      n.polys = other.clipPolygons(n.polys);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
  }
  all() {
    const out = [], stack = [this];
    while (stack.length) {
      const n = stack.pop();
      out.push(...n.polys);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
    return out;
  }
  build(polys) {
    const stack = [[this, polys]];
    while (stack.length) {
      const [n, list] = stack.pop();
      if (!list.length) continue;
      if (!n.pn) { n.pn = list[0].pn; n.w = list[0].w; }
      const front = [], back = [];
      for (const p of list) splitPolygon(n.pn, n.w, p, n.polys, n.polys, front, back);
      if (front.length) { if (!n.front) n.front = new Node(); stack.push([n.front, front]); }
      if (back.length) { if (!n.back) n.back = new Node(); stack.push([n.back, back]); }
    }
  }
}

/** op: 'union' | 'subtract' | 'intersect'. Inputs are not modified. */
export function boolean(polysA, polysB, op) {
  const a = new Node(polysA.slice()), b = new Node(polysB.slice());
  if (op === 'union') {
    a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
    a.build(b.all());
  } else if (op === 'subtract') {
    a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
    a.build(b.all()); a.invert();
  } else {
    a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a);
    a.build(b.all()); a.invert();
  }
  return a.all();
}
