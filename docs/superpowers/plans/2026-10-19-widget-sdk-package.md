# Widget SDK Package Implementation Plan (plan 2a of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@lifedashboard/widget-sdk` and a new `@lifedashboard/create-widget` work outside the monorepo as `pnpm pack` tarballs, with a typed `config`, a safe `source/`, and a static `ld-widget check`.

**Architecture:** The SDK keeps source exports for the workspace and switches to compiled `dist/` exports through `publishConfig`, which `pnpm pack` applies. `@lifedashboard/contracts` stays private and is bundled into the SDK JS and declarations. `check` is a Node module in the SDK that runs without a browser. It parses sources with the project's own `typescript`, type-checks with the project's own `vue-tsc`, and reuses `buildWidget`.

**Tech Stack:** TypeScript 6.0.3 (strict), Node 24, pnpm 10.30.2, Vite 8.3.2 + rolldown, `@vitejs/plugin-vue` 6.0.9, Vue 3.5.43, vue-tsc 3.3.12, Vitest 5.0.3.

**Spec:** `docs/superpowers/specs/2026-10-18-widget-sdk-agent-ready-design.md`. This plan covers the following:
- section 1 (package shape and distribution);
- the generated config declaration from section 3;
- section 5 (`check`);
- section 8 (safe `source/`);
- the `create` part of «Bootstrapping».

Plan 2b (`2026-10-19-widget-sdk-dev-shell.md`) covers section 4 (dev shell and dev gateway). It builds on this plan.

## Global Constraints

