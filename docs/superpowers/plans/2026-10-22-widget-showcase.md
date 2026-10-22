# Widget showcase implementation record

Approved requirements: [spec](../specs/2026-10-22-widget-showcase.md). This consolidates the working plan used for parallel implementation.

1. Implement clock, counter and weather in separate example folders. Use existing Vitest conventions and RED → GREEN for time, persistence and weather lifecycle/parser behavior.
2. Update only the workspace lockfile importers. Run each example's check, tests, typecheck and build.
3. Import built folders through the dashboard package UI in an isolated dataset. Review default/minimum sizes and light/dark themes. Verify persisted counter state and real gateway weather data.
4. Resolve independent review findings, capture authentic screenshots and add README source links, build instructions and weather attribution.
5. Run full repository tests, typecheck and build; inspect the final diff and document any limits in the [verification report](../reports/2026-10-22-widget-showcase.md).
