export interface SandboxUrls {
  /** Absolute runtime directory URL, ending with `/`. */
  runtime: string
  /** Absolute package directory URL, ending with `/`. */
  packageDir: string
  /** Absolute widget entry URL. */
  entry: string
}

export interface SandboxExtras {
  scripts?: readonly string[]
  connectSrc?: readonly string[]
}

/**
 * The document of one package version. Callers provide validated URLs and file names that need no
 * HTML escaping. No instance or user data: config, theme and size arrive over the port.
 */
export async function sandboxDocument(
  { runtime, packageDir, entry }: SandboxUrls,
  styles: readonly string[],
  extras: SandboxExtras = {},
): Promise<{ html: string; csp: string }> {
  const importMap = JSON.stringify({
    imports: {
      vue: `${runtime}vue.js`,
      '@lifedashboard/widget-sdk': `${runtime}sdk.js`,
      '@lifedashboard/widget-entry': entry,
    },
  })
  const links = styles.map((name) => `  <link rel="stylesheet" href="${packageDir}${name}">\n`).join('')
  const scripts = (extras.scripts ?? []).map((src) => `  <script type="module" src="${src}"></script>\n`).join('')
  const html =
    '<!doctype html>\n<html>\n<head>\n' +
    // Relative URLs (assets/…) must resolve against the host origin, not the proxying UI origin.
    `  <base href="${packageDir}">\n` +
    '  <meta charset="utf-8">\n' +
    `  <script type="importmap">${importMap}</script>\n` +
    links +
    scripts +
    `  <script type="module" src="${runtime}sdk.js"></script>\n` +
    '</head>\n<body><div id="app"></div></body>\n</html>\n'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(importMap))
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)))
  // Explicit URLs, not 'self': engines treat 'self' differently in opaque-origin documents.
  const csp = [
    "default-src 'none'",
    `script-src ${runtime} ${packageDir} 'sha256-${hash}' 'wasm-unsafe-eval'`,
    `style-src ${packageDir} 'unsafe-inline'`,
    `img-src ${packageDir} data: blob:`,
    `media-src ${packageDir} blob:`,
    `font-src ${packageDir} data:`,
    `connect-src ${packageDir} data: blob:${(extras.connectSrc ?? []).map((src) => ` ${src}`).join('')}`,
    'worker-src blob:',
    "frame-src 'none'",
    "object-src 'none'",
    `base-uri ${packageDir}`,
    "form-action 'none'",
  ].join('; ')
  return { html, csp }
}
