// Image encode worker (issue #15, phase 3 follow-up). Runs the CPU-bound WASM
// codecs (decode → resize → AVIF+WebP encode) OFF the main event loop so an
// upload — an AVIF encode in particular, which @jsquash runs synchronously —
// never blocks request handling for other users. The main thread (images.js)
// owns the DB and disk; this worker is pure pixels and touches neither. It loads
// only ./image-codec (no ./db), so no worker ever opens the SQLite handle.
//
// Protocol: main posts { id, buffer, format }; we reply with one of
//   { id, decoded: true, width, height, files: [{format,width,bytes,data}] }
//   { id, decoded: false }               // no decoder (gif/heic) — store verbatim
//   { id, error }                        // oversized/corrupt/encode failure
// The variant ArrayBuffers are transferred back (zero-copy), not cloned.
const { parentPort } = require('worker_threads');
const codec = require('./image-codec');

if (!parentPort) throw new Error('image-worker must be run as a worker thread');

parentPort.on('message', async ({ id, buffer, format }) => {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    // Second line of defence — the main thread already rejects oversized uploads
    // before dispatching, but the backfill and any future caller route through
    // here too, so guard again rather than trust the caller.
    if (codec.exceedsPixelCap(buf, format)) {
      parentPort.postMessage({ id, error: 'image exceeds decode limit' });
      return;
    }

    const decoded = await codec.decodeBuffer(buf, format);
    if (!decoded) {
      parentPort.postMessage({ id, decoded: false });
      return;
    }

    const variants = await codec.generateVariants(decoded);
    const files = variants.map((v) => ({ format: v.format, width: v.width, bytes: v.bytes, data: v.data }));
    // Transfer each variant's underlying ArrayBuffer so multi-MB payloads move
    // without a structured-clone copy. The decoded master never crosses back.
    const transfer = files.map((f) => f.data.buffer);
    parentPort.postMessage({ id, decoded: true, width: decoded.width, height: decoded.height, files }, transfer);
  } catch (err) {
    parentPort.postMessage({ id, error: (err && err.message) || 'image encode failed' });
  }
});
