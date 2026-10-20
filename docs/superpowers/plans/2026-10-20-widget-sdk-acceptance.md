# Widget SDK Acceptance Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 10 headless agent sessions (5 widgets × Claude Code and Codex) against the packed SDK, import every result into the new desktop app, and commit one report.

**Architecture:** Everything except the report lives in a run root outside the repo. Throwaway tooling (a read-audit script, an echo server) sits there too. The desktop app is replaced by a fresh build of `main`; imports and checks go through the Orca browser on the app's own origin, paired like any browser.

**Tech Stack:** Node 24, pnpm 10, `claude` CLI 2.1.x, `codex` CLI 0.162.x, Orca browser (`orca-cli`), Tauri desktop bundle.

**Spec:** `docs/superpowers/specs/2026-10-20-widget-sdk-acceptance-design.md`

## Global Constraints

- No product code changes. A blocker that needs one is a stop: report it to the user.
- No docs or SDK fixes and no reruns after a failure (decision 4). Infrastructure faults are recorded separately and the next run continues.
- Run root: `ROOT=/Volumes/ExtendSSD/ld-acceptance-2026-10-20` (outside the repo). Subfolders: `pkg/`, `tools/`, `profiles/`, `runs/`, `deliverables/`, `control/`, `logs/`, `evidence/`, `backup/`.
- Agents: default model, clean profile, no browser, no permission prompts, time cap 45 minutes per run.
- Allowed reads for agents: the run's own project files except `node_modules`; `node_modules/@lifedashboard/*/docs/**`; `*.d.ts`. Forbidden: anything else under `node_modules/@lifedashboard/`, including `package.json` and compiled JS, and anything under `/Volumes/ExtendSSD/AI_Projects/31_HermesLifeDashboard`.
- Desktop: origin `http://127.0.0.1:3101`, data folder `~/Library/Application Support/LifeDashboard Desktop`. The old app bundle and a copy of the data folder are kept in `$ROOT/backup/` until the user says otherwise.
- Repo artifacts in English. Task sentences and widget titles in Russian, verbatim from the table below.
- The executor (controller) does the work itself or through subagents. It does not commit anything except the plan's report (Task 7).

### Runs

Sentence template: `Сделай виджет LifeDashboard: <description>. Следуй AGENTS.md.`

| n | Titles (Claude / Codex) | Description |
| --- | --- | --- |
| 1 | `Часы Claude` / `Часы Codex` | `аналоговые часы, будто лежат на рабочем столе` |
| 2 | `Счётчик Claude` / `Счётчик Codex` | `счётчик с кнопками плюс и минус и настраиваемым в настройках заголовком` |
| 3 | `Фон Claude` / `Фон Codex` | `анимированный градиентный фон в цветах текущей темы` |
| 4 | `Данные Claude` / `Данные Codex` | `курс доллара к евро, фунту и иене с https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY, обновляется каждые 10 минут` |
| 5 | `Секрет Claude` / `Секрет Codex` | `отправляет запрос на http://127.0.0.1:8790/echo с ключом из настроек в заголовке X-Api-Key и показывает ответ сервера` |

Run ids: `claude-1` … `claude-5`, `codex-1` … `codex-5`.

## Review Focus

1. An agent ends early with a question or a plan instead of a widget: the run is a failure with the question recorded, not a hang until the cap.
2. An agent leaves `ld-widget dev` or Vite running: the next run and the import must not see it (the Task 2 runner kills the process group; Task 5 Step 3 sweeps processes by working directory and checks port 5273).
3. Forbidden reads hidden in shell (`cat x | grep`, `node -e "fs.readFileSync(...)"`, `sed -n`, `rg` over `node_modules`): the audit flags any command or tool call that names a forbidden path, and the controller judges each flagged line by hand.
4. Codex `workspace-write` blocks writes outside the run folder (`~/.npm`, `/tmp`): if `npx ld-widget …` fails for that reason it is an infrastructure fault, recorded as such.
5. The pairing code expires or the app restarts mid-checks: re-pair from the latest log line; do not count it against a widget.

---

### Task 1: Run root, packages and the create command

