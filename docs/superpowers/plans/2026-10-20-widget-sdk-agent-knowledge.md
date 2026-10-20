# Widget SDK Agent Knowledge Implementation Plan (plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installed packages enough for Claude Code and Codex to build a frameless, themed widget from one sentence: a `frame` manifest default, a one-command `create` with human titles, version-matched generated docs, a full `AGENTS.md`, one skill for both agents, a starter prompt in the dashboard and a matching README.

**Architecture:** The `frame` rule lives in `packages/contracts` (manifest parser, `sdk: 3`), so the API, the UI placement, `check`, `build` and the dev shell all read the same field. `create-widget` derives a slug from the title, writes the project, copies its own skill into `.claude/skills/` and `.agents/skills/`, and installs dependencies with the package manager that ran it; its CLI is bundled with Vite so the real `contracts` title check ships with it. The SDK build renders `docs-src/*.md` templates with values taken from `contracts` constants and the generated theme tokens into `docs/`, shipped in the package.

**Tech Stack:** TypeScript strict, Node 24, pnpm 10, Vue 3, Nuxt 4 SPA, Vite 8.3.2, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-20-widget-sdk-agent-knowledge-design.md` (parent: `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md`, section 6).

## Global Constraints

- No new dependencies. One exception, approved by the user on 2026-10-20: `vite` `8.3.2` (already in the lockfile through `@lifedashboard/widget-sdk`) becomes a devDependency of `@lifedashboard/create-widget` to bundle `contracts` into its CLI, as the SDK already does (Task 5).
- Installed `sdk: 1` and `sdk: 2` widgets keep working unchanged; `sdk: 2` manifests without `frame` keep their canonical JSON and package hash.
- `SDK_LEVELS` = `[1, 2, 3]`, `SDK_TARGET_LEVEL` = `3`.
- Manifest field: optional `"frame": "framed" | "frameless"`, default `framed`, requires `sdk: 3`.
- Folder `lifedashboard-<slug>/`; `widget.json` `id` `dev.local.<slug>`; project `package.json` `name` `<slug>`; slug pattern `^[a-z][a-z0-9-]{0,49}$`.
- Skill name `lifedashboard-widget`; installed to `.claude/skills/lifedashboard-widget/SKILL.md` and `.agents/skills/lifedashboard-widget/SKILL.md` as copies, not symlinks.
- Docs entry: `node_modules/@lifedashboard/widget-sdk/docs/index.md`.
- Agent-facing text (docs, `AGENTS.md`, skill, CLI messages) in English; dashboard UI text in Russian.
- CLI error messages name the rule and end with `Fix: …`, as the existing ones do.
- Tests never touch the network; no test runs a real `npm install`.
- No Hermes, data sources, device actions or MCP in any doc, skill or prompt.
- TDD for every behavior change; commit after each task with a conventional subject (`feat(contracts): …`, `feat(create-widget): …`), no attribution trailers.

## Review Focus

1. A Cyrillic title with mixed punctuation, digits and emoji («Часы №1 ⏰») should yield a usable slug (`chasy-no1`), not fail or keep stray dashes — test in Task 4.
2. A title that is only CJK or emoji should fail with the `--slug` hint and create no folder — test in Task 4.
3. A title with quotes or a backslash (`Clock "pro" \ v2`) must produce valid JSON in `widget.json` with the title unchanged — test in Task 4.
4. An agent running `create` without a title and without a TTY must get an error at once, not a hanging prompt — test in Task 5.
5. A manifest with `sdk: 4` and an unknown future field must get «needs a newer LifeDashboard», not «unknown field» — test in Task 1.

---

### Task 1: `frame` manifest field, `sdk: 3`, sdk-first parsing, runtime error-code list

**Files:**
- Modify: `packages/contracts/src/widget-package.ts` (`MANIFEST_KEYS`, `WidgetPackageManifest`, `parseManifest`)
- Modify: `packages/contracts/src/widget-gateway.ts` (`SDK_LEVELS`, `SDK_TARGET_LEVEL`, `WidgetErrorCode`)
- Modify: `packages/create-widget/template/widget.json` (`"sdk": 3`)
- Test: `packages/contracts/test/widget-package.test.ts`, `packages/contracts/test/widget-gateway.test.ts`

**Interfaces:**
- Produces: `WidgetPackageManifest.frame?: 'framed' | 'frameless'` (key absent when the manifest omits it); `SDK_LEVELS = [1, 2, 3] as const`; `SDK_TARGET_LEVEL: SdkLevel = 3`; `WIDGET_ERROR_CODES` (readonly tuple of the 10 existing codes, same order) with `type WidgetErrorCode = (typeof WIDGET_ERROR_CODES)[number]`.

- [ ] **Step 1: Write the failing tests** in `widget-package.test.ts` (use the file's existing valid-manifest helper):
  - `accepts frame at sdk 3 and keeps it`: `{ ...valid, sdk: 3, frame: 'frameless' }` → `ok: true`, `value.frame === 'frameless'`; same for `'framed'`.
  - `omits frame when absent`: `sdk: 3` without `frame` → `'frame' in value === false`.
  - `rejects frame below sdk 3`: `{ sdk: 2, frame: 'frameless' }` → `{ ok: false, error: 'manifest.frame needs sdk 3' }`.
  - `rejects an invalid frame`: `frame: 'none'` and `frame: true` at sdk 3 → `{ ok: false, error: 'manifest.frame must be "framed" or "frameless"' }`.
  - `checks sdk before unknown fields`: `{ ...valid, sdk: 4, future: 1 }` → `{ ok: false, error: 'manifest.sdk 4 needs a newer LifeDashboard (this one supports 1–3)' }`.
  - Update the existing `manifest.sdk 3 needs a newer LifeDashboard (this one supports 1–2)` expectation to `sdk 4 … 1–3`.
  - In `widget-gateway.test.ts`: `WIDGET_ERROR_CODES` equals `['SESSION_EXPIRED', 'UNKNOWN_OP', 'PERMISSION_DENIED', 'INVALID_INPUT', 'RATE_LIMITED', 'CONFLICT', 'TIMEOUT', 'BRIDGE_CLOSED', 'UNAVAILABLE', 'DECLINED']`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C packages/contracts exec vitest run test/widget-package.test.ts test/widget-gateway.test.ts`
