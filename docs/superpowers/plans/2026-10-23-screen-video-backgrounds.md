# Screen Video Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Independent frozen-contract tasks are delegated in parallel; root integrates and verifies.

**Goal:** Import a local video or image per screen, render it with Pixi and a configurable pixel PNG grid, and preserve draft/save/cancel and media safety.
**Architecture:** Add optional ScreenBackground in the existing board document; streamed, authenticated media storage plus renewable leases; one shell Pixi renderer; editor inside the existing active-screen popover.
**Tech Stack:** Existing Vue/Nuxt, PixiJS 8.22.0, Fastify, Node SQLite, Vitest; no new dependency.
**Spec:** `docs/superpowers/specs/2026-10-23-screen-video-backgrounds-design.md`

## Global Constraints

No new dependencies, branches, commits, pushes or publication. Preserve current dirty checkout. Use Orca only for browser work. Four deterministic PNG shapes; no remote URLs or transcoding. The user approved implementation and the screenshot control location, including separate video/pattern opacity.

## Frozen interfaces

This section records the initial video baseline. The authorized refinements below supersede its video-only names, four-pattern list and initial default; current source contracts define the final interfaces.

Contracts are exported from `@lifedashboard/contracts/board`:
- `ScreenBackground = { videoId: string; opacity: number; dim: number; pattern: { shape: 'none'|'circles'|'squares'|'diamonds'|'crosses'; color: string; opacity: number; scale: number } }`.
- All opacity/dim values are finite 0..1. Pattern colour is #rrggbb, scale finite 0.25..4. IDs are UUIDs. `defaultBackground(videoId)` returns opacity 1, dim .35, circles/black/.25/1.
- `ScreenBoard.background?: ScreenBackground | null`; parser omits null/absent, canonical order id, rows, themeId (if explicit), background (if explicit), instances, layout. Existing edit helpers preserve it.
- `BackgroundMedia = { id: string; name: string; size: number; mime: string }`.

Authenticated API:
- POST `/api/v1/background-media?name=<encoded>&size=<integer>&mime=<encoded>` raw application/octet-stream -> BackgroundMedia, only after streamed atomic completion. Validate container MP4/M4V/MOV or WebM; no whole-file buffering.
- GET `/api/v1/background-media/:id` -> streamed video with byte ranges.
- GET `/api/v1/background-media/:id/metadata` -> BackgroundMedia.
- DELETE `/api/v1/background-media/:id` -> null only when no saved refs/live leases; referenced assets yield conflict.
- POST `/api/v1/background-media/leases` JSON `{leaseId: UUID, videoIds: UUID[]}` replaces/renews that lease for 24 h; DELETE `/api/v1/background-media/leases/:leaseId` releases it. Renew at 60 s from UI. Protect shared references/drafts; release/GC only owned unused files; preserve cleanup metadata on unlink failure.

Editor module `background/media-api.ts` exports `importVideo(file:File, signal:AbortSignal):Promise<ApiResult<BackgroundMedia>>`, `mediaInfo(id)`, `leaseMedia(leaseId,videoIds)`, `releaseMedia(leaseId)`, `discardMedia(id)`. These use existing apiRequest. Upload takes caller signal instead of default 5 s. Return typed failures.
`BackgroundEditor.vue` props `{ background: ScreenBackground|null; disabled:boolean }`; emits `change(background:ScreenBackground|null)`. Parent keys it by displayed space+screen. Editor owns validation/import cancellation; late results never emit after unmount, disabled or newer import; stale unused import is discarded. Existing saved background remains until playable imported replacement succeeds. Native metadata/first-frame decode probe uses object URL and bounded timeout, then revokes it. Show filename/progress/error, file picker, remove, dim/video-opacity/pattern/colour/scale/pattern-opacity controls in Russian. No Done/save call here.

