# Widget showcase verification

Date: 2026-10-22. Scope: [approved requirements](../specs/2026-10-22-widget-showcase.md) and [implementation record](../plans/2026-10-22-widget-showcase.md).

## Delivered

Three independently built SDK packages, each version `1.0.0`, with source, manifest, build/install instructions and focused tests:

- [Analog clock](../../../examples/widgets/showcase-clock): frameless SVG, real local time/date, visibility and reduced-motion lifecycle.
- [Focus sessions](../../../examples/widgets/showcase-counter): configured goal, saved count, conflict recovery and protection against replaying an unconfirmed save.
- [Live weather](../../../examples/widgets/showcase-weather): real Open-Meteo data through the gateway, coordinate settings, stale/error handling and visible-only refresh scheduling.

The lockfile adds only the three workspace importers; all library versions already existed in the repository. No core SDK/API/UI source was changed for the showcase. Earlier SDK work and the user's built-in clock edit remain in the working tree.

The README also includes a prompt-to-widget illustration with three example prompts and the real individual dashboard captures. Its SVG source references those existing images; the PNG export is rendered with `rsvg-convert docs/images/widget-prompt-to-dashboard.svg --output docs/images/widget-prompt-to-dashboard.png`. This is an illustrated workflow, not evidence of a recorded one-shot chat.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm test` | 1828 passed across the repository, including 98 showcase tests. |
| `pnpm typecheck` | Passed. |
| `pnpm build` | Passed. |
| Final `pnpm --filter '@lifedashboard/example-showcase-*' check` | All three passed. |
| Final showcase `test`, `typecheck`, `build` | Passed: clock 10, counter 14, weather 74 tests. |
| `git diff --check` | Passed. |
| Local documentation links | All 40 targets exist, including the gallery and prompt-to-widget illustration. |

Full repository tests, typecheck and build were rerun after the final CSS fixes. Clock/time, persistence and weather lifecycle/parser changes followed RED → GREEN; the two semantic config regressions failed before the URL-based watcher fix.

## Dashboard evidence

Built folders were imported through the actual package UI into an isolated local API dataset and placed on its board. Installed JavaScript/CSS matched the final built artifacts byte for byte. The user's installed desktop app and data were not used for the new examples.

- All three rendered through the dashboard's normal sandbox host.
- Counter increments, decrement and read-back used the exported `createCounter` controller against the real authenticated state gateway. The verified value was 5, and the actual iframe displayed 5 after a dashboard reload. This is controller/gateway integration evidence, not evidence of native mouse dispatch.
- Weather requests returned HTTP 200 from Open-Meteo through the real gateway. Screenshots show the returned London conditions, model time and source. No sample response or fabricated fallback supplied the displayed weather.
- Minimum sizes (clock 3×3; counter/weather 4×4) were visually checked in Paper. A separate 2560×1440 viewport check confirmed `innerWidth=2560`, root font `32px`, and loaded weather with temperature, condition, source and model time visible.
- Default 6×6 widgets were checked in Glass. The clock's 10×6 rectangular case was checked in Paper after fixing intrinsic SVG grid sizing; its entire circular dial fit the shorter side.
- Screenshot assets are crops of actual Orca dashboard captures. Cropping removes unused board area; no widget pixels or values were reconstructed. The README links the overview, individual captures and example sources, with adjacent weather attribution.

Browser work used Orca's embedded browser exclusively. The test API used a temporary dataset; its services were stopped after capture.

## Review fixes

Independent review found a wrong weather install-folder path and compact weather overflow. Both were corrected. The compact height breakpoint now uses `rem` to follow dashboard scaling; explicit text line heights keep the default weather footer inside its viewport. Central visual checks also found and fixed the counter ring overlapping controls and the rectangular clock being clipped by intrinsic grid tracks. Replacing weather config with identical coordinates or changing only its label no longer clears verified data or repeats the request. The final independent review inspected the code and delivered images and found no remaining Important/Critical issue.

## Limits

Native Orca mouse/key commands acknowledged input without reliably dispatching it in this session. Package UI actions used DOM activation; counter interaction evidence uses the real controller and gateway. Native pointer/keyboard behavior inside the opaque widget iframe remains unverified.

The three packages were not installed into the user's macOS application. No video, package release or branch was created. The user subsequently requested committing and pushing this work to the renamed `csscoder/LifeDashboard` repository; the pre-existing built-in clock edit is excluded. Weather requires network access and uses Open-Meteo's non-commercial free endpoint; see the [widget README](../../../examples/widgets/showcase-weather/README.md) for policy and attribution.

Raw command logs, before/after layout captures and the independent review are local artifacts under `/tmp/lifedashboard-showcase-2026-10-22/`; they are not repository deliverables.
