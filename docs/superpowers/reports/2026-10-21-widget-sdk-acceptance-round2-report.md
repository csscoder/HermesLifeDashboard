# Widget SDK acceptance run — round 2 report

Date: 2026-10-21. Spec: `docs/superpowers/specs/2026-10-20-widget-sdk-acceptance-design.md`. Plan: `docs/superpowers/plans/2026-10-20-widget-sdk-acceptance.md`. Round 1: `docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md`.

Round 2 reruns all 10 runs on branch `fix/widget-sdk-acceptance-gaps`, which closes the round-1 gaps:
- `373f0fb`: the sandbox runtime gives `html`, `body` and `#app` `height: 100%`;
- `02d5ea5`: `docs/workflow.md` lists the dev-shell URL parameters (`w`, `h`, `theme`, `frame`, `confirm`) with theme ids and an example URL; `docs/design.md` says the root fills the frame and the default size shows the main content without scrolling; the template `AGENTS.md` and skill say to keep `title` and `id`, give the root `height: 100%`, and never read compiled files.

## Summary

**Verdict: fail. The SDK is not ready to publish, but every round-1 gap that agents hit is closed.**

- 0 forbidden reads (round 1: 5 runs). 0 questions. Every agent kept its title (round 1: 4 renamed). Every deliverable passed `check` and `build`, matched the control build and imported on the first attempt.
- 8 of 10 runs pass every criterion: all five Claude runs, `codex-2`, `codex-3`, `codex-5`.
- `codex-4` fails: at its 4×4 default JPY is not visible and the status and error line overlaps the rate rows.
- `codex-1` fails: the clock face is clipped whenever the widget is wider than tall.
- New SDK bug, introduced by `373f0fb`: the dev shell logs a false 8 px overflow before the widget mounts. Four of five Claude runs spent time chasing it.

The remaining failures share one cause: Codex never looks at its widget. All five Codex runs report «визуальная проверка недоступна» and stop after `check` and `build`; the two layout rules that fail for it (square content in a non-square frame, default size) can only be caught by looking.

## Runs table

Models: Claude Code `claude-opus-5-5`, Codex `gpt-6.1-sol`. Durations are agent wall-clock. No run hit the 45-minute cap. Titles carry the suffix « 2» (ruling, see Deviations).

| id | widget | min | check | build | import | criteria | forbidden reads | questions | verdict |
|---|---|---|---|---|---|---|---|---|---|
| claude-1 | clock | 18.1 | 0 | 0 | ok | all pass (frameless, themes, time, motion, 121/121 sizes) | 0 | 0 | **pass** |
| claude-2 | counter | 8.6 | 0 | 0 | ok | all pass (+/−, tab reload, app restart, title) | 0 | 0 | **pass** |
| claude-3 | decorative | 9.4 | 0 | 0 | ok | all pass (motion, theme, 121/121 sizes) | 0 | 0 | **pass** |
| claude-4 | HTTP | 8.8 | 0 | 0 | ok | all pass (rates, refresh ×3, offline error, recovery at the next tick) | 0 | 0 | **pass** |
| claude-5 | secret | 0.9 | 0 | 0 | ok | all pass (unavailable, header, `[REDACTED]`) | 0 | 0 | **pass** |
| codex-1 | clock | 1.4 | 0 | 0 | ok | frameless, themes, time, motion pass; sizes fail (face clipped when w > h) | 0 | 0 | fail |
| codex-2 | counter | 1.1 | 0 | 0 | ok | all pass (+/−, tab reload, app restart, title) | 0 | 0 | **pass** |
| codex-3 | decorative | 0.9 | 0 | 0 | ok | all pass (motion, theme, 121/121 sizes) | 0 | 0 | **pass** |
| codex-4 | HTTP | 1.3 | 0 | 0 | ok | refresh ×3, recovery pass; JPY hidden and error overlaps rates at 4×4 | 0 | 0 | fail |
| codex-5 | secret | 1.0 | 0 | 0 | ok | all pass (unavailable, header, `[REDACTED]`) | 0 | 0 | **pass** |

`check`/`build` are the controller's re-runs on an untouched copy (`logs/control-round2.log`). codex-3 now delivers (round 1: stopped on a contaminated profile). codex-3's obsidian and glass renders differ only slightly (RMSE 0.05); paper differs clearly. Counted as pass.

## Round 1 → round 2

| | round 1 | round 2 |
|---|---|---|
| runs passing every criterion | 3 | 8 |
| runs with forbidden reads | 5 | 0 |
| renamed titles | 4 | 0 |
| broken widgets | 2 (codex-1 blank, codex-4 clipped) | 2 (codex-1 clipped when w > h, codex-4 overlaps at 4×4) |
| infra faults stopping a run | 1 | 0 |

## Forbidden reads

None. The read audit flagged 23 calls for manual review (`logs/flagged-all.txt`); all read `docs/` or `*.d.ts`, or only listed names, which the spec allows.

## Import path

Every import went through «Виджеты → Выбрать папку» in the Orca browser on `http://127.0.0.1:3101` (`tools/import-place.sh`), with the same exceptions as round 1: the folder reached the dialog's own `input[webkitdirectory]` change handler from a page script, «Установить» was clicked in the UI, and the tab used 1600×1000 viewport emulation.

## How the agents worked without a browser

