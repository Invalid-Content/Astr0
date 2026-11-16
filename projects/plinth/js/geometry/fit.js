/**
 * geometry/fit.js — turn a freehand stroke into clean geometry.
 *
 * `recognise(points, tol)` looks at the whole path of the stroke (not just
 * where it ended) and returns the simplest shape that explains it:
 *   { kind: 'line', a, b }
 *   { kind: 'arc', a, m, b }            m is a point on the arc
 *   { kind: 'circle', c, r }
 *   { kind: 'rect', corners: [4] }
 *   { kind: 'triangle', corners: [3] }  regular triangle
 *   { kind: 'spline', pts, closed }
 * `tol` is the drawing tolerance in sketch units (a few screen pixels).
 */
import { dist2 } from './sketch2d.js';

function pathLength(pts) {
  let l = 0;
  for (let k = 1; k < pts.length; k++) l += dist2(pts[k - 1], pts[k]);
  return l;
}

function distToLine(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  return l ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l : dist2(p, a);
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  let worst = 0, index = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = distToLine(pts[k], pts[0], pts[pts.length - 1]);
    if (d > worst) { worst = d; index = k; }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, index + 1), tol).slice(0, -1), ...simplify(pts.slice(index), tol)];
}

/** Evenly re-spaced copy of a path, so slow parts of a stroke do not dominate a fit. */
function resample(pts, count) {
  const total = pathLength(pts), step = total / (count - 1), out = [pts[0]];
  let acc = 0, k = 1, prev = pts[0];
  while (out.length < count - 1 && k < pts.length) {
    const d = dist2(prev, pts[k]);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      prev = [prev[0] + (pts[k][0] - prev[0]) * t, prev[1] + (pts[k][1] - prev[1]) * t];
      out.push(prev);
      acc = 0;
    } else { acc += d; prev = pts[k]; k++; }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Least-squares circle (Kåsa). Returns { c, r, rms } or null. */
export function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] · [A B C] = [sxz syz sz]
  const m = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c];
    }
  }
  const A = m[0][3] / m[0][0], B = m[1][3] / m[1][1], C = m[2][3] / m[2][2];
  const c = [A / 2, B / 2], r2 = C + c[0] * c[0] + c[1] * c[1];
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let err = 0;
  for (const p of pts) err += (dist2(p, c) - r) ** 2;
  return { c, r, rms: Math.sqrt(err / n) };
}

