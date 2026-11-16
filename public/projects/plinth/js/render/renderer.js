/**
 * render/renderer.js — WebGL2 viewport renderer.
 *
 * The renderer knows nothing about the document or tools. Each frame it is
 * handed a list of draw items and an overlay callback:
 *
 *   renderer.render(camera, {
 *     items:   [{ mesh, model, color:[r,g,b], selected, hovered, ghost }],
 *     display: 'shaded' | 'edges' | 'wire' | 'xray',
 *     grid:    { visible, spacing }, axes: boolean,
 *     images:  [{ key, source, corners:[4 x xyz], alpha }]  // reference photos
 *     fills:   [{ mesh, color:[r,g,b,a] }]            // sketch faces
 *     lines:   [{ segments, color, width, onTop }]     // sketch curves, edge highlights
 *     overlay: (draw) => { draw.lines(...); draw.mesh(...); }   // gizmos
 *   })
 *
 * Passes: opaque bodies → grid and axes → feature edges → transparent bodies
 * → selection outline (mask + edge detect) → overlay on a cleared depth buffer.
 * Lines are drawn as instanced screen-space quads so width is in pixels and
 * consistent on every device (WebGL's own line width is fixed at 1).
 */
import { m4 } from '../core/math.js';

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj, uModel;
uniform mat3 uNormalMat;
out vec3 vN; out vec3 vW;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = uNormalMat * aNormal;
  gl_Position = uViewProj * w;
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW;
uniform vec3 uColor, uEye, uBack, uRight, uUp;
uniform float uAlpha, uOrtho, uUnlit;
out vec4 outColor;
void main() {
  vec3 N = normalize(vN);
  vec3 V = uOrtho > 0.5 ? uBack : normalize(uEye - vW);
  if (dot(N, V) < 0.0) N = -N;                       // two-sided
  vec3 base = pow(uColor, vec3(2.2));
  vec3 L1 = normalize(uBack * 0.55 + uUp * 0.7 - uRight * 0.45);   // key light, rides with the camera
  vec3 L2 = normalize(vec3(0.35, 0.5, 0.8));                       // fixed sky fill
  vec3 amb = mix(vec3(0.20, 0.19, 0.18), vec3(0.40, 0.43, 0.48), 0.5 + 0.5 * N.z);
  float d1 = max(dot(N, L1), 0.0), d2 = max(dot(N, L2), 0.0);
  float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 56.0) * 0.16;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.07;
  vec3 c = base * (amb + d1 * 0.6 + d2 * 0.18) + spec + rim;
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  outColor = vec4(mix(c, uColor, uUnlit), uAlpha);
}`;

const FLAT_FS = `#version 300 es
precision highp float;
uniform vec4 uFlat;
out vec4 outColor;
void main() { outColor = uFlat; }`;

const LINE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;      // x: 0 start / 1 end, y: -1 / +1 side
layout(location=1) in vec3 aStart;
layout(location=2) in vec3 aEnd;
uniform mat4 uViewProj, uModel;
uniform vec2 uViewport;                  // device pixels
uniform float uWidth, uBias, uNear;      // device pixels, depth bias, near distance
out float vSide;
void main() {
  vec4 a = uViewProj * uModel * vec4(aStart, 1.0);
  vec4 b = uViewProj * uModel * vec4(aEnd, 1.0);
  // Clip the segment against the near plane so it never wraps behind the eye.
  // Clipping exactly at the near distance keeps w large enough for a stable pixel offset.
  float eps = uNear;
  if (a.w < eps && b.w < eps) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (a.w < eps) a = mix(b, a, (b.w - eps) / (b.w - a.w));
  if (b.w < eps) b = mix(a, b, (a.w - eps) / (a.w - b.w));
  vec2 sa = a.xy / a.w * uViewport * 0.5, sb = b.xy / b.w * uViewport * 0.5;
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  vec4 p = mix(a, b, aCorner.x);
  float half_ = uWidth * 0.5 + 1.0;
  vec2 off = (n * aCorner.y + d * (aCorner.x * 2.0 - 1.0) * 0.5) * half_;
  p.xy += off / (uViewport * 0.5) * p.w;
  p.z -= uBias * p.w;
  vSide = aCorner.y * half_;
  gl_Position = p;
}`;