`PixiBackground.vue` props `{background:ScreenBackground|null}` emits `error(message:string|null)`; root calls only for a loaded/displayed board. Renderer module exposes `createBackgroundRenderer(host:HTMLElement,onError:(message:string|null)=>void):Promise<{setBackground(background:ScreenBackground|null):Promise<void>;destroy():void}>`. Shader-free Pixi scene, one canvas, one video source; video URL uses endpoint above. UI component handles prop race/unmount around async creation. Renderer owns pause/visibility/reduced-motion/resize, decoded-frame rendering, disposal and stale loads. Four PNG tiles in `background/patterns`.

## Review Focus

- Stale imports, renderer initialization and lease responses must not replace another screen or revive a destroyed renderer.
- Failed/declined/conflicting changes retain saved media; active leases protect orphaned media across tabs and >24h staging age.
- Partial/incorrect uploads and cleanup failures preserve metadata/retry safety without reading large files into memory.
- Separate video opacity, pattern opacity and dimming affect the intended layers, including 0 and 1.
- Draft canonical ordering and screen switch/save/cancel preserve background and widget changes; popup growth never overlaps its anchor or closes on internal scroll.

### Task 1: Contracts and API persistence/media (delegated)

**Files:** contracts board/tests; API migrations, spaces, app and new background-media module/tests.
- [x] RED/GREEN contracts, streamed upload/ranges/auth, metadata, lease/GC and board persistence/migration tests.
- [x] Implement frozen interfaces, cleanup after successful save/screen/space delete; preserve references/leases on errors. Full contracts/API tests and typechecks.

### Task 2: Pixi renderer (delegated, independent)

**Files:** `apps/ui/app/background/{PixiBackground.vue,renderer.ts,patterns/*.png}` and renderer/component tests.
- [x] RED/GREEN lifecycle, cover fit, layer opacity/tint, no duplicate renderers, hidden/reduced-motion, decoded frames, stale loads and cleanup failures.
- [x] Real Pixi renderer with four tile assets, lazy load Pixi in shell component. No API/editor/root edits.

### Task 3: Background editor/client (delegated, independent)

**Files:** `background/{BackgroundEditor.vue,media-api.ts,import-video.ts}` as needed and focused tests.
- [x] RED/GREEN typed request contracts and editor changes, failure preservation, cancellation/stale import, independent controls.
- [x] Implement Russian controls using existing theme tokens and test renderer. Do not edit ScreenDots/WidgetBoard/app/contracts/API.

### Task 4: Board/shell/lease integration (root)

**Files:** `board/{WidgetBoard.vue,edit-session.ts}`, `app.vue`, `spaces/ScreenDots.vue`, `background/use-media-leases.ts`, UI tests.
- [x] RED/GREEN canonical background edits preserving themes/widget state; renewable serial leases, release on unmount and failed renew recovery.
- [x] Expose shown background/key and setBackground draft mutation; shell single PixiBackground; editor inside popover, resize/reposition on content growth.
- [x] Preserve existing save/cancel/switch/delete paths. No background API call implicitly saves widgets.

### Task 5: Acceptance, review and documentation

- [x] Full pnpm test/typecheck/build; inspect scoped diff.
- [ ] Orca isolated database + real MP4/WebM: import/copy independence/playback, all controls, Done/Cancel, reload/switching/hide/resume, errors and one canvas.
- [x] Independent whole-feature review; important findings fixed by RED/GREEN. Update README/theme docs, record performance evidence limits and outcomes.

## Progress

Approved spec; current checkout retained without Git operations as authorized. Work streams own disjoint files against the frozen contracts above. Root owns integration and final verification. No implementation done at plan creation.

## Implementation refinements authorized by user

Micro-grid: the initial common 3px cell is superseded by exact binary PNG cells: diagonal2×2; cross/square/triangle/legacy-diamond3×3; circle6×6. Default diagonal scale1. Nearest sampling without mipmaps, integer enlargement1..4, legacy fractional scale rounds to minimum1. Square is a2×2 fill within3×3 to prevent stripes. Explicit on/off stores shape none; other settings remain independent.
Images: ScreenBackground canonical `{mediaId,kind:'video'|'image',opacity,dim,pattern}`. defaultBackground(id,kind='video'); old videoId parsed as video and migrated additively. API supports PNG/JPEG/WebP/AVIF, validates kind against MIME; existing media/lease store shared (legacy lease videoIds wire retained). Editor uses generic import/probe and dynamic opacity label; renderer uses a static ImageSource with no frame callback. Root getter uses mediaId. No new dependency.