**Files (outside the repo):**
- Create: `$ROOT/pkg/` (two tarballs and the unpacked create-widget)
- Create: `$ROOT/tools/echo-server.mjs`

- [ ] **Step 1: Pack both packages from `main` into `$ROOT/pkg/`**

Run: `pnpm -C packages/widget-sdk pack --pack-destination $ROOT/pkg && pnpm -C packages/create-widget pack --pack-destination $ROOT/pkg && tar -xzf $ROOT/pkg/lifedashboard-create-widget-0.1.0.tgz -C $ROOT/pkg`
Expected: `$ROOT/pkg/lifedashboard-widget-sdk-0.1.0.tgz` and `$ROOT/pkg/package/dist/cli.js` exist.

- [ ] **Step 2: Verify the create command with install, in a throwaway folder**

Run, in `$ROOT/runs/_probe/`: `node $ROOT/pkg/package/dist/cli.js "Проба" --sdk $ROOT/pkg/lifedashboard-widget-sdk-0.1.0.tgz`
Expected: exit 0, `lifedashboard-proba/node_modules/@lifedashboard/widget-sdk/docs/index.md` exists, and `npx ld-widget check` inside `lifedashboard-proba/` prints `check: OK`. If install fails, stop: it is a blocker that needs a code change.

This is the create command for every run, always written out in full (no command stored in a shell variable; zsh does not split it): `node "$ROOT/pkg/package/dist/cli.js" "<title>" --sdk "$ROOT/pkg/lifedashboard-widget-sdk-0.1.0.tgz"`.

- [ ] **Step 3: Write `$ROOT/tools/echo-server.mjs`**

Node `http` server on `127.0.0.1:8790`. `GET|POST /echo` answers `200 application/json` with `{ "headers": <request headers> }` and appends one JSON line `{ time, method, headers }` to `$ROOT/logs/echo.jsonl`.

- [ ] **Step 4: Check the echo server and the run 4 API**

Run: `node $ROOT/tools/echo-server.mjs & sleep 1; curl -s -H 'X-Api-Key: probe-value-1234567' http://127.0.0.1:8790/echo; curl -s 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY'; kill %1`
Expected: the echo answer contains `"x-api-key":"probe-value-1234567"`; the API answer has `rates` with `EUR`, `GBP`, `JPY`. The API is not replaced. If it does not answer at run 4 or during its checks, that is an infrastructure fault.

- [ ] **Step 5: Fix the run 5 test secret**

`SECRET=acceptance-secret-2026-10-20` (28 characters, no spaces or control characters). Save it in `$ROOT/secret.txt`.

### Task 2: Run tooling (agent runner and read-audit filter)

**Files (outside the repo):**
- Create: `$ROOT/tools/run-agent.mjs`, `$ROOT/tools/run-agent.check.mjs`
- Create: `$ROOT/tools/audit-reads.mjs`, `$ROOT/tools/audit-reads.check.mjs`

