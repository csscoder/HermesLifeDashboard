# Widget SDK acceptance run — report

Date: 2026-10-20. Spec: `docs/superpowers/specs/2026-10-20-widget-sdk-acceptance-design.md`. Plan: `docs/superpowers/plans/2026-10-20-widget-sdk-acceptance.md`.

## Summary

**Verdict: fail. The SDK is not ready to publish.**

- 3 of 10 runs pass every criterion: `claude-4`, `codex-2`, `codex-5`. `codex-2` ran under a contaminated Codex profile (see Infrastructure faults).
- 5 runs built a working widget but read compiled SDK files: `claude-1`, `claude-2`, `claude-3`, `claude-5`, `codex-1`. A forbidden read fails the run regardless of the result.
- 2 runs produced a broken widget: `codex-1` renders blank, `codex-4` does not fit its default size.
- 1 run produced nothing: `codex-3` stopped on a skill from the contaminated profile (infrastructure fault, not rerun, decision 4).
- Every deliverable that exists passed `ld-widget check` and `build` and imported on the first attempt. No run touched the platform repository.

The two main gaps: the dev shell's URL parameters and theme ids are not documented, so agents dug into compiled JS for them; and the widget frame gives the widget root no height, which nothing documents.

## Runs table

Models: Claude Code `claude-opus-5-5`, Codex `gpt-6.1-sol` (from session logs). Durations are agent wall-clock. No run hit the 45-minute cap.

| id | widget | min | deliverable | check | build | import | criteria | forbidden reads | questions | infra fault | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | clock | 5.8 | yes | 0 | 0 | ok | all pass (frameless, themes, time, motion, 88/88 sizes) | 3 | 0 | — | fail (reads) |
| claude-2 | counter | 6.0 | yes | 0 | 0 | ok | all pass (+/−, tab reload, app restart, title) | 2 | 0 | — | fail (reads) |
| claude-3 | decorative | 8.0 | yes | 0 | 0 | ok | all pass (motion, theme, 121/121 sizes) | 3 | 0 | — | fail (reads) |
| claude-4 | HTTP | 9.1 | yes | 0 | 0 | ok | all pass (rates, refresh ×3, failure state, recovery) | 0 | 0 | — | **pass** |
| claude-5 | secret | 5.9 | yes | 0 | 0 | ok | all pass (unavailable, header, `[REDACTED]`) | 9 | 0 | — | fail (reads) |
| codex-1 | clock | 1.9 | yes | 0 | 0 | ok | frameless pass; renders blank → theme, time, motion, sizes fail | 1 | 0 | shared `/tmp` | fail |
| codex-2 | counter | 1.8 | yes | 0 | 0 | ok | all pass (+/−, tab reload, app restart, title) | 0 | 0 | contaminated profile | **pass** (caveat) |
| codex-3 | decorative | 0.6 | no | n/a | n/a | n/a | n/a | 0 | 1 | contaminated profile | infra fault |
| codex-4 | HTTP | 1.9 | yes | 0 | 0 | ok | refresh ×3, recovery pass; rates and error clipped at 4×4 | 0 | 0 | — | fail |
| codex-5 | secret | 1.4 | yes | 0 | 0 | ok | all pass (unavailable, header, `[REDACTED]`) | 0 | 0 | — | **pass** |

`check`/`build` are the controller's re-runs on a copy; each deliverable matched the control build.

Title drift: the create command set titles «Часы Codex», «Данные Claude», «Данные Codex», «Секрет Codex»; the agents changed them to «Тихий ход», «Курс доллара», «Курс доллара», «Локальный Echo». Not a pass criterion, but two identical «Курс доллара» packages on one board are hard to tell apart.

## Forbidden reads

Rule (spec, Detection): listing names is not a read; a `grep`/`rg` that shows content of a forbidden file, or a recursive search into forbidden files, is a read. `docs/` and `*.d.ts` are allowed. Full list: `$ROOT/logs/reads-verdict.json`.

