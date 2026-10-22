# Widget SDK agent knowledge — frozen outcome

Feature ID: widget-sdk-agent-knowledge
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-22T05:25:00Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Contracts: optional manifest field frame ('framed' default, 'frameless'), requires sdk 3; parseManifest checks sdk before unknown keys; SDK_LEVELS [1, 2, 3]; SDK_TARGET_LEVEL 3; WIDGET_ERROR_CODES tuple (commits bed22eb). (evidence: [ev-spec], [ev-plan], [ev-commits])
- Board: a widget instance whose package manifest declares frameless is created with appearance builtin:bare and shadow null; only at creation (commit 3c8571c, addInstance). (evidence: [ev-spec], [ev-commits])
- Dev shell starts in the manifest frame; the URL frame parameter still overrides it (commit 4e0d426). (evidence: [ev-plan], [ev-commits])
- create-widget: optional title, slug derivation from any title (transliteration of Cyrillic, NFKD), --slug override, folder lifedashboard-<slug>/, id dev.local.<slug>, project name <slug> (commit 47a5682). (evidence: [ev-spec], [ev-commits])
- create-widget: title prompt on a TTY only; non-TTY without a title fails with a directed error; dependency install with the calling package manager, --no-install flag (commit db9ca19). (evidence: [ev-spec], [ev-commits])
- create-widget: copies the lifedashboard-widget skill as regular files to .claude/skills and .agents/skills; template AGENTS.md expanded (commit 88ec5d5). (evidence: [ev-spec], [ev-commits])
- widget-sdk: docs pages (index, api, runtime, errors, design, settings, recipes, workflow) rendered from docs-src with platform constants into docs/, shipped in the package (commit 5dfed3b). (evidence: [ev-plan], [ev-commits])
- UI: starter-prompt block in the packages dialog with the create command and an agent task sentence (commit da7cb37). (evidence: [ev-plan], [ev-commits])
- README: create quickstart, contributor tarball steps, frame field and sdk 3 in the SDK section, roadmap items for the create flow removed (commits d9910be, b04fda9). (evidence: [ev-commits])
- Acceptance runs in the plan 4 round 5 report exercised create, check, build, import and frameless widgets built from the f7ddb99 tarballs (10 runs, recorded as pass). (evidence: [ev-acceptance-r5])