- **No new dependencies** (user's hard stop). Allowed changes:
  - `vite` 8.3.2 and `@vitejs/plugin-vue` 6.0.9 move from devDependencies to `dependencies` of `@lifedashboard/widget-sdk`.
  - `vue` becomes a peer dependency `^3.5.0`, and stays a devDependency at 3.5.43.
  - `typescript` 6.0.3, `vue-tsc` 3.3.12 and `vue` 3.5.43 are added as devDependencies of example widgets and of the project template. These are versions the workspace already uses (`packages/widget-sdk`, `apps/ui`), not new dependencies.
  - Tests may call the system `tar` and `pnpm`. Task 6 may call `ffmpeg` once to encode `bg.webm`. None of these becomes a package dependency.
- **Deliverable:** `pnpm pack` tarballs of both packages. `publishConfig` overrides of `exports`, `bin` and `types` apply only through `pnpm pack`/`pnpm publish`, so the user publishes the tarballs, for example `npm publish lifedashboard-widget-sdk-0.1.0.tgz`. Publishing and a release pipeline are out of scope (spec decision 11).
- **Versions:** both packages are `0.1.0` and versioned in lockstep. The manifest `sdk` level stays `2`, independent of the npm version.
- **`dist/sandbox.js` path is fixed:** `apps/api/src/sandbox.ts` (`RUNTIME_FILES`) and `apps/api/scripts/copy-runtime.mjs` read it. One `dist/` is shared by several builds: clean it once at the start of the build script and never with `emptyOutDir` in a later step.
- **Error messages name the rule and the fix**, for example `"localStorage" does not work in the widget sandbox (no storage). Fix: use widget.state.get/set.`
- **`check` must never fail on something the agent cannot fix inside its project.** Forbidden names and URLs are matched on the TypeScript AST, never inside comments or strings.
- **Existing `sdk: 1` widgets keep working.** Runtime behaviour does not change. Only types and the build tool change.
- **Example manifests:** any change that alters a built example folder (its `source/` included) bumps that example's version, or re-import fails with `CONFLICT`. `hello` is at 1.0.3 and `hermes-tasks` at 1.0.1.
- **Codex sandbox:** tests that start a listening socket fail with `listen EPERM` inside it. The controller runs `pnpm install` before any task that changes a `package.json`, and reruns tests marked *controller-run* outside the sandbox.
- **Language:** code, comments and messages are in English; the template's widget UI text is in Russian, like the existing examples.

## Review Focus

1. **A forbidden name in a comment, a string, a template literal, an object key or a foreign property** (`foo.localStorage`) must not be flagged, while `window.localStorage` must be. A guarded `navigator.gpu` (`'gpu' in navigator`, `navigator.gpu?.…`, `if (navigator.gpu)`) must pass. Task 4 pins these.
2. **URLs:**
   - A URL inside a comment is ignored.
   - A template literal such as `` `https://api.example.com/v1/${id}` `` yields the origin `https://api.example.com`.
   - Relative URLs and `assets/…` are ignored.
   - `http://localhost:8787` must be listed in `network` like any other origin.
   
   Task 4 pins these.
3. **Project paths with spaces and Cyrillic** (`~/Мои виджеты/часы`) work in `create`, `check` and `build`. Tasks 4 and 5 pin this.
4. **A project without `typescript`/`vue-tsc`** gets one directed `types` problem with the install command, not a stack trace. Task 4 pins this.
5. **Packed declarations work in a consumer outside the workspace:**
   - `config.city` is a `string` and `config.apiKey` is a `boolean` after augmentation;
   - an unknown key is a type error;
   - the CLI runs from `node_modules` without type stripping.
   
   Task 3 pins these.

---

### Task 1: Safe `source/` allow-list

**Files:**
- Modify: `packages/widget-sdk/src/build.ts` (`keepInSource`)
- Modify: `packages/widget-sdk/src/cli.ts`
- Test: `packages/widget-sdk/test/build.test.ts`, `packages/widget-sdk/test/cli.test.ts` (create)

**Interfaces:**
- Produces: `keepInSource(path: string): boolean` (same signature, now an allow-list). `path` is relative to the project, uses platform separators, and is `''` for the root. The `fs.cp` filter calls it for directories too; `false` prunes the directory.

- [ ] **Step 1: Write the failing tests**

In `build.test.ts`, replace the existing `keepInSource` cases with this table:

```ts
it.each([
  ['', true], ['widget.json', true], ['package.json', true], ['package-lock.json', true], ['pnpm-lock.yaml', true],
  ['yarn.lock', true], ['tsconfig.json', true], ['tsconfig.app.json', true], ['AGENTS.md', true], ['CLAUDE.md', true],
  ['README.md', true], ['README', true], ['widget-env.d.ts', true], ['src', true], ['src/index.vue', true],
  [join('src', 'deep', 'a.ts'), true], ['test', true], [join('test', 'a.test.ts'), true],
  ['.npmrc', false], ['.env', false], ['.env.local', false], ['.gitignore', false], ['.ld-widget', false],
  ['node_modules', false], ['dist', false], ['assets', false], ['notes.md', false], ['secrets.json', false],
  ['scripts', false], ['vite.config.ts', false], [join('src', '.secret'), false], [join('src', '.hidden', 'a.ts'), false],
  [join('test', '.env'), false], [join('src', '.DS_Store'), false],
])('keepInSource(%j) is %s', (path, kept) => expect(keepInSource(path)).toBe(kept))
```

Add a build test. Copy `counter`, then add `.npmrc`, `notes.md`, `src/.env` and `src/extra.ts`. Assert that the built folder's `source/` holds exactly `source/src/extra.ts`, `source/src/index.vue` and `source/widget.json`.

Create `cli.test.ts`. Spawn `process.execPath src/cli.ts build <copy of counter>` and assert:
- exit 0;
- stdout contains `Built `;
- stdout contains a line `source/: 2 files`;
- stdout contains the lines `  src/index.vue` and `  widget.json`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/build.test.ts test/cli.test.ts`
Expected: FAIL. `.npmrc` and `notes.md` are kept, and the CLI prints no `source/` lines.

- [ ] **Step 3: Implement**

`keepInSource`:
- Reject any segment that starts with `.`.
- At depth 1, accept only these entries:
  - the directories `src` and `test`;
  - the files `widget.json`, `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `widget-env.d.ts`, `AGENTS.md` and `CLAUDE.md`;
  - names matching `/^tsconfig.*\.json$/` and `/^README/`.
- Below `src/` and `test/`, accept everything not rejected by the dot rule.

`cli.ts`: after `Built <dir>`, unless `--no-source` was given, list the files under `<dir>/source`. Use `/` separators, sorted, and print them as `source/: <n> files` followed by one `  <path>` line per file.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/widget-sdk exec vitest run test/build.test.ts test/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/src/build.ts packages/widget-sdk/src/cli.ts packages/widget-sdk/test/build.test.ts packages/widget-sdk/test/cli.test.ts
git commit -m "feat(widget-sdk): copy only an allow-list of project files into source/"
```

### Task 2: Typed `config` and the generated declaration

**Files:**
- Create: `packages/widget-sdk/src/config-declaration.ts`
- Modify: `packages/widget-sdk/src/widget.ts`, `packages/widget-sdk/src/index.ts`, `packages/widget-sdk/src/build.ts`
- Test: `packages/widget-sdk/test/config-declaration.test.ts`

**Interfaces:**
- Consumes: `SettingsSchema`, `parseSettingsSchema(raw, network)` from `@lifedashboard/contracts/widget-settings`.
- Produces:
  - `export interface WidgetConfig {}` in `widget.ts`, exported from `index.ts`. The generated `widget-env.d.ts` augments it.
  - `Widget.context` type: `Readonly<Omit<WidgetContext, 'config'> & { config: Readonly<WidgetConfig> }>`.
  - `renderConfigDeclaration(settings: SettingsSchema | undefined): string` (pure).
  - `writeConfigDeclaration(dir: string): Promise<void>`. It reads `<dir>/widget.json`, parses `settings` against `network ?? []`, and writes `<dir>/widget-env.d.ts` only when the content changed. On an invalid schema it throws `Error('Invalid widget.json: <parser error>')`.
  - `CONFIG_DECLARATION_FILE = 'widget-env.d.ts'`.
  - `writeConfigDeclaration` is not part of `index.ts`, because it is Node-only. The CLI and `check` import it.

- [ ] **Step 1: Write the failing test**

```ts
it('renders every setting type, quoting keys that are not identifiers', () => {
  expect(renderConfigDeclaration({ type: 'object', properties: {
    city: { type: 'string', title: 'Город', description: 'Где */ смотреть', default: 'Москва' },
    count: { type: 'integer', title: 'Сколько', default: 3 },
    ratio: { type: 'number', title: 'Доля', default: 0.5 },
    on: { type: 'boolean', title: 'Вкл', default: true },
    mode: { type: 'string', title: 'Режим', enum: ['a', "b'c"], default: 'a' },
    '1st': { type: 'string', title: 'Первый', default: '' },
    apiKey: { type: 'secret', title: 'Ключ', bind: { origin: 'https://api.example.com', header: 'Authorization' } },
  } })).toBe(`// Generated by ld-widget from widget.json. Do not edit: dev, check and build rewrite it.
import '@lifedashboard/widget-sdk'

declare module '@lifedashboard/widget-sdk' {
  interface WidgetConfig {
    /** Город — Где *\\/ смотреть */
    city: string
    /** Сколько */
    count: number
    /** Доля */
    ratio: number
    /** Вкл */
    on: boolean
    /** Режим */
    mode: 'a' | 'b\\'c'
    /** Первый */
    '1st': string
    /** Ключ. True when the user has set it; the widget never gets the value. */
    apiKey: boolean
  }
}
`)
})
```

Add tests for the following:
- `renderConfigDeclaration(undefined)` returns the same header and an empty `interface WidgetConfig {}` (one line).
- `writeConfigDeclaration` writes the file in a temp project.
- A second call leaves the file's mtime unchanged.
- Invalid `settings` reject with a message starting `Invalid widget.json: settings`.
- `buildWidget` on the `counter` copy leaves a `widget-env.d.ts` in the project.

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/config-declaration.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement the module, the `WidgetConfig` type, and the `writeConfigDeclaration(root)` call at the start of `buildWidget`.**

The generated file now lands in every built `source/`. Update the expectations from Task 1 and the existing `build.test.ts` file lists to include `source/widget-env.d.ts`; the CLI line becomes `source/: 3 files`.

Rules for the renderer:
- Quote a key with single quotes when it does not match `/^[A-Za-z_$][\w$]*$/`.
- Write enum members as single-quoted literals, escaping `\` and `'`.
- In comments, replace `*/` with `*\/`.
- Join `title — description` with an em dash.
- Indent with two spaces.
- End with one trailing newline.

- [ ] **Step 4: Run the package tests and typecheck**

Run: `pnpm -C packages/widget-sdk test && pnpm -r typecheck`
Expected: PASS. `apps/ui` and `examples/widgets/hermes-tasks` still typecheck: neither reads `context.config` with a specific type.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/src/config-declaration.ts packages/widget-sdk/src/widget.ts packages/widget-sdk/src/index.ts packages/widget-sdk/src/build.ts packages/widget-sdk/test/config-declaration.test.ts
git commit -m "feat(widget-sdk): type context.config from the manifest settings"
```

### Task 3: Publishable SDK package

**Files:**
- Modify: `packages/widget-sdk/package.json`, `packages/widget-sdk/src/cli.ts` (subcommand dispatch)
- Create: `packages/widget-sdk/scripts/build.ts`, `packages/widget-sdk/tsconfig.build.json`, `packages/widget-sdk/scripts/rewrite-declarations.ts`
- Keep: `packages/widget-sdk/vite.config.ts` (the `dev` script `vite build --watch` still rebuilds `dist/sandbox.js` for `pnpm dev`)
- Test: `packages/widget-sdk/test/pack.test.ts`

**Interfaces:**
- Consumes: `renderConfigDeclaration` (Task 2).
- Produces the `dist/` layout that plan 2b extends:
  - `dist/sandbox.js`: unchanged sandbox runtime.
  - `dist/index.js`: ESM; `vue` external; contracts bundled.
  - `dist/cli.js`: Node ESM; first line `#!/usr/bin/env node`; `vite`, `@vitejs/plugin-vue`, `typescript` and `node:*` external; contracts bundled.
  - `dist/types/`: declarations. The entry is `dist/types/widget-sdk/src/index.d.ts`.
- `cli.ts` dispatches on `argv[2]` through a `commands` record of `name → (args: string[]) => Promise<number>` (the exit code). Task 4 adds `check`, plan 2b adds `dev`. Unknown command → usage on stderr and exit 2. Usage line: `Usage: ld-widget <build|check> [dir] [options]`.
- Package-root lookup for runtime files: `packageRoot(): string` in `src/package-root.ts`, implemented as `dirname(createRequire(import.meta.url).resolve('@lifedashboard/widget-sdk/package.json'))`. It works from both `src/` (workspace) and `dist/` (tarball). Plan 2b uses it.

- [ ] **Step 1: Write the failing test** (`pack.test.ts`, timeout 180 s)

`beforeAll`:
1. `pnpm -C packages/widget-sdk pack --pack-destination <tmp>`.
2. `tar -xzf <tgz> -C <tmp>/x`.
3. Read `<tmp>/x/package/package.json`.

Assertions:

```ts
expect(pkg.private).toBeUndefined()
expect(pkg.version).toBe('0.1.0')
expect(pkg.exports['.']).toEqual({ types: './dist/types/widget-sdk/src/index.d.ts', default: './dist/index.js' })
expect(pkg.bin).toEqual({ 'ld-widget': './dist/cli.js' })
expect(pkg.peerDependencies).toEqual({ vue: '^3.5.0' })
expect(pkg.dependencies).toEqual({ vite: '8.3.2', '@vitejs/plugin-vue': '6.0.9' })
expect(JSON.stringify(pkg)).not.toContain('workspace:')
expect(files).toContain('dist/sandbox.js'); expect(files).toContain('dist/index.js'); expect(files).toContain('dist/cli.js')
expect(files.some((f) => f.startsWith('src/') || f.startsWith('test/'))).toBe(false)
expect((await readFile(`${x}/dist/cli.js`, 'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node')
```

Consumer test: build a temp project outside the workspace.
- Put the extracted package at `node_modules/@lifedashboard/widget-sdk`.
- Symlink `node_modules/vue`, `node_modules/vite`, `node_modules/@vitejs/plugin-vue` and `node_modules/typescript` to the monorepo copies, resolved from `packages/widget-sdk`.
- Write a `tsconfig.json` with `strict`, `module: "esnext"`, `moduleResolution: "bundler"`, `noEmit`, `skipLibCheck: false`, `types: []` and `include: ["src", "widget-env.d.ts"]`.
- Write `widget-env.d.ts` from `renderConfigDeclaration` with `city: string`, `mode: enum ['a','b']` and `apiKey: secret`.
- Write `src/main.ts`:

```ts
import type { Widget } from '@lifedashboard/widget-sdk'
declare const widget: Widget
const city: string = widget.context.config.city
const key: boolean = widget.context.config.apiKey
const mode: 'a' | 'b' = widget.context.config.mode
// @ts-expect-error unknown setting
void widget.context.config.missing
const out = await widget.http.get('https://api.example.com/x')
const status: number = out.status
export { city, key, mode, status }
```

Then:
- Assert `node <monorepo typescript>/bin/tsc -p <tmp>` exits 0.
- Copy the `counter` fixture into the temp project and run `node node_modules/@lifedashboard/widget-sdk/dist/cli.js build <fixture>` with `cwd` = temp. Assert exit 0 and that `dist/dev.test.counter-1.0.0/index.js` exists.

- [ ] **Step 2: Run the test and see it fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/pack.test.ts`
Expected: FAIL. `private` is set and there is no `publishConfig`.

- [ ] **Step 3: Implement**

`package.json`:
- Remove `private`.
- Add `"version": "0.1.0"`, `"license": "MIT"`, `"description"` and `"files": ["dist"]`.
- Add `"prepack": "node scripts/build.ts"`.
- Set `"build": "node scripts/build.ts"`.
- `publishConfig` overrides `exports` (as asserted above, plus `"./package.json"`), `bin` and `types`.
- Move dependencies as stated in Global Constraints. `@lifedashboard/contracts` becomes a devDependency.
- Workspace `exports` and `bin` stay on `src/`, so `apps/ui`, `apps/api` and the examples keep working unchanged.

`scripts/build.ts`, in this order:
1. Remove `dist/`.
2. Build the sandbox with the existing `vite.config.ts`.
3. Build `src/index.ts` as a library to `dist/index.js` (`emptyOutDir: false`).
4. Build `src/cli.ts` with `build.ssr` to `dist/cli.js`, bundling `@lifedashboard/contracts` (`ssr.noExternal`).
5. Run `tsc -p tsconfig.build.json`. It sets `emitDeclarationOnly`, `declaration`, `rootDir: ".."`, `outDir: "dist/types"` and includes `src/index.ts`, `src/env.d.ts`.
6. Run `rewrite-declarations.ts`. In every emitted `.d.ts`, it rewrites `@lifedashboard/contracts/<name>` to the relative path of `dist/types/contracts/src/<name>.js`, and relative `.ts` specifiers to `.js`.

If `pnpm pack` writes no `publishConfig` override or keeps a `workspace:` range, stop and report. Do not work around it with a hand-edited copy.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm -C packages/widget-sdk test && pnpm -r typecheck && pnpm -C apps/api test -- sandbox`
Expected: PASS. The API still serves `dist/sandbox.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk pnpm-lock.yaml
git commit -m "build(widget-sdk): publish compiled JS, bundled declarations and the ld-widget CLI"
```

### Task 4: `ld-widget check`

**Files:**
- Create: `packages/widget-sdk/src/check.ts`, `packages/widget-sdk/src/source-scan.ts`
- Modify: `packages/widget-sdk/src/cli.ts`
- Test: `packages/widget-sdk/test/source-scan.test.ts`, `packages/widget-sdk/test/check.test.ts`

**Interfaces:**
- Consumes: `buildWidget`, `writeConfigDeclaration` (Task 2), `parseWidgetManifest`, `SDK_TARGET_LEVEL`, `ASSET_TYPES`.
- Produces:
  - `type CheckRule = 'manifest' | 'types' | 'sandbox-api' | 'network' | 'media' | 'build'`
  - `interface Problem { rule: CheckRule; file?: string; line?: number; message: string }`, where `file` is project-relative with `/` and `line` is 1-based.
  - `scanSource(file: string, text: string, network: readonly string[], ts: typeof import('typescript')): Problem[]` (pure).
  - `checkWidget(dir: string, deps?: { typecheck?: (dir: string) => Promise<Problem[]> }): Promise<{ ok: boolean; problems: Problem[] }>`. It writes `<dir>/.ld-widget/check.json` as `{ ok, problems }`.
  - CLI `ld-widget check [dir]` prints one line per problem, `✗ [rule] file:line message` (omitting `file:line` when absent), then `check: OK` or `check: <n> problems`. It exits 0 or 1.

Order inside `checkWidget`:
1. Parse the manifest the way `buildWidget` does: `{ format: 2, ...fields, sdk: SDK_TARGET_LEVEL }` passed to `parseWidgetManifest`. If it fails, return a single `manifest` problem.
2. Run `writeConfigDeclaration`.
3. Resolve `typescript` and `vue-tsc/bin/vue-tsc.js` with `createRequire(join(dir, 'package.json'))`. If either is missing, add one `types` problem with the message `typescript and vue-tsc are missing from devDependencies. Fix: npm install -D typescript@6.0.3 vue-tsc@3.3.12` and skip steps 4 and 6.
4. Run `scanSource` on every `src/**/*.{ts,tsx,js,mjs,vue}`. For `.vue`, scan each `<script …>…</script>` block and add the block's line offset.
5. Run the media check over `assets/`.
6. Run the typecheck: `node <vue-tsc> --noEmit -p tsconfig.json` with `cwd` = project. Map `file(line,col): error TSxxxx: msg` lines to `types` problems. Any other non-zero output becomes one `types` problem carrying the raw text, capped at 2000 characters.
7. Run `buildWidget(dir)`. A thrown error becomes a `build` problem with its message; this covers media imported into code and the 10 MB code limit.

Scan rules work on `ts.createSourceFile` nodes, never on raw text:

| Match | Message |
| --- | --- |
| Identifier `localStorage`, `sessionStorage`, `indexedDB` used as a value (bare, or as the name of `window.`/`globalThis.`/`self.` access) | `"<name>" does not work in the widget sandbox (no storage). Fix: use widget.state.get/set.` |
| `document.cookie` | `"document.cookie" does not work in the widget sandbox. Fix: use widget.state.get/set.` |
| Identifier `Notification` used as a value | `Web Notifications do not work in the widget sandbox. Fix: use widget.notify(title, body).` |
| Identifier `requestIdleCallback` used as a value | `"requestIdleCallback" is not available in every dashboard engine. Fix: use setTimeout or requestAnimationFrame.` |
| `scheduler.postTask` | `"scheduler.postTask" is not available in every dashboard engine. Fix: use setTimeout or requestAnimationFrame.` |
| `navigator.gpu` that is not guarded | `"navigator.gpu" (WebGPU) is not in the runtime baseline. Fix: check 'gpu' in navigator and fall back to WebGL 2.` |
| String literal, no-substitution template, or template head starting with `http://` or `https://` whose `new URL(...).origin` is not in `network` | `URL origin <origin> is not in widget.json "network". Fix: add "<origin>" to network or call another origin.` |

`navigator.gpu` counts as guarded in any of these cases:
- the file contains the expression `'gpu' in navigator`;
- the node's parent access or call uses `?.`;
- the node is the condition of an `if` or a ternary;
- the node is the left operand of `&&`.

Not a value use:
- an object-literal property name;
- a declaration name;
- the name in `x.<name>` when `x` is not `window`, `globalThis` or `self`.

Media rules over the files in `assets/`:
- An `.mp4` without a same-basename `.webm` gives `assets/<f> has no WebM version. Fix: add assets/<base>.webm (VP9 + Opus) and list it first in <video><source>.`
- An `.mp3`, `.m4a`, `.aac`, `.wav` or `.flac` without a same-basename `.ogg`, `.oga`, `.opus` or `.webm` gives `assets/<f> has no Opus version. Fix: add assets/<base>.ogg or assets/<base>.opus (Opus).`

- [ ] **Step 1: Write the failing tests**

`source-scan.test.ts` loads `typescript` from the workspace and uses a `scan(code, network = [])` helper:

```ts
it.each([
  'window.localStorage.getItem("a")', 'localStorage.setItem("a", "b")', 'globalThis.sessionStorage', 'indexedDB.open("x")',
  'document.cookie = "a=1"', 'new Notification("hi")', 'requestIdleCallback(() => {})', 'scheduler.postTask(() => {})',
  'navigator.gpu.requestAdapter()',
])('flags %s', (code) => expect(scan(code)).toHaveLength(1))

it.each([
  '// localStorage and https://evil.example in a comment', '/* document.cookie */', 'const s = "localStorage"',
  'const t = `see ${a} localStorage docs`', 'const o = { localStorage: 1 }', 'foo.localStorage', 'foo.cookie',
  "if ('gpu' in navigator) { navigator.gpu.requestAdapter() }", 'navigator.gpu?.requestAdapter()',
  'if (navigator.gpu) start()', 'const ok = navigator.gpu && 1', 'fetch("assets/bg.webm")', 'fetch("/relative")',
])('does not flag %s', (code) => expect(scan(code)).toEqual([]))

it('checks URL origins against network', () => {
  expect(scan('fetch(`https://api.example.com/v1/${id}`)', ['https://api.example.com'])).toEqual([])
  expect(scan('fetch("http://localhost:8787/x")')[0]).toMatchObject({ rule: 'network', line: 1,
    message: 'URL origin http://localhost:8787 is not in widget.json "network". Fix: add "http://localhost:8787" to network or call another origin.' })
})
```

In `check.test.ts`, inject a stub `typecheck` returning `[]` except in the last test. The tests:
- A clean copy of `counter` gives `{ ok: true, problems: [] }` and writes `.ld-widget/check.json`.
- An invalid manifest (missing `title`) gives only a `manifest` problem.
- A `.vue` file with `localStorage` on script line 3 reports the correct file-level `line`.
- `assets/bg.mp4` alone gives a `media` problem; adding `assets/bg.webm` makes it pass.
- `assets/a.mp3` alone gives a `media` problem.
- A project without `typescript` (the default `deps`, a temp dir with no `node_modules`) gives exactly one `types` problem with the install command.
- The project lives in a temp dir named `Мои виджеты/часы` (with a space).
- *Integration:* a project with `node_modules` symlinks to the workspace `typescript`, `vue-tsc`, `vue` and `@lifedashboard/widget-sdk`, and `src/index.vue` containing `const n: number = 'x'`. The result is one `types` problem with `file: 'src/index.vue'` and a line number.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm -C packages/widget-sdk exec vitest run test/source-scan.test.ts test/check.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Implement `source-scan.ts`, `check.ts` and the `check` CLI command.**

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm -C packages/widget-sdk test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widget-sdk/src/check.ts packages/widget-sdk/src/source-scan.ts packages/widget-sdk/src/cli.ts packages/widget-sdk/test/source-scan.test.ts packages/widget-sdk/test/check.test.ts
git commit -m "feat(widget-sdk): add ld-widget check for manifests, sandbox APIs, origins, media and types"
```

