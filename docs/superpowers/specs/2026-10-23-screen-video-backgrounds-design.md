# Screen video backgrounds and PNG patterns

## Intent and decisions

Each screen can use a locally imported looping background video. A configurable repeating PNG pattern and a separate dimming layer let a user tune readability without preparing a darker or differently cropped video.

User decisions: import a local file and retain an application-managed copy; use PixiJS for video and the pattern. Native video/CSS with GSAP transitions was offered as the smaller alternative; the user chose PixiJS. The user approved this specification and requested implementation. The subsequent supplied screenshot confirms that all background controls belong in the existing active-screen popover and adds separate video opacity.

## Approach and evidence

Use the installed PixiJS 8.22.0. One background component in the application shell owns at most one canvas and one active video resource. Pixi renders the browser-decoded video, a uniform dimming rectangle, and one TilingSprite from a PNG tile. This is a renderer choice, not a claim that Pixi is faster than native video: its VideoSource uploads decoded frames into a GPU texture. GSAP is an animation engine, not a competing video decoder; no GSAP dependency or new animation feature is needed here.

References checked against current official docs and the installed package:

- [VideoSource 8.22.0](https://pixijs.download/v8.22.0/docs/rendering.VideoSource.html)
- [TilingSprite](https://pixijs.com/8.x/guides/components/scene-objects/tiling-sprite)
- [GSAP core](https://gsap.com/docs/v3/GSAP/)

A repeating image and a scrim do not need a separate sprite for every dot. Use white shapes with alpha in small PNG tiles; Pixi tint provides the chosen colour without generating a file for each colour.

## User flow

- In board edit mode, the existing active-screen gear opens screen settings. Keep theme selection and confirmed deletion.
- Add a Background section: choose a local video, display its filename and upload/loading/error state, replace it, or remove the background. Replacement retains the previous saved background until the new file has imported successfully.
- Video fills the viewport with preserved aspect ratio and automatic centre cropping (`cover` equivalent). Do not stretch or require the user to resize a video. Playback is muted, inline and looped; audio is never enabled by this feature.
- Add controls for uniform dimming (0–100%), pattern (off/circles/squares/diamonds/crosses), pattern colour, tile scale, video opacity and pattern opacity. One selected shape and colour repeats over a screen; mixed random symbols and animated particles are outside this version.
- New video defaults: video opacity 100%, dimming 35%; circles, black, 25% pattern opacity, scale 1. Pattern colour and opacity are independent of the screen theme.
- Both dimming and pattern opacity can be zero. The scrim can reach 100%: a sparse dot pattern alone cannot guarantee readability in its transparent gaps. No claim of automatic contrast analysis.
- Preview changes immediately in the current board draft. Done persists the whole screen; Cancel restores its saved background. Screen switches preserve the existing save-before-switch behavior. Importing a file does not save unrelated widget edits.
- Removing the background restores the theme backdrop. Screens without a background retain their current behavior. Background assignment is per screen; no space/dashboard video inheritance in this feature.

## Data and media lifecycle

- Add optional background settings to ScreenBoard: an opaque video asset ID, video opacity, dimming, and the pattern settings. Absent/null means theme backdrop. Normalize absent settings and preserve the API's stable JSON key order. All existing widget/row/theme edits preserve background settings.
- Store settings in an additive nullable SQLite column on screens. Keep video bytes in an application-owned directory under dataDir, never in SQLite JSON or localStorage. Never change or delete the selected original file.
- Import by streaming the file into a staging file, checking declared size and a supported video container, then atomically completing the application copy. Never buffer a whole video in API memory. Use generated IDs for paths; the original filename is display metadata only.
- Supported initial containers: MP4/M4V/MOV and WebM when their codec is playable by the actual browser/WebView. Unsupported or undecodable video yields a useful error and preserves the previous background. Import does not transcode. "Any video" means arbitrary content/aspect ratio within browser-supported codecs; it cannot promise playback of every container/codec or seamless looping of a clip whose end does not match its start.
- Use existing authentication for import, reads and deletion. Serve video with byte-range requests, accurate video MIME types and no user-supplied filesystem path. Sandbox widgets must not acquire background-media access.
- Saving validates that referenced assets are complete. Imported but unsaved assets are staged; Cancel/replacement releases them when unused. Interrupted staging files are cleaned on startup; unreferenced staged imports expire after 24 hours so a lost tab or failed response does not leave permanent copies.
- On a successful save, clear, replacement, screen deletion or space deletion, release the old application copy only if no saved screen references it. A declined confirmation or failed/conflicting save must not remove the saved asset. Reuse existing revision checks.
- Filesystem cleanup failure retains its metadata for retry and is logged; it must not report a successfully committed board save as failed. Cleanup touches only known application-owned files, never unrelated directory contents.
- Implementation call after builder review: open drafts and active background playback acquire renewable media leases, so another tab's replacement/deletion or a revision conflict cannot remove the file they still need. Renew while the page runtime is alive (target every 60 seconds); a lease expires only after 24 hours without renewal. Age alone never removes a validly leased import. Release leases when the owning preview/draft no longer needs them, and clean an unreferenced asset only after all leases are gone/expired. A page returning after lease expiry may find the video unavailable; show that error without discarding other unsaved board edits. Add cross-tab removal and long-lived draft renewal tests. Endpoint/token details remain builder choices.

## Rendering and runtime

- Layer order: theme fallback → video → dimming → PNG pattern → dashboard/widgets. Background accepts no pointer or keyboard input. Keep the edit grid separate from the decorative pattern.
- Resize video to cover the viewport and resize the tiled area without creating another renderer. Cap renderer resolution at min(devicePixelRatio, 2); this limits canvas resolution, not source-video decoding cost.
- Render on decoded video frames when requestVideoFrameCallback is available; do not run a redundant always-on animation ticker. Render once for size/settings changes. A bounded playback-only fallback may use Pixi's ticker where frame callbacks are unavailable.
- On screen change, pause and release the previous video/texture. On hidden document, pause decoding/rendering and resume only when visible and still displaying that screen. Respect prefers-reduced-motion with a still frame. Handle late imports/metadata/Pixi initialization so they cannot replace a different screen's state.
- On media load/decode, autoplay or renderer failure, keep the board usable and show the theme backdrop plus a clear notice. Dispose listeners, pending callbacks, textures and the renderer on unmount. No per-screen accumulation of canvases or videos.
- Keep the settings popover above its bullet as its contents change, constrain it to the available viewport and allow internal scrolling. Preserve existing Escape/board-shortcut protection and open-panel visibility.

## Constraints and non-goals

No new dependencies, branches, commits, pushes or external publication. Preserve current uncommitted work. No remote video URLs, automatic transcoding, custom user-imported pattern PNGs, shader effects, animation editor, audio controls, random particle fields or new media-library screen. Four deterministic PNG tile assets are sufficient; their colour comes from tint.

Builder choices: endpoint naming and upload protocol; exact file/table/module names; range-helper reuse; request cancellation and cleanup implementation; video-frame fallback mechanics; test fixture generation with existing ffmpeg or repository video samples. Choose the smallest implementation that meets these behaviors.

## Verification

Use RED → GREEN tests in existing Vitest packages for contract validation/canonical ordering, additive migration, authenticated streaming/ranges, interrupted/incorrect uploads, media-reference validation, safe cleanup across cancel/conflict/shared references and screen/space deletion, draft persistence and stale async work. Test renderer lifecycle through its real public boundary with controlled browser/Pixi dependencies; do not claim mocks establish video playback or GPU performance.

Run repository tests, typecheck, build and scoped diff checks. Use Orca's built-in browser with a temporary database and real MP4/WebM files for visible playback, local-copy independence, PNG shape/colour/scale/opacity, dimming, Done/Cancel, reload, switching, hide/resume, failure fallback, at most one canvas and video resource, and absence of console errors. Inspect actual frame advancement and capture screenshots where Orca permits. Distinguish live measurements from architectural expectations; no comparative speed claim without a native baseline measured on the same machine.

## Builder review

A fresh reviewer identified one material gap: active drafts/playback across tabs and beyond the staging expiry. Resolved by the explicit renewable lease policy above. Other implementation choices remain delegated as listed. The author selected this lifecycle policy to preserve unsaved work; the user approved this document.

## Approved UI clarification

Use the active-screen settings popover shown in the user's screenshot. Add the file picker and pattern settings there. Video opacity and pattern opacity are separate controls; lowering video opacity reveals the current theme backdrop. The uniform dimming control remains independent, and pattern colour does not change either opacity.

## Approved refinements during implementation

- The user clarified the decorative overlay is a fine retouch texture with an explicit grid on/off checkbox. The latest pixel refinement below supersedes the initial common 3 px cell proposal.
- The user explicitly added local image backgrounds alongside videos. Use the same panel, application-managed import, preview/Done/Cancel, cover crop, dimming, PNG microtexture and independent media/pattern opacity. Static images render only on settings/size changes, without a playback loop.
- Background references become generic: mediaId plus kind (video/image). Preserve older videoId documents through normalization and an additive migration. The existing media store/lease lifecycle applies to both kinds. Keep the historical lease wire name videoIds for compatibility, even though the IDs now include images.
- Initial raster image formats: PNG, JPEG, WebP and browser-decodable AVIF. No SVG execution/sanitizer or animated-image playback is added. Imported images must pass a bounded native decode probe; invalid or unsupported files retain the previous background.

## Final pixel-pattern refinement

Use exact binary white/transparent PNGs, nearest sampling and no mipmaps. Each tile repeats at its native CSS-pixel dimensions with integer enlargement 1–4; legacy fractional scale remains accepted in storage and rounds to a minimum of 1 for rendering. New backgrounds default to diagonal at scale 1. The editor shows the resulting cell dimensions.

| Shape | Cell | Filled rows (1 opaque, 0 transparent) |
| --- | --- | --- |
| Diagonal | 2×2 | `10/01` |
| Square | 3×3 | `110/110/000` |
| Cross | 3×3 | `010/111/010` |
| Circle | 6×6 | `001100/011110/111111/111111/011110/001100` |
| Triangle | 3×3 | `100/110/111` |
| Legacy diamond | 3×3 | `010/111/010` |

A square uses a 2×2 filled shape inside a 3×3 cell so repeated shapes stay recognizable; a 2×3 cell would merge adjacent squares into continuous stripes. Cross and legacy diamond share the same minimal pixel mask. Media/image sampling is unaffected by the pattern's nearest sampling.
