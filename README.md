# LifeDashboard

**Your workspace. Your widgets. Your rules.**

LifeDashboard is an open-source, customizable, widget-based personal workspace. Build a dashboard that looks and works the way you want: choose ready-made widgets, arrange them freely, personalize their appearance, or create entirely new ones with the **LifeDashboard Widget SDK** and tools such as **Claude Code**, **OpenAI Codex**, or your preferred coding agent.

The long-term goal is a beautiful, local-first desktop environment that can also serve as a visual interface for a personal AI agent. **Hermes Agent** is the planned AI integration, not a requirement for using the dashboard or ordinary widgets.

> **Status: early development.** The project currently runs as a local web application. The Widget SDK and installable widget packages have an initial implementation; the Tauri desktop app, Hermes integration, and many planned widgets are not available yet. Interfaces and package contracts may evolve before a stable release.

## The idea

LifeDashboard is a **widget platform first**. It is not a fixed productivity dashboard, a replacement for Hermes Agent, or another general-purpose AI chat application.

The user owns the workspace:

- **Compose:** select widgets from a growing library and arrange them on a customizable board.
- **Personalize:** adjust widget sizes, themes, frames, shadows, and eventually backgrounds and animations.
- **Extend:** install independently distributed widget packages without modifying the application.
- **Create:** build custom widgets manually or with an AI coding agent using a documented SDK.
- **Connect:** add optional AI, data sources, and device integrations as the platform evolves.

A widget can be practical, decorative, interactive, or AI-powered. Clocks, weather, music, calendars, notes, system information, visualizations, and AI conversations are all valid uses of the same system. **Visual quality and creative freedom are core product goals**, not secondary features.

## What works today

The following describes the implementation in the repository as of **October 2026**, not a completed product release.

| Area | Current state |
| --- | --- |
| Widget board | 24-column fluid grid; configurable number of rows; add, move, resize, and remove widgets; pointer and keyboard controls. |
| Persistence | Boards and widget instances saved through the local Fastify API to SQLite, with revision-based conflict detection. |
| Appearance | Glass, Obsidian, and Paper themes; per-widget theme selection, a frameless style, and custom shadows are implemented in source. |
| Built-in widgets | Animated analog clock and a placeholder. The built-in library is still small. |
| Installable widgets | Widget folders built by ld-widget build: code up to 10 MB, unlimited media, bundled sources; installed through the UI into the userwidgets library with permission review. |
| Widget SDK | Initial `useWidget()` API, `ld-widget build` CLI, reactive widget context, persisted state, and host notifications. |
| Isolation | Third-party widget packages run in sandboxed iframes with a restricted bridge to the host and API. |
| Local access | Pairing code, authenticated browser sessions, and local API origin checks. |
| Rooms and screens | Data contracts exist, but the UI currently displays the initial room and its first screen; management/navigation is planned. |
| Hermes Agent | Planned; no Hermes adapter or chat UI is implemented in the current application. |
| Desktop app / animated backgrounds | Planned; there is no Tauri desktop distribution or animated-background system yet. |

The newest appearance features have not yet completed the full documented browser-acceptance checks. Treat the current code as a development build.

## Widget ecosystem

There are two widget types:

1. **Built-in widgets** are trusted Vue components bundled with LifeDashboard. They use the same widget-facing API as external widgets.
2. **Installable widgets** are separately built Vue components distributed as built widget folders. The host validates the folder, asks for its declared permissions, and executes it in a sandboxed iframe.

Widgets declare their preferred, minimum, and maximum sizes. The host provides a reactive context containing the current size, size class, theme tokens, configuration, locale, and visibility.

**The intended ecosystem is open-ended:** the official library is only a starting point. Anyone should be able to create, install, share, or independently distribute widgets and themed packs. An online marketplace is not required for this model.

### Widget SDK

The initial SDK lives at [`packages/widget-sdk`](packages/widget-sdk). It currently provides:

