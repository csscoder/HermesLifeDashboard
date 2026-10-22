# Widget package format v2 — frozen outcome

Feature ID: widget-package-v2
Status: incomplete-evidence
Completed at: not recorded
Archived at: 2026-10-22T05:24:45Z
Skill: archive-plan 1.1.1
Archive revision: 1

## Implemented scope and outcomes
- Contracts: v2 manifest (format 2), path classes, parseWidgetFolder, PACKAGE_LIMITS and SERVED_TYPES in packages/contracts (commit 72892d9). (evidence: [ev-commits])
- Storage helpers for userwidgets/<id>/<version>/, staging and orphan folders in apps/api/src/userwidgets.ts (commit 2996d9a). (evidence: [ev-commits])
- Versions on disk: function migrations, migration 6 that moves v1 files to disk, disk-backed install and sandbox (commit 1923cff). (evidence: [ev-commits])
- Sandbox serving: assets and code from disk, single Range requests, per-file Content-Type and CSP, document CSP with base href (commit d238150). (evidence: [ev-commits])
- Upload sessions in apps/api/src/widget-uploads.ts replace the .ldwidget.json install; v1 install routes removed; session kept alive during a PUT (commits 61291f3 and 86c0142). (evidence: [ev-commits])
- ld-widget build emits dist/<id>-<version>/ with assets/ and source/ (--no-source supported) and a path-independent build that rejects symlinks (commits a1e974c and f9800dc). (evidence: [ev-commits])
- UI: folder picker and drop, review screen, three-at-a-time upload with progress, cancel and retry, source and asset paths with copy buttons (commits 42fffe7, 3b6fc54 and d575344). (evidence: [ev-commits])
- Examples and docs: hello with a background video in assets/, hostile probes, README update; v1 format removed (commit 42039a3). (evidence: [ev-commits])

## Accepted decisions
- No shared libraries: each widget bundles its own libraries, and the import map keeps only vue and @lifedashboard/widget-sdk. Reason: each sandbox iframe is a separate JS realm, so a shared copy saves disk only and couples widgets to core library versions. (evidence: [ev-spec])
- The install unit is the folder dist/<id>-<version>/ from ld-widget build, so the host runs no build of foreign code. Install is UI upload only, with a review screen and immutable versions. (evidence: [ev-spec])
- Upload transport is a session: create with manifest and file list, one streaming PUT per file, then install. No new dependency; large files never sit in memory, and the package is validated before any media is sent. (evidence: [ev-spec])
- Code (.js .mjs .css .wasm in the package root) is capped at 10 MB total because WASM is executable code. assets/ and source/ have no size limit, so the user controls disk use. (evidence: [ev-spec])
- Files are stored on disk under <dataDir>/userwidgets/<id>/<version>/, and SQLite keeps metadata only. Version hash: sha256 over path and file-hash lines; the same id and version with another hash is a CONFLICT. (evidence: [ev-spec])
- v1 packages are replaced by v2 through a migration, and .ldwidget.json install is removed. Reason: one format and one storage path while the project is in early development. (evidence: [ev-spec])
- ld-widget build copies the project to source/ by default, and --no-source turns that off. Sources then survive deletion of the development folder, and a forgotten flag does not lose them. (evidence: [ev-spec])
- Sources are accessed through absolute paths of source/ and assets/ shown in the packages list with a copy button. Reason: Node has no zip writer, and a download would need a new dependency. (evidence: [ev-spec])
- Media is referenced by document-relative URLs assets/...; importing any audio or video file, or another media file over 100 KB, into code fails the build. Reason: Vite library mode inlines imported assets as data: URLs, and media-src does not allow data:. (evidence: [ev-spec])
- Workers are allowed only from blob: URLs, because an opaque-origin frame cannot construct a worker from an http URL. connect-src, media-src, img-src and font-src reach only the package, data: and blob:. (evidence: [ev-spec])

## Archived source map
Original links inside preserved documents are unchanged; linked external documents are not bundled.
- `docs/superpowers/specs/2026-10-10-widget-package-v2-design.md` → [spec](spec.md)
- `docs/superpowers/plans/2026-10-10-widget-package-v2.md` → [plan](plan.md)

## Areas and modules
Not recorded.

## Git state
Repository root: .
Branch: main
HEAD commit: 5cecd9dfb0f62024ebe306c36cb42a9d020cfdc5
Describe: 5cecd9d
Working tree: clean

## Implementation evidence
Reported status: completed; evidence: [ev-commits].

## Verification
Reported status: unverified.
- Command/check: pnpm typecheck && pnpm test && pnpm build && pnpm -C examples/widgets/hello build && pnpm -C examples/widgets/hostile build (plan Task 8 Step 5); no recorded result
  Result: unverified; exit code: not recorded; evidence: [ev-accept].
