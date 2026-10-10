# Widget runtime: installable widget packages in a sandbox — frozen outcome

Feature ID: widget-runtime-sandbox
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-09T09:50:40Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Package format and validation in packages/contracts (widget-package.ts with PACKAGE_LIMITS, canonical hash), gateway operations, RPC message types and bridge limits (widget-gateway.ts), built-in manifests shared by API and UI, and the WidgetSource package variant. (evidence: [code-vs-spec], [git-history])
- API: migration 2 (widget packages, versions, grants, widget_state, widget_audit, source_version), package inspect/install/list/delete routes with PACKAGE_IN_USE, in-memory widget sessions (200 max, 1-hour idle) and the gateway pipeline with state and notifications operations. (evidence: [code-vs-spec], [git-history])
- Sandbox serving under /sandbox with a per-package document, import map and strict CSP, and the Nuxt dev proxy. (evidence: [code-vs-spec], [git-history])
- packages/widget-sdk: useWidget, the transport-neutral widget, port client, sandbox bootstrap and the ld-widget build CLI; examples/widgets/hello and hostile. (evidence: [code-vs-spec], [git-history])
- UI: broker with handshake by event.source and bridge limits, packages dialog and picker, in-process host for built-ins and a sandboxed iframe host for packages; README and base design updated. (evidence: [code-vs-spec], [git-history])

