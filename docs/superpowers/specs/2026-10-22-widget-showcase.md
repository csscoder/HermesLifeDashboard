# Widget showcase

The user approved clock + counter + weather for the repository description. This records the approved scope consolidated during implementation; it does not authorize a release or a commit.

- Create three independently installable Vue SDK examples in `examples/widgets/showcase-{clock,counter,weather}`. Reuse installed dependencies and theme tokens.
- Clock: frameless circular SVG, real local time/date, no permissions, pause when hidden and respect reduced motion.
- Counter: configurable title and session goal, increment/decrement, instance-local persisted state, revision conflict and uncertain-save handling. Start at zero; no calendar reset.
- Weather: configurable city label and coordinates, real Open-Meteo conditions through the SDK gateway, no API key or fabricated fallback. Handle loading, errors, stale responses and visibility. Attribute the provider and document its free endpoint policy.
- Support declared minimum/default sizes and light/dark themes. Include focused tests and build/install instructions.
- Capture the real widgets in an isolated dashboard through Orca and add a README gallery with source links and adjacent weather attribution.

Existing SDK changes and the user's built-in clock edit stay untouched. No video, native-app replacement, new library, publication, branch, commit or push is included.