- Command/check: Orca built-in browser acceptance, plan Task 8 Step 6, checks 1-9 (v1 hello renders after migration, folder install, video seek, parent-folder error, source paths, restore from source/, hostile probes, direct SVG open, delete warning); no recorded result
  Result: unverified; exit code: not recorded; evidence: [ev-accept].
The archive helper did not execute these commands; results above are taken from the cited evidence.

## Review
Reported status: missing; evidence: [ev-review].

## Deviations from plan
- Change: Commit f210b1f (2026-10-19) changes the ld-widget source/ copy rule from an exclusion list to an allow-list. At HEAD, dot-prefixed names and node_modules are excluded and only the listed root files and src/ and test/ are copied.
  Reason: not recorded
  Effect: Spec build step 4 keeps other dot files such as .npmrc and .data.json; at HEAD they are not copied into source/. Other root files are also not copied unless they are on the allow-list.
  Evidence: [ev-later].

## Consciously excluded scope
- Audio beyond package-local audio and video playback (spec sub-project 2, Widget audio), shared or core-provided libraries, dev mode with a watched source folder, zip export or download of sources, Show in Finder, building packages on the host. (evidence: [ev-spec])
- Publishing the SDK outside the monorepo, rebuilding sources outside a LifeDashboard checkout, disk quotas for media, distribution as an archive file and package signing. (evidence: [ev-spec])

## Confirmed follow-ups
- Run pnpm typecheck, pnpm test, pnpm build and the hello and hostile example builds (plan Task 8 Step 5). No result is recorded. (evidence: [ev-plan], [ev-accept])
- Run the nine-item Orca browser acceptance (plan Task 8 Step 6). No result is recorded. (evidence: [ev-plan], [ev-accept])
- Reconcile the source/ copy rule at HEAD (f210b1f) with spec build step 4, either by restoring the spec's rule or by updating the spec. The decision is not recorded. (evidence: [ev-later])
- Widget audio is a separate sub-project with its own spec (spec Delivery decomposition). (evidence: [ev-spec])

## Limitations and unresolved risks
- No verification or browser acceptance result is recorded, so the v1 migration, Range and CSP serving, and the upload flow are unverified at 42039a3. (evidence: [ev-plan], [ev-accept])
- Self-navigation of the frame to an external URL remains the residual risk accepted in v1. (evidence: [ev-spec])
- Unlimited media quota lets a package fill the disk; the review screen shows sizes before upload starts. (evidence: [ev-spec])
- Migrated v1 versions have no source/. Reinstalling the same version from a v2 build is a CONFLICT because the hash scheme differs. (evidence: [ev-spec])

## Evidence register
- [ev-spec] file: docs/superpowers/specs/2026-10-10-widget-package-v2-design.md
  Approved design (status: approved design, 2026-10-10). Decisions: no shared libraries (import map keeps only vue and @lifedashboard/widget-sdk); install unit is dist/<id>-<version>/ from ld-widget build; install by UI upload only; upload-session transport; code (.js .mjs .css .wasm in the root) capped at 10 MB total; assets/ and source/ unlimited; files on disk under userwidgets/, SQLite keeps metadata; v1 replaced by v2 with a migration and .ldwidget.json install removed; ld-widget build copies source/ by default, --no-source turns it off; media by document-relative URL, audio/video imports and media over 100 KB fail the build; workers only from blob: URLs; connect/media/img/font limited to the package, data: and blob:. Out of scope: audio beyond package-local playback, shared libraries, dev mode, zip export, building on the host, publishing the SDK, media quotas, archive distribution and signing. Acceptance criteria 1-8.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: 716d83e48605b2374bd0361f9df7b929f07943eb70d85ec7ee4b04ac45b98cf8
- [ev-plan] file: docs/superpowers/plans/2026-10-10-widget-package-v2.md
  Eight tasks: contracts and folder validation; userwidgets storage module; function migrations, migration 6, disk-backed install and sandbox; sandbox serving with Range and CSP; upload sessions and v1 route removal; ld-widget build folder output; UI folder install; examples, README, v1 removal, full verification and browser acceptance. Every step checkbox is unchecked, which records nothing. Task 8 Step 5 (pnpm typecheck, pnpm test, builds) and Step 6 (nine-item Orca browser acceptance) have no recorded results in the plan.
  Inspected by caller: true; helper validation: bytes-hashed.
  Capture: reference-only; summary preserved, original body not captured.
  SHA-256: bbde245e6738de70280a8cdd335eabc5893dd23901b89423914a871e0f04f4fc
