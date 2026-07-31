// Pure image codec functions (issue #15) — no DB, no filesystem, no upload dir.
// Split out of images.js so it can be loaded inside an image-worker thread
// WITHOUT dragging in ./db (a worker must never open the SQLite handle). Every
// export here is a pure function of its bytes: header probing, EXIF orientation,
// decode, resize and encode. images.js owns everything stateful (disk, DB, the
// worker pool that CALLS these on a background thread).
//
// Encoding runs on the @jsquash WASM codecs — the same WASM the browser could
// use, with no native libvips/node-gyp toolchain (VALUES 1/5). The codecs are
// ESM-only, so this CommonJS module imports them lazily with dynamic import()
// inside async functions (the module cache makes repeat imports free).

// Longest-edge widths. Ascending so target derivation stays ordered. thumb is
// enough for feed grids/avatars, large is the lightbox ceiling — the original
// is never stored above `large`.
const SIZES = [
  { name: 'thumb', width: 320 },
  { name: 'medium', width: 800 },
  { name: 'large', width: 1600 },
];
const WEBP_QUALITY = 80;
// AVIF quality knobs. cqLevel is 0 (lossless) .. 63 (worst); ~32 tracks WebP
// quality 80. speed is 0 (slowest/best) .. 10; 8 keeps encode time bounded at a
// negligible size cost over the default 6. Since encoding now runs on a worker
// thread (images.js) it no longer stalls request handling, but a bounded encode
// still keeps latency and worker occupancy predictable.
const AVIF_CQ = 32;
const AVIF_SPEED = 8;

// Decode ceiling (decompression-bomb guard). @jsquash decodes to a raw RGBA
// buffer of width*height*4 bytes, so a small compressed file declaring huge
// dimensions (e.g. a few-KB WebP at 30000x30000) would allocate gigabytes and
// OOM the process. We read the dimensions from the file HEADER before decoding
// and reject anything past this cap. 50MP (~8200x6100) clears any real phone
// photo — and the client already downscales to a 1600px master — while bounding
// the RGBA allocation to ~200MB.
const MAX_MEGAPIXELS = 50;
const MAX_PIXELS = MAX_MEGAPIXELS * 1_000_000;

// Formats produced per size, best-ratio first. The client emits one <picture>
// <source> per format in this order, so the browser picks AVIF when it can.
const VARIANT_FORMATS = ['avif', 'webp'];

const MIME_FORMAT = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heic',
};
function mimeToFormat(mime) {
  return MIME_FORMAT[mime] || 'jpeg';
}

// The widths to actually produce for a source of width `ow`: each configured
// size clamped so we NEVER upscale, de-duplicated. A 200px source yields one
// 200px variant; a 4000px source is capped at 1600 (large).
function targetWidths(ow) {
  const seen = new Set();
  const out = [];
  for (const s of SIZES) {
    const w = Math.min(s.width, ow);
    if (w >= 1 && !seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

// A Node Buffer's underlying ArrayBuffer may be a shared pool slice; hand the
// codecs exactly this buffer's bytes.
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// EXIF Orientation handling (issue #15 review). @jsquash/jpeg.decode returns raw
// RGBA and ignores the EXIF Orientation tag, but phone cameras store portrait
// shots as landscape pixels + Orientation = 6 ("rotate 90° CW to display"). If we
// resize/re-encode those raw pixels the tag is lost and every WebP/AVIF variant
// renders rotated. So we read the tag from the original JPEG and bake the
// rotation into the pixels here — the variants come out upright, tag-free.

// Read the EXIF Orientation (1..8) from a JPEG buffer; 1 (no transform) when the
// tag is absent or the bytes don't parse. Only the APP1/"Exif" segment is walked;
// scanning stops at SOS (start of compressed data). All reads are bounds-guarded.
function readJpegOrientation(buffer) {
  try {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      // Standalone markers (SOI/EOI/TEM/RSTn) carry no length payload.
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2; continue;
      }
      if (marker === 0xda) break; // SOS — image data starts, no more metadata
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2) return 1;
      if (marker === 0xe1) { // APP1
        const start = offset + 4;
        if (start + 6 <= buffer.length && buffer.toString('ascii', start, start + 4) === 'Exif') {
          return parseExifOrientation(buffer, start + 6); // skip "Exif\0\0"
        }
      }
      offset += 2 + size;
    }
  } catch { /* unparseable — treat as upright */ }
  return 1;
}

// Parse the TIFF block of an EXIF APP1 segment (starting at the byte-order mark)
// and return IFD0's Orientation value, or 1 when it isn't present.
function parseExifOrientation(buffer, tiffStart) {
  const le = buffer.toString('ascii', tiffStart, tiffStart + 2) === 'II';
  const u16 = (o) => (le ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o) => (le ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const ifd0 = tiffStart + u32(tiffStart + 4); // offset field skips the 0x002A magic
  if (ifd0 + 2 > buffer.length) return 1;
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > buffer.length) break;
    if (u16(entry) === 0x0112) { // Orientation, a SHORT stored inline in the value field
      const val = u16(entry + 8);
      return val >= 1 && val <= 8 ? val : 1;
    }
  }
  return 1;
}

// Read pixel dimensions straight from the file header, WITHOUT decoding, so an
// oversized image is caught before it can allocate width*height*4 bytes of RGBA
// (the decompression-bomb guard, see MAX_PIXELS). Returns { width, height } or
// null when the header can't be parsed (unknown format / truncated / corrupt) —
// callers treat null as "size unknown", never as a hard failure.
function probeDimensions(buffer, format) {
  try {
    if (format === 'jpeg') return probeJpeg(buffer);
    if (format === 'png') return probePng(buffer);
    if (format === 'webp') return probeWebp(buffer);
  } catch { /* unparseable header — treat as unknown size */ }
  return null;
}