## Accepted decisions
- Trust boundary: widgets compiled into the app run in-process; every installed package, including the owner's own, runs in an iframe with sandbox="allow-scripts" served by Fastify per package version. Chosen over srcdoc and Worker + remote-dom because an opaque origin blocks the host DOM, cookies and storage, CSP is an HTTP header, and documents are cacheable. Infinite loops cannot be stopped without Worker/QuickJS, which break ordinary Vue; this is a documented residual risk. (evidence: [spec-doc])
- Identity: the bridge handshake is checked by event.source and then moves to a transferred MessagePort; widget identity is a host-created session bound to the dashboard session, package version and grants, and the gateway never trusts an id sent by the widget. Rate limits key on (widgetId, op), so a new session does not reset them. (evidence: [spec-doc], [code-vs-spec])
- Package format: one *.ldwidget.json file (at most 1 MB, 20 flat files, only .js and .css) validated by hand-written code, stored in SQLite keyed by sha256; versions are immutable; grants are per package from manifest permissions, and a new version with new permissions shows the permissions screen again. (evidence: [spec-doc], [code-vs-spec])
- The SDK is async in both hosts so a widget moves between in-process and sandbox unchanged; the sandbox uses the lockfile Vue runtime through an import map; the sandbox document has no instance data and the host pushes theme tokens, size and rootFontSize over the port. (evidence: [spec-doc])
- Deviations from the base design: custom component widgets are isolated instead of running in-process as an accepted risk; packages are built by developers with ld-widget build rather than compiled by Fastify; gateway operations use w.call(op, input) with only state and notifications in this slice; widget-sdk is created now rather than at E6. (evidence: [spec-doc])
- New dependencies approved with the spec: vite and @vitejs/plugin-vue as devDependencies of widget-sdk, and vue as a dependency of apps/api to serve the runtime file. (evidence: [spec-doc])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-08-widget-runtime-sandbox.md` → [plan](plan.md)

## Areas and modules
contracts, api, ui, widget-sdk, examples

## Git state
Repository root: .
Branch: alex/go-4-povisit-bezopasnost
HEAD commit: f4ab72c41c5e8d1033e37f1daa3bc8bb0e6af8c3
Describe: f4ab72c
Working tree: dirty
Uncommitted changes are not attributed to this feature automatically.

## Implementation evidence
Reported status: completed; evidence: [git-history], [code-vs-spec].

## Verification
Reported status: unverified.
- Command/check: pnpm typecheck, pnpm test and pnpm build (plan Task 14 step 1), as covered by the GO-4 post-merge run of test and typecheck
  Result: unverified; exit code: not recorded; evidence: [go4-postmerge-tests].
- Command/check: Browser acceptance of the plan's Task 14 (install, state, conflict, theme, hostile package, frame attributes, delete rules, session renewal); only the hostile-package boundary was observed, indirectly, in the GO-4 Task 11 report
  Result: unverified; exit code: not recorded; evidence: [go4-task11-report].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: unverified; evidence: not recorded.

## Deviations from plan
- Change: The plan adds an UNAVAILABLE widget error code (network or API down) that the spec does not list; the code defines it in widget-gateway.ts.
  Reason: Stated in the plan: the spec has no code for that case.
  Effect: Widget-side errors carry UNAVAILABLE in addition to the gateway codes, TIMEOUT and BRIDGE_CLOSED.
  Evidence: [plan-doc], [code-vs-spec].

## Consciously excluded scope
- Out of scope per the spec: admin UI, secrets, grant revocation and audit log view; data sources, http.get and Hermes operations; project template, hot reload and Hermes-generated packages; switching a placed widget to another version, instance config UI; package signing, install from URL or git, a catalog; Worker or QuickJS execution; Tauri notification plugin and IPC check (E7); MCP Apps; serving the built UI from Fastify. (evidence: [spec-doc])

## Confirmed follow-ups
- Tauri E7 must verify that guest frames cannot reach Tauri IPC on macOS and Windows and that capabilities are scoped to the main window. (evidence: [spec-doc])
- hostile-1.0.0 did not complete the handshake in one embedded-browser session while a cache-busted copy did; the cause was not established (candidate: a stale immutable-cache entry). (evidence: [go4-task11-report])

## Limitations and unresolved risks
- Residual risks stated in the spec: an infinite loop in a frame can freeze the dashboard when the WebView runs frames in-process; a frame can navigate itself once to an external URL and leak data it holds. (evidence: [spec-doc])
- No implementation-review report, test log or Task 14 browser acceptance report was found for this feature. (evidence: [git-history])
- Later work changed parts of this spec: the sizing bound (12x8 in the spec text) was widened by the fluid board grid, and operation confirmation with grant modes was added on top of the gateway pipeline (see the spec's Operation confirmation paragraph). (evidence: [git-history], [spec-doc])

## Evidence register
- [spec-doc] file: docs/superpowers/specs/2026-10-08-widget-runtime-sandbox-design.md
  Design for sub-project 1 of the widget platform: hybrid runtime (built-ins in-process, installed packages in a sandboxed iframe served by Fastify), one-file *.ldwidget.json packages, useWidget() SDK, MessagePort bridge with a handshake checked by event.source, widget sessions bound to the dashboard session, a gateway pipeline with permission checks, rate limits and audit, state and notifications operations, nine acceptance criteria. Includes the later 'Operation confirmation' pointer paragraph.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: a759edd11d0d024d4444fe453204bba90104ad0987c76ad187ffb46e852a2ab4
- [plan-doc] file: docs/superpowers/plans/2026-10-08-widget-runtime-sandbox.md
  Fourteen-task plan (contracts, gateway contracts, migration 2, package routes, widget sessions and gateway, widget-sdk, sandbox bootstrap, sandbox serving, ld-widget CLI and examples, UI broker, packages dialog, in-process and sandbox hosts, base design and README, full verification and browser acceptance). All checkboxes are unticked; that is not evidence of the implementation state. It adds an UNAVAILABLE widget error code that the spec does not list.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 13fb8c7b6302c8dc4a47b7860484dda86430af2f7aa188aa8379d08bfe16c396
- [git-history] session: This session: git log for both source files, git log --reverse for the repository, git diff --stat 4876fd6..1132bbf, git show 82a5d47 --stat
  Spec 4876fd6 and its Codex-review fix b3e616a (2026-10-08); implementation commits 82654f3, 11957c7, 8fc7f04, d2eb662, ed79294, 4b8f430, 5fb0e5f, 3705f03, c56f254, 27447d5, a173b8d, ec6361c and docs 1132bbf (2026-10-08), one or more per plan task 1-13; the plan was committed afterwards in e92b1c2; 4876fd6..1132bbf changes 75 files across contracts, api, ui, widget-sdk, examples, README and pnpm files. Spec paragraph on operation confirmation added in 82a5d47. The later fluid-board-grid commits (36fb095..22c23d6) changed widget-package.ts and builtin-widgets.ts sizing bounds.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [code-vs-spec] session: This session: greps of packages/contracts/src/widget-package.ts and widget-gateway.ts, apps/api/src/{sandbox,widget-gateway,widget-packages,errors,migrations}.ts, apps/ui/app/widgets/{broker.ts,SandboxWidget.vue}, packages/widget-sdk/src/sandbox.ts and directory listings of apps/*/test, packages/widget-sdk, examples/widgets at HEAD f4ab72c
  Present and matching the spec at the grep level: PACKAGE_LIMITS 1 MiB/20 files/id 100/text 60; STATE_MAX_BYTES 65536; bridge maxMessageBytes 131072; SESSION_EXPIRED 401 and PACKAGE_IN_USE 409; MAX_SESSIONS 200 with 1-hour idle expiry; sandbox.ts with default-src 'none', connect-src 'none', a script-src with explicit URLs and the import-map sha256, and immutable caching; iframe sandbox="allow-scripts"; broker hello check by event.source and sandbox 'ld:hello'/'ld:init' handshake; migrations with widget_packages and source_version; widget-sdk (cli, build, port-client, sandbox, widget, theme), examples/widgets/hello and hostile, README section on packages; test files for api, ui broker and catalog, widget-sdk and contracts. UNAVAILABLE exists in widget-gateway.ts. Test bodies and most implementation code were not read.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [go4-task11-report] file: .superpowers/sdd/2026-10-09-widget-op-confirmation/task-11-report.md
  Browser acceptance for a later feature (GO-4 operation confirmation) in Orca's built-in browser, run on the code containing this runtime. Check 9 with a hostile package showed document.cookie, parent.document and localStorage blocked with SecurityError, fetch /api/v1/rooms blocked with TypeError, and an ungranted notifications.send answered PERMISSION_DENIED. Anomaly: hostile-1.0.0 never completed the handshake in that browser session (10 s hello timeout; cause not established, a cache-busted copy worked). It is not a run of this spec's acceptance list.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 5ea118c2fec4ff9c32502d227cfcd8ee80eebb78b05f5f969646449016191752
- [go4-postmerge-tests] session: This session: read of evidence entry tests-postmerge in the frozen GO-4 archive metadata (.project-history/features/2026-10-09-go-4-widget-operation-confirmation/metadata.json)
  Attested by another session: on the tree merged with main (which contained this runtime) the per-package suites reported contracts 141, widget-sdk 19, api 160, ui 264 passed, 0 failed and pnpm typecheck exit 0; the test exit code was not printed. Indirect evidence about the whole tree, not a run of this feature.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
The user named the spec explicitly. The plan names it as its Spec, shares its title scope (packages in a sandbox, gateway with state and notifications, 13 implementation tasks plus Task 14 acceptance) and was committed in e92b1c2, after the implementation commits 82654f3..1132bbf. The spec was read in full. It was approved on 2026-10-08, corrected after Codex review (b3e616a), and received one added paragraph, 'Operation confirmation', in 82a5d47 on 2026-10-09; the working-tree spec includes that paragraph and is archived as the current accepted version, so it is slightly newer than the version the implementation commits were built from. Neither file has uncommitted changes or a draft/obsolete/superseded marker. The plan's goal, architecture, global constraints, review focus, file map, task headings and Tasks 13-14 (and Task 12 verification step) were read; the bodies of Tasks 1-12 (about 5000 lines of code and tests) were not read line by line. Both files were grep-scanned for secret patterns with no hits. No tracker key exists in the materials, so the ID is the spec slug. Implementation evidence: commits 82654f3..1132bbf on main-reachable history plus the current code at f4ab72c. No implementation-review report, test log or Task 14 acceptance report exists for this feature; verification and review are recorded as unverified. Areas come from the paths changed by the implementation commits.
Evidence: [spec-doc], [plan-doc], [git-history], [code-vs-spec].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Working tree was dirty; uncommitted changes are not attributed to this feature automatically.
- Completion date not recorded; completedAt remains null.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User authorized archiving with incomplete evidence: no implementation review, test log or Task 14 acceptance report exists for this feature

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
