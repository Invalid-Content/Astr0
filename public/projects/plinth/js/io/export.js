/**
 * io/export.js — write the model to interchange formats.
 *
 * Solids export as triangle meshes in world coordinates, millimetres, Z up
 * (GLB is converted to its standard: metres, Y up). Sketches export as 2D
 * curves in their own plane coordinates.
 *
 *   exportModel(format, bodies)  -> [{ name, data }]   'stl' | 'obj' | 'glb' | '3mf'
 *   exportSketches(format, sketches) -> [{ name, data }]   'svg' | 'dxf'
 * where `bodies` is [{ name, color:'#rrggbb', mesh, matrix }] and sketches are
 * sketch nodes. Each returns the file(s) that make up the export.
 */
import { zip, utf8 } from './zip.js';
import { tessellate } from '../geometry/sketch2d.js';

const safe = (s) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'object';
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => (Math.abs(v) < 5e-7 ? '0' : String(Math.round(v * 1e5) / 1e5));
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** World-space triangles of a body: { positions, normals (Float32Array), indices (Uint32Array) }. */
function worldMesh({ mesh, matrix: m }) {
  const P = mesh.positions, N = mesh.normals, count = P.length / 3;
  const positions = new Float32Array(P.length), normals = new Float32Array(P.length);
  // Normals use the inverse transpose; a mirrored transform also reverses triangle winding.
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  const nm = [A, B, C, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d].map((x) => x / det);
  for (let k = 0; k < count; k++) {
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
    positions[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
    const wx = nm[0] * nx + nm[3] * ny + nm[6] * nz, wy = nm[1] * nx + nm[4] * ny + nm[7] * nz, wz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
    const l = Math.hypot(wx, wy, wz) || 1;
    normals[k * 3] = wx / l; normals[k * 3 + 1] = wy / l; normals[k * 3 + 2] = wz / l;
  }
  const indices = new Uint32Array(mesh.indices);
  if (det < 0) for (let t = 0; t < indices.length; t += 3) { const s = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = s; }
  return { positions, normals, indices };
}

function stl(bodies) {
  const meshes = bodies.map(worldMesh);
  const tris = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const out = new ArrayBuffer(84 + tris * 50), view = new DataView(out);
  new Uint8Array(out).set(utf8('Plinth 3D Modeller export, millimetres').subarray(0, 80));
  view.setUint32(80, tris, true);
  let at = 84;
  for (const { positions: P, indices: I } of meshes) {
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const v of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) { view.setFloat32(at, v, true); at += 4; }
      at += 2;
    }
  }
  return new Uint8Array(out);
}

function obj(bodies, base) {
  const lines = ['# Plinth 3D Modeller export. Units: millimetres. Z is up.', `mtllib ${base}.mtl`], mtl = [];
  let offset = 1;
  bodies.forEach((body, k) => {
    const { positions: P, normals: N, indices: I } = worldMesh(body), [r, g, b] = rgb(body.color);
    const material = `${safe(body.name)}_${k + 1}`;
    mtl.push(`newmtl ${material}`, `Kd ${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`, '');
    lines.push(`o ${safe(body.name)}`, `usemtl ${material}`);
    for (let i = 0; i < P.length; i += 3) lines.push(`v ${num(P[i])} ${num(P[i + 1])} ${num(P[i + 2])}`);
    for (let i = 0; i < N.length; i += 3) lines.push(`vn ${num(N[i])} ${num(N[i + 1])} ${num(N[i + 2])}`);
    for (let t = 0; t < I.length; t += 3) { const a = I[t] + offset, b2 = I[t + 1] + offset, c = I[t + 2] + offset; lines.push(`f ${a}//${a} ${b2}//${b2} ${c}//${c}`); }
    offset += P.length / 3;
  });
  return [{ name: `${base}.obj`, data: lines.join('\n') + '\n' }, { name: `${base}.mtl`, data: mtl.join('\n') }];
}

function glb(bodies) {
  const chunks = [], views = [], accessors = [], meshes = [], nodes = [], materials = [];
  let length = 0;
  const push = (array, target) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target });
    chunks.push(bytes);
    length += bytes.length;
    const pad = (4 - (length % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); length += pad; }
    return views.length - 1;
  };
  const linear = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  bodies.forEach((body, k) => {
    const { positions, normals, indices } = worldMesh(body);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) { const a = i % 3; if (positions[i] < min[a]) min[a] = positions[i]; if (positions[i] > max[a]) max[a] = positions[i]; }
    const count = positions.length / 3;
    accessors.push({ bufferView: push(positions, 34962), componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: push(normals, 34962), componentType: 5126, count, type: 'VEC3' },
      { bufferView: push(indices, 34963), componentType: 5125, count: indices.length, type: 'SCALAR' });
    const [r, g, b] = rgb(body.color);
    materials.push({ name: body.name, pbrMetallicRoughness: { baseColorFactor: [linear(r), linear(g), linear(b), 1], metallicFactor: 0, roughnessFactor: 0.6 } });
    meshes.push({ name: body.name, primitives: [{ attributes: { POSITION: k * 3, NORMAL: k * 3 + 1 }, indices: k * 3 + 2, material: k }] });
    nodes.push({ name: body.name, mesh: k });
  });
  // Root node converts millimetres with Z up to glTF's metres with Y up.
  nodes.push({ name: 'Plinth export', children: bodies.map((_, k) => k), rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [0.001, 0.001, 0.001] });
  const json = utf8(JSON.stringify({
    asset: { version: '2.0', generator: 'Plinth 3D Modeller' }, scene: 0, scenes: [{ nodes: [nodes.length - 1] }],
    nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: length }],
  }));
  const jsonPad = (4 - (json.length % 4)) % 4, total = 12 + 8 + json.length + jsonPad + 8 + length;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, json.length + jsonPad, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);
  let at = 20 + json.length + jsonPad;
  view.setUint32(at, length, true); view.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