Expected: FAIL (unknown field "frame", missing export `WIDGET_ERROR_CODES`).

- [ ] **Step 3: Implement.** In `parseManifest`, move the whole `sdk` block (integer check and the «needs a newer LifeDashboard» branch) above the `unknownKey` check; add `'frame'` to `MANIFEST_KEYS`; after the `settings` sdk check add the two `frame` rules; return `...(frame === undefined ? {} : { frame })` like `network`. Set `SDK_LEVELS`/`SDK_TARGET_LEVEL`; replace the `WidgetErrorCode` union with the tuple and derived type. Set the template `widget.json` `sdk` to `3`.

- [ ] **Step 4: Run the full suites that read SDK levels**

Run: `pnpm -C packages/contracts test && pnpm -C packages/widget-sdk test && pnpm -C packages/create-widget test && pnpm -C apps/api test && pnpm -C apps/ui test`
Expected: PASS after updating hard-coded `sdk: 2` *output* expectations that now come from `SDK_TARGET_LEVEL` (for example `build.test.ts`, `create.test.ts` manifest equality). Fixtures and `examples/widgets/*/widget.json` stay at `sdk: 2`: `build`, `check` and `dev` overwrite the level. Do not change tests that set `pkg.manifest.sdk = 2` on purpose.

- [ ] **Step 5: Commit** — `feat(contracts): add the frame manifest field at sdk 3 and check sdk before unknown fields`

### Task 2: Frameless placement on the board

**Files:**
- Modify: `apps/ui/app/board/edit-session.ts` (add `addInstance`)
- Modify: `apps/ui/app/widgets/catalog.ts` (`SourceInfo.frame`, `describeSource`)
- Modify: `apps/ui/app/board/WidgetBoard.vue:286-295` (`confirmBuild`)
- Test: `apps/ui/test/edit-session.test.ts`, `apps/ui/test/catalog.test.ts`

**Interfaces:**
- Consumes: `WidgetPackageManifest.frame` (Task 1); `BARE_THEME_ID`, `normalizeAppearance` from `@lifedashboard/contracts/board`.
- Produces: `addInstance(doc: ScreenBoard, id: string, source: WidgetSource, rect: Rect, frame: 'framed' | 'frameless' | undefined): ScreenBoard`; `SourceInfo.frame?: 'framed' | 'frameless'`.

