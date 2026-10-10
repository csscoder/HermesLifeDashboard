# Widget package v2: folder packages with media and sources

- **Builds on:** `.project-history/features/2026-10-09-widget-runtime-sandbox/spec.md` (package format v1,
  sandbox serving, gateway)
- **Status:** approved design, 2026-10-10

## Goal

A third-party widget can ship large code, media and its own sources, and the user installs it as a
folder through the UI:

- the user picks or drops the folder that `ld-widget build` produced; the host reviews it and copies
  it into `<dataDir>/userwidgets/<id>/<version>/`;
- code (JS, CSS, WASM) may total 10 MB; media (images, video, audio, fonts, models) has no limit;
- the widget bundles any npm library it wants; the core provides no shared libraries beyond `vue`
  and the SDK;
- the sandbox can load the package's own media, fonts, WASM and data files, with Range support for
  video and audio;
- the package carries the widget's source project, so the widget can be rebuilt after the original
  development folder is gone.

Success: `examples/widgets/hello` with a background video in `assets/` builds to a folder, installs
through «Установить», plays and seeks the video inside the sandbox; the packages list shows the paths
of its `source/` and `assets/`; packages installed before the upgrade still render on the board.

## Delivery decomposition

This is sub-project 1 of 2:

1. **Widget package v2** (this spec): folder format, upload and install, storage on disk, media
   serving, CSP, sources, migration of v1 packages.
2. **Widget audio** (separate spec, after this one): package-local audio, radio and external
   playlists behind a permission, playback that survives hiding the widget, host volume control.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Shared libraries | None. A widget bundles its own libraries; the import map keeps only `vue` and `@lifedashboard/widget-sdk` | Each sandbox iframe is a separate JS realm: a shared copy saves disk, not memory or CPU, and couples widgets to core library versions (`three` breaks in minor releases). The user does not want to restrict widgets to core libraries |
| Install unit | The built folder `dist/<id>-<version>/` from `ld-widget build` | The host never runs a build of foreign code outside the sandbox |
| Install path | UI upload only (folder picker or drop) | Keeps the review screen and immutable versions; a watched drop-in folder is a later dev-mode feature |
| Transport | Upload session: create (manifest + file list), one streaming `PUT` per file, install | No new dependency; the package is validated before any media is sent; large files never sit in memory |
| Code limit | `.js`, `.mjs`, `.css`, `.wasm` in the folder root: 10 MB total | Requested by the user; WASM is executable code |
| Media limit | None for `assets/**` and `source/**` | Requested by the user: the user controls disk use |
| Storage | Files on disk under `<dataDir>/userwidgets/`; SQLite keeps metadata only | Media of any size does not belong in SQLite |
| v1 packages | Replaced by v2 with a migration; `.ldwidget.json` install is removed | One format and one storage path; the project is in early development |
| Sources | `ld-widget build` copies the source project into `source/` by default; `--no-source` turns it off | Sources survive the deletion of the development folder; a forgotten flag must not lose them |
| Sources access | Absolute paths of `source/` and `assets/` shown in the packages list with a copy button | No zip writer in Node; a download would need a new dependency |
| Media references | Document-relative URLs `assets/...`; importing a media file over 100 KB into code fails the build | Vite library mode inlines imported assets as base64 into the JS |
| Workers | Allowed only from `blob:` URLs | An opaque-origin frame cannot construct a worker from an http URL |
| Network | Still none: `connect-src` allows only the package itself, `data:` and `blob:` | External sources belong to the gateway and the audio spec |

## Package folder

`ld-widget build` writes `dist/<id>-<version>/`:

```text
dev.example.clock-1.2.0/
├── widget.json          manifest, ≤ 64 KB
├── index.js             ┐
├── chunk-*.js           │ code, root only: .js .mjs .css .wasm, ≤ 10 MB total
├── style.css            ┘
├── assets/              media copied verbatim from the project's assets/, no limit
└── source/              the project without node_modules/, dist/, assets/ and dot entries
```

### File classes

| Location | Allowed extensions | Limit |
| --- | --- | --- |
| Root, no directories | `widget.json`; code: `js mjs css wasm` | Code ≤ 10 MB total |
| `assets/**` | Images: `png jpg jpeg webp avif gif svg`. Video: `mp4 webm`. Audio: `mp3 ogg oga opus wav m4a aac flac`. Fonts: `woff2 woff ttf otf`. Data: `json glb gltf bin riv lottie ktx2 hdr` | None |
| `source/**` | Any | None |

Any other location or extension is rejected when the upload session is created. Every served file
gets an exact `Content-Type` from this table (`SERVED_TYPES` in contracts) and `nosniff`.

### Path rules