### Task 5: `@lifedashboard/create-widget`

**Files:**
- Create: `packages/create-widget/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/create.ts`, `src/cli.ts`
- Create: `packages/create-widget/template/` containing:
  - `widget.json`
  - `package.json`
  - `tsconfig.json`
  - `widget-env.d.ts`
  - `gitignore` (renamed to `.gitignore` on copy, because npm drops `.gitignore` from tarballs)
  - `AGENTS.md`
  - `CLAUDE.md`
  - `src/index.vue`
- Test: `packages/create-widget/test/create.test.ts`

**Interfaces:**
- Produces:
  - `createWidgetProject(options: { name: string; parentDir: string; sdk?: string }): Promise<string>`. It returns the project directory and throws `Error` with a directed message.
  - `sdkSpecifier(sdk: string | undefined, ownVersion: string, cwd: string): string`.
  - Bin `create-widget <name> [--sdk <version|path|tarball>]`. It is non-interactive and creates `./<name>`.
- Name rule: `/^[a-z][a-z0-9-]{0,49}$/`. Otherwise: `Invalid name "<name>". Fix: use lowercase letters, digits and dashes, starting with a letter.`
- An existing non-empty folder gives: `Folder <name> already exists and is not empty. Fix: choose another name or remove the folder.`
- SDK specifier:
  - `undefined` → the package's own version (`0.1.0`);
  - a value ending in `.tgz`, or an existing path → `file:<absolute path>`;
  - anything else is used as given.