/** Corner points of a closed stroke. */
function corners(pts, tol) {
  // Start the loop at the point farthest from the centroid so a corner is never split.
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let far = 0;
  pts.forEach((p, k) => { if (dist2(p, [cx, cy]) > dist2(pts[far], [cx, cy])) far = k; });
  const loop = [...pts.slice(far), ...pts.slice(0, far)];
  // Split at the point farthest from the start, simplify both halves.
  let opp = 0;
  loop.forEach((p, k) => { if (dist2(p, loop[0]) > dist2(loop[opp], loop[0])) opp = k; });
  const a = simplify(loop.slice(0, opp + 1), tol), b = simplify([...loop.slice(opp), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

export function recognise(raw, tol, { shapes = true } = {}) {
  if (raw.length < 2) return null;
  const a = raw[0], b = raw[raw.length - 1];
  const length = pathLength(raw), chord = dist2(a, b);
  if (length < tol) return null;
  const pts = resample(raw, Math.max(16, Math.min(96, raw.length)));
  const closed = length > tol * 12 && chord < Math.max(tol * 3, length * 0.12);

  if (!closed) {
    let dev = 0;
    for (const p of pts) dev = Math.max(dev, distToLine(p, a, b));
    if (dev <= Math.max(tol, chord * 0.035) && length < chord * 1.12) return { kind: 'line', a, b };
    const fit = fitCircle(pts);
    if (fit && fit.rms <= Math.max(tol * 0.9, fit.r * 0.06) && fit.r < chord * 40) {
      // Total turning must be one-directional and less than a full turn.
      let sweep = 0, flips = 0, prevSign = 0;
      for (let k = 1; k < pts.length; k++) {
        let d = Math.atan2(pts[k][1] - fit.c[1], pts[k][0] - fit.c[0]) - Math.atan2(pts[k - 1][1] - fit.c[1], pts[k - 1][0] - fit.c[0]);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        const sign = Math.sign(d);
        if (sign && prevSign && sign !== prevSign && Math.abs(d) > 0.05) flips++;
        if (sign) prevSign = sign;
        sweep += d;
      }
      if (flips <= 1 && Math.abs(sweep) < Math.PI * 1.9 && Math.abs(sweep) > 0.2) {
        // Keep the user's exact start and end; take the bulge from the fitted circle.
        const mid = (Math.atan2(a[1] - fit.c[1], a[0] - fit.c[0])) + sweep / 2;
        return { kind: 'arc', a, b, m: [fit.c[0] + fit.r * Math.cos(mid), fit.c[1] + fit.r * Math.sin(mid)] };
      }
    }
    return { kind: 'spline', pts: simplify(pts, tol * 1.2), closed: false };
  }

  if (shapes) {
    const fit = fitCircle(pts);
    if (fit && fit.rms <= fit.r * 0.075) return { kind: 'circle', c: fit.c, r: fit.r };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const cs = corners(pts, diag * 0.09);
    if (cs.length === 4) {
      // Accept if every corner is roughly a right angle.
      const ok = cs.every((p, k) => {
        const q = cs[(k + 1) % 4], o = cs[(k + 3) % 4];
        const u = [q[0] - p[0], q[1] - p[1]], v = [o[0] - p[0], o[1] - p[1]];
        const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
        return Math.abs(cos) < 0.42;
      });
      if (ok) {
        // Orientation from the longest side; snap to the axes when nearly aligned.
        let ang = 0, longest = 0;
        cs.forEach((p, k) => {
          const q = cs[(k + 1) % 4], l = dist2(p, q);
          if (l > longest) { longest = l; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
        });
        ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
        if (ang > Math.PI / 4) ang -= Math.PI / 2;
        if (Math.abs(ang) < 0.21) ang = 0;
        const cr = Math.cos(ang), sr = Math.sin(ang);
        const local = cs.map((p) => [p[0] * cr + p[1] * sr, -p[0] * sr + p[1] * cr]);
        const x0 = Math.min(...local.map((p) => p[0])), x1 = Math.max(...local.map((p) => p[0]));
        const y0 = Math.min(...local.map((p) => p[1])), y1 = Math.max(...local.map((p) => p[1]));
        const back = (x, y) => [x * cr - y * sr, x * sr + y * cr];
        return { kind: 'rect', corners: [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)] };
      }
    }
    if (cs.length === 3) {
      // Regular triangle with the same centre and size, turned to match the stroke.
      const c = [(cs[0][0] + cs[1][0] + cs[2][0]) / 3, (cs[0][1] + cs[1][1] + cs[2][1]) / 3];
      const r = (dist2(cs[0], c) + dist2(cs[1], c) + dist2(cs[2], c)) / 3;
      let top = cs[0];
      for (const p of cs) if (Math.abs(p[0] - c[0]) < Math.abs(top[0] - c[0])) top = p;
      let base = Math.atan2(top[1] - c[1], top[0] - c[0]);
      if (Math.abs(Math.abs(base) - Math.PI / 2) < 0.3) base = Math.sign(base) * Math.PI / 2;
      return { kind: 'triangle', corners: [0, 1, 2].map((k) => [c[0] + r * Math.cos(base + (k * 2 * Math.PI) / 3), c[1] + r * Math.sin(base + (k * 2 * Math.PI) / 3)]) };
    }
  }
  const smooth = simplify(pts.slice(0, -1), tol * 1.2);
  return smooth.length >= 3 ? { kind: 'spline', pts: smooth, closed: true } : null;
}