- [ ] **Step 1: Write the failing tests**
  - `edit-session.test.ts` › `addInstance`: with `'frameless'` the new instance equals `{ id, source, configVersion: 1, config: {}, appearance: { themeId: 'builtin:bare', shadow: null } }` and the layout gains `{ instanceId: id, ...rect }`; with `'framed'` and `undefined` the instance has no `appearance` key; the input board is not mutated (`structuredClone` comparison, as the file's other tests do); the result passes `parseScreenBoard`.
  - `catalog.test.ts` › `describeSource` returns `frame: 'frameless'` for a package version whose manifest declares it, and no `frame` key for one that does not and for a built-in.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C apps/ui exec vitest run test/edit-session.test.ts test/catalog.test.ts`
Expected: FAIL (`addInstance` is not exported; `frame` missing).

- [ ] **Step 3: Implement** `addInstance` (appearance via `normalizeAppearance({ themeId: BARE_THEME_ID, shadow: null })`), add `frame` to the package branch of `describeSource` only when the manifest has it, and make `confirmBuild` call `save(addInstance(doc.value, id, props.draftSource, rect, describeSource(props.draftSource)?.frame))`.

- [ ] **Step 4: Run** `pnpm -C apps/ui test && pnpm -C apps/ui typecheck` — Expected: PASS.

- [ ] **Step 5: Check the real placement** (the unit tests do not cover the `confirmBuild` wiring). Build a copy of `examples/widgets/hello` in a temporary directory with `"sdk": 3, "frame": "frameless"` added to its `widget.json`, start `pnpm dev`, and in Orca's built-in browser (via `orca-cli`, project rule) install the folder, place it with «Добавить виджет…» and save. Expected: `GET` of the room returns the new instance with `appearance: { themeId: 'builtin:bare', shadow: null }`, and the widget renders without a frame. Report what you saw.

- [ ] **Step 6: Commit** — `feat(ui): place widgets that declare frameless without a frame`

### Task 3: Dev shell starts in the manifest frame

**Files:**
- Modify: `packages/widget-sdk/src/dev/shell-state.ts` (`parseShellState`)
- Test: `packages/widget-sdk/test/shell-state.test.ts`

**Interfaces:**
- Consumes: `WidgetPackageManifest.frame` (Task 1).
- Produces: `parseShellState` unchanged signature; `frame` = URL `frame` when it is `framed` or `frameless`, else `manifest.frame ?? 'framed'`.

- [ ] **Step 1: Write the failing test** `starts in the manifest frame and lets the URL override it`: with `{ ...counter, frame: 'frameless' }`, `parseShellState('', m, themeIds).frame === 'frameless'`, `parseShellState('?frame=framed', m, themeIds).frame === 'framed'`, `parseShellState('?frame=x', m, themeIds).frame === 'frameless'`; with `counter` (no `frame`) `''` → `'framed'`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/widget-sdk exec vitest run test/shell-state.test.ts`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Implement** the frame rule in `parseShellState`.

- [ ] **Step 4: Run** `pnpm -C packages/widget-sdk exec vitest run test/shell-state.test.ts test/dev-parity.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(widget-sdk): start the dev shell in the manifest frame`

### Task 4: `createWidgetProject` with title, slug and the `lifedashboard-` folder

**Files:**
- Create: `packages/create-widget/src/slug.ts`
- Modify: `packages/create-widget/src/create.ts`
- Modify: `packages/create-widget/template/widget.json` (`"id": "dev.local.__SLUG__"`, `"title": "__TITLE__"`), `packages/create-widget/template/package.json` (`"name": "__SLUG__"`)
- Test: `packages/create-widget/test/slug.test.ts`, `packages/create-widget/test/create.test.ts`

**Interfaces:**
- Consumes: `isPlainText` from `@lifedashboard/contracts/parse`.
- Produces:
  - `SLUG_PATTERN = /^[a-z][a-z0-9-]{0,49}$/`
  - `slugFromTitle(title: string): string | null`
  - `createWidgetProject(options: { title: string; slug?: string; parentDir: string; sdk?: string }): Promise<{ dir: string; slug: string }>` — `dir` is `<parentDir>/lifedashboard-<slug>`.

- [ ] **Step 1: Write the failing slug tests** (`slug.test.ts`), table-driven:

```ts
it.each([
  ['Мои суперчасы', 'moi-superchasy'],
  ['Мой ёжик', 'moy-yozhik'],
  ['Café clock', 'cafe-clock'],
  ['Щука и Цапля', 'shchuka-i-tsaplya'],
  ['Їжак Ґудзик', 'yizhak-gudzik'],
  ['Часы №1 ⏰', 'chasy-no1'],
  ['  --Hello__World--  ', 'hello-world'],
  ['Подъезд, объём', 'podezd-obyom'],
])('%j → %s', (title, slug) => expect(slugFromTitle(title)).toBe(slug))

it.each(['時計', '⏰⏰', '123', '', '---'])('%j → null', (title) => expect(slugFromTitle(title)).toBeNull())

it('cuts long titles to 50 characters at a dash boundary', () => {
  const slug = slugFromTitle('word '.repeat(20))!
  expect(slug.length).toBeLessThanOrEqual(50)
  expect(slug).toMatch(SLUG_PATTERN)
  expect(slug.endsWith('-')).toBe(false)
})
```

Table (Ukrainian letters follow the spec list `і ї є ґ ў`): `а a, б b, в v, г g, д d, е e, ё yo, ж zh, з z, и i, й y, к k, л l, м m, н n, о o, п p, р r, с s, т t, у u, ф f, х kh, ц ts, ч ch, ш sh, щ shch, ъ —, ы y, ь —, э e, ю yu, я ya, і i, ї yi, є ye, ґ g, ў u`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/create-widget exec vitest run test/slug.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `slugFromTitle`** in `slug.ts`: lowercase → map each Cyrillic letter by the table (before NFKD, which would split `й` and `ё`) → `normalize('NFKD')` (turns `№` into `No`) → lowercase again → drop `\p{M}` → replace runs of `[^a-z0-9]+` with `-` → trim dashes → if longer than 50, cut to 50 and back to the last dash when one exists in the cut, then trim dashes → return it only when it matches `SLUG_PATTERN`, else `null`.

- [ ] **Step 4: Run** the slug test — Expected: PASS.

- [ ] **Step 5: Rewrite the `createWidgetProject` tests** in `create.test.ts` for the new options and return value:
  - `createWidgetProject({ title: 'Мои суперчасы', parentDir })` → `{ dir: join(parentDir, 'lifedashboard-moi-superchasy'), slug: 'moi-superchasy' }`; `widget.json` `id` `dev.local.moi-superchasy`, `title` `Мои суперчасы`, `sdk` `3`; `package.json` `name` `moi-superchasy`; manifest passes `parseWidgetManifest({ format: 2, ...manifest })`.
  - `slug: 'my-clock'` overrides derivation → folder `lifedashboard-my-clock`, title unchanged.
  - Title boundary cases through both `create` and `parseWidgetManifest`: `'a'.repeat(60)`, `'Clock "pro" \\ v2'` and `'Clock __SDK__ __SLUG__'` are accepted and round-trip exactly through `widget.json`; `''`, `'a'.repeat(61)` and `'bad\u0007title'` reject with `Invalid title "<title>". Fix: use 1–60 characters without control characters.` and create nothing.
  - `title: '時計'` without `slug` rejects with `Cannot derive a Latin name from "時計". Fix: give one with --slug, for example --slug my-clock.` and creates nothing.
  - Invalid `slug` (`'Clock'`, `'1clock'`, `'a'.repeat(51)`) rejects with `Invalid slug "<slug>". Fix: use lowercase letters, digits and dashes, starting with a letter.`
  - Non-empty folder: `Folder lifedashboard-clock already exists and is not empty. Fix: choose another title or --slug, or remove the folder.`
  - Keep the Unicode parent-path, empty-folder and `sdkSpecifier` tests, adapted to the new options.

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm -C packages/create-widget exec vitest run test/create.test.ts -t createWidgetProject`
Expected: FAIL (old signature).

- [ ] **Step 7: Implement** the new `createWidgetProject`: validate the title with `isPlainText`, then the slug (given or derived), then the folder; replace the markers in one pass, `template.replace(/__(TITLE|SLUG|SDK)__/g, (_, key) => escaped[key])`, with JSON-string-escaped values (`JSON.stringify(x).slice(1, -1)`), so a title containing a marker is never substituted again.

- [ ] **Step 8: Run** `pnpm -C packages/create-widget exec vitest run test/slug.test.ts test/create.test.ts -t "createWidgetProject|slug"` — Expected: PASS. (The packed-CLI test is rewritten in Task 5.)

- [ ] **Step 9: Commit** — `feat(create-widget): derive the slug from a title in any language and create lifedashboard-<slug>/`

### Task 5: CLI — title prompt, flags, dependency install, bundled build

**Files:**
- Create: `packages/create-widget/src/install.ts`, `packages/create-widget/src/prompt.ts`, `packages/create-widget/scripts/build.ts`
- Modify: `packages/create-widget/src/cli.ts`, `packages/create-widget/package.json` (`build` → `node scripts/build.ts`, devDependency `vite: 8.3.2`), `packages/create-widget/tsconfig.json` (`include`: `["src", "test", "scripts"]`)
- Delete: `packages/create-widget/tsconfig.build.json` if nothing else uses it
- Test: `packages/create-widget/test/install.test.ts`, `packages/create-widget/test/prompt.test.ts`, `packages/create-widget/test/create.test.ts` (packed-CLI test)

**Interfaces:**
- Consumes: `createWidgetProject` (Task 4).
- Produces:
  - `packageManager(userAgent: string | undefined): 'npm' | 'pnpm' | 'yarn'` — first token's name before `/`; anything else or absent → `'npm'`.
  - `askTitle(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<string>` — asks `Widget title: ` with `node:readline/promises`, returns the trimmed answer.
  - CLI: `create-widget [title] [--slug <slug>] [--sdk <version|path|tarball>] [--no-install]`.

- [ ] **Step 1: Write the failing unit tests**
  - `install.test.ts`: `packageManager('pnpm/10.30.2 npm/? node/v24.21.0 darwin arm64')` → `'pnpm'`; `'yarn/4.5.0 …'` → `'yarn'`; `'npm/11.6.0 node/v24 …'` → `'npm'`; `'bun/1.2 …'` and `undefined` → `'npm'`.
  - `prompt.test.ts`: with `PassThrough` streams, writing `'  Мои часы  \n'` to input resolves `'Мои часы'` and the output contains `Widget title: `.

- [ ] **Step 2: Run to verify they fail** — `pnpm -C packages/create-widget exec vitest run test/install.test.ts test/prompt.test.ts` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** `install.ts` and `prompt.ts`. — **Step 4: Run** them — Expected: PASS.

- [ ] **Step 5: Rewrite the packed-CLI test** in `create.test.ts`. Pack `create-widget` and the SDK as today, then run the packed `dist/cli.js` with `env: { ...process.env, PATH: \`${stub}:${process.env.PATH}\`, npm_config_user_agent: 'npm/11.6.0 node/v24.21.0 darwin arm64' }`, where `stub` holds an executable `npm` shell script that writes its arguments and `pwd` to `$STUB_LOG` and exits with `$STUB_EXIT`. Assertions:
  - `cli.js "Мои часы" --sdk <tarball>` with `STUB_EXIT=0`: exit 0, empty stderr, the stub ran `install` in `<work>/lifedashboard-moi-chasy`, stdout equals
    ```
    Created lifedashboard-moi-chasy/
      title: Мои часы
      id: dev.local.moi-chasy
      package: moi-chasy
    Next: open lifedashboard-moi-chasy/ in Claude Code or Codex; the agent starts from AGENTS.md.
    ```
  - `cli.js "Clock" --no-install` → the stub did not run; stdout ends with `Install dependencies first: cd lifedashboard-clock && npm install`.
  - `STUB_EXIT=1` → exit 1, the project folder exists, stderr is `Dependency install failed. Fix: run "cd lifedashboard-<slug> && npm install".`
  - No title, stdin a pipe (`spawnSync` default) → exit 1 within the timeout, stderr `Missing widget title. Fix: run create-widget "<title>" [--slug <slug>].`
  - Two positionals or an unknown flag → `Invalid arguments. Fix: use create-widget [title] [--slug <slug>] [--sdk <version|path|tarball>] [--no-install].`
  - The packed `package.json` has `files` `['dist', 'template']` (Task 6 adds `skill`) and `dist/cli.js` starts with `#!/usr/bin/env node`; `dist/cli.js` contains no `@lifedashboard/contracts` import.

- [ ] **Step 6: Run to verify it fails** — `pnpm -C packages/create-widget exec vitest run test/create.test.ts -t packs` — Expected: FAIL.

- [ ] **Step 7: Implement.** `scripts/build.ts`: a Vite SSR build of `src/cli.ts` to `dist/cli.js` with `ssr.noExternal: [/^@lifedashboard\/contracts(?:\/|$)/]` and `external: [/^node:/]`, keeping the shebang (follow the CLI build in `packages/widget-sdk/scripts/build.ts`). `cli.ts`: parse args with `node:util` `parseArgs` (`slug`, `sdk` strings, `no-install` boolean, at most one positional); title from the positional, else `askTitle(process.stdin, process.stdout)` when `process.stdin.isTTY`, else the missing-title error; after `createWidgetProject`, unless `--no-install`, run `spawnSync(pm, ['install'], { cwd: dir, stdio: 'inherit' })` and map a non-zero status or spawn error to the install-failed message; print the success message.

- [ ] **Step 8: Run** `pnpm -C packages/create-widget test && pnpm -C packages/create-widget typecheck` — Expected: PASS.

- [ ] **Step 9: Commit** — `feat(create-widget): ask for a title on a TTY and install dependencies with the calling package manager`

### Task 6: Skill and full `AGENTS.md` in the template

**Files:**
- Create: `packages/create-widget/skill/lifedashboard-widget/SKILL.md`
- Modify: `packages/create-widget/template/AGENTS.md`, `packages/create-widget/src/create.ts` (copy the skill), `packages/create-widget/package.json` (`files`: `["dist", "template", "skill"]`)
- Test: `packages/create-widget/test/create.test.ts`

**Interfaces:**
- Consumes: `createWidgetProject` (Task 4); docs page names from Task 7 (`index.md`, `api.md`, `runtime.md`, `errors.md`, `design.md`, `settings.md`, `recipes.md`, `workflow.md`).
- Produces: projects contain `.claude/skills/lifedashboard-widget/SKILL.md` and `.agents/skills/lifedashboard-widget/SKILL.md`, byte-identical to the package's `skill/lifedashboard-widget/SKILL.md`.

- [ ] **Step 1: Write the failing tests** in `create.test.ts`:
  - The created project's file list (existing exact-list test) gains both skill paths; both files equal the package source and are regular files (`lstat(...).isSymbolicLink() === false`).
  - `SKILL.md` starts with `---\nname: lifedashboard-widget\ndescription: ` and has a closing `---` line.
  - `AGENTS.md` contains each of: `node_modules/@lifedashboard/widget-sdk/docs/index.md`, `widget.state`, `widget.http.get`, `widget.http.send`, `network`, `WebM`, `Opus`, `assets/`, `var(--ld-`, `context.size`, `sizeClass`, `context.frame`, `context.visible`, `"frame": "frameless"`, `npx ld-widget dev`, `npx ld-widget check`, `npx ld-widget build`, `.ld-widget/`, `dist/<id>-<version>/`, `Виджеты → Выбрать папку`; it does not contain `dist/types` (the old pointer), `Hermes` or `MCP`; it is at most 60 lines.
  - The packed-CLI test asserts `files` `['dist', 'template', 'skill']` and that the skill is in the pack.

- [ ] **Step 2: Run to verify they fail** — `pnpm -C packages/create-widget exec vitest run test/create.test.ts` — Expected: FAIL.

- [ ] **Step 3: Write `AGENTS.md`** (English, one screen): what the project is; the rules behind most failures, each with the replacement API (no browser storage → `widget.state` with the `state` permission; external HTTP only through `widget.http.get/send` with the `network` permission and the origin in `network`; files only from the widget folder; media by URL from `assets/` as WebM (VP9 + Opus) / Opus; only `var(--ld-…)` theme tokens; adapt to `context.size`, `sizeClass`, `context.frame`; pause animation when `context.visible` is false; declare `"frame": "frameless"` for object-like widgets such as clocks and draw no card background then); the workflow (`npx ld-widget dev`, open the shell at min/default/max size × every theme × framed/frameless, read the dev log in `.ld-widget/`, then `npx ld-widget check`, then `npx ld-widget build`); where the docs index is; what to hand over (`dist/<id>-<version>/`, imported via «Виджеты → Выбрать папку»). Check the exact dev log file name in `packages/widget-sdk/src/dev/log.ts` and name it.

- [ ] **Step 4: Write `SKILL.md`**: frontmatter `name: lifedashboard-widget` and a `description` that says when to use it (building or changing a LifeDashboard widget in this project, and before handing a built folder to the user); body: the step-by-step workflow from `AGENTS.md`, one line per docs page saying when to open it, and that the docs in `node_modules` win when they differ from this skill.

- [ ] **Step 5: Implement the copy** in `createWidgetProject` (`cp` with `recursive`, `errorOnExist`, both targets) and add `skill` to `files`.

- [ ] **Step 6: Run** `pnpm -C packages/create-widget test` — Expected: PASS.

- [ ] **Step 7: Commit** — `feat(create-widget): install the widget skill for Claude Code and Codex and expand AGENTS.md`

### Task 7: Generated package docs

**Files:**
- Create: `packages/widget-sdk/docs-src/{index,api,runtime,errors,design,settings,recipes,workflow}.md` (templates), `packages/widget-sdk/docs/*.md` (rendered, committed), `packages/widget-sdk/scripts/docs.ts`
- Modify: `packages/widget-sdk/scripts/build.ts` (fail on stale docs), `packages/widget-sdk/package.json` (`files`: `["dist", "docs"]`; script `"docs": "node scripts/docs.ts"`)
- Test: `packages/widget-sdk/test/docs.test.ts`, `packages/widget-sdk/test/pack.test.ts`

Rendered docs are committed so the README can link them and GitHub shows real numbers. `pnpm -C packages/widget-sdk docs` rewrites `docs/`; the build (and so `prepack`) throws `Docs are stale. Fix: run pnpm -C packages/widget-sdk docs.` when `docs/` differs from a fresh render, so a pack never ships stale docs. Any later change to a constant used by the docs must rerun the script.

**Interfaces:**
- Consumes: `WIDGET_ERROR_CODES`, `SDK_LEVELS`, `SDK_TARGET_LEVEL` (Task 1); `contracts` constants; `sandboxDocument`; `extractThemeTokens` from `src/dev/themes.ts` over `apps/ui/app/theme/styles/themes/*.css`, as `build.ts` does.
- Produces:
  - `themeTokenNames(): Promise<string[]>` — sorted union of token names over the built-in themes.
  - `docValues(themeTokens: readonly string[]): Promise<Record<string, string>>` — numbers as `String(n)`.
  - `renderDocs(pages: ReadonlyMap<string, string>, values: Readonly<Record<string, string>>): Map<string, string>` — replaces `{{KEY}}`; throws `Unknown docs placeholder {{KEY}} in <page>` for a key not in `values` and `Docs value KEY is not used by any page` for an unused key.
  - `freshDocs(): Promise<Map<string, string>>` — reads `docs-src/`, renders with `docValues(await themeTokenNames())`; used by the script, the build check and the tests.

`docValues` keys (each a Markdown-ready string): `SDK_TARGET_LEVEL`, `SDK_LEVELS`, `PERMISSIONS`, `GATEWAY_OPS` (table: operation | permission | confirmation policy), `RATE_LIMITS` (table: operation | max | window), `STATE_MAX_BYTES`, `NOTIFICATION_TITLE_MAX`, `NOTIFICATION_BODY_MAX`, `HTTP_URL_LENGTH`, `HTTP_HEADER_VALUE_LENGTH`, `HTTP_BODY_BYTES`, `HTTP_RESPONSE_BYTES`, `HTTP_TIMEOUT_MS`, `HTTP_ANSWER_BYTES`, `HTTP_SEND_METHODS`, `NETWORK_ORIGINS_MAX`, `BRIDGE_MAX_MESSAGE_BYTES`, `BRIDGE_REQUEST_TIMEOUT_MS`, `BRIDGE_CONFIRM_TIMEOUT_MS`, `BRIDGE_MAX_IN_FLIGHT`, `CONFIRMATION_TTL_MS`, `CODE_BYTES`, `VUE_RANGE` (the SDK `peerDependencies.vue`), `TITLE_MAX`, `SETTINGS_PROPERTIES`, `SETTINGS_DESCRIPTION_LENGTH`, `SETTINGS_ENUM_ITEMS`, `SETTINGS_MAX_LENGTH`, `SECRET_MIN_LENGTH`, `REDACTED`, `GRID_COLS`, `ROWS_MAX`, `ERROR_CODES`, `THEME_TOKENS`, `CSP` (directives of `sandboxDocument({ runtime: '<runtime>/', packageDir: '<widget>/', entry: '<widget>/index.js' }, [])`, one per line, the `sha256-…` value replaced with `sha256-<import map hash>`).

- [ ] **Step 1: Write the failing tests** (`docs.test.ts`):
  - `renderDocs` replaces keys, throws the unknown-placeholder and unused-value errors (exact messages above).
  - `freshDocs()` succeeds and leaves no `{{` in any page; the committed `docs/` has exactly the same file names and contents (the drift check).
  - `Object.keys(docValues(...)).sort()` equals the full key list above (so a dropped limit fails); every value is a non-empty string; `values.STATE_MAX_BYTES === String(STATE_MAX_BYTES)`, `values.HTTP_ANSWER_BYTES === String(HTTP_LIMITS.answerBytes)`, `values.BRIDGE_CONFIRM_TIMEOUT_MS === String(BRIDGE_LIMITS.confirmTimeoutMs)`, `values.VUE_RANGE === '^3.5.0'` read from `package.json`.
  - `errors.md` has a `### <CODE>` heading for each of `WIDGET_ERROR_CODES` and no other `###` code headings.
  - `api.md` mentions every `GATEWAY_OPS` key, `useWidget`, `widget.state.get`, `widget.state.set`, `widget.notify`, `widget.http.get`, `widget.http.send`, `widget.call`, and every `WidgetContext` field (`size`, `sizeClass`, `frame`, `theme`, `rootFontSize`, `config`, `locale`, `visible`).
  - `index.md` links every other page; no page contains `Hermes`, `MCP`, `apps/` or `packages/contracts`.
  - `pack.test.ts`: the pack contains `docs/<page>.md` for all eight pages and no `docs-src/`.

- [ ] **Step 2: Run to verify they fail** — `pnpm -C packages/widget-sdk exec vitest run test/docs.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scripts/docs.ts`** (when run directly: replace `docs/` with `freshDocs()`) and the stale check in `build.ts`.

- [ ] **Step 4: Write the pages** (English; numbers only through placeholders; signatures by pointing at `dist/types/widget-sdk/src/index.d.ts`, never at platform sources):
  - `index.md`: one line per page; the minimum project layout.
  - `api.md`: `useWidget()`, every context field, `state`, `notify`, `http`, `call` with permissions and limits; the `GATEWAY_OPS` and `RATE_LIMITS` tables; `sdk` levels and what each adds (2: settings, typed HTTP, `frame`; 3: the `frame` manifest field).
  - `runtime.md`: sandbox and CSP in plain words with the `CSP` block (no storage APIs → `state`; no Web Notifications → `notify`; files only from the widget folder; media by URL from `assets/`; workers from `blob:` only; HTTP only through the gateway); the runtime baseline from the parent spec section 7 (intersection of WebKit 18.6 and WebKitGTK 2.50; WebM VP9 + Opus; WebGL 2, WebGPU only as an enhancement; `backdrop-filter` only as an enhancement); dependencies: the host provides Vue `{{VUE_RANGE}}`, a widget must not bundle its own Vue, third-party npm libraries are allowed and bundled if they are browser ESM without Node APIs and the code stays within `{{CODE_BYTES}}` bytes. Before writing the `requestIdleCallback` and `scheduler.postTask` lines, check them on MDN (WebFetch `https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback` and `https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask`); if unreachable, say so in the task report.
  - `errors.md`: one `### CODE` per error code: when it happens, what the widget should do.
  - `design.md`: theme tokens (the `THEME_TOKENS` list; meaning from `docs/theme-contract.md`), grid sizing (`GRID_COLS` columns, `sizing` in cells, size classes), `rem` and `rootFontSize`, framed vs frameless and the `frame` manifest field: when to declare `frameless` (decorative, object-like widgets: clocks, gauges, stickers) and that a frameless widget draws its own background or none, using tokens.
  - `settings.md`: the schema subset with limits and examples, secret settings and `REDACTED`.
  - `recipes.md`: visibility-aware animation (an analog clock that pauses when `context.visible` is false and is frameless); adapting to `sizeClass`; polling HTTP with backoff on `RATE_LIMITED`/`TIMEOUT`/`UNAVAILABLE`; revision conflicts on `CONFLICT`.
  - `workflow.md`: `create` → `dev` (shell combinations, dev log) → `check` (`.ld-widget/check.json`) → `build` → hand over `dist/<id>-<version>/`; sharing a project vs a built folder; the declared dev-shell differences from production; final engine checks in Safari (macOS) and GNOME Web (Linux) for widgets with media.

- [ ] **Step 5: Render and run** `pnpm -C packages/widget-sdk docs && pnpm -C packages/widget-sdk test && pnpm -C packages/widget-sdk typecheck` — Expected: PASS.

- [ ] **Step 6: Commit** `docs-src/`, `docs/`, `scripts/`, tests and `package.json` — `feat(widget-sdk): ship docs generated from the platform constants`

### Task 8: Starter prompt in the packages dialog

**Files:**
- Create: `apps/ui/app/widgets/starter-prompt.ts`
- Modify: `apps/ui/app/widgets/PackagesDialog.vue` (list view, before the bottom `packages__actions`)
- Test: `apps/ui/test/starter-prompt.test.ts`

**Interfaces:**
- Produces: `CREATE_COMMAND = 'npm create @lifedashboard/widget "Название виджета"'`; `AGENT_TASK = 'Сделай виджет LifeDashboard: <что он показывает и как выглядит>. Следуй AGENTS.md.'`

- [ ] **Step 1: Write the failing test**: `CREATE_COMMAND` starts with `npm create @lifedashboard/widget `; `packages/create-widget/package.json` `name` is `@lifedashboard/create-widget` (the `npm create` mapping); `AGENT_TASK` contains `AGENTS.md`.

- [ ] **Step 2: Run to verify it fails** — `pnpm -C apps/ui exec vitest run test/starter-prompt.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the module and a block in the list view: subtitle «Создать свой виджет», a line «1. Создайте проект:» with `<code class="packages__path">{{ CREATE_COMMAND }}</code>` and a «Копировать» button using the existing `copy()`; a line «2. Откройте папку в Claude Code или Codex и напишите:» with `AGENT_TASK` the same way. Reuse existing `packages__*` classes; the `<code>` text stays selectable as the fallback when the clipboard fails.

- [ ] **Step 4: Run** `pnpm -C apps/ui test && pnpm -C apps/ui typecheck` — Expected: PASS. Then open the dialog in Orca's browser (`pnpm dev`, project rule: Orca's built-in browser via `orca-cli`) and check both copy buttons. Then build the desktop app (`pnpm -C apps/desktop run package`), open the dialog there and check both copy buttons in WKWebView; if copying fails, confirm the `<code>` text can be selected and copied by hand and that the failed copy leaves no unhandled error in the console. Report both results.

- [ ] **Step 5: Commit** — `feat(ui): show a starter prompt for creating a widget`

### Task 9: README

**Files:**
- Modify: `README.md` («Widget SDK», «Creating widgets with Claude Code, Codex, or other AI tools», «Security and privacy» if it lists manifest fields)

- [ ] **Step 1: Edit.** In «Widget SDK» add the `frame` field and `sdk: 3` where manifest fields are described, and `create-widget` to the tool list. Replace the «on the roadmap» sentence and the monorepo example prompt with a quickstart: `npm create @lifedashboard/widget "<title>"` → open the folder in Claude Code or Codex → one sentence → import `dist/<id>-<version>/`; link `packages/widget-sdk/docs/index.md`; one line saying the command works once the packages are published. Add one contributor paragraph: before publishing, `pnpm -C packages/widget-sdk pack` and `pnpm -C packages/create-widget pack`, then `node <unpacked create-widget>/dist/cli.js "<title>" --sdk <sdk tarball>`. Remove any claim that contradicts shipped behavior.

- [ ] **Step 2: Verify** the commands in the contributor paragraph by running them in a temporary directory with `--no-install`; documentation-only otherwise, no application tests.

- [ ] **Step 3: Commit** — `docs: point the README at the widget create flow and package docs`

### Task 10: Whole-repo check

- [ ] **Step 1: Run** `pnpm typecheck && pnpm test` from the repository root — Expected: PASS. Report pre-existing unrelated failures separately, with output.
- [ ] **Step 2: Build and pack** `pnpm -C packages/widget-sdk pack` and `pnpm -C packages/create-widget pack`; in a temporary directory run the unpacked CLI with `"Мои суперчасы" --sdk <sdk tarball> --no-install` and confirm `lifedashboard-moi-superchasy/` has both skill copies, `AGENTS.md`, `widget.json` with `sdk: 3`; report the listing.