- Segments match `[A-Za-z0-9._-]+`; no segment starts with `.`; no `..`; separator `/`.
- A path is at most 200 characters; a package has at most 2000 files including `widget.json`.
- Two paths that differ only in letter case are rejected (one file on a case-insensitive disk).
- `widget.json` is required; `manifest.entry` and every `manifest.styles` item must be code files in
  the root.

### Manifest v2 (`widget.json`)

The v1 manifest plus `"format": 2`; there is no `{ format, manifest, files }` wrapper:

```json
{
  "format": 2,
  "id": "dev.example.clock",
  "version": "1.2.0",
  "title": "Clock",
  "author": "Example",
  "sdk": 1,
  "entry": "index.js",
  "styles": ["style.css"],
  "sizing": { "default": { "w": 4, "h": 4 }, "min": { "w": 2, "h": 2 }, "max": { "w": 8, "h": 8 } },
  "permissions": ["state"]
}
```

`WidgetPackageManifest` keeps its fields; `format` is checked by the parser and not stored in the
type.

### Version hash

`sha256` over the lines `<path>\0<sha256 of the file>\n` of every file in the folder, sorted by
path. It covers `widget.json`, code, `assets/` and `source/`. A version stays immutable: the same
`id` and `version` with another hash is a `CONFLICT`.

### Referencing media

The sandbox document lives at `/sandbox/packages/<hash>/`, so `<video src="assets/bg.mp4">`,
`fetch('assets/model.glb')` and CSS `url(assets/font.woff2)` resolve without SDK help. Workers:
`fetch` the script, then `new Worker(URL.createObjectURL(blob))`.

### Restoring the project

`source/` plus `assets/` of the same version is the complete project. `pnpm install` and
`ld-widget build` there produce a new version.

## Contracts (`packages/contracts/src/widget-package.ts`)

- `PACKAGE_LIMITS = { codeBytes: 10_485_760, manifestBytes: 65_536, maxFiles: 2000, maxPathLength: 200, maxIdLength: 100, maxTextLength: 60 }`.
- `SERVED_TYPES: Record<string, string>`: extension → `Content-Type` for root code and `assets/`.
- `parseWidgetManifest(raw): ParseResult<WidgetPackageManifest>`: requires `format: 2`, otherwise
  the v1 manifest rules.
- `parseWidgetFolder(manifest: unknown, files: unknown): ParseResult<WidgetFolder>` with
  `files: { path: string; size: number }[]`: path rules, file classes, code limit, file count,
  `entry`/`styles`. Returns `{ manifest, files, sizes: { code, assets, source } }`. The single
  validation point for the CLI, the UI and the API.
- `parseWidgetPackage`, the `files` map and `.ldwidget.json` are removed.
- `InstalledPackageVersion` gains `paths: { source: string | null; assets: string | null }`
  (absolute; `null` when the folder is absent).
- `PackageInspection` gains `sizes`; `hash` is `null` until the files are uploaded.

## Data

- Root: `<dataDir>/userwidgets/` (`dataDir` from `apps/api/src/config.ts`).
- Version folder: `userwidgets/<id>/<version>/`.
- Upload staging: `userwidgets/.staging/<uploadId>/`.
- `widget_package_versions` loses `files`; `hash`, `manifest`, `installed_at` stay.

### Migration v1 → v2

`MIGRATIONS` entries become `string | ((db: DatabaseSync, context: { dataDir: string }) => void)`;
`openDatabase` passes the context and runs a function entry inside the same transaction as SQL ones.
The new entry:

1. For each `widget_package_versions` row: write every file of `files` and a v2 `widget.json`
   (`format: 2` plus the stored manifest) into `userwidgets/<id>/<version>/`, overwriting existing
   files. Writes are idempotent.
2. Rebuild `widget_package_versions` without `files` (create new table, copy, drop, rename).
3. The stored `hash` stays: it identifies the version in sandbox URLs and on boards.

A write failure throws; the transaction rolls back, the API does not start, and the database keeps
`files` (the pre-migration backup `lifedashboard.db.bak-v<n>` exists as before). Files already
written are rewritten on the next start.

Migrated versions have no `source/`; reinstalling the same version from a v2 build is a `CONFLICT`
because the hash scheme differs.

### Startup cleanup

After migrations, the API deletes `userwidgets/.staging/` and every `userwidgets/<id>/<version>/`
without a `widget_package_versions` row (left by a crash between the folder move and the commit).

## API