| API | Purpose |
| --- | --- |
| `useWidget()` | Access the host-provided widget API from a Vue component. |
| `widget.context` | Reactive size, `sizeClass`, theme, `rootFontSize`, config, locale, and visibility. |
| `widget.state.get<T>()` | Read instance-specific persisted state and its revision. |
| `widget.state.set(data, expectedRevision)` | Save state with optimistic concurrency control. |
| `widget.notify({ title, body })` | Request a notification displayed by LifeDashboard. |
| `widget.call(op, input)` | Call a supported, permission-checked gateway operation. |
| `ld-widget build [dir] [--no-source]` | Build a widget project into an installable folder `dist/<id>-<version>/`. |

**Current gateway operations are limited to `state.get`, `state.set`, and `notifications.send`.** Widget access to external HTTP services, LifeDashboard data sources, local device actions, and Hermes is planned; it is not available through the SDK today.

A widget project contains at least:

```text
my-widget/
├── widget.json       # ID, version, author, sizing, permissions, entry, styles
├── package.json
└── src/
    └── index.vue     # Vue single-file component
```

`ld-widget build` writes `dist/<id>-<version>/`: `widget.json` (`"format": 2`), compiled code (`.js`, `.mjs`, `.css`, `.wasm`, up to **10 MB** in total), `assets/` copied from the project (images, video, audio, fonts, models — **no size limit**) and `source/`, the project itself without `node_modules/`, `dist/`, `assets/`, `.git/` and `.env*` files. `--no-source` leaves `source/` out.

Reference media by URL, for example `<video src="assets/bg.mp4">` or `fetch('assets/model.glb')`; importing a video, audio or a media file over 100 KB into code fails the build. Workers start from a `blob:` URL. A widget still has no network access beyond its own folder.

To rebuild an installed widget, copy its `source/` and `assets/` (paths are shown in «Виджеты») into `examples/widgets/<name>/` of a LifeDashboard checkout and run `pnpm -C examples/widgets/<name> build`.

**Existing examples:**

- [`examples/widgets/hello`](examples/widgets/hello) demonstrates persisted state, revision conflicts, notifications, and a background video from `assets/`.
- [`examples/widgets/hostile`](examples/widgets/hostile) is a security test fixture, **not** a production widget template.
- [`apps/ui/app/widgets/builtin/clocks/analog_1`](apps/ui/app/widgets/builtin/clocks/analog_1) shows an animated built-in clock implemented with Vue, SVG, and GSAP.

Build the existing example from the repository root:

```bash
pnpm install
pnpm -C examples/widgets/hello build
# examples/widgets/hello/dist/dev.lifedashboard.hello-1.0.0/
```

Then start LifeDashboard and select **«Виджеты» → «Выбрать папку»**, pick that folder (or drop it on the dialog), review the permissions and sizes, install the widget, and place it using **«Добавить виджет…»**.

A package already used by a board cannot be removed until its widget instances are removed. Installed versions are immutable, and placed instances remain associated with their selected version.

### Creating widgets with Claude Code, Codex, or other AI tools

**AI-assisted widget development is a central use case, not a dependency on a particular AI provider.** The intended workflow is:

```text
Describe your idea
       ↓
Claude Code / Codex / another coding agent
       ↓
LifeDashboard Widget SDK + examples
       ↓
Vue widget source + widget.json
       ↓
ld-widget build
       ↓
Install the built widget folder
       ↓
Add it to your dashboard
```

Today, a coding agent can work from this repository's SDK and example widget. Dedicated starter templates, self-contained SDK documentation, local preview tooling, and AI-friendly development instructions are on the roadmap.

Example prompt for a coding agent:

> Create a LifeDashboard widget using `packages/widget-sdk` and `examples/widgets/hello` as references. Build a responsive analog clock with a transparent background and subtle animations. Respect `widget.context.size`, `sizeClass`, theme tokens, and visibility. Provide `widget.json`, a Vue component, and a buildable widget folder. Do not use unavailable gateway operations.

The goal is to make custom widgets possible **without changing or rebuilding LifeDashboard itself**.

