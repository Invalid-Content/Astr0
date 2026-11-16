/**
 * core/math.js — minimal linear algebra for the modeller.
 *
 * Conventions
 *  - Vectors are plain arrays [x, y, z].
 *  - Quaternions are [x, y, z, w].
 *  - Matrices are Float32Array(16), column-major (WebGL layout).
 *  - World space is right-handed, Z-up, units are millimetres.
 */

export const EPS = 1e-9;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  addScaled: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
};

export const quat = {
  identity: () => [0, 0, 0, 1],
  fromAxisAngle(axis, rad) {
    const s = Math.sin(rad / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
  },
  mul(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },
  normalize(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  conj: (q) => [-q[0], -q[1], -q[2], q[3]],
  rotate(q, v) {
    // v' = q v q*
    const [x, y, z, w] = q;
    const uv = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
    const uuv = [y * uv[2] - z * uv[1], z * uv[0] - x * uv[2], x * uv[1] - y * uv[0]];
    return [v[0] + 2 * (w * uv[0] + uuv[0]), v[1] + 2 * (w * uv[1] + uuv[1]), v[2] + 2 * (w * uv[2] + uuv[2])];
  },
  /** Euler angles in degrees, intrinsic XYZ order (R = Rx · Ry · Rz). */
  fromEuler(e) {
    const x = e[0] * DEG / 2, y = e[1] * DEG / 2, z = e[2] * DEG / 2;
    const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
    const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
    return [
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    ];
  },
  toEuler(q) {
    const [x, y, z, w] = q;
    const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
    const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
    const m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
    const ey = Math.asin(clamp(m13, -1, 1));
    let ex, ez;
    if (Math.abs(m13) < 0.9999999) {
      ex = Math.atan2(-m23, m33);
      ez = Math.atan2(-m12, m11);
    } else {
      ex = Math.atan2(m32, m22);
      ez = 0;
    }
    const clean = (r) => {
      const d = r / DEG;
      return Math.abs(d) < 1e-6 ? 0 : d;
    };
    return [clean(ex), clean(ey), clean(ez)];
  },
};

export const m4 = {
  identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },
  /** Translation · Rotation · Scale. */
  compose(p, q, s) {
    const [x, y, z, w] = q;
    const m = new Float32Array(16);
    m[0] = (1 - 2 * (y * y + z * z)) * s[0];
    m[1] = (2 * (x * y + w * z)) * s[0];
    m[2] = (2 * (x * z - w * y)) * s[0];
    m[4] = (2 * (x * y - w * z)) * s[1];
    m[5] = (1 - 2 * (x * x + z * z)) * s[1];
    m[6] = (2 * (y * z + w * x)) * s[1];
    m[8] = (2 * (x * z + w * y)) * s[2];
    m[9] = (2 * (y * z - w * x)) * s[2];
    m[10] = (1 - 2 * (x * x + y * y)) * s[2];
    m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; m[15] = 1;
    return m;
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (near - far); m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  },
  ortho(halfW, halfH, near, far) {
    const m = new Float32Array(16);
    m[0] = 1 / halfW; m[5] = 1 / halfH;
    m[10] = -2 / (far - near);
    m[14] = -(far + near) / (far - near);
    m[15] = 1;
    return m;
  },
  /** View matrix from an eye point and an orthonormal camera basis. */
  view(eye, right, up, back) {
    const m = new Float32Array(16);
    m[0] = right[0]; m[4] = right[1]; m[8] = right[2]; m[12] = -v3.dot(right, eye);
    m[1] = up[0]; m[5] = up[1]; m[9] = up[2]; m[13] = -v3.dot(up, eye);
    m[2] = back[0]; m[6] = back[1]; m[10] = back[2]; m[14] = -v3.dot(back, eye);
    m[15] = 1;
    return m;
  },
  invert(a) {
    const o = new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4.identity();
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  /** Transform a point (w = 1) with perspective divide. */
  point(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
  /** Transform a direction (w = 0). */
  dir(m, d) {
    return [
      m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
      m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
      m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ];
  },
  /** Inverse-transpose of the upper 3×3, as Float32Array(9), for normals. */
  normalMatrix(m) {
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    let det = a * A + b * B + c * C;
    det = det ? 1 / det : 1;
    return new Float32Array([
      A * det, B * det, C * det,
      (c * h - b * i) * det, (a * i - c * g) * det, (b * g - a * h) * det,
      (b * f - c * e) * det, (c * d - a * f) * det, (a * e - b * d) * det,
    ]);
  },
};

/** Ray helpers. A ray is { o: origin, d: unit direction }. */
export const ray = {
  /** Intersection parameter with a plane (point + normal), or null if parallel. */
  plane(r, point, normal) {
    const denom = v3.dot(r.d, normal);
    if (Math.abs(denom) < 1e-8) return null;
    return v3.dot(v3.sub(point, r.o), normal) / denom;
  },
  at: (r, t) => v3.addScaled(r.o, r.d, t),
  /** Parameter along line (p + s·dir) of the point closest to the ray. */
  closestOnLine(r, p, dir) {
    const w = v3.sub(p, r.o);
    const b = v3.dot(dir, r.d), d = v3.dot(dir, w), e = v3.dot(r.d, w);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-8) return 0;
    return (b * e - d) / denom;
  },
  /** Slab test against an axis-aligned box. Returns true on hit. */
  aabb(r, min, max) {
    let t0 = -Infinity, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(r.d[i]) < 1e-12) {
        if (r.o[i] < min[i] || r.o[i] > max[i]) return false;
        continue;
      }
      let a = (min[i] - r.o[i]) / r.d[i], b = (max[i] - r.o[i]) / r.d[i];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return t1 >= 0;
  },
};

/** Round `v` to the nearest multiple of `step` (no-op when step is falsy). */
export const snap = (v, step) => (step ? Math.round(v / step) * step : v);
