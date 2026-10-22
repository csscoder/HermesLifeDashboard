# Analog clock

A frameless SVG clock for LifeDashboard. It shows the device's local time and date,
with a smooth second hand and a 24-hour digital complication. All colours and fonts
follow the host's theme tokens, including light themes.

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
pnpm -C examples/widgets/showcase-clock dev
pnpm -C examples/widgets/showcase-clock check
pnpm -C examples/widgets/showcase-clock build
```

Install `dist/dev.lifedashboard.showcase.clock-1.0.0/` through LifeDashboard's widget package dialog.
The widget defaults to 6×6 cells, supports 3×3 through 10×10, and keeps its circular
dial within the smaller side of a rectangular widget.

The clock requires no permissions, network requests, or saved state. It pauses work
while `widget.context.visible` is false and catches up when visible. The system's
reduced-motion preference replaces the smooth sweep with one-second ticks; changes
to that preference apply immediately. Timers and the preference listener are
released on unmount.

```sh
pnpm -C examples/widgets/showcase-clock test
pnpm -C examples/widgets/showcase-clock typecheck
```

Tests cover hand positions, subsecond carry, visibility, motion preferences, and
resource cleanup. The widget uses only Vue and the workspace widget SDK.
