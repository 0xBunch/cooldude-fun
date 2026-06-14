// Art provider — the seam between the Studio and an image-generation vendor, mirroring
// drive.ts (interface + concrete impl + keyless stub + lazy getProvider() singleton).
//
// Contract: generate(prompt) → RAW image bytes (a Buffer), exactly like drive's
// getContent(). The provider is dumb on purpose — it does NOT know what a "sprite" is.
// All image semantics (magic-byte validation, resize to 256², metadata strip, PNG,
// the future chroma-key) live in image.ts (reencodeToSprite), shared with the upload
// path. So both paths converge: bytes → reencodeToSprite → setSpriteImg.
//
// Real generation requires BOTH a key and the explicit enable flag; otherwise the
// keyless StubArtProvider runs, so the whole pipeline is testable offline.

// `@google/genai` is ESM-only; this project compiles to CommonJS (tsconfig module:
// node16, no "type":"module"), so it is loaded via a lazy dynamic import() — which
// node16 preserves — only when real generation actually runs. The type is import-type
// only (erased at compile time), so no static require is emitted.
import sharp from 'sharp';
import { config } from '../config';

// Instance type derived from the dynamic-import type (no static ESM import — that
// would emit a require() and fail at runtime under CommonJS). resolution-mode tells
// node16 to type-resolve the ESM build.
type GenAIClient = InstanceType<(typeof import('@google/genai', { with: { 'resolution-mode': 'import' } }))['GoogleGenAI']>;

export interface ArtProvider {
  generate(prompt: string): Promise<Buffer>;
}

class GeminiArtProvider implements ArtProvider {
  private ai: GenAIClient | null = null;
  constructor(private apiKey: string) {}

  private async client(): Promise<GenAIClient> {
    if (!this.ai) {
      // Value-side load shares the ESM resolution the GenAIClient type alias uses;
      // don't "simplify" one without the other.
      const { GoogleGenAI } = await import('@google/genai');
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.ai;
  }

  // NOTE: this path is only reachable once KB sets GEMINI_API_KEY + STUDIO_GEMINI_ENABLED=1,
  // so it CANNOT be exercised in keyless dev — verify it on the first real key. We send only
  // the verified-core call (model + templated prompt + responseModalities) and read the image
  // out of inlineData; the model's built-in safety filter is the content gate (a vision
  // moderation pass is the deferred backstop). Returned bytes are JPEG/PNG — reencodeToSprite
  // accepts both and normalizes to a 256² PNG.
  async generate(prompt: string): Promise<Buffer> {
    const ai = await this.client();
    const res = await ai.models.generateContent({
      model: config.geminiImageModel,
      contents: prompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const parts = res?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const data = part?.inlineData?.data;
      if (typeof data === 'string' && data) return Buffer.from(data, 'base64');
    }
    throw new Error('Gemini returned no image');
  }
}

class StubArtProvider implements ArtProvider {
  // Keyless dev: a solid magenta square so the generate→re-encode→render pipeline is
  // visibly exercised end-to-end without spending a cent. reencodeToSprite re-encodes it.
  async generate(_prompt: string): Promise<Buffer> {
    return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 43, b: 214, alpha: 1 } } })
      .png()
      .toBuffer();
  }
}

// True when real generation is OFF (keyless or flag unset) — the /draw route uses this
// to skip the paid global budget gate (the stub is free) and to label the dev mode.
export function isStubArt(): boolean {
  return !(config.geminiApiKey && config.geminiEnabled);
}

let provider: ArtProvider | null = null;
export function getArtProvider(): ArtProvider {
  if (provider) return provider;
  provider = isStubArt() ? new StubArtProvider() : new GeminiArtProvider(config.geminiApiKey);
  return provider;
}