function threeMF(bodies) {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ' <metadata name="Application">Plinth 3D Modeller</metadata>', ' <resources>', '  <basematerials id="1">'];
  for (const body of bodies) parts.push(`   <base name="${xml(body.name)}" displaycolor="${body.color.toUpperCase()}"/>`);
  parts.push('  </basematerials>');
  bodies.forEach((body, k) => {
    const { positions: P, indices: I } = worldMesh(body);
    // 3MF wants shared vertices: weld identical positions.
    const ids = new Map(), verts = [], map = new Uint32Array(P.length / 3);
    for (let v = 0; v < map.length; v++) {
      const key = `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
      let id = ids.get(key);
      if (id === undefined) { id = verts.length; ids.set(key, id); verts.push(`<vertex x="${num(P[v * 3])}" y="${num(P[v * 3 + 1])}" z="${num(P[v * 3 + 2])}"/>`); }
      map[v] = id;
    }
    parts.push(`  <object id="${k + 2}" type="model" name="${xml(body.name)}" pid="1" pindex="${k}">`, '   <mesh>', '    <vertices>', ...verts.map((v) => '     ' + v), '    </vertices>', '    <triangles>');
    for (let t = 0; t < I.length; t += 3) {
      const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]];
      if (a !== b && b !== c && a !== c) parts.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }
    parts.push('    </triangles>', '   </mesh>', '  </object>');
  });
  parts.push(' </resources>', ' <build>', ...bodies.map((_, k) => `  <item objectid="${k + 2}"/>`), ' </build>', '</model>');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: parts.join('\n') },
  ]);
}

export function exportModel(format, bodies, base) {
  if (format === 'stl') return [{ name: `${base}.stl`, data: stl(bodies) }];
  if (format === 'obj') return obj(bodies, base);
  if (format === 'glb') return [{ name: `${base}.glb`, data: glb(bodies) }];
  if (format === '3mf') return [{ name: `${base}.3mf`, data: threeMF(bodies) }];
  throw new Error(`Unknown format ${format}`);
}

// ---- sketches ----------------------------------------------------------------
function svg(sketches) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const groups = sketches.map((sk) => {
    const paths = sk.entities.map((e) => {
      const { pts, closed } = tessellate(e);
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      let el;
      // SVG's Y axis points down, so Y is negated throughout.
      if (e.type === 'circle') el = `<circle cx="${num(e.c[0])}" cy="${num(-e.c[1])}" r="${num(e.r)}"`;
      else if (e.type === 'line') el = `<line x1="${num(e.a[0])}" y1="${num(-e.a[1])}" x2="${num(e.b[0])}" y2="${num(-e.b[1])}"`;
      else if (e.type === 'arc') {
        const a = pts[0], b = pts[pts.length - 1];
        el = `<path d="M${num(a[0])} ${num(-a[1])}A${num(e.r)} ${num(e.r)} 0 ${e.a1 - e.a0 > Math.PI ? 1 : 0} 0 ${num(b[0])} ${num(-b[1])}"`;
      } else el = `<path d="M${pts.map((p) => `${num(p[0])} ${num(-p[1])}`).join('L')}${closed ? 'Z' : ''}"`;
      return `  ${el}${e.cons ? ' stroke-dasharray="2 1.5" stroke="#888"' : ''}/>`;
    });
    return ` <g id="${xml(safe(sk.name))}" data-plane="${sk.plane}">\n${paths.join('\n')}\n </g>`;
  });
  if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 10; }
  const pad = 2, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Plinth 3D Modeller sketch export. One unit is one millimetre. -->\n<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}mm" height="${num(h)}mm" viewBox="${num(x0 - pad)} ${num(-y1 - pad)} ${num(w)} ${num(h)}" fill="none" stroke="#000" stroke-width="0.25">\n${groups.join('\n')}\n</svg>\n`;
}

function dxf(sketches) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const deg = (a) => num((((a * 180) / Math.PI) % 360 + 360) % 360);
  for (const sk of sketches) {
    const layer = safe(sk.name) + (sk.entities.some((e) => e.cons) ? '' : '');
    for (const e of sk.entities) {
      const L = e.cons ? `${layer}_construction` : layer;
      if (e.type === 'line') out.push('0', 'LINE', '8', L, '10', num(e.a[0]), '20', num(e.a[1]), '30', '0', '11', num(e.b[0]), '21', num(e.b[1]), '31', '0');
      else if (e.type === 'circle') out.push('0', 'CIRCLE', '8', L, '10', num(e.c[0]), '20', num(e.c[1]), '30', '0', '40', num(e.r));
      else if (e.type === 'arc') out.push('0', 'ARC', '8', L, '10', num(e.c[0]), '20', num(e.c[1]), '30', '0', '40', num(e.r), '50', deg(e.a0), '51', deg(e.a1));
      else {
        // Ellipses and splines go out as fine polylines, which every DXF reader accepts.
        const { pts, closed } = tessellate(e);
        out.push('0', 'POLYLINE', '8', L, '66', '1', '70', closed ? '1' : '0');
        for (const p of pts) out.push('0', 'VERTEX', '8', L, '10', num(p[0]), '20', num(p[1]), '30', '0');
        out.push('0', 'SEQEND');
      }
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

export function exportSketches(format, sketches, base) {
  if (format === 'svg') return [{ name: `${base}.svg`, data: svg(sketches) }];
  if (format === 'dxf') return [{ name: `${base}.dxf`, data: dxf(sketches) }];
  throw new Error(`Unknown format ${format}`);
}

export { zip, safe };