// Walk the JPEG marker segments to the SOFn frame header, which carries the
// image dimensions (height then width, both big-endian). Reuses the same
// segment-skipping logic as readJpegOrientation.
function probeJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; continue;
    }
    if (marker === 0xda) break; // SOS — no frame header will follow
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2) return null;
    // SOF0..SOF15 hold the frame dimensions; C4 (DHT), C8 (JPG) and CC (DAC)
    // share the range but aren't frame headers.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return null;
}

// PNG: 8-byte signature, then the IHDR chunk (length + "IHDR" + width + height,
// both 32-bit big-endian) at a fixed offset.
function probePng(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// WebP: RIFF container with a "WEBP" form type, then one of three bitstream
// chunks (lossy VP8, lossless VP8L, extended VP8X), each storing the canvas
// dimensions at a known offset. All little-endian.
function probeWebp(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buffer.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    // Lossy: 3-byte frame tag + start code (9d 01 2a) then 14-bit width, height.
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    // Lossless: signature byte 0x2f then 14-bit (width-1), 14-bit (height-1).
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    // Extended: 24-bit (width-1), 24-bit (height-1) little-endian at offset 24.
    const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
    const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
    return { width, height };
  }
  return null;
}

// True when a header-probed image is larger than we will decode. Used to reject
// a decompression bomb before the codec allocates its RGBA buffer.
function exceedsPixelCap(buffer, format) {
  const dims = probeDimensions(buffer, format);
  return dims != null && dims.width * dims.height > MAX_PIXELS;
}

// Rotate/flip a decoded { data, width, height } bitmap to its upright form for the
// given EXIF orientation. Orientations 5-8 swap the axes (portrait<->landscape).
function applyOrientation(image, orientation) {
  if (!orientation || orientation === 1) return image;
  const { data, width: w, height: h } = image;
  const swap = orientation >= 5;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx, dy;
      switch (orientation) {
        case 2: dx = w - 1 - x; dy = y; break;          // flip horizontal
        case 3: dx = w - 1 - x; dy = h - 1 - y; break;  // rotate 180
        case 4: dx = x; dy = h - 1 - y; break;          // flip vertical
        case 5: dx = y; dy = x; break;                  // transpose
        case 6: dx = h - 1 - y; dy = x; break;          // rotate 90 CW
        case 7: dx = h - 1 - y; dy = w - 1 - x; break;  // transverse
        case 8: dx = y; dy = w - 1 - x; break;          // rotate 90 CCW
        default: dx = x; dy = y;
      }
      const si = (y * w + x) * 4;
      const di = (dy * ow + dx) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: ow, height: oh };
}

// Decode to ImageData ({ data, width, height }) or null when we have no codec
// for the format (gif/heic) or the bytes are corrupt. Callers treat null as
// "store the file as a single un-resized variant" — never a hard failure.
// JPEGs are rotated to their upright EXIF orientation before returning.
async function decodeBuffer(buffer, format) {
  try {
    // Bomb guard: refuse to decode an image whose header declares more pixels
    // than we'll allocate RGBA for. Returning null routes the backfill to "skip"
    // and the upload path to its undecodable branch, neither of which decodes.
    if (exceedsPixelCap(buffer, format)) return null;
    const ab = toArrayBuffer(buffer);
    if (format === 'webp') return await (await import('@jsquash/webp')).decode(ab);
    if (format === 'jpeg') {
      const decoded = await (await import('@jsquash/jpeg')).decode(ab);
      return applyOrientation(decoded, readJpegOrientation(buffer));
    }
    if (format === 'png') return await (await import('@jsquash/png')).decode(ab);
    return null; // gif / heic — no decoder wired (see docs/image-handling.md)
  } catch {
    return null;
  }
}

async function encodeTo(format, img) {
  if (format === 'webp') {
    return new Uint8Array(await (await import('@jsquash/webp')).encode(img, { quality: WEBP_QUALITY }));
  }
  if (format === 'avif') {
    return new Uint8Array(await (await import('@jsquash/avif')).encode(img, { cqLevel: AVIF_CQ, speed: AVIF_SPEED }));
  }
  throw new Error(`unknown variant format: ${format}`);
}

// From one decoded master, produce a file for every (format x target width).
// Returns [{ format, width, data: Uint8Array, bytes }]. Each width is resized
// once and then encoded to every requested format, so the expensive resize is
// shared. Ascending by width, formats in VARIANT_FORMATS order per width.
// Shared by uploads and the legacy backfill so both derive variants identically.
async function generateVariants(decoded, formats = VARIANT_FORMATS) {
  const { width: ow, height: oh } = decoded;
  const resize = (await import('@jsquash/resize')).default;
  const out = [];
  for (const w of targetWidths(ow)) {
    const img = w === ow
      ? decoded
      : await resize(decoded, { width: w, height: Math.max(1, Math.round((oh * w) / ow)) });
    for (const format of formats) {
      const data = await encodeTo(format, img);
      out.push({ format, width: w, data, bytes: data.length });
    }
  }
  return out;
}

// WebP-only helper, kept for callers that want the single-format subset.
async function generateWebpVariants(decoded) {
  return generateVariants(decoded, ['webp']);
}

module.exports = {
  SIZES,
  MAX_MEGAPIXELS,
  MAX_PIXELS,
  VARIANT_FORMATS,
  mimeToFormat,
  targetWidths,
  readJpegOrientation,
  applyOrientation,
  probeDimensions,
  exceedsPixelCap,
  decodeBuffer,
  generateVariants,
  generateWebpVariants,
};
