/**
 * pixel-agents-secure (H6): the webview's Content-Security-Policy.
 *
 * Upstream loads the webview with no CSP at all, so nothing stops a future
 * change (or an injected string rendered as HTML) from loading remote scripts,
 * images or fonts, or from opening network connections. This policy allows
 * only what the bundled SPA uses:
 *   - scripts, styles, fonts and images from the extension's own webview
 *     resources (`cspSource`);
 *   - `data:` / `blob:` images (wardrobe PNGs are inlined as data URIs; a piece
 *     sheet import is decoded from an object URL);
 *   - inline styles (React and xterm set them);
 *   - a `blob:` worker (the office radio's background clock; it falls back to
 *     setInterval if refused).
 * Everything else -- remote hosts above all -- is refused.
 *
 * Pure (no `vscode` import) so it can be unit-tested.
 */
export function webviewCsp(cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    `connect-src ${cspSource} data: blob:`,
    `manifest-src ${cspSource}`,
    'worker-src blob:',
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Insert the CSP meta tag as the first element of <head>. Throws if the HTML
 *  has no <head>, so a broken build can never ship without a policy. */
export function withCsp(html: string, cspSource: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${webviewCsp(cspSource)}" />`;
  if (!/<head[^>]*>/i.test(html)) throw new Error('webview index.html has no <head>');
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n    ${tag}`);
}