- Template substitution replaces `__NAME__` in `widget.json` and `package.json`, and `__SDK__` in `package.json`.

Template contents:

| File | Content |
| --- | --- |
| `widget.json` | `id` `dev.local.__NAME__`, `version` `0.1.0`, `title` `__NAME__`, `author` `""`, `sdk` 2, `entry` `index.js`, `styles` `["style.css"]`, `sizing` default 4×4, min 2×2, max 12×12, `permissions` `[]` |
| `package.json` | `name` `__NAME__`, `private` true, `type` `module`, scripts `check`/`build` → `ld-widget check`/`ld-widget build`, devDependencies `@lifedashboard/widget-sdk` `__SDK__`, `vue` `3.5.43`, `typescript` `6.0.3`, `vue-tsc` `3.3.12` |
| `tsconfig.json` | `target` `es2022`, `module` `esnext`, `moduleResolution` `bundler`, `strict`, `noEmit`, `skipLibCheck`, `lib` `["es2022","dom","dom.iterable"]`, `types` `[]`, `include` `["src","widget-env.d.ts"]` |
| `widget-env.d.ts` | output of `renderConfigDeclaration(undefined)`, copied verbatim (no settings) |
| `gitignore` | `node_modules/`, `dist/`, `.ld-widget/`, `.env*` |
| `CLAUDE.md` | `@AGENTS.md` |
| `src/index.vue` | a component using `useWidget()` that shows `context.sizeClass`, styled only with `var(--ld-…)` tokens, with a `<style scoped>` block so `style.css` is emitted |

