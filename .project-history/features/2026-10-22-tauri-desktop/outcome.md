# Tauri desktop app (macOS) — frozen outcome

Feature ID: tauri-desktop
Status: incomplete-evidence
Completed at: 2026-10-11
Archived at: 2026-10-22T05:24:48Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- API config: optional LIFEDASHBOARD_UI_DIR and LIFEDASHBOARD_RUNTIME_DIR, absolute paths only, unset keeps the dev behavior (commit 1731930). (evidence: [ev-commits], [ev-tree])
- Sandbox runtime: /sandbox/runtime/vue.js and sdk.js read from runtimeDir when it is set (commit 81870b5). (evidence: [ev-commits])
- Static UI: apps/api/src/ui-static.ts serves the generated UI with SPA fallback, path guards and the Host allowlist; registered only when uiDir is set (commit b431898). (evidence: [ev-commits], [ev-tree])
- Pairing: the startup pairing code is issued only when no unexpired session exists; POST pair-code is unchanged; PairingForm copy is desktop-neutral (commit b04d31a). (evidence: [ev-commits], [ev-tree])
- Bundle and ready line: vite.bundle.config.ts, scripts/copy-runtime.mjs, scripts/smoke-bundle.mjs and the build:bundle script; server.ts prints the ready line after listen (commit 6c968ad). (evidence: [ev-commits], [ev-tree])
- Desktop package apps/desktop: package script, prepare-node.mjs, tauri.conf.json with the Node sidecar as externalBin, the API bundle and UI as resources, ad-hoc signing, no capabilities (commit 3d738b0). (evidence: [ev-commits], [ev-tree])
- Parsers: pairing_code and is_ready in src-tauri/src/lines.rs with unit tests (commit 1a53542). (evidence: [ev-commits], [ev-tree])
- Wrapper: src-tauri/src/main.rs starts the sidecar on port 3101, writes api.log, shows the pairing and error dialogs, opens the window after the ready line and stops the sidecar with SIGTERM (commit eea7b21). (evidence: [ev-commits], [ev-tree])
- Docs: README desktop section and AGENTS.md entry and package command (commit 2d94b81). (evidence: [ev-commits])
- Manual acceptance: all 10 spec acceptance items recorded as pass in the plan (commit 7a1b8ba). (evidence: [ev-plan])