Task1 video baseline: contracts484/API383 passed; later MOV compatibility RED/GREEN fixed a real browser-decodable legacy QuickTime file and API384 passed. Generic image extension in progress.
Task2 video baseline: focused19 passed; reviewer found deferred play/pause race, four RED cases plus stale/genuine failure cases -> focused25 and UI579 passed. Microtexture period RED (128px instead of3px) -> focused29 passed.
Task3: editor + media client/probe + serialized renewing leases implemented/tested; parent root integration57 focused tests passed. Generic image refinement in progress.
Task4: draft background helper, displayed screen background/key/lease union, shell renderer, shared popover editor and ResizeObserver integrated. Canonical/order tests and growing-popup tests RED->GREEN. Full video baseline1963 tests/typecheck/build passed before authorized microtexture/image additions.

## Integrated verification so far

- Generic image/video contracts/API/editor/renderer integration: full `pnpm test` recheck passed1995/1995 (contracts486, SDK341, UI605, API387, examples/create-widget176). `pnpm typecheck` and `pnpm build` passed. One preceding SDK dev-server.listen test failed on a revision expectation (3 instead of2); isolated6-test rerun and full recheck passed. SDK source was not modified.
- Independent video review found one Important deferred play/pause race, covered by four failing cases and fixed with playback-intent tickets. Image extension review found no new Critical/Important issue. Its generic grid-label wording was aligned with the newly approved image scope.
- Live Orca video baseline at59476 used a temporary database and a real generated MP4: muted native decoding advanced, one canvas/one active video and no app console errors. A native-decodable legacy MOV was rejected by first-ftyp validation, reproduced live and fixed by bounded QuickTime atom validation; API tests pass, final browser retry pending.
- Browser final image/video acceptance is in progress. During automation the displayed media changed to an unrelated1280×720 clip and original instrumentation/context changed, so active UI actions were stopped and a clarification was sent to the user to avoid overwriting their manual work. No claim is made that the interrupted final script passed. Current test server/data are retained until ownership is clear.

## Final pixel refinement verification

- Six actual tiny PNG assets contain only white RGB with alpha0/255. Exact source pixels and2×2/3×3/6×6 dimensions are covered by decoded-PNG tests. Pattern-only nearest sampling and no mipmaps preserve binary edges; media sampling remains unchanged.
- Editor exposes shape, colour, independent opacity, on/off and integer enlargement1..4 with actual dimensions. Renderer rounds legacy fractional scales consistently. The square's2×2 fill sits in3×3 to avoid merging repeated squares into stripes.
- Fresh root verification after integration: `pnpm test` passed2024/2024 (contracts494, SDK341, UI626, API387, examples/create-widget176); `pnpm typecheck`, `pnpm build` and `git diff --check` passed. Focused independent review found no Critical/Important issue.
- Final GPU appearance and the interrupted end-to-end image/video acceptance remain **unverified**. Browser mutation remains paused pending ownership clarification; existing MP4 playback evidence does not establish final pixel appearance or static-image acceptance. No native/Pixi performance comparison was made.

## Live save rejection follow-up

The user reported a failed Done save on the acceptance server at59476. Reproduced the same draft: HTTP400 `screens[0]: invalid screen background` for a valid `mediaId/kind:video/diagonal/scale:2` background. The plain Node API process had started13:32, before the current shape contract changed13:48; the newly built UI was therefore talking to an old in-memory parser. The current source parser accepted the identical background.

Gracefully restarted only that acceptance API with the same SQLite/data directory, without reloading the draft, under `node --watch` so imported source changes trigger restart. Repeated Done: HTTP200 revision10, edit mode closed, notice cleared; independent GET returned the saved background and existing widget. Reload completed, one visible background canvas was observed and console was empty. The user resumed screen/settings interactions during subsequent visual capture; no further UI mutations were performed. This establishes the reported save fix, not the remaining whole-feature image/video acceptance. No production source change or new test was needed for this stale-process issue.