const LINE_FS = `#version 300 es
precision highp float;
in float vSide;
uniform vec4 uColor;
uniform float uWidth;
out vec4 outColor;
void main() {
  float a = clamp(uWidth * 0.5 + 0.5 - abs(vSide), 0.0, 1.0);
  outColor = vec4(uColor.rgb, uColor.a * a);
}`;

const GRID_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uViewProj;
uniform vec3 uO, uU, uV;                 // grid plane: origin and in-plane axes
uniform vec2 uCenter;
uniform float uExtent;
out vec2 vW;
void main() {
  vW = uCenter + aPos * uExtent;
  gl_Position = uViewProj * vec4(uO + uU * vW.x + uV * vW.y, 1.0);
}`;

const GRID_FS = `#version 300 es
precision highp float;
in vec2 vW;
uniform vec2 uCenter;
uniform float uExtent, uMinor;
uniform vec4 uMinorColor, uMajorColor;
out vec4 outColor;
float gridLine(float spacing) {
  vec2 c = vW / spacing;
  vec2 f = max(fwidth(c), vec2(1e-6));
  vec2 g = abs(fract(c - 0.5) - 0.5) / f;
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  return line * (1.0 - smoothstep(0.2, 0.55, max(f.x, f.y)));   // fade when too dense
}
void main() {
  float minor = gridLine(uMinor) * uMinorColor.a;
  float major = gridLine(uMinor * 10.0) * uMajorColor.a;
  float fade = 1.0 - smoothstep(uExtent * 0.45, uExtent * 0.95, distance(vW, uCenter));
  vec3 col = major > minor ? uMajorColor.rgb : uMinorColor.rgb;
  float a = max(minor, major) * fade;
  if (a < 0.003) discard;
  outColor = vec4(col, a);
}`;

// Reference photos: a textured quad given by its four world-space corners.
const IMAGE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
uniform mat4 uViewProj;
out vec2 vUv;
void main() { vUv = aUv; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const IMAGE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;
void main() { vec4 c = texture(uTex, vUv); outColor = vec4(c.rgb, c.a * uAlpha); }`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const OUTLINE_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform vec2 uTexel;
uniform float uRadius;
uniform vec4 uSelColor, uHovColor;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 c = texture(uMask, uv).rg;
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    float r = (i % 2 == 0) ? uRadius : uRadius * 0.55;
    acc += texture(uMask, uv + vec2(cos(a), sin(a)) * r * uTexel).rg;
  }
  vec2 edge = clamp(acc / 12.0 * 2.6, 0.0, 1.0) * (1.0 - c);
  float sel = edge.r * uSelColor.a;
  float hov = edge.g * uHovColor.a * (1.0 - c.r) * (1.0 - edge.r);
  float a = max(sel, hov);
  if (a < 0.01) discard;
  outColor = vec4(sel >= hov ? uSelColor.rgb : uHovColor.rgb, a);
}`;

function compile(gl, vsSrc, fsSrc) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

const IDENTITY = m4.identity();

/** Parse "#rrggbb" to [r, g, b] in 0..1. */
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.dpr = 1;
    this.theme = {
      background: [0.93, 0.94, 0.95], gridMinor: [0, 0, 0, 0.08], gridMajor: [0, 0, 0, 0.16],
      edge: [0.1, 0.12, 0.16, 0.8], select: [1, 0.48, 0.1, 1], hover: [0.2, 0.45, 1, 0.9],
    };
    this.meshProg = compile(gl, MESH_VS, MESH_FS);
    this.maskProg = compile(gl, MESH_VS, FLAT_FS);
    this.lineProg = compile(gl, LINE_VS, LINE_FS);
    this.gridProg = compile(gl, GRID_VS, GRID_FS);
    this.outlineProg = compile(gl, QUAD_VS, OUTLINE_FS);
    this.imageProg = compile(gl, IMAGE_VS, IMAGE_FS);
    this.textures = new Map();         // photo key -> { tex, source }
    this.imageVao = gl.createVertexArray();
    gl.bindVertexArray(this.imageVao);
    this.imageBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 80, gl.DYNAMIC_DRAW);   // 4 corners x (xyz + uv)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    this.gpu = new WeakMap();          // mesh -> GPU buffers

    // Unit quad used by the grid and full-screen passes.
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Corner buffer shared by every line draw; instances supply the endpoints.
    this.cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.scratch = this.makeLineVao(null);
    gl.bindVertexArray(null);

    this.mask = null;                  // { fbo, tex, w, h }
  }

  setTheme(theme) { Object.assign(this.theme, theme); }

  /** Match the drawing buffer to the canvas' CSS size. Returns CSS size. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }

  makeLineVao(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [loc, offset] of [[1, 0], [2, 12]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    return { vao, buf, count: data ? data.length / 6 : 0 };
  }

  /** Upload (once) and return GPU buffers for a mesh. */
  buffers(mesh) {
    let g = this.gpu.get(mesh);
    if (g) return g;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [loc, data] of [[0, mesh.positions], [1, mesh.normals]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    g = { vao, count: mesh.indices.length, edges: this.makeLineVao(mesh.edges), iso: this.makeLineVao(mesh.iso) };
    gl.bindVertexArray(null);
    this.gpu.set(mesh, g);
    return g;
  }

  /** Texture for a photo, uploaded once per picture. */
  texture(key, source) {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (t && t.source === source) return t.tex;
    if (t) gl.deleteTexture(t.tex);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(key, { tex, source });
    return tex;
  }

  ensureMask(w, h) {
    const gl = this.gl;
    if (this.mask && this.mask.w === w && this.mask.h === h) return;
    if (this.mask) { gl.deleteTexture(this.mask.tex); gl.deleteFramebuffer(this.mask.fbo); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.mask = { fbo, tex, w, h };
  }

  // ---- low-level draws -------------------------------------------------------
  useMesh(prog, camera) {
    const gl = this.gl, u = prog.u;
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(u.uViewProj, false, camera.viewProj);
    if (u.uEye) gl.uniform3fv(u.uEye, camera.eye);
    if (u.uBack) gl.uniform3fv(u.uBack, camera.back);
    if (u.uRight) gl.uniform3fv(u.uRight, camera.right);
    if (u.uUp) gl.uniform3fv(u.uUp, camera.up);
    if (u.uOrtho) gl.uniform1f(u.uOrtho, camera.ortho ? 1 : 0);
  }
  drawMesh(prog, mesh, model) {
    const gl = this.gl, g = this.buffers(mesh);
    gl.uniformMatrix4fv(prog.u.uModel, false, model);
    if (prog.u.uNormalMat) gl.uniformMatrix3fv(prog.u.uNormalMat, false, m4.normalMatrix(model));
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
  }
  useLines(camera) {
    const gl = this.gl, u = this.lineProg.u;
    gl.useProgram(this.lineProg.p);
    gl.uniformMatrix4fv(u.uViewProj, false, camera.viewProj);
    gl.uniform2f(u.uViewport, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uNear, camera.ortho ? -1 : camera.near * 1.001);
  }
  drawLineVao(line, model, color, width, bias = 0) {
    if (!line.count) return;
    const gl = this.gl, u = this.lineProg.u;
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform4fv(u.uColor, color);
    gl.uniform1f(u.uWidth, width * this.dpr);
    gl.uniform1f(u.uBias, bias);
    gl.bindVertexArray(line.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, line.count);
  }
  /** Immediate-mode lines: `segments` is a flat array of xyz pairs. */
  drawSegments(segments, color, width, model = IDENTITY, bias = 0) {
    const gl = this.gl;
    const data = segments instanceof Float32Array ? segments : new Float32Array(segments);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.scratch.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.scratch.count = data.length / 6;
    this.drawLineVao(this.scratch, model, color, width, bias);
  }

  // ---- frame -----------------------------------------------------------------
  render(camera, frame) {
    const gl = this.gl, t = this.theme;
    const W = this.canvas.width, H = this.canvas.height;
    const { items, display } = frame;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(t.background[0], t.background[1], t.background[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    const solid = display === 'shaded' || display === 'edges';
    const opaque = items.filter((it) => solid && !it.ghost);
    const translucent = items.filter((it) => !solid || it.ghost);

    // 1. Opaque bodies, pushed back slightly so edges sit cleanly on top.
    this.useMesh(this.meshProg, camera);
    gl.uniform1f(this.meshProg.u.uUnlit, 0);
    gl.uniform1f(this.meshProg.u.uAlpha, 1);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    for (const it of opaque) {
      gl.uniform3fv(this.meshProg.u.uColor, it.color);
      this.drawMesh(this.meshProg, it.mesh, it.model);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 2. Grid and axes.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    // Reference photos lie under the grid and everything sketched on top of them.
    if (frame.images && frame.images.length) {
      const u = this.imageProg.u;
      gl.useProgram(this.imageProg.p);
      gl.uniformMatrix4fv(u.uViewProj, false, camera.viewProj);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(u.uTex, 0);
      gl.bindVertexArray(this.imageVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuf);
      const uv = [[0, 1], [1, 1], [0, 0], [1, 0]], data = new Float32Array(20);
      for (const im of frame.images) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture(im.key, im.source));
        im.corners.forEach((c, k) => data.set([c[0], c[1], c[2], uv[k][0], uv[k][1]], k * 5));
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
        gl.uniform1f(u.uAlpha, im.alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    const wpp = camera.worldPerPixel();
    let minor = frame.grid.spacing;
    while (minor / wpp < 9) minor *= 10;
    this.gridMinor = minor;
    const extent = Math.max(camera.distance * 3, minor * 30);
    if (frame.grid.visible) {
      const u = this.gridProg.u, pl = frame.grid.plane || { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] };
      const rel = [camera.target[0] - pl.o[0], camera.target[1] - pl.o[1], camera.target[2] - pl.o[2]];
      const boost = frame.grid.boost || 1;
      gl.useProgram(this.gridProg.p);
      gl.uniformMatrix4fv(u.uViewProj, false, camera.viewProj);
      gl.uniform3fv(u.uO, pl.o); gl.uniform3fv(u.uU, pl.u); gl.uniform3fv(u.uV, pl.v);
      gl.uniform2f(u.uCenter, rel[0] * pl.u[0] + rel[1] * pl.u[1] + rel[2] * pl.u[2], rel[0] * pl.v[0] + rel[1] * pl.v[1] + rel[2] * pl.v[2]);
      gl.uniform1f(u.uExtent, extent);
      gl.uniform1f(u.uMinor, minor);
      gl.uniform4f(u.uMinorColor, t.gridMinor[0], t.gridMinor[1], t.gridMinor[2], Math.min(1, t.gridMinor[3] * boost));
      gl.uniform4f(u.uMajorColor, t.gridMajor[0], t.gridMajor[1], t.gridMajor[2], Math.min(1, t.gridMajor[3] * boost));
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.useLines(camera);
    if (frame.axes) {
      const L = extent;
      this.drawSegments([-L, 0, 0, L, 0, 0], [0.86, 0.27, 0.27, 0.9], 1.4, IDENTITY, 0.00002);
      this.drawSegments([0, -L, 0, 0, L, 0], [0.3, 0.68, 0.32, 0.9], 1.4, IDENTITY, 0.00002);
      this.drawSegments([0, 0, 0, 0, 0, L * 0.5], [0.25, 0.5, 0.95, 0.9], 1.4, IDENTITY, 0.00002);
    }

    // 3. Feature edges of solid bodies (depth tested).
    if (display === 'edges') {
      for (const it of opaque) {
        this.drawLineVao(this.buffers(it.mesh).edges, it.model, it.selected ? t.select : t.edge, it.selected ? 1.6 : 1.1, 0.00004);
      }
    }

    // 3b. Sketches: translucent face fills, then curves.
    if (frame.fills && frame.fills.length) {
      this.useMesh(this.meshProg, camera);
      gl.uniform1f(this.meshProg.u.uUnlit, 1);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      for (const f of frame.fills) {
        gl.uniform1f(this.meshProg.u.uAlpha, f.color[3]);
        gl.uniform3f(this.meshProg.u.uColor, f.color[0], f.color[1], f.color[2]);
        this.drawMesh(this.meshProg, f.mesh, f.model || IDENTITY);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    if (frame.lines && frame.lines.length) {
      this.useLines(camera);
      for (const l of frame.lines) {
        if (!l.segments.length) continue;
        if (l.onTop) gl.disable(gl.DEPTH_TEST);
        this.drawSegments(l.segments, l.color, l.width, l.model || IDENTITY, 0.00008);
        gl.enable(gl.DEPTH_TEST);
      }
    }

    // 4. Translucent bodies: x-ray, wireframe and creation previews.
    if (translucent.length) {
      this.useMesh(this.meshProg, camera);
      gl.uniform1f(this.meshProg.u.uUnlit, 0);
      for (const it of translucent) {
        const alpha = it.alpha ?? (it.ghost ? 0.55 : display === 'wire' ? 0.05 : 0.3);
        gl.uniform1f(this.meshProg.u.uAlpha, alpha);
        gl.uniform3fv(this.meshProg.u.uColor, it.color);
        this.drawMesh(this.meshProg, it.mesh, it.model);
      }
      this.useLines(camera);
      for (const it of translucent) {
        const g = this.buffers(it.mesh);
        const color = it.selected || (it.ghost && !it.plain) ? t.select : t.wireEdge || t.edge;
        // See-through styles show hidden edges too; previews keep depth testing.
        if (!it.ghost) gl.disable(gl.DEPTH_TEST);
        this.drawLineVao(g.edges, it.model, color, 1.2, 0.00004);
        if (display === 'wire' && !it.ghost) this.drawLineVao(g.iso, it.model, [color[0], color[1], color[2], color[3] * 0.55], 1, 0.00004);
        gl.enable(gl.DEPTH_TEST);
      }
    }
    gl.depthMask(true);

    // 5. Selection and hover outline.
    const marked = items.filter((it) => it.selected || it.hovered);
    if (marked.length) {
      this.ensureMask(W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mask.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.useMesh(this.maskProg, camera);
      for (const it of marked) {
        gl.uniform4f(this.maskProg.u.uFlat, it.selected ? 1 : 0, it.hovered && !it.selected ? 1 : 0, 0, 1);
        this.drawMesh(this.maskProg, it.mesh, it.model);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const u = this.outlineProg.u;
      gl.useProgram(this.outlineProg.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.mask.tex);
      gl.uniform1i(u.uMask, 0);
      gl.uniform2f(u.uTexel, 1 / W, 1 / H);
      gl.uniform1f(u.uRadius, 2.2 * this.dpr);
      gl.uniform4fv(u.uSelColor, t.select);
      gl.uniform4fv(u.uHovColor, t.hover);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 6. Overlay (gizmos) on a fresh depth buffer so it is never hidden.
    if (frame.overlay) {
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const self = this;
      frame.overlay({
        lines(segments, color, width = 2, depth = false) {
          if (depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
          self.useLines(camera);
          self.drawSegments(segments, color, width);
        },
        mesh(mesh, model, color, depth = false) {
          if (depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
          self.useMesh(self.meshProg, camera);
          gl.uniform1f(self.meshProg.u.uUnlit, 1);
          gl.uniform1f(self.meshProg.u.uAlpha, color[3]);
          gl.uniform3f(self.meshProg.u.uColor, color[0], color[1], color[2]);
          self.drawMesh(self.meshProg, mesh, model);
        },
      });
    }
    gl.bindVertexArray(null);
  }
}
