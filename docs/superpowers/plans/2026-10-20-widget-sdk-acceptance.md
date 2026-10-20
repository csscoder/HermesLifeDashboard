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
2. An agent leaves `ld-widget dev` or Vite running: the next run and the import must not see it (Task 5 kills processes by run folder).
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

This is the create command for every run: `CREATE="node $ROOT/pkg/package/dist/cli.js"`, called as `$CREATE "<title>" --sdk $ROOT/pkg/lifedashboard-widget-sdk-0.1.0.tgz`.

- [ ] **Step 3: Write `$ROOT/tools/echo-server.mjs`**

Node `http` server on `127.0.0.1:8790`. `GET|POST /echo` answers `200 application/json` with `{ "headers": <request headers> }` and appends one JSON line `{ time, method, headers }` to `$ROOT/logs/echo.jsonl`.

- [ ] **Step 4: Check the echo server and the run 4 API**

Run: `node $ROOT/tools/echo-server.mjs & sleep 1; curl -s -H 'X-Api-Key: probe-value-1234567' http://127.0.0.1:8790/echo; curl -s 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY'; kill %1`
Expected: the echo answer contains `"x-api-key":"probe-value-1234567"`; the API answer has `rates` with `EUR`, `GBP`, `JPY`. If the API does not answer, pick another no-key HTTPS JSON API, change only the run 4 description, and note it in the report.

- [ ] **Step 5: Fix the run 5 test secret**

`SECRET=acceptance-secret-2026-10-20` (28 characters, no spaces or control characters). Save it in `$ROOT/secret.txt`.

### Task 2: Read-audit script

**Files (outside the repo):**
- Create: `$ROOT/tools/audit-reads.mjs`
- Create: `$ROOT/tools/audit-reads.check.mjs`

**Interfaces:**
- Produces: `node $ROOT/tools/audit-reads.mjs <claude|codex> <log.jsonl> <runDir>` prints JSON `{ flagged: Entry[], outside: Entry[], total: number }`, where `Entry = { via: string, path: string, call: string }`. `via` is the tool name (`Read`, `Grep`, `Glob`, `Bash`) or `shell` for Codex commands.

- [ ] **Step 1: Write the failing check**

`audit-reads.check.mjs` builds a small Claude log fixture and a Codex log fixture in memory, runs the audit on each, and asserts with `node:assert`:
- `Read` of `<runDir>/node_modules/@lifedashboard/widget-sdk/dist/index.js` → flagged;
- `Read` of `<runDir>/node_modules/@lifedashboard/widget-sdk/docs/api.md` → not flagged;
- `Read` of `<runDir>/node_modules/@lifedashboard/widget-sdk/dist/types/widget-sdk/src/index.d.ts` → not flagged;
- `Bash` `cat node_modules/@lifedashboard/widget-sdk/package.json` → flagged;
- Codex shell `sed -n 1,40p /Volumes/ExtendSSD/AI_Projects/31_HermesLifeDashboard/README.md` → flagged;
- `Read` of `<runDir>/src/index.vue` → not flagged and not outside;
- `Bash` `cat ~/.npmrc` → in `outside`, not flagged.

- [ ] **Step 2: Run it to see it fail**

Run: `node $ROOT/tools/audit-reads.check.mjs`
Expected: FAIL (`audit-reads.mjs` missing).

- [ ] **Step 3: Implement `audit-reads.mjs`**

Claude logs: take every `tool_use` block and read `input.file_path`, `input.path`, `input.pattern` and `input.command`. Codex logs: take every command-execution item and read its command string. From a command, take every whitespace-separated token that contains `/` or starts with `node_modules`, `~`, `.` or `..`. Strip quotes, resolve the token against `runDir` (and `~` against `$HOME`), then classify it:
- forbidden by the Global Constraints rule → `flagged`;
- outside `runDir` → `outside`;
- otherwise allowed.

Listing commands are not exempted by the script. The controller judges each flagged line by hand (Task 5, Step 6).

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

Runs go in pairs: `claude-n` and `codex-n` at the same time, n = 1 … 5. They use different providers and different folders.

For each run id, in order:

- [ ] **Step 1: Create the project**

`mkdir -p $ROOT/runs/<id> && cd $ROOT/runs/<id> && $CREATE "<title>" --sdk $ROOT/pkg/lifedashboard-widget-sdk-0.1.0.tgz`
Expected: exit 0. A failure here is an infrastructure fault, not an agent result.

- [ ] **Step 2: Start the agent with the sentence and nothing else**

