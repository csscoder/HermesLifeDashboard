# Focus sessions

A small, installable LifeDashboard SDK example: a progress ring, a session goal and two controls backed by real instance-local persistence. New instances start at zero.

From the repository root:

```sh
pnpm install
pnpm -C examples/widgets/showcase-counter dev
pnpm -C examples/widgets/showcase-counter check
pnpm -C examples/widgets/showcase-counter test
pnpm -C examples/widgets/showcase-counter typecheck
pnpm -C examples/widgets/showcase-counter build
```

Install the generated `dist/dev.lifedashboard.showcase.counter-1.0.0/` folder through LifeDashboard's widget package dialog. Source entry: [`src/index.vue`](src/index.vue); manifest and settings: [`widget.json`](widget.json).

Configure **Title** and **Session goal** (default 8) in the dashboard's widget settings. Use **Edit progress** to open the named workspace and save a nonnegative safe integer. The workspace displays the goal read-only, reloads conflicts for review and closes only after a confirmed save. The compact runtime remounts and reads persisted progress after every close. The count also changes through **Add session** and the minus button; it persists across reloads and has no calendar reset. Counts may exceed the goal and never go below zero.

The widget requests only `state`. It uses `useWidget().state`, theme tokens and the host's frame; it makes no network request and uses no browser storage. A revision conflict reloads current progress and retries the click once. An unconfirmed save requires reloading progress, so a lost response cannot silently replay a session. Invalid saved progress stays untouched and disables editing.

The default size is 6 × 6; the minimum is 4 × 4. Controls have accessible labels and focus indicators. Progress motion follows `prefers-reduced-motion`. [`test/counter.test.ts`](test/counter.test.ts) covers persistence, concurrent changes, failures and invalid saved data.

[`src/CounterWorkspace.vue`](src/CounterWorkspace.vue) demonstrates a separate modal runtime with shared revision-based state; [`test/modal.test.ts`](test/modal.test.ts) compiles the real component and tests saves, conflicts, malformed data, timeouts and pending writes.
