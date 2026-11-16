/**
 * geometry/primitives.js — parametric primitive generators.
 *
 * Each generator turns a parameter object (lengths in mm) into a Mesh:
 *   positions  Float32Array  xyz per vertex
 *   normals    Float32Array  xyz per vertex
 *   indices    Uint32Array   three per triangle
 *   triFace    Uint16Array   face-group id per triangle (a "face" in CAD terms)
 *   edges      Float32Array  feature edges, six floats per segment
 *   iso        Float32Array  extra curves shown in wireframe for smooth surfaces
 *   min, max   bounding box
 *
 * All primitives are centred on their local origin with Z up.
 */

const TAU = Math.PI * 2;
const ROUND_SEGMENTS = 64;

class MeshBuilder {
  constructor() {
    this.p = []; this.n = []; this.i = []; this.f = []; this.e = []; this.iso = [];
  }
  vert(p, n) {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c, face) {
    this.i.push(a, b, c);
    this.f.push(face);
  }
  /** Flat polygon (convex, counter-clockwise seen from outside). */
  polygon(points, face) {
    const a = points[0], b = points[1], c = points[2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const ids = points.map((pt) => this.vert(pt, n));
    for (let k = 1; k < ids.length - 1; k++) this.tri(ids[0], ids[k], ids[k + 1], face);
  }
  edge(a, b, target = this.e) {
    target.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  loop(points, target = this.e) {
    for (let k = 0; k < points.length; k++) this.edge(points[k], points[(k + 1) % points.length], target);
  }
  build() {
    const positions = new Float32Array(this.p);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        if (positions[k + a] < min[a]) min[a] = positions[k + a];
        if (positions[k + a] > max[a]) max[a] = positions[k + a];
      }
    }
    return {
      positions,
      normals: new Float32Array(this.n),
      indices: new Uint32Array(this.i),
      triFace: new Uint16Array(this.f),
      edges: new Float32Array(this.e),
      iso: new Float32Array(this.iso),
      min, max,
    };
  }
}

const circle = (r, z, seg, phase = 0) =>
  Array.from({ length: seg }, (_, k) => {
    const a = phase + (k / seg) * TAU;
    return [r * Math.cos(a), r * Math.sin(a), z];
  });

function box({ width, depth, height }) {
  const b = new MeshBuilder();
  const x = width / 2, y = depth / 2, z = height / 2;
  const c = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  const faces = [[1, 2, 6, 5], [3, 0, 4, 7], [2, 3, 7, 6], [0, 1, 5, 4], [4, 5, 6, 7], [3, 2, 1, 0]];
  faces.forEach((f, k) => b.polygon(f.map((id) => c[id]), k));
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    .forEach(([a, d]) => b.edge(c[a], c[d]));
  return b.build();
}

/** Cylinder, cone and truncated cone share one generator. */
function frustum(r1, r2, h, seg = ROUND_SEGMENTS) {
  const b = new MeshBuilder();
  const z0 = -h / 2, z1 = h / 2;
  const slope = r1 - r2;
  const bottom = [], top = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const l = Math.hypot(h, slope) || 1;
    const n = [(ca * h) / l, (sa * h) / l, slope / l];
    bottom.push(b.vert([r1 * ca, r1 * sa, z0], n));
    top.push(b.vert([r2 * ca, r2 * sa, z1], n));
  }
  for (let k = 0; k < seg; k++) {
    if (r1 > 0) b.tri(bottom[k], bottom[k + 1], top[k], 0);
    if (r2 > 0) b.tri(bottom[k + 1], top[k + 1], top[k], 0);
  }
  if (r2 > 0) {
    const ring = circle(r2, z1, seg);
    b.polygon(ring, 1);
    b.loop(ring);
  }
  if (r1 > 0) {
    const ring = circle(r1, z0, seg);
    b.polygon(ring.slice().reverse(), 2);
    b.loop(ring);
  }
  // Four straight rulings so the side wall reads in wireframe.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    b.edge([r1 * Math.cos(a), r1 * Math.sin(a), z0], [r2 * Math.cos(a), r2 * Math.sin(a), z1], b.iso);
  }
  return b.build();
}

function sphere({ radius }) {
  const b = new MeshBuilder();
  const segU = ROUND_SEGMENTS, segV = ROUND_SEGMENTS / 2;
  const row = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI - Math.PI / 2;
    const cz = Math.sin(phi), cr = Math.cos(phi);
    row.push([]);
    for (let u = 0; u <= segU; u++) {
      const a = (u / segU) * TAU;
      const n = [cr * Math.cos(a), cr * Math.sin(a), cz];
      row[v].push(b.vert([n[0] * radius, n[1] * radius, n[2] * radius], n));
    }
  }
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      if (v > 0) b.tri(row[v][u], row[v][u + 1], row[v + 1][u], 0);
      if (v < segV - 1) b.tri(row[v][u + 1], row[v + 1][u + 1], row[v + 1][u], 0);
    }
  }
  b.loop(circle(radius, 0, segU), b.iso);
  b.loop(circle(radius, 0, segU).map(([x, y]) => [x, 0, y]), b.iso);
  b.loop(circle(radius, 0, segU).map(([x, y]) => [0, x, y]), b.iso);
  return b.build();
}