## Visual customization

LifeDashboard treats visual design as a first-class feature:

- A responsive-to-window-width board with square grid cells and explicit drag/resize editing.
- Built-in **Glass**, **Obsidian**, and **Paper** themes.
- Per-widget appearance: inherit the board theme, use another theme, or remove the frame.
- Configurable widget shadows, including shadows that can follow the shape of frameless content.
- A shared design-token vocabulary for consistent UI across widgets.
- Animations where they improve the experience, with consideration for reduced-motion preferences.

**Planned:** static and animated backgrounds, additional skins and themes, richer visual widgets, themed widget packs, and more flexible personalization. A frameless clock is one example of the intended direction: widgets should be able to feel like objects on a desktop, not just rectangles in a grid.

Theme contracts and token rules are documented in [`docs/theme-contract.md`](docs/theme-contract.md).

## Hermes Agent: optional intelligence

LifeDashboard's long-term AI layer is designed around **[Hermes Agent](https://github.com/NousResearch/hermes-agent)**. Hermes remains responsible for agent reasoning, sessions, tools, profiles, and memory-related capabilities. LifeDashboard provides the visual workspace and controlled interaction with these capabilities.

Planned integration includes a connection to an existing Hermes installation, discovery of supported API capabilities, conversations/sessions, relevant context from the active workspace, and AI-powered widgets where explicitly enabled.

Important boundaries:

- **Hermes is optional.** The dashboard, visual widgets, and local functionality must remain usable without it.
- **Hermes is managed separately.** LifeDashboard is not intended to bundle or replace the agent runtime.
- **No duplicate AI runtime.** LifeDashboard does not implement its own LLM agent loop or memory system.
- **Controlled access.** Widget or UI access to AI capabilities will go through the LifeDashboard backend, with explicit permissions and limits.
- **No provider lock-in for widget creation.** A widget may be authored with Claude Code, Codex, or another tool; Hermes is not required to build it.

The Hermes integration described here is **product direction, not a currently implemented feature**.

## Architecture

LifeDashboard is currently a TypeScript monorepo managed with pnpm:

```text
LifeDashboard UI (Nuxt 4 / Vue 3)
  ├── Widget board, themes, and package manager
  ├── Built-in Vue widgets
  └── Installed widgets (sandboxed iframes)
             │
             │ Host broker / permissions / HTTP API
             ▼
LifeDashboard Core (Fastify)
  ├── Authentication and pairing
  ├── Rooms and board persistence
  ├── Widget package registry and gateway
  └── SQLite storage

Planned: Tauri desktop host; optional Hermes Agent adapter
```

| Path | Responsibility |
| --- | --- |
| [`apps/ui`](apps/ui) | Nuxt SPA, board editor, widgets, appearance, package UI, and sandbox host. |
| [`apps/api`](apps/api) | Fastify API, authentication, persistence, package management, and widget gateway. |
| [`packages/contracts`](packages/contracts) | Shared TypeScript contracts, validation, grid and package formats. |
| [`packages/widget-sdk`](packages/widget-sdk) | Public widget-facing API, sandbox runtime, and build CLI. |
| [`examples/widgets`](examples/widgets) | Example and security-test widget projects. |
| [`docs/theme-contract.md`](docs/theme-contract.md) | Theme token contract and validation rules. |

The current UI runs in a browser with a local API. **Tauri packaging is a future delivery target**, not the current runtime. The desktop version is intended to reuse the same UI and backend rather than maintain a second implementation of the application.

## Run locally

### Requirements

- **Node.js 24 LTS** (see [`.nvmrc`](.nvmrc))
- **pnpm 10.30.2**, selected by the root `packageManager` field via Corepack
- A desktop browser at **1280 px width or more**; narrow-screen and mobile layouts are not supported yet

### Start the development app

```bash
corepack enable
pnpm install
cp .env.example .env  # optional; the defaults are usable without .env
pnpm dev
```

Development services:

- UI: <http://127.0.0.1:3000>
- API: <http://127.0.0.1:3001>
- Health check: <http://127.0.0.1:3001/health>

