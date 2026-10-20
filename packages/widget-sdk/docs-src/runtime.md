# Runtime

A widget runs in a sandboxed frame with an opaque origin. The host draws the frame, supplies Vue and talks to the widget only through the SDK.

## Sandbox rules

- No browser storage: `localStorage`, `sessionStorage`, `indexedDB` and cookies do not work. Persist with `widget.state` and declare `state`.
- No Web Notifications. Use `widget.notify`, and declare `notifications`.
- Files load only from the widget folder. `fetch`, XHR and WebSocket reach only the widget's own files.
- External HTTP only through `widget.http.get` and `widget.http.send`. Declare `network` and list each origin in the manifest `network` array.
- Media by URL from `assets/`. Media files are not inlined into code.
- Workers only from `blob:` URLs.
- No nested frames.

## Content Security Policy

The host sends this CSP with each widget. Directive lines show what is allowed. `sha256-<import map hash>` is the hash of the host-generated import map.

```
{{CSP}}
```

## Runtime baseline

Target the intersection of WebKit 18.6 (macOS, WKWebView) and WebKitGTK 2.50 (Linux). Windows (WebView2, Chromium) is the least constrained engine.

- Video: WebM with VP9 video and Opus audio. Audio: Opus in Ogg or WebM. H.264/MP4, MP3 and AAC may not play on Linux without GStreamer plugins.
- 3D: WebGL 2. WebGPU only as an enhancement behind feature detection, with a fallback.
- `backdrop-filter` is an enhancement only. Critical UI must not depend on it.
- `requestIdleCallback` and `scheduler.postTask` are not available in every engine. Do not use them. `ld-widget check` reports them. Use `setTimeout` or `requestAnimationFrame`.
- Anything newer than the baseline needs feature detection and a fallback.

## Dependencies

- The host provides Vue {{VUE_RANGE}}. A widget must not bundle its own Vue.
- Third-party npm libraries are allowed. They must be browser ES modules without Node APIs. The build bundles them.
- The bundled code must stay within {{CODE_BYTES}} bytes.
- Reference audio and video by URL from `assets/`. The build rejects imports of such files into code.
