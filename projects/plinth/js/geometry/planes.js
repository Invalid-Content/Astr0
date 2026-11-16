/**
 * geometry/planes.js — sketch planes and the derived display data of a sketch.
 *
 * A plane has an origin and axes u, v (in-plane) and n (normal), with
 * u × v = n. Sketch coordinates (x, y) map to world as o + u·x + v·y.
 */
import { tessellate, computeRegions, triangulate } from './sketch2d.js';

export const PLANES = {
  xy: { key: 'xy', label: 'Top plane (XY)', short: 'XY', o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { key: 'xz', label: 'Front plane (XZ)', short: 'XZ', o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  yz: { key: 'yz', label: 'Side plane (YZ)', short: 'YZ', o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};
/** Which plane each face of the navigation cube looks at. */
export const VIEW_PLANE = { top: 'xy', bottom: 'xy', front: 'xz', back: 'xz', right: 'yz', left: 'yz' };

export const to3 = (pl, p, z = 0) => [
  pl.o[0] + pl.u[0] * p[0] + pl.v[0] * p[1] + pl.n[0] * z,
  pl.o[1] + pl.u[1] * p[0] + pl.v[1] * p[1] + pl.n[1] * z,
  pl.o[2] + pl.u[2] * p[0] + pl.v[2] * p[1] + pl.n[2] * z,
];
export const to2 = (pl, p) => {
  const d = [p[0] - pl.o[0], p[1] - pl.o[1], p[2] - pl.o[2]];
  return [d[0] * pl.u[0] + d[1] * pl.u[1] + d[2] * pl.u[2], d[0] * pl.v[0] + d[1] * pl.v[1] + d[2] * pl.v[2]];
};

/**
 * Corners of a reference photo node, in plane (c2) and world (c3) coordinates.
 * Order: bottom-left, bottom-right, top-left, top-right.
 */
export function imageCorners(node) {
  const pl = PLANES[node.plane], a = node.rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const hw = node.w / 2, hh = node.w * node.aspect / 2;
  const c2 = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].map(([x, y]) => [node.x + x * cs - y * sn, node.y + x * sn + y * cs]);
  return { pl, c2, c3: c2.map((p) => to3(pl, p)) };
}

/** World-space line segments for a list of entities. */
export function entitySegments(pl, entities) {
  const out = [];
  for (const e of entities) {
    const { pts, closed } = tessellate(e);
    const n = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) out.push(...to3(pl, pts[k]), ...to3(pl, pts[(k + 1) % pts.length]));
  }
  return new Float32Array(out);
}

const cache = new WeakMap();
/**
 * Display and selection data for a sketch node, cached on its entity list
 * (which is replaced, never mutated, on every edit):
 *   { plane, regions, open, drawn, construction, fills: [mesh per region] }
 */
export function sketchData(node) {
  let d = cache.get(node.entities);
  if (d) return d;
  const plane = PLANES[node.plane];
  const { regions, open } = computeRegions(node.entities);
  const openSet = new Set(open);
  const fills = regions.map((r) => {
    const { pts, tris } = triangulate(r.outer.pts, r.holes.map((h) => h.pts));
    const positions = new Float32Array(pts.length * 3), normals = new Float32Array(pts.length * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    pts.forEach((p, k) => {
      const w = to3(plane, p);
      positions.set(w, k * 3);
      normals.set(plane.n, k * 3);
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], w[a]); max[a] = Math.max(max[a], w[a]); }
    });
    return { positions, normals, indices: new Uint32Array(tris), triFace: new Uint16Array(tris.length / 3), edges: new Float32Array(0), iso: new Float32Array(0), min, max };
  });
  d = {
    plane, regions, open: openSet, fills,
    closedSeg: entitySegments(plane, node.entities.filter((e) => !e.cons && !openSet.has(e.id))),
    openSeg: entitySegments(plane, node.entities.filter((e) => !e.cons && openSet.has(e.id))),
    consSeg: entitySegments(plane, node.entities.filter((e) => e.cons)),
  };
  cache.set(node.entities, d);
  return d;
}
