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
- Native form submission is disabled. Activate SDK actions with `type="button"` and a click handler instead of relying on a form submit.

## Content Security Policy

The host sends this CSP with each widget. Directive lines show what is allowed. `sha256-<import map hash>` is the hash of the host-generated import map.

```
default-src 'none'
script-src <runtime>/ <widget>/ 'sha256-<import map hash>' 'wasm-unsafe-eval'
style-src <widget>/ 'unsafe-inline'
img-src <widget>/ data: blob:
media-src <widget>/ blob:
font-src <widget>/ data:
connect-src <widget>/ data: blob:
worker-src blob:
frame-src 'none'
object-src 'none'
base-uri <widget>/
form-action 'none'
```

## Runtime baseline

Target the intersection of WebKit 18.6 (macOS, WKWebView) and WebKitGTK 2.50 (Linux). Windows (WebView2, Chromium) is the least constrained engine.

- Video: WebM with VP9 video and Opus audio. Audio: Opus in Ogg or WebM. H.264/MP4, MP3 and AAC may not play on Linux without GStreamer plugins.
- 3D: WebGL 2. WebGPU only as an enhancement behind feature detection, with a fallback.
- `backdrop-filter` is an enhancement only. Critical UI must not depend on it.
- `requestIdleCallback` and `scheduler.postTask` are not available in every engine. Do not use them. `ld-widget check` reports them. Use `setTimeout` or `requestAnimationFrame`.
- Anything newer than the baseline needs feature detection and a fallback.

## Dependencies

- The host provides Vue ^3.5.0. A widget must not bundle its own Vue.
- Third-party npm libraries are allowed. They must be browser ES modules without Node APIs. The build bundles them.
- The bundled code must stay within 10485760 bytes.
- Reference audio and video by URL from `assets/`. The build rejects imports of such files into code.

## Modal lifecycle

A named modal runs in a separate sandbox with independent module memory, component state and lifecycle. It shares instance identity, persisted state, permissions, configuration and theme with the compact widget. Ordinary props are a JSON snapshot; imports and Vue refs do not communicate between runtimes.

Close through the host × button, Escape, or `widget.modal.close()`. Backdrop clicks do not close. Escape focused inside the iframe also closes, unless a widget control consumes it with `event.preventDefault()` (for example an open combobox); stopPropagation alone does not consume Escape. Nested modals are unavailable.

Every accepted close, including an error view, restarts exactly the compact caller's runtime and session. Unsaved in-memory edits disappear. Removed or replaced callers are never restored. Persist drafts if they must survive. The host drains already dispatched calls while rejecting new ones during close; uncertain completion after the bounded drain must be treated as unknown. Await writes before SDK close and reload after an unconfirmed write instead of replaying it.

The default window is `min(1120px, viewport width - 48px)` by `min(780px, viewport height - 48px)`. Modal `context.size` remains the board grid size; use CSS and container queries for the actual viewport. Use a full-width root, readable maximum content width, scrolling content and theme tokens. Do not infer modal pixels from grid cells.
