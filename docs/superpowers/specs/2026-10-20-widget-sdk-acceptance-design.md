# Widget SDK acceptance run (plan 4) — design

Date: 2026-10-20. Status: draft for approval.

Parent specs: `2026-10-18-widget-sdk-agent-ready-design.md` (acceptance run, section "Success and failure") and `2026-10-20-widget-sdk-agent-knowledge-design.md` (reference task, plan 3 deliverables). Where they differ, the plan 3 spec wins: the user runs `create`, then gives the agent one sentence.

## Intent

Prove that the Widget SDK is ready to publish. A fresh coding agent that sees only the installed packages must build a widget from one sentence, and the built folder must import on the first attempt into the user's main dashboard (the desktop app) and work.

Plan 4 is a measurement, not a fix. It produces a report. Fixing the gaps it finds is a later plan that the user decides on after reading the report.

## Success and failure

- **Success (user's words):** the widget is created and imports into the main dashboard on the first attempt.
- **Failure (inherited, user's words):** the agent opens dashboard sources. Allowed reading: the generated project's own files (including `AGENTS.md`, `CLAUDE.md`, the skill), `node_modules/@lifedashboard/*/docs/` and `.d.ts` files. Any other platform file, including compiled runtime JS in `node_modules` and anything in the LifeDashboard monorepo, is a failure.
- **Failure (plan 3, user's words):** the clock looks like an ordinary card with a frame.
- **Failure:** `ld-widget check` or `ld-widget build` fails at the end of the run, the folder does not import, or the widget does not work by the criteria below.

## Decisions made by the user (this conversation)

1. The controller (Claude) launches the agents. The user looks only at the result.
2. All five widgets run, in both Claude Code and Codex: 10 runs.
3. The user keeps the clock and the counter. The other three are checks only.
4. If a run fails, the controller does not fix docs or rerun. It finishes all 10 runs and writes one full report. The user decides on fixes afterwards.
5. Agents run with their default model.
6. Agents run in a clean profile, as a new user would: no user-level `CLAUDE.md`, `AGENTS.md`, plugins, skills, hooks or MCP servers.
7. The clock and counter from both agents (4 widgets) go on the main dashboard for side-by-side comparison. The board shows only its first screen and has no screen management, so the user chose the main screen, in free space below the existing widgets, over a separate screen (which would need a product change).
8. The user closes the running desktop app before the new build is installed.
9. Agents get no browser, as a new user's terminal agent has none. `AGENTS.md`, the skill and `workflow.md` tell the agent to open the dev shell in a browser; how the agent copes without one is a finding for the report, not a reason to change the setup. The agent may not install a browser for itself. If it tries, the attempt is recorded. Any `ld-widget dev` or other long-running process an agent leaves behind is stopped by the controller when the run ends.

## The ten runs

Each widget runs once in Claude Code and once in Codex. The title carries the agent name so the two copies get different slugs and ids (controller's call).

| # | Widget | Titles | Description in the sentence (controller's call) | Kept |
| --- | --- | --- | --- | --- |
| 1 | Clock (reference task) | «Часы Claude», «Часы Codex» | аналоговые часы, будто лежат на рабочем столе | yes |
| 2 | Counter with settings | «Счётчик Claude», «Счётчик Codex» | счётчик с кнопками плюс и минус и настраиваемым в настройках заголовком | yes |
| 3 | Decorative | «Фон Claude», «Фон Codex» | анимированный градиентный фон в цветах текущей темы | no |
| 4 | HTTP | «Данные Claude», «Данные Codex» | names one public HTTPS JSON API without a key, shows its data, refreshes every few minutes | no |
| 5 | Secret | «Секрет Claude», «Секрет Codex» | sends a request with a user-entered key in a header to a local echo server and shows the response | no |

The sentence is the dashboard's starter prompt with the description filled in:

`Сделай виджет LifeDashboard: <description>. Следуй AGENTS.md.`

For runs 4 and 5 the description names the exact URL (and for run 5 the header name), because a user would know them. The builder picks the HTTP API, checks it answers before the runs, and writes the final sentences into the plan.

## Run procedure

1. **Setup, once.**
   - Pack `@lifedashboard/widget-sdk` and `@lifedashboard/create-widget` from current `main` into a temp folder outside the repo.
   - Rebuild the desktop app from `main` (`pnpm -C apps/desktop run package`). After the user closes the running app, move the old `/Applications/LifeDashboard.app` to a backup and install the new one. The desktop data folder (`~/Library/Application Support/LifeDashboard Desktop`) stays in place.
   - Before the new build first starts, copy the whole data folder to a backup and compare the database's applied migrations with the new build's list. The API applies pending migrations on start, and some migrations delete tables. If a pending migration deletes user data, stop and ask the user. Restoring means putting back the old app bundle and the copied data folder together.
   - Create clean agent profiles (see Constraints) and confirm, with a throwaway project, that each agent loads the project's `AGENTS.md`, `CLAUDE.md` (Claude Code) and the `lifedashboard-widget` skill, and does not load the user's global config.
   - Start the local echo server for run 5. It is a small throwaway script in the temp folder, on `http://127.0.0.1:<port>`; it returns the request headers it received.
   - Pick the run 5 test secret to satisfy the host's rule (`SECRET_MIN_LENGTH`, 16 characters or more, no surrounding spaces or control characters). A rejection caused by the controller's test value is a setup error, not a run failure.
2. **Per run.**
   - In a fresh empty folder outside the repo, the controller runs the create command from the unpacked `create-widget` tarball with the widget title and `--sdk <sdk tarball>`, with dependency install on (the user's one command). Before publishing, `npm create` cannot resolve the package, so this tarball command replaces it; the builder fixes the exact command and verifies install works with the tarball SDK.
   - The agent starts headless in the created `lifedashboard-<slug>/` folder with the one sentence and nothing else. It may run any command and iterate on its own `check` errors. Nobody answers its questions; a question it asks is recorded.
   - The run ends when the agent stops or hits the time cap (controller's call: 45 minutes).
   - When the run ends, the controller saves a copy of the agent's built `dist/<id>-<version>/` folder as the run's deliverable. A missing built folder is a failure of the run. The deliverable is what gets imported.
   - The controller then runs `ld-widget check` and `ld-widget build` itself on a separate copy of the project, so the result does not depend on the agent's claim. These commands rebuild `dist/`, so they never run on the deliverable. A deliverable that differs from the controller's build (stale or hand-edited) is recorded.
3. **Import and checks, after all 10 runs.**
   - Import each built `dist/<id>-<version>/` folder into the new desktop app through its folder import («Виджеты → Выбрать папку»). How the controller drives the import (GUI automation of the app, or the app's own web origin in a browser) is the builder's call; the report says which path each import took.
   - Place all 10 imported widgets on the main screen, in free space below the existing widgets, without moving or changing the existing ones: the four kept ones (clock and counter from each agent) and the six check ones (decorative, HTTP and secret from each agent). Each of the 10 is checked on its own. After the report, remove the six check widgets and their packages.

## Pass criteria per widget

- **Clock:** frameless on first placement, before anyone touches its frame setting (saved appearance `builtin:bare` and no card frame on screen right after placing; a framed first placement is a failure); colors follow the current theme (switch at least two built-in themes); renders correctly at every size the manifest allows; shows the current local time and the hands move.
- **Counter:** plus and minus change the value; the value survives a reload of the app; changing the title in the widget's settings screen changes the shown title.
- **Decorative:** animates; fills its rectangle at every allowed size; uses theme colors.
- **HTTP:** shows data from the named API; refreshes on its interval; shows a readable state when the request fails (checked by blocking or breaking the request, builder's choice).
- **Secret:** before the secret is entered the widget shows the `UNAVAILABLE` case readably; after entering the secret in the settings screen the echo server receives it in the header; the response shown in the widget contains `[REDACTED]`, not the secret.

## Detecting "opened dashboard sources"

- Every run keeps its full session log: Claude Code `--output-format stream-json`, Codex `exec --json`.
- The controller extracts every file read: read tools, and shell commands that read a path (`cat`, `sed`, `head`, `grep`, `rg`, `find`, `ls` and similar). Each path is checked against the allowed list in "Success and failure". A recursive search that walks into forbidden files counts as reading them.
- The report lists every forbidden access with the exact tool call or command.
- Borderline cases (controller's call):
  - A listing that shows only names (`ls`, `find` without reading content) is not a read.
  - Reading any other file under `node_modules/@lifedashboard/*/`, including its `package.json`, is a failure, as the allowed list says.
  - A `grep`/`rg` whose output shows content from a forbidden file is a read of that file.
  - Files of the generated project, including those `check` or `build` output names, are always allowed.

## Infrastructure faults

A run that fails for a reason that is not the SDK's (rate limit, agent crash, sandbox blocking network, the run 4 API being down) is not rerun, per decision 4. The report records it as an infrastructure fault, separate from SDK failures, and the remaining runs continue.

## Report

One Markdown report committed to `docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md` (controller's call). It contains:

- a table of the 10 runs: agent, model actually used, widget, duration, `check`, `build`, import, each pass criterion, forbidden reads (count), questions asked;
- for every failure: what happened and which gap in the docs, types, skill or `AGENTS.md` it points to;
- a deduplicated list of gaps, ranked by how many runs hit them;
- what was not checked and why.

Raw session logs and the generated projects stay in the temp folder; the report names where. They are not committed.

## Constraints

- No product code changes in plan 4. If the run cannot proceed without a code change (for example the tarball install does not work), that is a stop: report it to the user.
- Clean profiles:
  - Codex: a fresh `CODEX_HOME` with only the auth file copied in. `--ignore-user-config` alone is not enough, because the user's global `AGENTS.md` lives in `~/.codex`.
  - Claude Code: a configuration that loads no user-level settings, `CLAUDE.md`, plugins, hooks or MCP servers, but does load the project's `CLAUDE.md`, `AGENTS.md` and `.claude/skills/`. `--bare` skips `CLAUDE.md` discovery and may skip project skills, so it is acceptable only if the setup check shows the project files still load. A separate config directory is the likely route; authentication must still work. If the user's login does not carry over, stop and ask the user to log in to the clean profile; an API key fallback changes billing and is not used without their approval.
- Agents run without permission prompts inside their run folder (headless). Network stays on: run 4 needs it.
- Runs happen in folders outside the monorepo. The agent's working directory gives no path back to the monorepo.
- The desktop app replacement keeps the user's data. The old app bundle is kept as a backup until the user says otherwise.
- Repository artifacts (spec, plan, report) are in English. The task sentences and widget titles are in Russian, as a user would write them.

## Non-goals

- Fixing docs, types, the skill or the SDK (a later plan).
- Publishing to npm.
- Windows and Linux.
- Agents other than Claude Code and Codex.
- Judging code quality of the generated widgets beyond the pass criteria.

## Left to the builder

- The exact create command from tarballs, with install.
- How to build the clean Claude Code profile and verify it.
- Which public API run 4 uses, and the echo server's port and header name for run 5.
- Run order and whether Claude Code and Codex runs go in parallel (rate limits allowing).
- How the import is driven, and how each pass criterion is observed (screenshots, saved board state, the echo server log).
