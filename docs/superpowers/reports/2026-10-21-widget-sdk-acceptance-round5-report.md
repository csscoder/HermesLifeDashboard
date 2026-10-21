# Widget SDK acceptance run — full rerun on the final SDK

Date: 2026-10-21. Spec: `docs/superpowers/specs/2026-10-20-widget-sdk-acceptance-design.md`. Plan: `docs/superpowers/plans/2026-10-20-widget-sdk-acceptance.md`. Earlier rounds: `2026-10-20-widget-sdk-acceptance-report.md`, `2026-10-21-widget-sdk-acceptance-round2-report.md`.

All 10 runs on `main` at `f7ddb99`: SDK and `create-widget` tarballs and the desktop app rebuilt from that commit. The SDK includes the headless screenshot recipe, the square-fit rule, the sandbox-crash advice and the `body` margin fix. Titles carry the suffix « 5».

## Summary

**Verdict: pass on the acceptance criteria. 10 of 10 runs pass every check. Two SDK defects remain before publishing (see Open findings).**

- Every deliverable passed `check` and `build`, matched the control build and imported on the first attempt. Every agent kept its title. 0 forbidden reads.
- Every agent took screenshots of its own widget with the documented recipe (round 2: Codex never looked).
- Both round-2 failures are fixed: the Codex clock is round and whole at all 121 sizes, and the Codex rates widget fits all three rates and its status line at 4×4.

## Runs table

Models: Claude Code `claude-opus-5-5`, Codex `gpt-6.1-sol`. Durations are agent wall-clock; cap 45 minutes, none hit.

| id | widget | min | check / build / import | criteria | verdict |
|---|---|---|---|---|---|
| claude-1 | clock | 13.4 | ok | frameless, time, motion, themes, 121/121 sizes | **pass** |
| claude-2 | counter | 8.7 | ok | +/−, tab reload, app restart, title from settings | **pass** |
| claude-3 | decorative | 3.0 | ok | frameless, motion, themes, 121/121 sizes | **pass** |
| claude-4 | HTTP | 40.3 | ok | rates, refresh ×3, offline error, recovery | **pass** |
| claude-5 | secret | 8.3 | ok | hint without key, header reaches server, `[REDACTED]` | **pass** |
| codex-1 | clock | 5.4 | ok | frameless, time, motion, themes, 121/121 sizes | **pass** |
| codex-2 | counter | 18.2 | ok | +/−, tab reload, app restart, title from settings | **pass** |
| codex-3 | decorative | 4.2 | ok | frameless, motion, themes, 121/121 sizes | **pass** |
| codex-4 | HTTP | 8.1 | ok | rates fit at 4×4, refresh ×3, offline error, recovery | **pass** |
| codex-5 | secret | 3.5 | ok | hint without key, header reaches server, `[REDACTED]` | **pass** |

Evidence: `logs/checks.jsonl` (round 5), `evidence/*-r5-sizes.png`, `evidence/r5-http-sheet.png`, `evidence/r5-recaptured.png`. In the size loops, 7 claude-3 tiles and 1 codex-3 tile came out blank or off-target; they were capture timing and were recaptured with content.

## Open findings

1. **The headless screenshot recipe is unreliable.** claude-4 spent most of its 40 minutes on blank or «Загрузка…» frames; claude-1's screenshot batch timed out; codex-5 ran three Chrome processes in parallel and several hung; claude-2 and claude-5 report blank first captures. Agents still got usable frames, but at a high time cost. Proposed fix, no new dependency: an `ld-widget shot` command that starts the installed Chrome, waits for the widget's first render and then captures.
2. **False overflow in the dev shell before the first measure.** While the preview width is still 0, the frame is 0 px wide and the overflow check fires (`shell/App.vue`; codex-5 `dev.log`: "content is 24×150 px in a 0×150 px frame"). Same class as the round-2 `body` margin bug.
3. **macOS keychain dialog from headless Chrome.** Under the test HOME without a keychain, Chrome raised «Keychain Not Found». A real user's HOME has a keychain, so this is mostly a setup artifact, but adding `--use-mock-keychain` to the recipe keeps headless Chrome away from the keychain entirely.
4. **App, not SDK: no silent auto-placement failure message.** codex-5 chose a 6×6 default; with no free 6×6 area on the visible board the installed widget was not placed and nothing told the user. Placed by hand. Not investigated further.

## Deviations and rulings

- Ruling: Codex runs without its sandbox, like Claude. Round 2 compared unequal setups, and Chrome cannot start in the macOS `workspace-write` sandbox. Cost if wrong: results overstate Codex in its default sandboxed setup; the docs tell the agent to ask the user to run the screenshot outside the sandbox.
- Ruling: fresh Codex profile (`auth.json` and `config.toml` only); the old profile held history and memories of earlier runs. Cost if wrong: none known.
- The test HOME's `Library/Keychains` was linked to the real keychain mid-run (during codex-2) to stop the dialog.
- Board checks ran without viewport emulation after the user widened the Orca pane to 1689 px; screenshots under emulation came back half-scale or tiled.
- `sizes.sh` parked other instances in one column and exceeded the board's 100-row limit (PUT 400); fixed to park in rows of 24 columns and rerun.