The API writes a **six-digit pairing code** to the terminal. Open the UI, enter the code, and start using the board. The code expires after 10 minutes; a new code can be requested. Use `127.0.0.1` rather than `localhost` unless you explicitly configure that origin.

### Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the API, UI, and supporting workspace development tasks. |
| `pnpm build` | Build the API and generate the static UI. |
| `pnpm typecheck` | Run TypeScript checks across the workspace. |
| `pnpm test` | Run the available Vitest test suites. |
| `pnpm -C examples/widgets/hello build` | Build the example installable widget. |

`pnpm build` produces the compiled API in `apps/api/dist` and static UI output in `apps/ui/.output/public`. **This is not yet a packaged desktop installer.**

### Configuration

Environment variables can be set in a root `.env` file or passed through the process environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LIFEDASHBOARD_API_PORT` | `3001` | Fastify port and target for the Nuxt development proxy. |
| `LIFEDASHBOARD_DATA_DIR` | OS-specific user data directory | Directory containing `lifedashboard.db`. |
| `LIFEDASHBOARD_UI_ORIGINS` | `http://127.0.0.1:3000` | Comma-separated origins permitted to call the API. |

On macOS, the default data directory is `~/Library/Application Support/LifeDashboard`. Environment variables override the values in `.env`. See [`.env.example`](.env.example).

## Roadmap

The roadmap describes intended directions rather than release promises or delivery dates.

1. **Widget experience:** polish the board editor, broaden the built-in library, improve animations and appearance controls, and support static/animated backgrounds.
2. **Widget SDK developer experience:** stable versioned contracts, starter projects, documentation tailored to human and AI developers, preview tooling, and richer asset support.
3. **Workspace organization:** multiple editable rooms/screens, presets, portable layouts, and import/export of configurations.
4. **Widget ecosystem:** practical and decorative widget collections, themed packs, easier package discovery and updates, and optional independently sold premium packs.
5. **Data and AI integrations:** permission-controlled data sources, external service access, device integrations, and Hermes sessions/conversations and AI-powered widgets.
6. **Desktop release:** Tauri packaging, native lifecycle and security checks, installation, and platform-specific testing.

The order may change based on actual usage and implementation constraints. **A strong, delightful widget platform comes before a large collection of unrelated productivity features.**

## Security and privacy

LifeDashboard is designed to be **local-first**, with the API bound to the loopback interface and project data stored locally in SQLite. The initial implementation includes pairing-based authentication, request origin checks, and permission-aware widget operations.

Installable widgets run inside sandboxed iframes and communicate with the host through a constrained message bridge. Packages cannot directly use arbitrary host APIs through the Widget SDK. Currently supported permissions are `state` and `notifications`; notification calls may require confirmation depending on the saved grant mode.

Sandboxing **reduces risk but is not a guarantee against all malicious or resource-intensive code**. Only install widget packages from sources you trust. Future native, network, or AI capabilities will require separate security review and explicit authorization.

There is no mandatory cloud account or hosted backend in the current architecture. A mobile app, cloud sync, and multi-user service are not initial goals.

## License and distribution

LifeDashboard is licensed under the **[MIT License](LICENSE)**.

The core application and the Widget SDK are intended to remain open and extensible. Independently distributed widgets, artwork, animations, or premium widget packs may have **their own clearly stated licenses**; the MIT license of this repository does not automatically apply to separate products that are not included in it.

## Contributing

Bug reports, ideas, and contributions are welcome through the repository's [GitHub Issues](https://github.com/csscoder/HermesLifeDashboard/issues) and pull requests.

Before contributing, review the existing TypeScript contracts, follow the widget permission model, add or update tests for behavior changes, and keep claims about shipped features separate from roadmap items. The implementation and test suites are the reference for **current behavior**; this README defines the **product direction**.

---

**LifeDashboard is an open canvas for your personal desktop: use the widgets you love, build the widgets you need, and make the whole space your own.**