`AGENTS.md` is a stub that plan 3 replaces. It states:
- what the project is;
- that the API reference is the JSDoc in `node_modules/@lifedashboard/widget-sdk/dist/types`;
- the rules that cause most failures: no browser storage (use `widget.state`), only origins listed in `network`, media as WebM/Opus in `assets/`;
- the workflow `npx ld-widget check` → `npx ld-widget build` → give the user `dist/<id>-<version>/` to import via «Виджеты → Выбрать папку».

It names no file that does not exist yet.

Output after success:

```
Created <name>/
Next:
  cd <name>
  npm install
  npx ld-widget check
Read AGENTS.md before writing code.
```

- [ ] **Step 1: Write the failing tests**
- `createWidgetProject({ name: 'clock', parentDir: tmp })` creates exactly these files:
  - `.gitignore`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `package.json`
  - `src/index.vue`
  - `tsconfig.json`
  - `widget-env.d.ts`
  - `widget.json`
- `package.json` devDependencies equal `{ '@lifedashboard/widget-sdk': '0.1.0', vue: '3.5.43', typescript: '6.0.3', 'vue-tsc': '3.3.12' }`.
- `widget.json` passes `parseWidgetManifest({ format: 2, ...json })`.
- The template's `vue`, `typescript` and `vue-tsc` versions equal those in `packages/widget-sdk/package.json` (`vue`, `typescript`) and `apps/ui/package.json` (`vue-tsc`), read from disk.
- `widget-env.d.ts` equals `renderConfigDeclaration(undefined)`, imported from `../../widget-sdk/src/config-declaration.ts`.
- `sdkSpecifier('./x.tgz', '0.1.0', '/a')` is `'file:/a/x.tgz'`. `sdkSpecifier('0.2.0', …)` is `'0.2.0'`. `sdkSpecifier(undefined, '0.1.0', …)` is `'0.1.0'`.
- Bad names and a non-empty target reject with the messages above.
- A `parentDir` named `Мои виджеты` works.
- Pack: `pnpm -C packages/create-widget pack` and extract. `package.json` has `bin: { 'create-widget': './dist/cli.js' }` and no `private`. Files include `dist/cli.js` and `template/gitignore`.
- Running `node <extracted>/dist/cli.js demo --sdk <sdk tarball path>` in a temp dir exits 0, prints `Read AGENTS.md before writing code.`, and writes `"@lifedashboard/widget-sdk": "file:<abs>"`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm -C packages/create-widget exec vitest run`
Expected: FAIL. The package does not exist.

- [ ] **Step 3: Implement**

The package has `version` `0.1.0`, `files: ["dist", "template"]`, `bin` `create-widget` → `./dist/cli.js` with a shebang, `build`: `tsc -p tsconfig.build.json` (with `rewriteRelativeImportExtensions`), and `prepack` → `build`. Its devDependencies are `typescript`, `vitest`, `@types/node` and `@lifedashboard/contracts` (workspace, used only by tests). It reads its own version from `../package.json` via `createRequire`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm install && pnpm -C packages/create-widget test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Controller-run check (needs the network)**

In a temp dir outside the repo:
1. Run `npm exec --package=<create-widget tgz> -- create-widget demo --sdk <sdk tgz>`.
2. `cd demo && npm install && npx ld-widget check && npx ld-widget build`.

Expected: `check: OK`, and `dist/dev.local.demo-0.1.0/` exists. Record the exact command in the ledger: plan 4's acceptance task sentence names it.

- [ ] **Step 6: Commit**

```bash
git add packages/create-widget pnpm-lock.yaml
git commit -m "feat(create-widget): scaffold a widget project outside the monorepo"
```

### Task 6: Examples pass `check`

**Files:**
- Create: `examples/widgets/hello/assets/bg.webm`, `examples/widgets/hello/tsconfig.json`, `examples/widgets/hermes-tasks/tsconfig.json`
- Modify: `examples/widgets/hello/src/index.vue`, `examples/widgets/hello/widget.json` (version `1.0.4`), `examples/widgets/hello/package.json`, `examples/widgets/hermes-tasks/widget.json` (version `1.0.2`), `examples/widgets/hermes-tasks/package.json`
- Generated and committed: `examples/widgets/*/widget-env.d.ts` (it is part of `source/`)

**Interfaces:**
- Consumes: `ld-widget check` (Task 4).

- [ ] **Step 1: Run `check` and record the failures**

Run: `pnpm -C examples/widgets/hello exec ld-widget check; pnpm -C examples/widgets/hermes-tasks exec ld-widget check`
Expected: FAIL. `hello` has `media` (no WebM) and `types` (no `typescript`/`vue-tsc`). `hermes-tasks` has `types`.

- [ ] **Step 2: Fix the examples**

- Encode the WebM once: `ffmpeg -i examples/widgets/hello/assets/bg.mp4 -c:v libvpx-vp9 -b:v 0 -crf 40 -an examples/widgets/hello/assets/bg.webm`.
- Change the `<video>` to two `<source>` children: WebM first, then MP4.
- Add devDependencies `vue` 3.5.43, `typescript` 6.0.3 and `vue-tsc` 3.3.12, plus a `"check": "ld-widget check"` script, to both examples.
- Add a `tsconfig.json` with the same content as the template's.
- Bump the versions as listed above.
- `examples/widgets/hostile` is a security fixture that uses forbidden APIs on purpose. Leave it unchanged.

- [ ] **Step 3: Verify**

Run: `pnpm install && pnpm -C examples/widgets/hello exec ld-widget check && pnpm -C examples/widgets/hermes-tasks exec ld-widget check && pnpm test`
Expected: both print `check: OK`, and the full suite passes.

- [ ] **Step 4: Commit**

```bash
git add examples/widgets/hello examples/widgets/hermes-tasks pnpm-lock.yaml
git commit -m "chore(examples): add WebM media and type checking so examples pass ld-widget check"
```

## Deferred to other plans

- **Plan 2b:** `ld-widget dev`, the dev shell, the dev gateway and `.env.local` secrets, the shared sandbox document, the host bridge and gateway core, generated theme tokens and the dev Vue runtime, the divergence test, and the template `dev` script.
- **Plan 3:**
  - package docs under `docs/` and the full `AGENTS.md`;
  - the skill installed by `create`;
  - docs numbers generated from constants;
  - the copyable starter prompt in the import dialog;
  - the README SDK section pointing at the package docs.
- **Plan 4:** the acceptance run with a fresh agent.