- [ev-commits] session: This archive session, read-only: git log --date=short --format='%h %ad %s' on the spec and plan paths; git log --date=short --format='%h %ad %s' --stat 72892d9^..42039a3; git merge-base --is-ancestor 42039a3 HEAD (true); git grep -n for classifyPath, parseWidgetFolder, SERVED_TYPES, PACKAGE_LIMITS, userwidgets, orphaned, readFolder, uploadFiles, the format 2 check and ldwidget; test -e on the named UI, API, SDK, contracts and example asset files.
  Task 1 contracts: 72892d9. Task 2 userwidgets storage: 2996d9a. Task 3 versions on disk, function migrations, migration 6: 1923cff. Task 4 sandbox Range and CSP serving: d238150. Task 5 upload sessions replace .ldwidget.json install: 61291f3, fix 86c0142. Task 6 ld-widget build folder: a1e974c, fix f9800dc. Task 7 UI folder install and source paths: 42fffe7, fixes 3b6fc54 and d575344. Task 8 examples, docs, v1 format removed: 42039a3. Symbols and files exist at HEAD: classifyPath, parseWidgetFolder, PACKAGE_LIMITS, SERVED_TYPES, apps/api/src/userwidgets.ts, apps/api/src/widget-uploads.ts, migration code in apps/api/src/migrations.ts, readFolder and uploadFiles in apps/ui/app/widgets, packages/widget-sdk/src/build.ts, examples/widgets/hello/assets/bg.mp4 and examples/widgets/hostile/assets/evil.svg. No 'ldwidget' match in apps, packages, examples or README.md.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-review] session: This archive session, read-only: git log --date=short --format='%h %ad %s' --since=2026-10-10 --until=2026-10-23 -- docs; git log -i --grep=review|accept|verif over 72892d9^..42039a3; git log --all -i --grep=acceptance|record.
  No committed code review record for this feature. Review commits in the docs history cover the spec only (a5ff1ee, docs: address Codex review findings in widget package v2 spec) or other features. No review commit exists for the plan or for the implementation commits.
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-accept] session: This archive session, read-only: grep of the plan for acceptance, result and status; git log of docs since 2026-10-10 and git log --all --grep=acceptance|record.
  No recorded result for pnpm typecheck, pnpm test, pnpm build, the hello and hostile example builds, or the Orca browser acceptance (plan Task 8 Steps 5 and 6). Acceptance and verification reports in the repository belong to other features (for example 8f2b6ef, 7a1b8ba, f94471d, 8f66234).
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.
- [ev-later] session: This archive session, read-only: git log --date=short --format='%h %ad %s' -- on the feature's files after 42039a3; git show f210b1f (diff of packages/widget-sdk/src/build.ts keepInSource); git show --stat d6daf17.
  f210b1f (2026-10-19, feat(widget-sdk): copy only an allow-list of project files into source/) replaces the exclusion rule in keepInSource. At HEAD, source/ copies only src/, test/, widget.json, package.json, lockfiles, widget-env.d.ts, AGENTS.md, CLAUDE.md, tsconfig*.json and README* at the root. Any segment starting with a dot and node_modules are excluded. This differs from the spec's build step 4. d6daf17 (2026-10-11, feat(api): store the network origins approved per package) changes migrations.ts, widget-packages.ts and widget-uploads.ts; it is not part of the plan. Other later commits also touch these files (for example 3c57251, 81870b5).
  Inspected by caller: true; helper validation: agent-attested-session.
  Capture: reference-only; summary preserved, original body not captured.

## Source assessment
Read the full spec (status: approved design, 2026-10-10) and the plan (eight tasks; read in full by section and by grep for status, acceptance and symbol references). Both use the slug widget-package-v2 and link each other by path. Neither has a draft, obsolete or superseded marker. The last spec commit is a5ff1ee and the last plan commit is c2fdb5e, both before the implementation commits. Implementation: commits 72892d9 through 42039a3 map to plan Tasks 1-8 (ev-commits). The files and symbols the plan names exist at HEAD (main, 927f5d0). No review and no verification or browser acceptance result is recorded for this feature (ev-review, ev-accept), so the archive uses incomplete-evidence mode by explicit user request. Later commits changed files this feature created (ev-later); the archive describes the feature as of 42039a3. Secrets: a grep of both source files for credential patterns found no credentials.
Evidence: [ev-spec], [ev-plan], [ev-commits], [ev-review], [ev-accept], [ev-later].

## Archive notes
- Explicit incomplete-evidence archive. Unsupported gates: review, verification, verification checks.
- Completion date not recorded; completedAt remains null.
- URL/session evidence is agent-attested; the helper does not fetch or independently verify it.
Incomplete-evidence authorization/reason: User requested on 2026-10-22 to archive every completed feature in docs/superpowers; recorded review or verification evidence is incomplete

This is historical evidence, not living project documentation. Sources were copied, not rewritten.
