// Inject the Arcade SDK <script> into a game's HTML so plain artifacts get
// window.Arcade for free. Inserted right after <head> (fallback: after <body>,
// then prepend). The SDK is served from the games origin at /arcade-sdk.js.

const SDK_TAG = '<script src="/arcade-sdk.js"></script>';

export function injectSdk(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + '\n' + SDK_TAG);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (m) => m + '\n' + SDK_TAG);
  }
  return SDK_TAG + '\n' + html;
}
