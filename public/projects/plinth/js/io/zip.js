/**
 * io/zip.js — minimal ZIP writer (stored, no compression).
 * Used for 3MF (which is a ZIP package) and to bundle exports.
 * files: [{ name, data: Uint8Array | string }]  ->  Uint8Array
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const utf8 = (text) => new TextEncoder().encode(text);

export function zip(files) {
  const entries = files.map((f) => {
    const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
    return { name: utf8(f.name), data, crc: crc32(data) };
  });
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(size), view = new DataView(out.buffer);
  let at = 0;
  const central = [];
  for (const e of entries) {
    const offset = at;
    view.setUint32(at, 0x04034b50, true); view.setUint16(at + 4, 20, true); view.setUint16(at + 6, 0x0800, true);   // UTF-8 names
    view.setUint16(at + 8, 0, true); view.setUint16(at + 10, 0, true); view.setUint16(at + 12, 0x21, true);         // stored; fixed date
    view.setUint32(at + 14, e.crc, true); view.setUint32(at + 18, e.data.length, true); view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, e.name.length, true); view.setUint16(at + 28, 0, true);
    out.set(e.name, at + 30); out.set(e.data, at + 30 + e.name.length);
    at += 30 + e.name.length + e.data.length;
    central.push({ e, offset });
  }
  const start = at;
  for (const { e, offset } of central) {
    view.setUint32(at, 0x02014b50, true); view.setUint16(at + 4, 20, true); view.setUint16(at + 6, 20, true); view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true); view.setUint16(at + 12, 0, true); view.setUint16(at + 14, 0x21, true);
    view.setUint32(at + 16, e.crc, true); view.setUint32(at + 20, e.data.length, true); view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, e.name.length, true);
    view.setUint32(at + 42, offset, true);
    out.set(e.name, at + 46);
    at += 46 + e.name.length;
  }
  view.setUint32(at, 0x06054b50, true); view.setUint16(at + 8, entries.length, true); view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - start, true); view.setUint32(at + 16, start, true);
  return out;
}