- **claude-1** (3): `ls dist; grep -rl "edge-highlight" dist`; `grep -o "searchParams…" -r …/widget-sdk/dist/shell`; `grep -oE "(get|set|has)…" dist/shell/assets/*.js; grep -oE "URLSearchParams…"`.
- **claude-2** (2): `grep -oE 'searchParams…' dist/shell/assets/*.js`; `grep -oE '.{150}URLSearchParams.{300}' dist/shell/assets/index-Dyi1wLyr.js`.
- **claude-3** (3): `curl …/@ld/shell/assets/index-Dyi1wLyr.js | grep …` plus `grep -rhoE '"id"…' widget-sdk/dist`; `grep -rlE -- '--ld-accent' widget-sdk/dist`; `node -e require(…/widget-sdk/dist/dev/themes.json)`.
- **claude-5** (9): `grep searchParams` and `grep -o LD_SECRET -r widget-sdk/`; `grep URLSearchParams|location.search|themes dist/shell/assets/index-Dyi1wLyr.js`; `grep id/scheme -r dist/*.js`; `grep scheme dist/cli.js`; `grep -rlo surface-1-solid dist`; `require dist/dev/themes.json`; `grep '[overflow]' -r dist`; `grep scrollHeight dist/sandbox.js dist/dev/*`; `cat dist/dev/frame.css; cat dist/dev/probe.js`.
- **codex-1** (1): `rg -n 'playwright|theme=|searchParams|size=' node_modules/@lifedashboard/widget-sdk -g '*.js'`.

What they looked for: dev-shell URL parameters (all five), theme ids and token values (claude-3, claude-5), the root/frame height and overflow (claude-5), the secret env name (claude-5).

## Import path

Every import went through «Виджеты → Выбрать папку» in the Orca browser on `http://127.0.0.1:3101`. Exceptions, the same for all runs:
- the folder reached the dialog's own `input[webkitdirectory]` change handler from a page script, because `orca upload` gives that input no files; «Установить» was clicked in the UI;
- the tab used viewport emulation (1600×1000) because the Orca pane is 1220 px, under the 1280 px gate; some clicks were sent with `element.click()` and the secret field with `orca fill`, because synthetic clicks and value assignment did not register.

## Failures

### claude-1, claude-2, claude-3, claude-5 — forbidden reads

The widgets work. Each agent followed `AGENTS.md` and `workflow.md`, wanted to open the dev shell at given sizes and themes, and could not find how. `docs/workflow.md:24` says "Shell state (size, theme, frame) is in the URL, so each combination can be opened and checked separately" but names no parameter or value, and no page lists theme ids. Gap 1. claude-3 and claude-5 also wanted theme token values for a preview (gap 3). claude-5 searched the docs for the root height (`grep -n "height|root|#app|mount" docs/*.md`), found nothing, and read `dist/sandbox.js` and `dist/dev/frame.css` (gap 2).

### codex-1 — clock renders blank

The instance is frameless and present in the DOM, but nothing is visible in any theme. Cause, inferred from code and not measured in the iframe: the sandbox document (`packages/contracts/src/sandbox-document.ts`) gives `html`, `body` and `#app` no height and `sandbox.ts` only zeroes the body margin, so the widget's `.stage { height: 100%; container-type: size }` resolves to 0 height and every `cqh` unit to 0. claude-1 used `height: 100vh` and renders. Nothing in `docs/` states the root's height, and `docs/recipes.md`'s clock recipe itself uses `height: 100%` (gap 2). codex-1 also had one forbidden read (gap 1) and reused claude-1's leftover `/tmp/ldshots/shot.mjs` (infrastructure).

### codex-4 — content does not fit its default size

At its 4×4 default only the header and a cut EUR row are visible; GBP, JPY and the error line are below the fold. Refresh and recovery work. `docs/design.md` covers size classes but does not say that the default size must show the essential content without scrolling (gap 4).

### codex-3 — no deliverable

The synced superpowers plugin's brainstorming skill made Codex stop and ask for design approval. Infrastructure fault by the setup, not an SDK gap.

## Gaps