function torus({ radius, tube }) {
  const b = new MeshBuilder();
  const segU = ROUND_SEGMENTS, segV = ROUND_SEGMENTS / 2;
  const row = [];
  for (let u = 0; u <= segU; u++) {
    const a = (u / segU) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    row.push([]);
    for (let v = 0; v <= segV; v++) {
      const t = (v / segV) * TAU, ct = Math.cos(t), st = Math.sin(t);
      row[u].push(b.vert([(radius + tube * ct) * ca, (radius + tube * ct) * sa, tube * st], [ct * ca, ct * sa, st]));
    }
  }
  for (let u = 0; u < segU; u++) {
    for (let v = 0; v < segV; v++) {
      b.tri(row[u][v], row[u + 1][v], row[u][v + 1], 0);
      b.tri(row[u + 1][v], row[u + 1][v + 1], row[u][v + 1], 0);
    }
  }
  b.loop(circle(radius + tube, 0, segU), b.iso);
  b.loop(circle(radius - tube, 0, segU), b.iso);
  b.loop(circle(radius, tube, segU), b.iso);
  b.loop(circle(radius, -tube, segU), b.iso);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    b.loop(circle(tube, 0, segV).map(([x, z]) => [(radius + x) * Math.cos(a), (radius + x) * Math.sin(a), z]), b.iso);
  }
  return b.build();
}

function plane({ width, depth }) {
  const b = new MeshBuilder();
  const x = width / 2, y = depth / 2;
  const ring = [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]];
  b.polygon(ring, 0);
  b.loop(ring);
  return b.build();
}

function pyramid({ width, depth, height }) {
  const b = new MeshBuilder();
  const x = width / 2, y = depth / 2, z = height / 2;
  const base = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]];
  const apex = [0, 0, z];
  for (let k = 0; k < 4; k++) {
    b.polygon([base[k], base[(k + 1) % 4], apex], k);
    b.edge(base[k], apex);
  }
  b.polygon(base.slice().reverse(), 4);
  b.loop(base);
  return b.build();
}

/** Regular n-sided prism: the "custom polygonal primitive". */
function prism({ sides, radius, height }) {
  const b = new MeshBuilder();
  const n = Math.max(3, Math.round(sides));
  const z = height / 2;
  // Phase puts a flat side toward the front (−Y), as on a hex bolt head.
  const phase = -Math.PI / 2 - Math.PI / n;
  const bottom = circle(radius, -z, n, phase), top = circle(radius, z, n, phase);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    b.polygon([bottom[k], bottom[j], top[j], top[k]], k);
    b.edge(bottom[k], top[k]);
  }
  b.polygon(top, n);
  b.polygon(bottom.slice().reverse(), n + 1);
  b.loop(top);
  b.loop(bottom);
  return b.build();
}

/**
 * Primitive catalogue. `params` drive both the generator and the UI:
 * kind is 'length' (mm, shown in display units) or 'count' (integer).
 */
export const PRIMITIVES = {
  box: {
    label: 'Cube', icon: 'cube',
    params: [
      { key: 'width', label: 'Width (X)', kind: 'length', default: 40, min: 0.001 },
      { key: 'depth', label: 'Depth (Y)', kind: 'length', default: 40, min: 0.001 },
      { key: 'height', label: 'Height (Z)', kind: 'length', default: 40, min: 0.001 },
    ],
    build: box,
  },
  sphere: {
    label: 'Sphere', icon: 'sphere',
    params: [{ key: 'radius', label: 'Radius', kind: 'length', default: 20, min: 0.001 }],
    build: sphere,
  },
  cylinder: {
    label: 'Cylinder', icon: 'cylinder',
    params: [
      { key: 'radius', label: 'Radius', kind: 'length', default: 15, min: 0.001 },
      { key: 'height', label: 'Height', kind: 'length', default: 40, min: 0.001 },
    ],
    build: (p) => frustum(p.radius, p.radius, p.height),
  },
  cone: {
    label: 'Cone', icon: 'cone',
    params: [
      { key: 'radius', label: 'Base radius', kind: 'length', default: 20, min: 0.001 },
      { key: 'topRadius', label: 'Top radius', kind: 'length', default: 0, min: 0 },
      { key: 'height', label: 'Height', kind: 'length', default: 40, min: 0.001 },
    ],
    build: (p) => frustum(p.radius, p.topRadius, p.height),
  },
  torus: {
    label: 'Torus', icon: 'torus',
    params: [
      { key: 'radius', label: 'Ring radius', kind: 'length', default: 25, min: 0.001 },
      { key: 'tube', label: 'Tube radius', kind: 'length', default: 6, min: 0.001 },
    ],
    validate: (p) => (p.tube >= p.radius ? 'The tube radius must be smaller than the ring radius.' : null),
    build: torus,
  },
  plane: {
    label: 'Plane', icon: 'plane',
    params: [
      { key: 'width', label: 'Width (X)', kind: 'length', default: 60, min: 0.001 },
      { key: 'depth', label: 'Depth (Y)', kind: 'length', default: 60, min: 0.001 },
    ],
    build: plane,
  },
  pyramid: {
    label: 'Pyramid', icon: 'pyramid',
    params: [
      { key: 'width', label: 'Base width (X)', kind: 'length', default: 40, min: 0.001 },
      { key: 'depth', label: 'Base depth (Y)', kind: 'length', default: 40, min: 0.001 },
      { key: 'height', label: 'Height', kind: 'length', default: 40, min: 0.001 },
    ],
    build: pyramid,
  },
  prism: {
    label: 'Polygon prism', icon: 'prism',
    params: [
      { key: 'sides', label: 'Sides', kind: 'count', default: 6, min: 3, max: 64 },
      { key: 'radius', label: 'Corner radius', kind: 'length', default: 20, min: 0.001 },
      { key: 'height', label: 'Height', kind: 'length', default: 30, min: 0.001 },
    ],
    build: prism,
  },
};
