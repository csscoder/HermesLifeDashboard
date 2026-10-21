# Workflow

A widget goes from project to built folder to the user's dashboard in four steps: `dev`, `check`, `build`, handover.

## Create

```sh
npm create @lifedashboard/widget -- "<title>"
cd lifedashboard-<slug>
```

The project folder is `lifedashboard-<slug>/`. Dependencies are installed. The project includes `AGENTS.md`, `CLAUDE.md` and the widget skill for Claude Code and Codex.

## dev

```sh
npx ld-widget dev
```

The dev server starts the shell. The shell shows the widget in a frame, at sizes between the manifest `min` and `max`, in every built-in theme, framed and frameless. It also shows a settings form generated from the schema and a log of gateway calls and errors.

- Runtime errors, CSP violations, gateway errors and content that overflows the frame are written to `.ld-widget/dev.log`.
- After each change, read `.ld-widget/dev.log` and fix every entry in it.
- Shell state is in the URL, so each combination can be opened and checked separately. Open the address `ld-widget dev` prints and add these query parameters:
  - `w`, `h`: the size in cells. Values outside the manifest `min`…`max` are clamped; a missing value uses `default`.
  - `theme`: a built-in theme id. An unknown id opens the first theme.
  - `frame`: `framed` or `frameless`. A missing value uses the manifest `frame`.
  - `confirm`: `allow` or `decline`, the answer the shell gives to confirmations.

  Example: `?w=4&h=3&theme=builtin:paper&frame=frameless`. Built-in theme ids:

{{THEME_IDS}}

- The shell and `.ld-widget/dev.log` need a browser. Without an open browser, take headless screenshots of the shell with an installed Chromium-based browser and look at each image. With `ld-widget dev` running, from the project folder:

  ```sh
  "<browser>" --headless --hide-scrollbars --window-size=1280,900 --virtual-time-budget=20000 \
    --screenshot=.ld-widget/shot-4x3-paper.png "<shell address>?w=4&h=3&theme=builtin:paper"
  ```

  - `<browser>`: on macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; on Linux `google-chrome` or `chromium`; on Windows the full path to `chrome.exe` or `msedge.exe`.
  - Take one screenshot per combination: min, default and max size, each theme, framed and frameless. The widget is at the top left, below the controls.
  - If the widget area is blank or still shows a loading state, take the screenshot again.
  - If the browser exits at start with no output, an agent sandbox is the usual cause. Ask the user to approve running the command outside the sandbox, or to run it themselves and share the image.
  - The headless run writes `.ld-widget/dev.log` like an open browser does.
  - Do not install a browser or packages for this. If no Chromium-based browser is installed, rely on `check`, `build` and the rules in [design.md](design.md), and tell the user that the layout was not checked visually.
- Everything an agent needs is in these docs and the `.d.ts` types; do not read the compiled files of the SDK.

Declared differences from production:

- The Vue development build is used for hot reload.
- Vite's client and its hot-reload WebSocket are allowed by the CSP.
- State is kept in memory or on disk, with the same size limit and revisions as production.
- HTTP goes through a dev proxy. It allows only the manifest `network` origins and applies the production limits, timeouts, header rules, rate limits and confirmation policy.

The dev shell does not reproduce every production behavior, so run `check` and `build` before handover.

## check

```sh
npx ld-widget check
```

`check` runs without a browser. It prints plain-text problems and writes `.ld-widget/check.json`. It checks:

- the manifest, the settings schema and secret bindings, for the declared `sdk` level;
- types, against the SDK types and the generated `widget-env.d.ts`, using the project's own `vue-tsc`;
- APIs that do not work in the sandbox or on the baseline (see [runtime.md](runtime.md));
- HTTP URL literals whose origin is not in the manifest `network` list;
- media: an MP4 without a WebM source, or audio without an Opus source, is an error;
- the build itself and the code size limit (see [runtime.md](runtime.md)).

Fix every reported problem. `check` does not verify codecs; media needs the engine checks below.

## build

```sh
npx ld-widget build
```

The output is `dist/<id>-<version>/`. It contains the code, `assets/`, and `source/`.

- `source/` is an allow-list: `widget.json`, `package.json`, lockfiles, `tsconfig*.json`, `AGENTS.md`, `CLAUDE.md`, `README*`, and the `src/` and `test/` directories. Dotfiles are never included. `build` prints what it put into `source/`.
- `--no-source` leaves `source/` out.
- Relative URLs only. Everything is bundled. The folder works the same on macOS, Windows and Linux.

## Handover

Give the user the folder `dist/<id>-<version>/`. The user imports it in the dashboard with «Виджеты → Выбрать папку».

- A built folder is portable and carries no credentials. Share it as it is.
- Sharing the project means sharing the source. Do not share `node_modules/`, `dist/` or `.ld-widget/`.

## Engine checks

For a widget with media, check playback in the target engines before handover: Safari on macOS and GNOME Web on Linux. Both must play the WebM and Opus files the widget uses.
