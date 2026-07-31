// Client-side image preprocessing for uploads (issue #15, phase 1).
//
// Downscale a picked image to a bounded WebP "master" before it leaves the
// device. The full-resolution camera original is never uploaded — the cheapest
// possible answer to the plan's "don't even send the original" — and the upload
// is a fraction of the bytes. The server derives the smaller responsive sizes
// from this master (server/src/images.js).
//
// WebP is encoded natively with canvas.toBlob, reliable across every evergreen
// browser, so no WASM codec ships to the client. Anything the browser can't
// decode or encode (ancient browsers, HEIC without a decoder) falls back to the
// original file untouched; the server then stores it as a single-variant image.

const MAX_EDGE = 1600; // longest edge — matches the server's `large` ceiling
const QUALITY = 0.82;

export async function prepareImageUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  // A canvas re-encode would flatten an animated GIF to one frame — leave it.
  if (file.type === 'image/gif') return file;

  let bitmap: ImageBitmap;
  try {
    // `from-image` honours EXIF orientation so portrait phone photos aren't
    // stored sideways once the metadata is dropped by the re-encode.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // undecodable here (e.g. HEIC) — let the server keep the original
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', QUALITY),
    );
    // No WebP support, or the re-encode is no smaller than the source (an
    // already-optimised small image): keep the original rather than bloat it.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
    return new File([blob], name, { type: 'image/webp', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