- Claude runs 1–4 again took headless screenshots of the dev shell (Playwright or Chrome, 6–57 mentions per log), now with the documented URL parameters and no compiled reads. claude-5 did not look at its widget.
- No Codex run looked: all five report «визуальная проверка недоступна» and stop after `check` and `build` (round 1: Codex installed Playwright into `/tmp`). Both Codex failures are layout failures a look would have caught (gap B).

## Failures

### codex-1 — clock face clipped when w > h

At every size wider than tall (e.g. 6×3, 10×3, 12×6) the bottom of the face is cut off (`evidence/codex-1-clip.png`, contact sheet `evidence/codex-1-sizes.png`). Cause in `src/index.vue`: `.desk-clock` uses `display: grid; place-items: center` and the `svg` has `width: 100%; height: 100%`; the grid track is sized by the content, so the square svg takes the frame width and overflows the height. claude-1 sizes the face from the smaller side and passes 121/121. `docs/design.md` and `docs/recipes.md` give no rule for fitting square or round content into a non-square frame (gap A).

### codex-4 — content does not fit its default size

At 4×4 the header, «1 USD», a refresh button and the EUR row take the whole widget; the status line («Курс на … · Проверено в …») and the error line («Не удалось обновить, показаны последние курсы») are drawn over the EUR and GBP rows, and JPY is not visible (`evidence/r2-http-codex-rates.png`, `r2-http-codex-offline.png`). The same at 1600×1000 emulation (250 px cells) and at the native 1689×929 window (301 px cells, `evidence/r2-native-half.png`): the text scales with the widget, so a larger window does not help. Refresh and recovery work. The default-size rule added in `02d5ea5` was in the docs codex-4 read; it did not look at the result (gap B).

## New SDK bug: false overflow records before mount

claude-1, claude-2, claude-3 and claude-4 each found `.ld-widget/dev.log` entries like «content is 81×89 px in a 81×81 px frame», always +8 px, logged once per new size before the widget mounts. All four traced it correctly and concluded it is the dev shell, not their widget; claude-1 spent most of its 18 minutes on it.

Cause, confirmed in code: `packages/widget-sdk/src/sandbox.ts` `start()` sets `height: 100%` on `html`, `body` and `#app` at script start, but `body`'s default 8 px margin is zeroed only in `followContext()`, after `ld:init` arrives. Between the two the document is the frame height plus 16 px and the overflow probe fires. This regression comes from round-2 fix `373f0fb`. Fix: zero the body margin in `start()` together with the height.

## Gaps

1. **Gap A: no rule for square or round content in a non-square frame** — 1 run (codex-1). Fix: one line in `docs/design.md` and the clock recipe in `docs/recipes.md`: size square content from the smaller side (`min(100cqw, 100cqh)` or `aspect-ratio: 1` with `max-height: 100%`).
2. **Gap B: agents without a browser cannot verify layout** — all 5 Codex runs skip any visual check; both Codex layout failures follow from it. The default-size rule added in `02d5ea5` is in the docs codex-4 read, and it still shipped clipped content. Docs alone do not close this. Options, each a separate decision: a layout check in `ld-widget check` that renders the widget at default, min and max size and reports overflow (needs a headless browser — a new dependency); or a documented headless screenshot route.
3. **Gap C: false overflow before mount** — see above; SDK bug, not docs.

## Deviations and rulings

- Round-1 results moved to `$ROOT/round1/`; round-2 titles get « 2» so package ids do not collide with the four round-1 widgets kept on the board.
- The desktop app was rebuilt so the board runs the fixed `sandbox.js`; the old bundle is in `$ROOT/backup-round2/`. The round-1 codex-1 clock renders with the fixed runtime, which confirms the round-1 root-height cause.
- The driver's control copy failed for all runs because `$ROOT/control` was not recreated after archiving round 1 (setup bug). Control `check`, `build` and diff were redone by hand on the untouched projects: all 10 match.
- HTTP checks waited about 6 hours (UPSTREAM_ERROR from 20:22Z to 02:08Z): the rebuilt app's bundled `node` had no outbound network (connect timeout; system `node` reached the API). The likely cause is a firewall rule bound to the old binary (inferred, not confirmed); the user was asked to allow it, and the network was back at the 02:16Z tick. Infrastructure, not SDK. During the outage both widgets kept their 10-minute schedule and showed their error state, which gave a live-iframe failure check.
- `shot.sh` retakes a screenshot when the crop is blank: Orca sometimes returns a half-scale frame. All blank size tiles were this and were recaptured with content.
- HTTP recovery was checked at the next timer tick with the iframe alive, as the plan says (round 1 used a tab reload at the user's request). claude-4 recovered at 02:50:20Z, 23 s after going online (its own retry); codex-4 at its 02:58:42Z tick.
- The user enlarged the Orca window during the run; codex-4's layout was rechecked without viewport emulation. Same result.

## Not checked

- The desktop app's own window (WKWebView). All checks ran in the Orca browser on the app's origin.
- Size loops for counter, HTTP and secret widgets (not required).
- A real `npm create @lifedashboard/widget`: packages are unpublished; tarballs were used.

## Artifacts

Under `ROOT=/Volumes/ExtendSSD/ld-acceptance-2026-10-20`, as in round 1; round-1 files are in `round1/`. Round-2 specifics: `logs/control-round2.log`, `logs/import-round2.log`, `logs/place-round2.log`, `logs/sizes-<id>.log`, `evidence/r2-*.png`, `evidence/<id>-sizes.png`, `evidence/codex-1-clip.png`.