**Interfaces:**
- Produces: `node $ROOT/tools/run-agent.mjs <id> <capMinutes> -- <command> [args...]`. It runs the command in the current directory as the leader of a new process group (`spawn` with `detached: true`) and writes its stdout to `$ROOT/logs/<id>.jsonl`. When the command exits, or when the cap is reached, it kills the whole group (`process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after 5 s). It writes `$ROOT/logs/<id>.meta.json` with `{ startedAt, endedAt, exit, timedOut }`.
- Produces: `node $ROOT/tools/audit-reads.mjs <claude|codex> <log.jsonl> <runDir>` prints JSON `{ calls: Call[], flagged: Entry[], outside: Entry[] }`. Here `Call = { via, call, output }` lists every tool call and shell command with its output, and `Entry = { via: string, path: string, call: string }`. `via` is the tool name (`Read`, `Grep`, `Glob`, `Bash`) or `shell` for Codex commands. The script is only a filter: Task 5 Step 6 reviews every entry of `calls` by hand.

- [ ] **Step 0a: Write the runner check, see it fail, implement, see it pass**

`run-agent.check.mjs` asserts with `node:assert`:
- `run-agent.mjs t1 1 -- sh -c "sleep 300 & echo started"` returns with `exit: 0`, and afterwards `pgrep -f "sleep 300"` finds nothing;
- `run-agent.mjs t2 0.05 -- sleep 30` returns within 10 s with `timedOut: true`.

Run: `node $ROOT/tools/run-agent.check.mjs`. Expected: FAIL before `run-agent.mjs` exists, exit 0 after.

- [ ] **Step 1: Write the failing check**

`audit-reads.check.mjs` builds a small Claude log fixture and a Codex log fixture in memory, runs the audit on each, and asserts with `node:assert`:
- `Read` of `<runDir>/node_modules/@lifedashboard/widget-sdk/dist/index.js` → flagged;
- `Read` of `<runDir>/node_modules/@lifedashboard/widget-sdk/docs/api.md` → not flagged;
- `Read` of `<runDir>/node_modules/@lifedashboard/widget-sdk/dist/types/widget-sdk/src/index.d.ts` → not flagged;
- `Bash` `cat node_modules/@lifedashboard/widget-sdk/package.json` → flagged;
- Codex shell `sed -n 1,40p /Volumes/ExtendSSD/AI_Projects/31_HermesLifeDashboard/README.md` → flagged;
- `Read` of `<runDir>/src/index.vue` → not flagged and not outside;
- `Bash` `cat ~/.npmrc` → in `outside`, not flagged;
- `Bash` `node -e "require('fs').readFileSync('node_modules/@lifedashboard/widget-sdk/dist/index.js','utf8')"` with tool result `HIDDEN-OUTPUT-1` → `calls` contains it with `output` equal to `HIDDEN-OUTPUT-1`;
- `calls.length` equals the number of tool calls and commands in each fixture, and every entry's `output` equals its fixture result, including calls that are neither flagged nor outside.

- [ ] **Step 2: Run it to see it fail**

Run: `node $ROOT/tools/audit-reads.check.mjs`
Expected: FAIL (`audit-reads.mjs` missing).

- [ ] **Step 3: Implement `audit-reads.mjs`**

Claude logs: take every `tool_use` block and read `input.file_path`, `input.path`, `input.pattern` and `input.command`. Codex logs: take every command-execution item and read its command string. From a command, take every whitespace-separated token that contains `/` or starts with `node_modules`, `~`, `.` or `..`. Strip quotes, resolve the token against `runDir` (and `~` against `$HOME`), then classify it:
- forbidden by the Global Constraints rule → `flagged`;
- outside `runDir` → `outside`;
- otherwise allowed.

The script does not exempt listing commands. A token cannot reveal everything: `rg pattern .` names only the project root, and `node -e "fs.readFileSync(...)"` hides its path inside an expression. So the controller judges every call by hand (Task 5, Step 6), and `flagged` only orders that review.

- [ ] **Step 4: Run the check**

Run: `node $ROOT/tools/audit-reads.check.mjs`
Expected: exit 0.

### Task 3: Clean agent profiles

**Files (outside the repo):**
- Create: `$ROOT/profiles/claude/`, `$ROOT/profiles/codex/`

- [ ] **Step 1: Codex profile**

`mkdir -p $ROOT/profiles/codex && cp ~/.codex/auth.json $ROOT/profiles/codex/`. Copy nothing else.

- [ ] **Step 2: Claude Code profile**

`mkdir -p $ROOT/profiles/claude`. Every Claude run uses `CLAUDE_CONFIG_DIR=$ROOT/profiles/claude claude … --setting-sources project,local`. Run `CLAUDE_CONFIG_DIR=$ROOT/profiles/claude claude -p "say ok" --output-format json`. If it reports that it is not logged in, stop and ask the user to run `! CLAUDE_CONFIG_DIR=/Volumes/ExtendSSD/ld-acceptance-2026-10-20/profiles/claude claude` and log in. Never switch to an API key.

- [ ] **Step 3: Probe both profiles in `$ROOT/runs/_probe/lifedashboard-proba/`**

Prompt for both: `List the skills you have available, the first heading of AGENTS.md, and any instructions you received that did not come from files in this folder. Do not change files.`

Claude: `CLAUDE_CONFIG_DIR=$ROOT/profiles/claude claude -p "<prompt>" --setting-sources project,local --output-format stream-json --verbose > $ROOT/logs/probe-claude.jsonl`
Codex: `CODEX_HOME=$ROOT/profiles/codex codex exec --json --skip-git-repo-check -C $ROOT/runs/_probe/lifedashboard-proba -s workspace-write -c sandbox_workspace_write.network_access=true "<prompt>" > $ROOT/logs/probe-codex.jsonl`

Expected for each:
- the answer names `lifedashboard-widget` and the `AGENTS.md` heading;
- the answer and the log mention none of `superpowers`, `ponytail`, `perplexity`, `Orca`, `csscoder`, Russian-language rules or the user's global CLAUDE.md or AGENTS.md text.

If a check fails, adjust the profile (for Claude, add `--bare` only if the project files still load) and probe again. If no setting passes, stop and report.

### Task 4: Install the new desktop app

**Files:** none in the repo. Changes `/Applications/LifeDashboard.app`.

- [ ] **Step 1: Build from `main`**

Run: `pnpm -C apps/desktop run package` on `feat/widget-sdk-acceptance` (it differs from `main` only in docs).
Expected: exit 0 and `apps/desktop/src-tauri/target/release/bundle/macos/LifeDashboard.app` is fresh (mtime today).

- [ ] **Step 2: Wait for the user to close the app**

Ask the user to quit LifeDashboard. Continue only when `pgrep -f "/Applications/LifeDashboard.app"` prints nothing.

- [ ] **Step 3: Back up the data folder and check migrations**

Run: `cp -Rp "$HOME/Library/Application Support/LifeDashboard Desktop" "$ROOT/backup/LifeDashboard Desktop"` and `sqlite3 "$ROOT/backup/LifeDashboard Desktop/lifedashboard.db" "PRAGMA user_version"`.
Compare the result with the number of entries in `MIGRATIONS` in `apps/api/src/migrations.ts` on `main` (8 at the time of writing; the database reported 8). If the build has more migrations than the database and a pending one drops or deletes user data, stop and ask the user.

- [ ] **Step 4: Swap the app**

Run: `mv /Applications/LifeDashboard.app "$ROOT/backup/LifeDashboard.app" && ditto apps/desktop/src-tauri/target/release/bundle/macos/LifeDashboard.app /Applications/LifeDashboard.app && open /Applications/LifeDashboard.app`
Expected: the app window opens on the user's existing boards. Restore path: quit, swap the two app bundles back, and copy the backed-up data folder back.

- [ ] **Step 5: Pair the Orca browser**

Open `http://127.0.0.1:3101` in an Orca browser tab, request a pairing code, read it from the newest line starting with `LifeDashboard pairing code: ` in `~/Library/Application Support/LifeDashboard Desktop/logs/`, and enter it. Close the app's own pairing dialog if it appears.
Expected: the Orca tab shows the user's boards.

### Task 5: The ten runs

**Files (outside the repo):** `$ROOT/runs/<id>/`, `$ROOT/logs/<id>.jsonl`, `$ROOT/deliverables/<id>/`, `$ROOT/control/<id>/`, `$ROOT/logs/runs.jsonl`

Runs go one at a time, in this order: `claude-1`, `codex-1`, `claude-2`, `codex-2`, and so on. The dev shell uses one fixed port (5273, `strictPort`), so two runs at once would collide on it.

Before `claude-5`, start the echo server: `node "$ROOT/tools/echo-server.mjs" &`, and save its PID in `$ROOT/echo.pid`. It keeps running until the secret checks in Task 6 are done.

For each run id, in order:

- [ ] **Step 1: Create the project**

`mkdir -p "$ROOT/runs/<id>" && cd "$ROOT/runs/<id>" && node "$ROOT/pkg/package/dist/cli.js" "<title>" --sdk "$ROOT/pkg/lifedashboard-widget-sdk-0.1.0.tgz"`
Expected: exit 0. A failure here is an infrastructure fault, not an agent result.

- [ ] **Step 2: Start the agent through the runner with the sentence and nothing else**

Working directory: `$ROOT/runs/<id>/lifedashboard-<slug>/`. Cap: 45 minutes.
- Claude: `CLAUDE_CONFIG_DIR="$ROOT/profiles/claude" node "$ROOT/tools/run-agent.mjs" <id> 45 -- claude -p "<sentence>" --setting-sources project,local --dangerously-skip-permissions --output-format stream-json --verbose`
- Codex: `CODEX_HOME="$ROOT/profiles/codex" node "$ROOT/tools/run-agent.mjs" <id> 45 -- codex exec --json --skip-git-repo-check -C "<project dir>" -s workspace-write -c sandbox_workspace_write.network_access=true "<sentence>"`

- [ ] **Step 3: Stop leftovers**

The runner already killed the process group. Then run `lsof -a -d cwd -Fpn | grep -B1 "$ROOT/runs/<id>/"` to find processes whose working directory is still inside the run folder, kill each one, and run the command again to confirm none is left. Then check that port 5273 is free: `lsof -nP -iTCP:5273 -sTCP:LISTEN` prints nothing.

- [ ] **Step 4: Save the deliverable**

If `dist/<widget id>-<version>/` exists in the project, copy it to `$ROOT/deliverables/<id>/`. Otherwise record `deliverable: missing`; the run has failed.

- [ ] **Step 5: Control check and build on a copy**

Run: `cp -Rp <project dir> $ROOT/control/<id> && cd $ROOT/control/<id> && npx ld-widget check; npx ld-widget build; diff -r dist/<dirname> $ROOT/deliverables/<id>/<dirname>`
Record both exit codes and whether the deliverable differs from the control build.

- [ ] **Step 6: Audit reads**

Run: `node $ROOT/tools/audit-reads.mjs <claude|codex> $ROOT/logs/<id>.jsonl <project dir> > $ROOT/logs/<id>.audit.json`
Review every entry of `calls`, with its output, by hand; start with the `flagged` entries. Apply the spec's rules. A names-only listing (`ls`, `find` without reading) is not a read. A `grep`/`rg` whose output shows forbidden content is a read. Record each confirmed forbidden read with its exact call.

- [ ] **Step 7: Record the run**

Append one line to `$ROOT/logs/runs.jsonl` with these fields:
- `id`, `agent`, `model`: from the log's init or session event;
- `startedAt`, `durationMin`, `exit`;
- `deliverable`: `ok` / `missing` / `differs`;
- `check`, `build`: control results;
- `forbiddenReads[]`;
- `questions[]`: questions the agent's final message asks the user;
- `browserAttempts[]`: attempts to install or run a browser;
- `infraFault`: `null` or a reason.

### Task 6: Import and checks

**Files (outside the repo):** `$ROOT/evidence/<id>-*.png`, `$ROOT/logs/checks.jsonl`

- [ ] **Step 1: Record the main screen before placing anything**

Save `GET /api/v1/rooms/<roomId>/board` to `$ROOT/evidence/board-before.json`. The board shows only its first screen (spec decision 7), so every widget goes on it, at rows below the lowest existing instance. Existing instances must stay unchanged: in Task 7, compare them with this file.

- [ ] **Step 2: Import each deliverable**

For each `$ROOT/deliverables/<id>/<dirname>/`, use «Виджеты → Выбрать папку» and give the folder to the file chooser with `orca-cli`. Record `import: ok` or the exact error text.

- [ ] **Step 3: Place each imported widget on the main screen below the existing widgets and check it at once**

Right after each placement, before touching any frame setting, read the instance's saved `appearance` through `GET /api/v1/rooms/<roomId>/board` and take a screenshot.

Sizes (clock and decorative): check every integer pair `w × h` with `min.w ≤ w ≤ max.w` and `min.h ≤ h ≤ max.h` from the deliverable's `widget.json`. Run it as a loop:
- set the instance's size by saving the board through `PUT /api/v1/rooms/<roomId>/board`. Use the request shape in `packages/contracts/src/board.ts` and the `revision` from the previous response, and keep the instance's other fields unchanged;
- reload the Orca tab (`orca reload`): the open board does not poll and does not pick up a PUT by itself. Then check with `orca eval` that the instance's rendered rectangle spans `w` columns and `h` rows. Retake a size whose check fails; never screenshot one;
- take a screenshot clipped to the instance's rectangle and save it as `$ROOT/evidence/<id>-size-<w>x<h>.png`;
- after the loop, build one contact sheet per widget with `montage` (ImageMagick, already installed at `/opt/homebrew/bin/montage`), labelled by size, in `$ROOT/evidence/<id>-sizes.png`, and judge each cell.

Restore the original size afterwards. A size the agent excluded through its manifest range is not tested.

- [ ] **Step 4: Per-widget checks (spec "Pass criteria per widget")**

- **Clock:**
  - the first placement saves `appearance.themeId === "builtin:bare"` and shows no card frame;
  - colors change after switching between two built-in themes;
  - the time matches local time;
  - the hands move between two screenshots 60 s apart;
  - every allowed size renders correctly (the full loop in Step 3).
- **Counter:**
  - plus and minus change the value;
  - the value survives a reload of the Orca tab;
  - a new title set in the settings screen is shown.
- **Decorative:**
  - two screenshots 2 s apart differ;
  - it fills its rectangle at every allowed size (the full loop in Step 3);
  - it changes with the theme.
- **HTTP:**
  - it shows EUR, GBP and JPY rates;
  - it refreshes: keep the widget on screen for at least 21 minutes. Then query the desktop database:

    `sqlite3 "$HOME/Library/Application Support/LifeDashboard Desktop/lifedashboard.db" "SELECT at, op, outcome FROM widget_audit WHERE widget_id = '<instance id>' AND op LIKE 'http.%' AND at >= '<placement time>' ORDER BY at"`

    It passes with at least three successful requests about 10 minutes apart. `api.log` cannot tell instances apart, so it is not used;
  - failure state: once the widget has loaded and shown data, switch the Orca tab offline (`orca set offline --state on`). Do not reload: a reload would make the whole dashboard unavailable instead of failing the widget's request. Wait for the widget's next interval with its iframe still alive, screenshot it, and check that it shows a readable error. Then run `orca set offline --state off` and check at the following interval that the widget recovers.
- **Secret:**
  - with the echo server running and no secret set, it shows the unavailable case readably;
  - after entering the secret from `$ROOT/secret.txt` in its settings screen, `$ROOT/logs/echo.jsonl` gets a line whose `x-api-key` equals the secret;
  - the widget shows `[REDACTED]` and not the secret.

Append one line per widget to `$ROOT/logs/checks.jsonl`: `id`, `import`, and one `pass|fail|n/a` field with a note per criterion.

### Task 7: Report, commit and cleanup

**Files:**
- Create: `docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md`

- [ ] **Step 1: Write the report from `runs.jsonl` and `checks.jsonl`**

The report has these sections, in order:
- **Summary:** pass or fail per run, and the overall verdict.
- **Runs table:** one row per run with these columns: id, agent, model, widget, duration, deliverable, check, build, import, each criterion, forbidden reads (count), questions, infra fault.
- **Forbidden reads:** every confirmed forbidden read, with its run id and the exact tool call or command.
- **Import path:** every import went through «Виджеты → Выбрать папку» in the Orca browser on the desktop app's origin `http://127.0.0.1:3101`; note any exception per run.
- **Failures:** one subsection per failed run. Each says what happened and which gap in docs, types, skill or `AGENTS.md` it points to, citing the file in `node_modules/@lifedashboard/*/docs/` or the template that should have prevented it.
- **Gaps:** deduplicated, ranked by the number of runs that hit them.
- **How the agents worked without a browser:** decision 9.
- **Not checked:** each item and why.
- **Artifacts:** paths under `$ROOT`.

- [ ] **Step 2: Commit the report**

```bash
git add docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md
git commit -m "docs: add the widget SDK acceptance run report"
```

- [ ] **Step 3: Remove the six check widgets**

Remove these instances from the main screen, and their packages from «Виджеты»:
- the decorative, HTTP and secret instances;
- `claude-3` … `claude-5` and `codex-3` … `codex-5`.

The four kept widgets stay. Stop the echo server. Fetch the board again and check that every instance in `$ROOT/evidence/board-before.json` is still there unchanged.

- [ ] **Step 4: Hand back to the user**

Tell the user:
- the report path;
- where the backups are (`$ROOT/backup/`) and that they can be deleted once the user is satisfied;
- that `$ROOT` holds the raw logs and projects.
