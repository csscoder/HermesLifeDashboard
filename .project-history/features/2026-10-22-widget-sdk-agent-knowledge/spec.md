# Widget SDK agent knowledge (plan 3) — design

Date: 2026-10-20. Status: approved (implemented by plan 2026-10-20-widget-sdk-agent-knowledge).

Parent spec: `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md` (section 6 «Agent knowledge»). This document is the design for plan 3 of that series. Where the two differ, this one wins; the differences are listed in «Changes to the parent spec».

## Intent

Plans 1, 2a and 2b delivered the platform gaps, the publishable SDK package, `create`, `check`, `build` and the dev shell. An agent working in a fresh widget project still does not know the platform: the template `AGENTS.md` is a 13-line cheat sheet that points to JSDoc, the package has no docs, there is no skill, and the dashboard gives the user no starting point.

Plan 3 makes the installed packages enough for Claude Code and Codex to build a good widget on the first attempt, from one sentence, without reading LifeDashboard sources. It also removes two obstacles found while designing it: the user has to run `npm install` by hand and pick a technical name, and a widget cannot ask to be shown without a frame.

## Success and failure

- **Reference task (user's words):** an analog clock that looks like it sits on the desktop.
- **Success (user's words, confirmed):** the user runs one command, opens the folder in Claude Code or Codex, writes one sentence, and imports the folder the agent hands back. The clock works at once: frameless, in the current theme's colors, at every allowed size.
- **Failure (user's words):** the clock looks like an ordinary card with a frame. This counts as failure even if everything else works.
- **Failure (inherited):** the agent opens dashboard sources.
- Proving this with a fresh agent is plan 4 (acceptance run), not this plan. Plan 3 is done when the deliverables below exist and their tests pass.

## Decisions made by the user (this conversation)

1. Both Claude Code and Codex must work on the first attempt.
2. The end user works only with the published packages, never with a LifeDashboard clone: `npm create @lifedashboard/widget …`. A clone and tarballs are only for the time before publishing (the user's own checks, plan 4).
3. `create` installs the project's dependencies itself, so one command is enough.
4. The user gives the widget a name in any language. The technical name is derived from it automatically: transliterated when it is not English; when that is not possible, the user must give a Latin name. Automatic translation to English is not wanted at the cost of complexity.
5. The `lifedashboard-` prefix goes only into the folder name, not into the widget id or the project's package name.
6. A widget can declare in its manifest that it is shown frameless by default. This platform change is part of plan 3.

## Goals

- `create` with a human title, a derived slug, the `lifedashboard-<slug>` folder and automatic dependency install.
- Manifest field for the default frame, applied when the widget is placed on a board, reflected in the dev shell and the docs.
- Version-matched docs inside `@lifedashboard/widget-sdk`, with every number generated from the platform constants and a test that fails when they drift.
- Full template `AGENTS.md` (cross-agent baseline) and one skill installed for both Claude Code and Codex.
- A copyable starter prompt in the dashboard's widget packages dialog.
- README SDK section that matches what is shipped.

## Non-goals

- The acceptance run with a fresh agent (plan 4).
- Publishing to npm and a release pipeline (parent decision 11).
- Translating titles; transliteration of scripts other than Cyrillic and Latin with diacritics.
- Agents other than Claude Code and Codex beyond what the `AGENTS.md` baseline gives them for free.
- MCP server, marketplace, CLI ↔ dashboard connection (parent non-goals).
- Any new gateway capability, permission or widened network reach.

## Anti-goals

- A widget meant to look like a desktop object that lands on the board as a framed card.
- Docs that state a limit, list or token name differing from the enforced constant.
- Docs or skill that promise API surface the SDK does not deliver (Hermes, data sources, device actions).
- An agent that has to read compiled runtime JS or LifeDashboard sources to finish the task.
- A `create` that hangs waiting for input when an agent runs it non-interactively.

## Current state (facts from the repo, 2026-10-20)

- `packages/create-widget/src/cli.ts`: `create-widget <name> [--sdk …]`; one required positional; `name` must match `^[a-z][a-z0-9-]{0,49}$` and becomes the folder name, `widget.json` `id` (`dev.local.<name>`) and `title`. It prints `cd`, `npm install`, `npx ld-widget check`. It does not install.
- `create` refuses a non-empty target folder; the SDK specifier defaults to `create-widget`'s own version (`sdkSpecifier`), so both packages must be published in matching versions.
- Template: `widget.json`, `package.json`, `tsconfig.json`, `widget-env.d.ts`, `src/`, `gitignore`, `AGENTS.md` (13 lines), `CLAUDE.md` (`@AGENTS.md`).
- `packages/widget-sdk/package.json` `files` is `["dist"]`; there is no `docs/` and no skill.
- Platform constants live in `packages/contracts`: `HTTP_LIMITS`, `HTTP_SEND_METHODS`, `STATE_MAX_BYTES`, `NOTIFICATION_TITLE_MAX`, `NOTIFICATION_BODY_MAX`, `RATE_LIMITS`, `CONFIRMATION_TTL_MS`, `BRIDGE_LIMITS`, `PACKAGE_LIMITS`, `NETWORK_ORIGINS_MAX`, `SETTINGS_LIMITS`, `SECRET_MIN_LENGTH`, `WIDGET_PERMISSIONS`, `GATEWAY_OPS`, `GRID_COLS`, `ROWS`, `SDK_LEVELS`, `SDK_TARGET_LEVEL` (2); `WidgetErrorCode` has 10 codes; the CSP comes from `sandbox-document.ts`. The SDK build already generates theme tokens (`dist/dev/themes.json`) from `apps/ui/app/theme`.
- Frame: `WidgetHost.vue:44` sets `context.frame` to `frameless` only when the instance appearance is `builtin:bare` (`BARE_THEME_ID`); bare keeps the board's theme tokens (`theme/resolve.ts:24`). A new instance is created without appearance (`WidgetBoard.vue:292`), so every widget starts framed. The dev shell has a framed/frameless toggle.
- `parseManifest` rejects unknown keys; `settings` already requires `sdk: 2`, and an `sdk` above the supported range gets «needs a newer LifeDashboard». `build` and `check` write and check `SDK_TARGET_LEVEL`.
- The import UI is `apps/ui/app/widgets/PackagesDialog.vue` («Виджеты → Выбрать папку»).
- `README.md` still says starter templates, self-contained docs, preview tooling and agent instructions are «on the roadmap», and its example prompt points agents at `packages/widget-sdk` and `examples/widgets/hello` in the monorepo.

## Design

### 1. `create`: title, slug, folder, install

Command: `npm create @lifedashboard/widget [title] -- [--slug <slug>] [--sdk <version|path|tarball>] [--no-install]` (bin `create-widget [title] [options]`).

- **Title.** Optional positional. When missing and stdin is a TTY, `create` asks for it (`node:readline`). When missing and stdin is not a TTY, it fails with a directed error naming the argument, so an agent never hangs. The title goes into `widget.json` `title` unchanged and must pass the manifest's plain-text title rule (1–60 characters). `contracts` is private, so the published `create-widget` gets the real check from `contracts` at build time (bundled or generated, as the SDK bundles `contracts`; mechanism left to the builder), never a hand copy, so `create` never accepts a title that `check` rejects. A test runs the boundary cases (empty, 60 and 61 characters, markup and control characters) through both.
- **Slug** (my call on the exact rules). Without `--slug`: lowercase the title; transliterate Cyrillic with a built-in table (Russian alphabet plus Ukrainian/Belarusian `і ї є ґ ў`; `ё→yo й→y ж→zh х→kh ц→ts ч→ch ш→sh щ→shch ы→y э→e ю→yu я→ya`, `ъ ь` dropped); decompose with `normalize('NFKD')` and drop combining marks; replace every run of other characters with `-`; trim dashes; cut to 50 characters at a dash boundary when possible. The result must match the existing `^[a-z][a-z0-9-]{0,49}$`; if not (empty, starts with a digit, CJK, emoji), fail with «give a Latin name: --slug my-clock». `--slug` is validated by the same pattern and skips derivation. Examples: «Мои суперчасы» → `moi-superchasy`; «Мой ёжик» → `moy-yozhik`; «Café clock» → `cafe-clock`.
- **Names.** Folder `lifedashboard-<slug>/`; `widget.json` `id` `dev.local.<slug>`; project `package.json` `name` `<slug>`. `create` prints all three.
- **Install.** After writing the files, `create` runs `<pm> install` in the project with inherited output. `<pm>` is the package manager that ran `create`, read from `npm_config_user_agent` (`npm`, `pnpm`, `yarn`; anything else or absent → `npm`). `--no-install` skips it. If the install fails, the project stays on disk and `create` exits non-zero with the exact command to rerun.
- **Final message.** The path, «open this folder in Claude Code or Codex», and that the agent starts from `AGENTS.md`.
- The existing non-empty-folder refusal stays; two widgets with the same slug cannot overwrite each other.
- Tests do not touch the network: they use `--no-install` or a stub package manager; the builder decides how.

### 2. Default frame from the manifest

- **Field** (my call on the name): optional top-level `"frame": "framed" | "frameless"` in `widget.json`, default `framed`. The values match `context.frame`.
- **SDK level** (my call): the field needs `sdk: 3`, following the `settings` → `sdk: 2` precedent. `SDK_LEVELS` becomes `[1, 2, 3]` and `SDK_TARGET_LEVEL` 3. Dashboards released before this change reject such a manifest with `unknown field "frame"`, because today's `parseManifest` checks unknown keys before `sdk` (`widget-package.ts:207–219`); a new SDK cannot change an installed parser. To make future level bumps diagnosable (my call), `parseManifest` checks `sdk` before unknown keys from now on, so a dashboard with this change answers a higher-level manifest with «needs a newer LifeDashboard». Consequence: every widget built with the new SDK needs a dashboard that supports level 3. Accepted because nothing is published yet; the builder confirms no other level-3 rule is needed.
- **Effect.** When an instance of a package whose manifest says `frameless` is placed on a board, it is created with appearance `{ themeId: BARE_THEME_ID, shadow: null }` (exact shape per `normalizeAppearance`). This happens only at creation. The user can change the frame afterwards as today. A new package version that changes `frame` does not touch existing instances. Board export/import is unchanged, since appearance already persists.
- **Dev shell.** Starts in the manifest's frame; the URL parameter and the toggle still override it. A test checks that the shell's initial frame equals the manifest default.
- **`check`.** Validates the field through the shared parser. No heuristic warnings.
- **Docs.** The design page states when to declare `frameless` (decorative, object-like widgets: clocks, gauges, stickers) and that a frameless widget draws its own background or none, using theme tokens.

### 3. Package docs

- Location: `node_modules/@lifedashboard/widget-sdk/docs/`; `files` gains `docs`. Source under `packages/widget-sdk/` (layout left to the builder).
- Content: the topics of the parent spec section 6 (levers; runtime restrictions; runtime baseline; error codes; design: theme tokens, grid sizing, framed vs frameless, `rem` scaling; settings; recipes; workflow `dev → check → build → import`), plus the `frame` field. Recipes include, at minimum: visibility-aware animation (pause when `context.visible` is false), adapting to `sizeClass`, a frameless object-like widget, polling HTTP with backoff, revision conflicts.
- An index file lists every page with one line each, so `AGENTS.md` and the skill point to one entry.
- Every limit, list, error code, permission, token name, grid size, rate limit and CSP entry comes from the platform constants at SDK build time (`contracts`, generated theme tokens, `sandboxDocument`). A test fails when the built docs differ from a fresh generation or when a constant is not represented. Mechanism left to the builder.
- Docs reference the shipped `.d.ts` files for exact signatures; they never tell the agent to read platform sources or compiled runtime JS.
- Facts marked unverified in the parent research record (`requestIdleCallback`, `scheduler.postTask`) are checked on MDN while writing.
- Language: English.

### 4. Template `AGENTS.md` and `CLAUDE.md`

- `AGENTS.md` stays short (my call: one screen): what the project is; the rules behind most failures (no browser storage → `state`; HTTP only through `widget.http` with declared origins; files only from the widget folder; media by URL from `assets/` as WebM/Opus; theme tokens only; respect size, `sizeClass`, `frame`, `visible`; declare `"frame": "frameless"` for object-like widgets); the workflow including which dev-shell combinations to open and the dev log path; where the docs index is; what to hand to the user.
- `CLAUDE.md` stays `@AGENTS.md`. Codex reads `AGENTS.md` natively; Claude Code gets it through the import.
- Language: English.

### 5. Skill

- One skill source in `@lifedashboard/create-widget` (my call; for example `skill/lifedashboard-widget/SKILL.md`, shipped in `files`). Not in the SDK: `create-widget` has no runtime dependency on the SDK, and the SDK is not installed yet when `create` writes files (never with `--no-install`). The skill therefore matches the `create-widget` version; this is the accepted lag below. Frontmatter `name` and `description`, both present because Codex requires them.
- `create` copies it into `.claude/skills/lifedashboard-widget/` (Claude Code) and `.agents/skills/lifedashboard-widget/` (Codex). Copies, not symlinks (my call): symlinks can break when a project is copied or zipped.
- Content: when to use it (building or changing a LifeDashboard widget), the step-by-step workflow, and pointers to the docs index. It is thin and defers to the docs, which are version-matched; a skill copied at `create` time can lag behind a later SDK upgrade.
- Both directories are dotfiles, so the existing `source/` allow-list keeps them out of built folders. Unchanged.

### 6. Starter prompt in the packages dialog

- `PackagesDialog.vue` gets a «create your own widget» block with two copyable parts: the command `npm create @lifedashboard/widget "<название>"`, and a one-sentence task template for the agent (for example «Сделай виджет: <что он делает и как выглядит>. Следуй AGENTS.md.»).
- Language follows the dashboard UI, Russian (my call): the user reads and pastes it.
- Copy uses the Clipboard API with a fallback of selectable text; the builder checks it in the desktop app.

### 7. README

- Replace the «on the roadmap» sentence and the monorepo-based example prompt with a quickstart: `npm create @lifedashboard/widget "<title>"` → open in Claude Code or Codex → one sentence → import `dist/<id>-<version>/`. Link to the package docs. One line says the command works once the packages are published and points to the tarball paragraph until then.
- One paragraph for contributors: before publishing, scaffold from `pnpm pack` tarballs (`--sdk <tarball>`).
- Mention the `frame` manifest field and `sdk: 3` where the SDK table lists manifest fields.

## Changes to the parent spec

- Parent section 6 «a skill ships in the SDK package; create installs it for Claude Code» → the skill ships in `create-widget`; create installs it for Claude Code and Codex.
- Parent «Bootstrapping»: `create` is non-interactive by default → non-interactive whenever the title is given or stdin is not a TTY; it prompts only on a TTY without a title. It now installs dependencies.
- Parent decision «frameless is the theme `builtin:bare`; the widget is told via `frame`» gains a manifest default.
- `SDK_TARGET_LEVEL` 2 → 3.

## Constraints

- No new dependencies (hard stop). Transliteration, prompting and install use the standard library.
- TypeScript strict, Node 24, pnpm 10; tests in Vitest; TDD per the user's rules.
- Installed `sdk: 1` and `sdk: 2` widgets keep working unchanged.
- Agent-facing artifacts in English; dashboard UI text in Russian.

## Left to the builder

- Docs file layout, page wording, the docs generation mechanism, and the drift test's shape.
- Skill wording and its file name inside the package.
- The prompt's input mechanics and the package-manager stub in tests.
- Placement and look of the starter-prompt block in `PackagesDialog.vue`.
- Implementation split into tasks.

## Research record (checked 2026-10-20 via Perplexity search; URLs returned HTTP 200, page contents not fetched)

- Codex reads `AGENTS.md` automatically and discovers repository skills in `.agents/skills/<name>/SKILL.md` from the working directory up to the repository root; `name` and `description` frontmatter are required; `.codex/skills` is older material: https://developers.openai.com/codex/skills.
- Claude Code discovers project skills only in `.claude/skills/<name>/SKILL.md` (startup directory and parents up to the repository root), not in `.agents/skills`; frontmatter fields are optional, `description` drives automatic use: https://code.claude.com/docs/en/skills. `@AGENTS.md` inside `CLAUDE.md` imports shared instructions: https://code.claude.com/docs/en/memory.
- `npm create <@scope/name>` runs the package `<@scope/create-name>`; arguments after `--` reach the initializer: https://docs.npmjs.com/cli/v11/commands/npm-init.