## Accepted decisions
- The frame field lives in the manifest and needs sdk 3; parseManifest checks sdk before unknown keys so that a newer manifest gets 'needs a newer LifeDashboard' instead of 'unknown field'. Rationale: an installed parser cannot be changed by a new SDK. (evidence: [ev-spec])
- The manifest frame default applies only when an instance is created; later package versions do not change existing instances, and board export and import are unchanged. Rationale: appearance already persists in the board, and the user can change the frame afterward. (evidence: [ev-spec])
- create derives the technical name by transliteration and never translates titles to English, because automatic translation adds complexity. Titles with no Latin form need --slug. Rationale: the user gives the title in any language; the technical name is derived automatically. (evidence: [ev-spec])
- create is non-interactive whenever the title is given or stdin is not a TTY, so an agent never hangs; it installs dependencies with the package manager that ran it. Rationale: one command must be enough for the user. (evidence: [ev-spec])
- The skill ships in create-widget and is copied as regular files into .claude/skills and .agents/skills, not symlinked. Rationale: the SDK is not installed when create writes files, and symlinks can break when a project is copied or zipped. (evidence: [ev-spec])
- Package docs are rendered from platform constants and committed; a drift test compares them with a fresh render. Rationale: docs must state the enforced limits and names, not hand-copied values. (evidence: [ev-spec], [ev-plan])
- The only new dependency is vite 8.3.2 as a devDependency of create-widget, used to bundle contracts into the CLI; the user approved it on 2026-10-20. Rationale: the real title check ships with the CLI without a hand-copied rule. (evidence: [ev-plan])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-20-widget-sdk-agent-knowledge-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-20-widget-sdk-agent-knowledge.md` → [plan](plan.md)

## Areas and modules
Not recorded.

## Git state
Repository root: .
Branch: main
HEAD commit: 5cecd9dfb0f62024ebe306c36cb42a9d020cfdc5
Describe: 5cecd9d
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ev-spec], [ev-plan], [ev-commits].

## Verification
Reported status: unverified.
- Command/check: Plan Task 10 whole-repo check, pnpm typecheck and pnpm test from the repository root, plus the pack and unpacked-CLI check. Not run for this archive and not recorded in the repository.
  Result: not-run; exit code: not recorded; evidence: not recorded.
- Command/check: Observed manual acceptance runs recorded in the plan 4 round 5 report: create, check, build, import and frameless rendering of agent-built widgets on f7ddb99 (10 runs, all recorded as pass). Not an executed command in this session.
  Result: passed; exit code: not recorded; evidence: [ev-acceptance-r5].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: not recorded.

## Deviations from plan
Deviations: not recorded / unverified. No absence claim is made.

## Consciously excluded scope
- The acceptance run with a fresh agent (plan 4); publishing to npm and a release pipeline; translating widget titles; agents beyond the AGENTS.md baseline; MCP server, marketplace and CLI-to-dashboard connection; any new gateway capability, permission or wider network reach (spec Non-goals). (evidence: [ev-spec])

## Confirmed follow-ups
- Run the Task 10 whole-repo check (pnpm typecheck and pnpm test from the root, then pack and an unpacked create run with --no-install) and record the result. No result is recorded. (evidence: [ev-plan], [ev-commits])
- Review the code of plan 3 against the plan and spec; the only reviews on record are of the spec and plan documents. (evidence: [ev-commits])
- Review the four open findings listed in the plan 4 round 5 report (screenshot recipe, dev-shell overflow probe, keychain dialog, placement failure message); their current status is not verified here. (evidence: [ev-acceptance-r5])

## Limitations and unresolved risks
- Installed skill copies lag behind later SDK upgrades, because the skill ships with create-widget and is copied at create time (spec, Skill). (evidence: [ev-spec])
- Widgets built with sdk 3 need a dashboard that supports level 3; accepted in the spec because nothing was published yet. (evidence: [ev-spec])
- Test runs for the new create, contracts and widget-sdk behavior are not recorded, so the unit-level behavior is not verified by any record in the repository. (evidence: [ev-plan], [ev-commits])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-20-widget-sdk-agent-knowledge-design.md
  Approved design (status line updated to approved in commit 2d3a66d). Intent: an installed agent builds a frameless, themed widget from one sentence without reading LifeDashboard sources. Decisions: the frame manifest field requires sdk 3 and parseManifest checks sdk before unknown keys; a frameless default applies only when an instance is created, so later package versions do not change existing instances; create installs dependencies, is non-interactive when a title is given or stdin is not a TTY, and derives a Latin slug by transliteration (no machine translation), with --slug as the override; the skill lives in create-widget and is copied as regular files into .claude/skills and .agents/skills, because the SDK is not installed yet when create runs; docs are rendered from platform constants with a drift check. Non-goals: the acceptance run (plan 4), npm publishing, title translation, other agents beyond the AGENTS.md baseline, MCP, and new gateway capabilities.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: e0f3adcc832d27204e42e404d315cfcad66b3c2877fa8d863cbac80b9432feeb
- [ev-plan] file: docs/superpowers/plans/2026-10-20-widget-sdk-agent-knowledge.md
  Ten tasks: Task 1 frame field, sdk 3 and sdk-first parsing; Task 2 frameless placement on the board; Task 3 dev shell starts in the manifest frame; Task 4 slug and lifedashboard- folder; Task 5 CLI title prompt, flags and dependency install; Task 6 skill and full AGENTS.md; Task 7 generated package docs; Task 8 starter prompt in the packages dialog; Task 9 README; Task 10 whole-repo typecheck, test run and pack check. Global constraints: no new dependency except vite 8.3.2 as a devDependency of create-widget (approved by the user on 2026-10-20). All plan checkboxes are unchecked, which records nothing either way. The plan's review commits (0435396, 4f46b75, b7a4ca9) are reviews of the plan document.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: fc5d9783702d8f55b24ad8882c8aa89a0d1ac717ca402dc6040f5a6c6a88c325
- [ev-commits] session: This archive session, Bash on branch main at HEAD 2d3a66d: git show --stat 2d3a66d; git show 2d3a66d -- docs/superpowers/specs/2026-10-20-widget-sdk-agent-knowledge-design.md; git log --format='%h %ad %s' --date=short -- docs/superpowers/reports/; git log --format='%h %ad %s' --date=short --since=2026-10-20 -- packages/create-widget packages/widget-sdk packages/contracts apps/ui/app/widgets; git merge-base --is-ancestor <each plan commit> f7ddb99; git log --oneline -- README.md; grep and ls checks in the working tree on the symbols and files named above.
  Implementation commits, by plan task (matched by subject): bed22eb feat(contracts) frame field, sdk 3, sdk-first parsing (Task 1); 3c8571c feat(ui) frameless placement (Task 2); 4e0d426 feat(widget-sdk) dev shell starts in the manifest frame (Task 3); 47a5682 feat(create-widget) slug and lifedashboard- folder (Task 4); db9ca19 feat(create-widget) title prompt on a TTY and dependency install (Task 5); 88ec5d5 feat(create-widget) skill for Claude Code and Codex and expanded AGENTS.md (Task 6); 5dfed3b feat(widget-sdk) docs generated from the platform constants (Task 7); da7cb37 feat(ui) starter prompt (Task 8); d9910be and b04fda9 docs for the create flow and README roadmap cleanup (Task 9). Task 10 has no commit or record. All of these are ancestors of f7ddb99. Tree spot checks passed for: frame in contracts widget-package.ts (MANIFEST_KEYS, sdk 3 rule); SDK_LEVELS [1, 2, 3] and SDK_TARGET_LEVEL 3; addInstance in apps/ui/app/board/edit-session.ts; frame in widget-sdk src/dev/shell-state.ts; SLUG_PATTERN and slugFromTitle in create-widget src/slug.ts; install.ts, prompt.ts, scripts/build.ts; the skill copy in src/create.ts; skill/lifedashboard-widget/SKILL.md; packages/widget-sdk/docs and docs-src with the eight pages; starter-prompt.ts used by PackagesDialog.vue; README create quickstart; the template AGENTS.md (29 lines, no Hermes or MCP). Not checked: that tests pass. Commits 2c118a4 and 373f0fb (2026-10-21) are later widget-sdk fixes from the acceptance rounds and are not claimed here.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-acceptance-r5] file: docs/superpowers/reports/2026-10-21-widget-sdk-acceptance-round5-report.md
  Plan 4 acceptance report, full rerun of 10 agent runs (5 Claude Code, 5 Codex) on main at f7ddb99, with SDK and create-widget tarballs rebuilt from that commit. The report records that every run passed create, check, build and import on the first attempt, that every agent kept its title, and that the frameless criterion passed for the clock and decorative widgets (claude-1, codex-1, claude-3, codex-3), with 121 of 121 sizes checked. It does not record unit or whole-repo test results. Its four open findings concern the headless screenshot recipe, a false overflow in the dev shell before the first measure, a macOS keychain dialog in headless Chrome, and the lack of a placement failure message. Later commits bbf3f7f and 2c118a4 touch the overflow probe and headless screenshots; their effect is not verified here.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 4ce79e6e8d0532e05f0ebdea98a940802f23567ce88c48a618254c7714dddd98

## Source assessment
Read the full spec and plan (plan 3 of 4 in the widget SDK series). The spec header now reads 'Status: approved (implemented by plan 2026-10-20-widget-sdk-agent-knowledge).' after commit 2d3a66d, which changed only that line (1 insertion, 1 deletion). The controller made that status update on 2026-10-22 at the user's archival request; the earlier 'draft for approval' line was not an approval record. The plan header links the spec by path and uses the same slug; neither file has a draft, obsolete or superseded marker. Both files are committed and clean in the working tree at HEAD 2d3a66d. Implementation: commits bed22eb, 3c8571c, 4e0d426, 47a5682, db9ca19, 88ec5d5, 5dfed3b, da7cb37, d9910be and b04fda9 map by subject to plan Tasks 1 to 9, and all are ancestors of f7ddb99. Spot checks against the tree: manifest frame field, SDK_LEVELS [1, 2, 3] and SDK_TARGET_LEVEL 3 in contracts; addInstance in apps/ui/app/board/edit-session.ts; frame in widget-sdk shell-state; slugFromTitle and SLUG_PATTERN in create-widget; install.ts, prompt.ts and the skill copy in create.ts; the skill source under packages/create-widget/skill; the eight docs pages in packages/widget-sdk/docs and docs-src; starter-prompt.ts used by PackagesDialog.vue; the README quickstart. No code review record exists for plan 3. Task 10 (whole-repo typecheck and test run, pack check) has no recorded result, and this archive ran no tests. The plan 4 round 5 report records passing acceptance runs against the f7ddb99 tarballs, which contain these deliverables; it is cited only for those runs. Archive mode is incomplete-evidence by explicit user choice.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-acceptance-r5].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- Deviations from plan were not recorded; absence of deviations is not claimed.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