## Accepted decisions
- The window loads http://127.0.0.1:3101/ and the API serves the UI on the same origin. This keeps the SameSite=Strict session cookie, the Host and Origin allowlists and relative fetch URLs unchanged; a tauri:// origin would break auth in several places. (evidence: [ev-spec])
- Fixed port 3101. A random port changes the origin and resets WebKit localStorage on every launch; 3101 does not collide with the dev API on 3001. (evidence: [ev-spec])
- The API runs as a Node 24 arm64 binary shipped as a Tauri sidecar (externalBin). This works when the app starts from Finder, which has no nvm PATH. (evidence: [ev-spec])
- The API is bundled into one ESM file with Vite 8. @lifedashboard/contracts exports .ts sources that Node does not strip under node_modules, so a copied node_modules would not start. (evidence: [ev-spec])
- Separate data directory ~/Library/Application Support/LifeDashboard Desktop. db.ts assumes one process owns the database, and a newer dev schema would stop the app. (evidence: [ev-spec])
- The wrapper reads the pairing code from the API's stdout and shows it in a native dialog. The security model is unchanged. (evidence: [ev-spec])
- The API issues the startup pairing code only when no unexpired session exists. Otherwise the desktop app would show the dialog on every launch. (evidence: [ev-spec])
- Static UI is served by a small handler in the API, with no @fastify/static, reusing the file-serving and path guards already in apps/api. (evidence: [ev-spec])
- The sidecar is started with std::process::Command, not tauri-plugin-shell, and no capabilities are granted, so the remote page has no IPC access. (evidence: [ev-spec])
- Shutdown sends SIGTERM through /bin/kill, then SIGKILL after 5 s. std::process::Child::kill sends SIGKILL directly, and this avoids a libc or nix dependency. (evidence: [ev-spec])
- Hardened runtime is off (bundle.macOS.hardenedRuntime false). Re-signing the copied Node binary ad-hoc with hardened runtime and without JIT entitlements could break V8; hardened runtime matters only for notarization, which is out of scope. (evidence: [ev-plan])
- No tauri dev. UI and API keep developing through pnpm dev; the desktop package has no build, dev, typecheck or test script, because the root pnpm build and pnpm dev would recurse into it. (evidence: [ev-spec], [ev-plan])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-11-tauri-desktop-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-11-tauri-desktop.md` → [plan](plan.md)

## Areas and modules
Not recorded.

## Git state
Repository root: .
Branch: main
HEAD commit: 5cecd9dfb0f62024ebe306c36cb42a9d020cfdc5
Describe: 5cecd9d
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ev-commits], [ev-tree].

## Verification
Reported status: passed.
- Command/check: Manual acceptance item 1 (spec «Acceptance criteria»): pnpm -C apps/desktop run package produced LifeDashboard.app and LifeDashboard_0.1.0_aarch64.dmg; recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 2: start from /Applications, pairing dialog appears and pairing works; recorded result pass (dialog confirmed by the partner)
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 3: restart shows the board without a pairing dialog; recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 4: built-in clock added, moved, resized and kept after quit and relaunch; recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 5: Выбрать папку opens a folder picker and installs examples/widgets/hello; recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 6: remove the package and reinstall by dropping the folder on the dialog; recorded result pass (drop performed by the partner)
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 7: hello renders, video plays, state and notifications work and survive a restart; recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 8: hostile widget stays contained in its iframe; recorded result pass (9 attacks reported blocked by the widget's own probe)
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 9: Cmd+Q leaves no server.mjs process (quit sent as AppleEvent); recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
- Command/check: Manual acceptance item 10: with port 3101 held by a foreign HTTP server answering /health, the app shows the error dialog, opens no window and exits; recorded result pass
  Result: passed; exit code: not recorded; evidence: [ev-plan].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
- Change: Acceptance item 10 expected a pairing dialog before the error dialog; none appeared because the install was already paired.
  Reason: The startup pairing code is issued only for unpaired installs (spec «Pairing at start»; plan Task 4).
  Effect: The plan's expectation was not met; the error dialog behaved as specified.
  Evidence: [ev-plan].

## Consciously excluded scope
- Developer ID signing, notarization, universal or Intel builds, Windows and Linux, auto-update, tray, autostart, automatic API restart, tauri dev, a native menu beyond Tauri's default, and moving data from the dev data directory (spec Out of scope). (evidence: [ev-spec])

## Confirmed follow-ups
- Rerun pnpm -C apps/desktop run package and the acceptance checklist on the current tree; commit cabd8cb (2026-10-18) changed tauri.conf.json after the recorded run (minimumSystemVersion 15.7). (evidence: [ev-commits])
- Record the automated checks named in the plan (pnpm typecheck, pnpm test, cargo test, pnpm -C apps/api smoke:bundle); no results are recorded. (evidence: [ev-plan])

## Limitations and unresolved risks
- Several acceptance items used partner-confirmed gestures or dialogs (items 2, 4, 6 and 10 as recorded), and the pairing dialog could not be captured by window-scoped screenshots. (evidence: [ev-plan])
- No code review of the desktop change is recorded. (evidence: [ev-commits])
- The build is ad-hoc signed and not notarized; it is intended for the machine that built it (spec Decisions, Audience). (evidence: [ev-spec])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-11-tauri-desktop-design.md
  Approved design (2026-10-11) for a local, ad-hoc signed macOS arm64 build of LifeDashboard as a Tauri 2 app. Decisions: window on the API origin http://127.0.0.1:3101 (one origin keeps the session cookie and Host/Origin checks); fixed port 3101; Node 24 arm64 binary as Tauri sidecar; API bundled to one ESM file with Vite 8; separate data directory; pairing code read from API stdout and shown in a native dialog; startup code only without an unexpired session; static UI served by a small API handler; std::process::Command without tauri-plugin-shell; SIGTERM via /bin/kill; no tauri dev. Out of scope: Developer ID signing, notarization, universal or Intel builds, Windows and Linux, auto-update, tray, autostart, automatic API restart, native menu beyond default, moving dev data. Acceptance criteria 1-10 in the window (WebKit).
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: f8776a6c7c1911fc63bf0bd4ad8601b7180a4c4cd5aacea5aa782270bb39e66b
- [ev-plan] file: docs/superpowers/plans/2026-10-11-tauri-desktop.md
  Ten tasks: API config and UI/runtime directories; sandbox runtime from runtimeDir; static UI with SPA fallback; startup pairing code only for unpaired installs; API bundle, ready line and smoke check; desktop package scaffold with Node sidecar (hardenedRuntime false); stdout line parsers with Rust tests; wrapper lifecycle and package build; documentation; manual acceptance. Appended section «Acceptance results (2026-10-11)»: items 1-10 recorded as pass, with evidence per item. Item 10 note: the expected pairing dialog before the error dialog did not appear because the install was already paired. Plan checkboxes and the automated check results (typecheck, test, cargo test, smoke:bundle) are not recorded in the plan.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 50a17dbe6adc95449133bf61e5028472a32ec3887c75b391624868f79bd8de4d
- [ev-commits] session: This archive session, Bash, read-only: git log --format='%h %ad %s' --date=short 9ad76e8~1..7a1b8ba; git log --all --grep='desktop|tauri|sidecar|pairing|bundle' (-i); git log --since=2026-10-11 --until=2026-10-12; git show --stat for 9ad76e8, 2604316, a76de33, af29e43, 1731930, 81870b5, b431898, b04d31a, 6c968ad, 3d738b0, 1a53542, eea7b21, 2d94b81, 7a1b8ba, cabd8cb, 94a17e2; git show cabd8cb -- apps/desktop/src-tauri/tauri.conf.json; git log --all -i --grep=review for 2026-10-10..2026-10-13.
  Implementation commits: 1731930 config UI and runtime dirs (Task 1); 81870b5 sandbox runtime from runtimeDir (Task 2); b431898 ui-static.ts and registration (Task 3); b04d31a startup code for unpaired installs and PairingForm copy (Task 4); 6c968ad bundle config, copy-runtime, smoke-bundle, ready line (Task 5); 3d738b0 desktop package scaffold, Cargo files, tauri.conf.json, icons, prepare-node (Task 6); 1a53542 lines.rs parsers (Task 7); eea7b21 main.rs lifecycle and window (Task 8); 2d94b81 README and AGENTS.md (Task 9). Docs: 9ad76e8 and 2604316 spec; a76de33 and af29e43 plan. Acceptance record: 7a1b8ba. Later commit outside the plan: cabd8cb (2026-10-18) adds minimumSystemVersion 15.7 to tauri.conf.json. No commit message records a code review of the desktop change; review commits in that period concern other specs.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-tree] session: This archive session, Bash, read-only: test -f for apps/api/src/ui-static.ts, apps/api/vite.bundle.config.ts, apps/api/scripts/copy-runtime.mjs, apps/api/scripts/smoke-bundle.mjs, apps/desktop/package.json, apps/desktop/scripts/prepare-node.mjs, apps/desktop/src-tauri/{Cargo.toml,tauri.conf.json,src/main.rs,src/lines.rs}; git grep for parseOptionalDir, registerUiStatic, onPairingCode, pairing_code, is_ready, LifeDashboard Desktop, disable_drag_drop_handler; git grep for dist-bundle and desktop ignore rules in .gitignore; git status --short (empty); ls .project-history/features (no tauri-desktop entry).
  All named files exist in the current tree. The named symbols exist: parseOptionalDir and registerUiStatic (apps/api/src), onPairingCode (auth.ts), pairing_code and is_ready (lines.rs), disable_drag_drop_handler and the data directory name (main.rs). .gitignore lists dist-bundle/ and the desktop target, binaries and gen directories. Working tree clean at the start of the session. The feature is not archived yet. No automated test or build result was run in this session.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
Read the full spec (status: approved design, 2026-10-11; last changed in commit 2604316) and the full plan (Tasks 1-10 and the appended «Acceptance results (2026-10-11)» section, added in commit 7a1b8ba). Neither has a draft, obsolete or superseded marker. Both use the tauri-desktop feature and link each other by path. The spec and plan at HEAD 927f5d0 are the accepted final versions. Implementation: commits 1731930 through eea7b21 map to plan Tasks 1-8 and commit 2d94b81 to Task 9; the files and symbols named in the plan exist in the current tree (ev-tree). Acceptance: the plan records results for all 10 spec acceptance items, all passed (ev-plan). completedAt 2026-10-11 comes from the acceptance commit 7a1b8ba, which records the acceptance run. No code review of the desktop change is recorded. Commit cabd8cb (2026-10-18) changed apps/desktop/src-tauri/tauri.conf.json after the acceptance run; the acceptance does not cover that change. Secrets: a search of both sources found only a test file name, a SQL column name and a traversal test string.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-tree].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