Ranked by the number of runs that hit them.

1. **Dev-shell URL parameters and theme ids undocumented** — 5 runs (claude-1, claude-2, claude-3, claude-5, codex-1). Fix: in `docs/workflow.md`, list the shell URL parameters (`size`, `theme`, `frame`), their value formats, the theme ids, and a full example URL.
2. **Widget root height undocumented; recipe relies on it** — 2 runs (codex-1 blank, claude-5 read compiled files to find it). Fix: give `html, body, #app` `height: 100%` in the sandbox document and dev shell, or state in `docs/design.md` and `docs/runtime.md` that the root has no height and show `height: 100vh`; fix `docs/recipes.md` to match.
3. **Theme token values for previews not available** — 2 runs (claude-3, claude-5 read `dist/dev/themes.json`). Fix: say in `docs/design.md` where agents get real theme values, or that the shell's theme parameter is enough.
4. **No rule that the default size shows the essential content** — 1 run (codex-4). Fix: one line in `docs/design.md` and `AGENTS.md`.
5. **Title given to `create` is not protected** — 4 runs renamed it (codex-1, claude-4, codex-4, codex-5). Fix: `AGENTS.md`: keep `title` from `widget.json` unless the user asks to change it.

## Infrastructure faults

- **Contaminated Codex profile.** During codex-1 Codex synced account plugins (including superpowers) into the clean `CODEX_HOME`. codex-2 completed with it; codex-3 stopped on it. From codex-4 the profile disables plugins and apps. codex-2 and codex-3 were not rerun (decision 4); a rerun is offered.
- **Shared `/tmp`.** codex-1 reused a script claude-1 left in `/tmp`. From pair 2 the driver moved each run's `/tmp` leftovers into the run folder.
- **Claude profile.** At the user's request Claude ran on the user's account with `--setting-sources project,local --strict-mcp-config` and the real `HOME`, so it saw the user's Playwright and npm caches. The init log lists only built-in skills plus `lifedashboard-widget`, no MCP servers, no user plugins.

## How the agents worked without a browser

Decision 9 gave the agents no browser. All nine runs that worked tried to get one anyway, mentioning Playwright 2–30 times per log:
- Claude runs used Playwright browsers from the user's caches or installed `playwright` into `/tmp`, then took headless screenshots of the dev shell;
- Codex runs installed `playwright` into `/tmp` with a private npm cache, or used system Chrome.

The headless-browser hunt is what led to every forbidden read: once they had a browser, they needed shell URL parameters and theme ids the docs do not give. `docs/workflow.md` assumes a browser is open and offers no headless route. Either document one (a supported screenshot command or `ld-widget preview --size --theme`) or document the URL contract (gap 1).

## Not checked

- The desktop app's own window (WKWebView). All checks ran in the Orca browser on the app's origin; the app was only restarted for the counter persistence check.
- The HTTP recovery at the next 10-minute timer tick. At the user's request recovery was checked after a tab reload online; the failure state was checked live, offline, at the scheduled interval.
- codex-1's root cause in the live DOM: the iframe is cross-origin to the controller; the cause is inferred from code.
- codex-4's error message on screen: it is below the fold at 4×4; its text was read from the source.
- Size loops beyond the clock and decorative widgets (not required). codex-1's loop was skipped because nothing renders.
- A real `npm create @lifedashboard/widget`: packages are unpublished; tarballs were used.

## Artifacts

All under `ROOT=/Volumes/ExtendSSD/ld-acceptance-2026-10-20`:
- `logs/<id>.jsonl` — raw agent sessions; `logs/<id>.audit.json` — read audit; `logs/reads-verdict.json` — manual read verdicts;
- `logs/runs.jsonl`, `logs/checks.jsonl` — run records and per-widget checks;
- `runs/<id>/` — generated projects; `deliverables/<id>/` — imported folders; `control/<id>/` — control builds;
- `evidence/` — screenshots and size contact sheets; `board-before.json` — the board before placement;
- `backup/` — old app bundle and data folder copy.
