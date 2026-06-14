// Image pipeline — the ONE place that turns untrusted/vendor image BYTES into a
// canonical sprite PNG data URI. Shared by BOTH the upload route (a kid's photo)
// and the generate route (Gemini output).
//
// SECURITY (this is the upload spine): we validate magic bytes against a strict
// PNG/JPEG/WEBP allow-list on the DECODED buffer (SVG and everything else are
// rejected BEFORE sharp ever sees them — never trust a content-type or filename),
// then RE-ENCODE through sharp to a fresh 256² PNG. The re-encode is what makes the
// bytes safe: it strips all EXIF/metadata and discards anything after the image data
// (so polyglots and EXIF-script don't survive). The output data URI is built from
// OUR buffer, and validateSpriteImg (spec.ts) then verifies our own output.

import sharp from 'sharp';
import { validateSpriteImg } from './spec';

const SPRITE_PX = 256;
const MAX_INPUT_PIXELS = 6_000_000; // decompression-bomb guard — we only ever output 256²

export class ImageRejected extends Error {}

// Magic-byte allow-list on the decoded buffer. PNG: 89 50 4E 47. JPEG: FF D8 FF.
// WEBP: the split signature "RIFF"<4 size bytes>"WEBP" — both ranges must match, so
// a bare RIFF container (AVI/WAV) is rejected.
function sniff(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Raw image bytes (PNG/JPEG/WEBP) → a validated `data:image/png;base64,…` sprite.
// Throws ImageRejected on anything that is not a decodable allow-listed image, or
// whose re-encoded output somehow fails the sprite allow-list (e.g. size cap).
export async function reencodeToSprite(buf: Buffer): Promise<string> {
  if (sniff(buf) === null) throw new ImageRejected('unsupported image type');
  let out: Buffer;
  try {
    out = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate() // apply EXIF orientation, then re-encode drops all metadata
      .resize(SPRITE_PX, SPRITE_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new ImageRejected('could not decode image');
  }
  const uri = validateSpriteImg('data:image/png;base64,' + out.toString('base64'));
  if (!uri) throw new ImageRejected('re-encoded image failed the sprite allow-list');
  return uri;
}