All routes need a dashboard session and pass the existing origin checks.

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/v1/widget-uploads` | `{ manifest, files: [{ path, size }] }` (JSON, default 1 MB body limit) | `{ uploadId, inspection }`; `inspection.hash = null` |
| `PUT /api/v1/widget-uploads/:id/files/*` | `application/octet-stream`, streamed | `null` |
| `POST /api/v1/widget-uploads/:id/install` | none | `PackageInspection` with `installed: true` |
| `DELETE /api/v1/widget-uploads/:id` | none | `null` |

`POST /widget-packages/inspect` and `POST /widget-packages` are removed. `GET /widget-packages`,
`DELETE /widget-packages/:id` and the grant route stay; delete also removes `userwidgets/<id>/`.

### Upload sessions

- Kept in memory: `uploadId` (random), declared manifest and files, staging path, last use. At most
  3 sessions; a new one evicts the oldest and deletes its staging folder. A session idle for 30
  minutes is deleted. An API restart drops all sessions (startup cleanup removes the folders).
- Create: `parseWidgetFolder`; the inspection reports `installed` (the version exists),
  `newPermissions` and `sizes`.
- `PUT`: a content-type parser for `application/octet-stream` hands the raw stream to the route
  (no body limit is applied by Fastify; the route enforces sizes). The path must be in the declared
  list. The stream goes to `<staging>/<path>` through `stream.pipeline`; more bytes than declared
  abort the request with `VALIDATION_ERROR` and delete the partial file. A repeated `PUT` of a path
  overwrites it.
- Install, under `BEGIN IMMEDIATE`:
  1. every declared file exists with its declared size;
  2. `widget.json` read from staging parses with `parseWidgetManifest` and equals the declared
     manifest;
  3. compute the version hash;
  4. if the version row exists: same hash → delete staging, return `installed: true`; other hash →
     `CONFLICT`;
  5. `rename` staging to `userwidgets/<id>/<version>/` (same volume, atomic);
  6. insert package, version and grants as v1 install does (new confirmable grants start as `ask`);
  7. commit; on any failure after step 5 delete the version folder and roll back.
  The session ends after install, success or not.

### Errors

| Case | Code |
| --- | --- |
| Manifest, path, extension, limits, size mismatch, missing file, `widget.json` changed | `VALIDATION_ERROR` with a readable message |
| Unknown or expired `uploadId` | `NOT_FOUND` |
| Same version with another hash | `CONFLICT` |
| Disk write failure | `INTERNAL_ERROR`; the staging folder is deleted |

## Sandbox serving (`apps/api/src/sandbox.ts`)

- `GET /sandbox/packages/:hash/` keeps serving the document; the manifest comes from SQLite.
- `GET /sandbox/packages/:hash/*`:
  - the hash selects `<id>/<version>`; the path must pass the path rules and be root code or
    `assets/**`; `widget.json` and `source/**` are `NOT_FOUND`;
  - the resolved path must stay inside the version folder;
  - `Content-Type` from `SERVED_TYPES`, `nosniff`, `cache-control: public, max-age=31536000, immutable`;
  - single `Range: bytes=a-b` (and `a-`, `-n`) → `206` with `Content-Range` and
    `Accept-Ranges: bytes`; an unsatisfiable range → `416`; other ranges → full `200`. Files stream
    from `fs.createReadStream`;
  - every file response carries `Content-Security-Policy: sandbox; default-src 'none'`, so a file
    opened directly in a tab (an SVG with a script) runs in an opaque origin without scripts.
    Cookies are not port-bound, so without it such a script could call `/api` as the user.

### Document CSP

```text
default-src 'none'
script-src <runtime> <package> 'sha256-<import map>' 'wasm-unsafe-eval'
style-src <package> 'unsafe-inline'
img-src <package> data: blob:
media-src <package> blob:
font-src <package> data:
connect-src <package> data: blob:
worker-src blob:
frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

`<package>` is `<base>/sandbox/packages/<hash>/`. The iframe keeps `sandbox="allow-scripts"`.

## SDK (`packages/widget-sdk`)

`ld-widget build [dir] [--no-source]`:

1. Vite library build as today with `vue` and the SDK external; code splitting stays on, so
   `import()` produces chunks. Every emitted file goes to the package root.
2. A build plugin fails the build when code imports a file with a media extension larger than
   100 KB: «reference media by URL: assets/<name>».
3. Copy `<project>/assets/` verbatim to `assets/`.
4. Unless `--no-source`, copy the project to `source/`, excluding `node_modules/`, `dist/`,
   `assets/` and every entry whose name starts with `.`.
5. Write `widget.json` with `format: 2`.
6. Validate the output with `parseWidgetFolder`; a path that breaks the path rules fails the build
   and names the path.
7. Replace `dist/<id>-<version>/` and print its path.

The sandbox runtime (`sandbox.ts`) is unchanged.

## UI (`apps/ui`)

- `PackagesDialog.vue`, «Установить»: a folder picker (`<input type="file" webkitdirectory>`) and a
  drop zone (`DataTransferItem.webkitGetAsEntry()` traversal). Paths are taken relative to the
  picked folder. The client reads `widget.json`, runs `parseWidgetFolder` and shows errors before
  any request.
- Review screen from the create response: title, author, version, «уже установлена» when
  `installed`, permissions with modes, sizes (код / медиа / исходники).
- «Установить» uploads files three at a time with one overall progress bar, then calls install,
  then saves relaxed grant modes as today.
- «Отмена» at any step calls `DELETE /widget-uploads/:id`. A failed file can be retried; any other
  error shows its message and offers to start over.
- Packages list: per version a row «Исходники» with the `source/` and `assets/` paths and copy
  buttons, or «Исходники не включены» when `paths.source` is `null`.
- `readPackageFile` and the `.ldwidget.json` file input are removed.

## Examples and docs

- `examples/widgets/hello`: a short background video in `assets/`, played muted and looped.
- `examples/widgets/hostile`: new attacks — a `../` path in the upload list, direct navigation to an
  SVG asset with a script, `fetch` to an external host, `new Worker('assets/w.js')`, a request for
  `source/` and `widget.json` through the sandbox route.
- README «Widget SDK»: folder format, limits, media URLs, workers, sources and `--no-source`,
  install flow. Remove the `.ldwidget.json` instructions.

## Security notes

- The host still runs no package code outside the sandbox; the build happens on the author's
  machine.
- Paths are validated against the declared list on every `PUT` and on serving; resolved paths must
  stay inside their folder; the server creates every file itself, so no symlinks exist in
  `userwidgets/`.
- `source/` is never served to the sandbox; `ld-widget build` excludes dot entries so `.env` files
  do not ship.
- `'wasm-unsafe-eval'` permits WebAssembly compilation only, not JS `eval`.
- `connect-src` and `media-src` reach only the package's own folder: a widget still cannot send data
  anywhere.
- An unlimited media quota lets a package fill the disk; this is the user's explicit choice and the
  review screen shows the sizes before the upload starts.

## Testing

Vitest, test first for every behavior change.

- `contracts`: `parseWidgetManifest` (format 2, v1 rules); `parseWidgetFolder` — path rules, dot
  segments, `..`, case collisions, extension per class, 10 MB code limit, 2000 files, `entry` and
  `styles`, sizes per class.
- `api` (`widget-packages.test.ts` and a new `widget-uploads.test.ts`):
  - create rejects invalid folders; `PUT` of an undeclared path; `PUT` over the declared size aborts
    and deletes the partial file; repeated `PUT` overwrites;
  - install: missing file, size mismatch, changed `widget.json`, same hash → installed, other hash →
    `CONFLICT`, success moves the folder and writes rows, a failing insert removes the folder;
  - cancel, eviction of the fourth session, idle expiry;
  - startup cleanup of `.staging/` and orphan version folders; delete removes `userwidgets/<id>/`.
- `api` (`db.test.ts`): the v1 → v2 migration writes files and `widget.json`, keeps hashes, drops
  `files`; a write failure rolls back and keeps `files`.
- `api` (`sandbox.test.ts`): document CSP; file types; `206`, `416` and full responses; `NOT_FOUND`
  for `source/**`, `widget.json`, `..` and unknown paths; the `sandbox` CSP header on files.
- `widget-sdk`: build of a fixture project — folder layout, chunks, `assets/` copy, `source/`
  exclusions, `--no-source`, the media-import error, an invalid file name error.
- `ui`: building the file list from a picked folder and from a dropped directory entry.
- Browser acceptance in Orca's browser: install `hello`, video plays and seeks; packages list shows
  the paths; a v1 package placed before the upgrade still renders; every `hostile` attack fails.

## Acceptance criteria

1. `ld-widget build` produces `dist/<id>-<version>/` with code, `assets/`, `source/` and a v2
   `widget.json`; `--no-source` omits `source/`.
2. «Установить» accepts a picked or dropped folder, shows the review screen before uploading,
   uploads with progress and installs into `userwidgets/<id>/<version>/`.
3. Code over 10 MB, a forbidden path or extension, and a changed `widget.json` are rejected with a
   readable message; media size is not limited.
4. The sandbox loads package images, video (with seeking), fonts, WASM and data files; external
   network stays blocked.
5. Opening a package SVG directly in a tab does not run its script.
6. The packages list shows `source/` and `assets/` paths, or «Исходники не включены».
7. Packages installed in format v1 keep working after the migration; `.ldwidget.json` install no
   longer exists.
8. `pnpm typecheck` and `pnpm test` pass.

## Out of scope

- Audio beyond package-local `<audio>`/`<video>` playback (spec «Widget audio»).
- Shared or core-provided libraries for sandboxed widgets.
- Dev mode: a watched source folder with live preview.
- Zip export or download of sources; «Показать в Finder» (Tauri).
- Building packages on the host.
- Disk quotas for media.
- Distribution as a single file (archive) and package signing.