Working directory: `$ROOT/runs/<id>/lifedashboard-<slug>/`.
- Claude: `CLAUDE_CONFIG_DIR=$ROOT/profiles/claude claude -p "<sentence>" --setting-sources project,local --dangerously-skip-permissions --output-format stream-json --verbose > $ROOT/logs/<id>.jsonl`
- Codex: `CODEX_HOME=$ROOT/profiles/codex codex exec --json --skip-git-repo-check -C <project dir> -s workspace-write -c sandbox_workspace_write.network_access=true "<sentence>" > $ROOT/logs/<id>.jsonl`

Kill the agent's process group after 45 minutes. Record the start time, end time and exit code.

- [ ] **Step 3: Stop leftovers**

Run: `pkill -f "$ROOT/runs/<id>/"`, then `lsof -nP -iTCP -sTCP:LISTEN | grep -i node` to confirm no process from that folder still listens.

- [ ] **Step 4: Save the deliverable**

If `dist/<widget id>-<version>/` exists in the project, copy it to `$ROOT/deliverables/<id>/`. Otherwise record `deliverable: missing`; the run has failed.

- [ ] **Step 5: Control check and build on a copy**

Run: `cp -Rp <project dir> $ROOT/control/<id> && cd $ROOT/control/<id> && npx ld-widget check; npx ld-widget build; diff -r dist/<dirname> $ROOT/deliverables/<id>/<dirname>`
Record both exit codes and whether the deliverable differs from the control build.

- [ ] **Step 6: Audit reads**

Run: `node $ROOT/tools/audit-reads.mjs <claude|codex> $ROOT/logs/<id>.jsonl <project dir> > $ROOT/logs/<id>.audit.json`
Judge each `flagged` entry by hand with the spec's rules. A names-only listing (`ls`, `find` without reading) is not a read. A `grep`/`rg` whose output shows forbidden content is a read. Record each confirmed forbidden read with its exact call.

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

- [ ] **Step 1: Create the screen**

In the Orca tab on `http://127.0.0.1:3101`, add a screen named `Приёмка SDK`.

- [ ] **Step 2: Import each deliverable**

For each `$ROOT/deliverables/<id>/<dirname>/`, use «Виджеты → Выбрать папку» and give the folder to the file chooser with `orca-cli`. Record `import: ok` or the exact error text.

- [ ] **Step 3: Place each imported widget on `Приёмка SDK` and check it at once**

Right after each placement, before touching any frame setting, read the instance's saved `appearance` through `GET /api/v1/rooms/<roomId>/board` and take a screenshot.

Sizes: test the default size and the four corners of the manifest's sizing range (min×min, min×max, max×min, max×max). The executor may not shrink this set further. The report states that this set stands in for "every allowed size".

- [ ] **Step 4: Per-widget checks (spec "Pass criteria per widget")**

- **Clock:**
  - the first placement saves `appearance.themeId === "builtin:bare"` and shows no card frame;
  - colors change after switching between two built-in themes;
  - the time matches local time;
  - the hands move between two screenshots 60 s apart;
  - the five sizes render correctly.
- **Counter:**
  - plus and minus change the value;
  - the value survives a reload of the Orca tab;
  - a new title set in the settings screen is shown.
- **Decorative:**
  - two screenshots 2 s apart differ;
  - it fills its rectangle at the five sizes;
  - it changes with the theme.
- **HTTP:**
  - it shows EUR, GBP and JPY rates;
  - its code refreshes on an interval of 10 minutes (read the deliverable's source, or wait one interval);
  - failure state: read the deliverable's source for a visible error branch. Record `failure state: source only`, because breaking the network for one widget needs system changes this plan does not make.
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
- **Failures:** one subsection per failed run. Each says what happened and which gap in docs, types, skill or `AGENTS.md` it points to, citing the file in `node_modules/@lifedashboard/*/docs/` or the template that should have prevented it.
- **Gaps:** deduplicated, ranked by the number of runs that hit them.
- **How the agents worked without a browser:** decision 9.
- **Not checked:** each item and why, including the size set and the HTTP failure state.
- **Artifacts:** paths under `$ROOT`.

- [ ] **Step 2: Commit the report**

```bash
git add docs/superpowers/reports/2026-10-20-widget-sdk-acceptance-report.md
git commit -m "docs: add the widget SDK acceptance run report"
```

- [ ] **Step 3: Remove the six check widgets**

Remove these instances from `Приёмка SDK`, and their packages from «Виджеты»:
- the decorative, HTTP and secret instances;
- `claude-3` … `claude-5` and `codex-3` … `codex-5`.

The four kept widgets stay. Stop the echo server.

- [ ] **Step 4: Hand back to the user**

Tell the user:
- the report path;
- where the backups are (`$ROOT/backup/`) and that they can be deleted once the user is satisfied;
- that `$ROOT` holds the raw logs and projects.
