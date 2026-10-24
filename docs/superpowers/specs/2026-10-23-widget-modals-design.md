# Widget modal applications

## Status and intent

Approved by the user in this session on 2026-10-23, after reviewing the design and interactive prototype. Prepare and review the implementation plan next. Do not create branches or commits.

Independent builder check completed: no important questions remain before planning. This is a design review, not evidence that the proposed runtime behavior has been implemented or verified.

An installable widget is the compact entry point to an application. Its developer can provide additional Vue screens from the same package and open them inside the dashboard's global modal. The dashboard owns the window; package code remains inside a sandbox.

## Decisions made with the user

- Use a second sandbox and a separate Vue application for modal content. The compact widget stays mounted on the board while the modal is open.
- Both surfaces act on the same widget instance and project, with the same API capabilities, permissions, settings and persisted widget state. The author controls data loading and application logic.
- Every completed modal close restarts the calling widget automatically. This includes the host close button, Escape and programmatic closing.
- Resetting the caller's local memory, selected tab and unsaved local input during that restart is explicitly acceptable. API data and `widget.state` must survive.
- There is no automatic shared reactive store between the two Vue applications.

## Approaches

1. Expand the existing sandbox and switch it to an extended view. It can retain one reactive application, but replaces the compact presentation during modal use.
2. Open a second sandbox in a dashboard modal. It preserves the compact presentation and supports an independent Vue screen. Data crosses through the existing API and persisted state rather than shared JavaScript memory.

The user selected approach 2 and requested automatic caller refresh on close. Running a package's Vue component directly inside the dashboard would break the existing isolation boundary and is excluded.

## Scope and non-goals

Deliver the SDK API, runtime and dashboard support, equivalent `ld-widget dev` behavior, documentation and one working example. Retain support for existing widget packages.

The first version supports installed package widgets. Built-in widgets keep their existing behavior; modal calls from an in-process widget without a registered modal runtime reject as unavailable.

Do not add dependencies, a new persistence model, a generic window manager, nested windows, drag/resize controls, arbitrary remote content, automatic shared stores, modal return values or a new permission. Do not change unrelated in-progress board/background work.

## Authoring contract

Keep `src/index.vue` as the package entry and its default export as the compact component. Optional named export `modals` registers modal components in the same module. Ordinary imports include their JavaScript and CSS in the existing widget build. The dashboard never imports this module itself.

```vue
<!-- src/index.vue -->
<script lang="ts">
import TaskWorkspace from './TaskWorkspace.vue'

export const modals = { workspace: TaskWorkspace }
</script>

<script setup lang="ts">
import { useWidget } from '@lifedashboard/widget-sdk'
const widget = useWidget()

async function openWorkspace() {
  await widget.modal.open('workspace', {
    title: 'Tasks',
    props: { projectId: 'example-project' },
  })
}
</script>

<template>
  <button type="button" @click="openWorkspace">Open tasks</button>
</template>
```

`TaskWorkspace.vue` receives ordinary Vue props, calls `useWidget()` for the same capabilities as the compact component and can call `widget.modal.close()` after awaiting its writes. Its internal navigation and child components are normal Vue application code.

The runtime selects the component from an own property of the local `modals` registry. View identifiers match `^[a-z][a-z0-9-]{0,63}$`. Missing registries/views reject the open request before the host allocates a modal when detectable in the caller runtime; the modal runtime independently checks its mount selector. Use the same mechanism in development and built packages. Verify that the existing library build preserves the named export and its styles.

## Public SDK

```ts
interface WidgetModal {
  open(view: string, options?: {
    title?: string
    props?: Record<string, JsonValue>
  }): Promise<void>
  close(): void
}
```

Add `modal: WidgetModal` to `Widget`. Use the repository's JSON type/validation where available; do not introduce a competing JSON framework.

- `open` resolves after the host accepts the request, reserves the modal slot and mounts its loading shell. It does not wait for closing or for application data to load. Ordinary bridge request deadlines apply.
- No close-result promise is exposed: the compact runtime will be destroyed at close. Save shared results through the API or `widget.state`.
- `props` defaults to `{}` and contains only finite JSON values, with no functions, components, proxies, DOM nodes, cycles or `undefined`. Bound nesting to 32 levels and encoded props to 64 KiB; the existing 128 KiB message bound still applies.
- `title` is optional plain text, 1–80 characters when supplied. Default to the package title. Render it as text, never HTML.
- `close` sends a one-way host control message from a modal surface. It makes no promise that a closing iframe can receive an acknowledgement. Calling it on a compact surface throws `WidgetError('UNAVAILABLE')`.
- A modal cannot open another modal. A busy global modal slot rejects opens, including repeated clicks from the original widget, with `UNAVAILABLE`. Invalid options or unknown views reject with `INVALID_INPUT`.
- A per-widget opening limit of 10 accepted opens per minute survives caller remounts and rejects excess opens with `RATE_LIMITED`. This is a proposed host UX limit, not a network permission or API quota.
- Request/display failures use existing `WidgetError` codes and the existing frame error presentation. A failed modal launch remains closable; closing it refreshes its surviving caller.

The limits, first-version exclusions and API shape above are design proposals by the implementer, subject to the user's approval of this document.

## Runtime, transport and identity

Treat modal opening/closing as host UI controls, separate from the backend `GatewayOp` permission table. The widget-facing `call` method retains its existing typed gateway contract. Reuse the bridge request/response framing and validation for `modal.open`; add a narrowly validated one-way close message for `close`.

The host binds requests to the already registered iframe/MessagePort and its immutable widget identity. Messages cannot choose a widget ID, package hash, source URL, API token or entry path. A modal mount selector contains only the validated view name and JSON props and reaches the new frame in its initialization message. Use the caller's pinned package hash/version. The sandbox runtime imports that package's entry and mounts the selected local component instead of its default export.

Keep `sandbox="allow-scripts"`, opaque origins, package CSP and the existing source-checked handshake. No arbitrary URLs, HTML, cross-document Teleport or component objects cross the bridge. Wire protocol version can remain 1 with a validated optional modal mount selector; extend the parser/tests explicitly rather than weakening existing message checks.

The modal uses a separate `GatewayClient` and widget session for the same `widgetId` and expected package source. Existing backend session creation supports multiple sessions; existing state storage and rate limiting are keyed by widget identity. Do not create a board widget, duplicate state, expose tokens or grant extra origins/permissions. Permissions and secret handling remain enforced by the existing gateway.

Give each surface an ephemeral confirmation owner separate from the persistent widget ID. Modal teardown cancels only its own queued/active confirmations and closes only its own session. Removing a widget cancels both surfaces. Preserve existing confirmation tests and the current widget-level removal behavior.

Modal context follows the caller's effective theme, settings, locale, secret-set flags and root font size. Its `visible` follows the modal/document, independently of board intersection. Use `frame: 'frameless'` for the modal content. Keep `size` and `sizeClass` as the owning widget's board geometry for compatibility; document that modal layout uses its actual iframe viewport through CSS/container queries, not grid cells. Do not add an unused layout API.

Target SDK level 4; retain levels 1–3. The package format and manifest fields do not change. Update generated declarations/docs and all supported-level messages/tests. New builds target level 4; older dashboards reject them through the existing newer-SDK error.

## Dashboard window behavior

Use the project's native `<dialog>` pattern and theme tokens. Allow one application modal globally, with its content in a separate sandbox. The header always identifies the originating package and displays the optional screen title; its close button remains outside package control.

Proposed default dimensions are `min(1120px, viewport width - 48px)` by `min(780px, viewport height - 48px)`. Constrain dimensions on short windows. Keep the header and close button visible, and give the iframe the remaining content area. No public size options in this version.

- Opening moves keyboard focus into the dialog. The board is inert while it is modal. Closing returns focus to the newly mounted caller's iframe, with a stable board fallback if that widget no longer exists.
- The host close button, Escape while focused in either the host or sandbox, and `widget.modal.close()` all reach one idempotent close path. Forward sandbox Escape through the authenticated bridge; allow the author to consume Escape for an internal menu before forwarding. Do not depend on cross-frame keyboard bubbling.
- Clicking the backdrop does not close the application, to reduce accidental loss of input. There is no unsaved-changes veto in this version. The author controls explicit save/discard actions and must await writes before programmatic closing.
- Permission confirmation dialogs must appear above the application modal and remain actionable. Escape dismisses the topmost confirmation first. Restoring focus after a confirmation returns to the requesting surface while it still exists.
- Missing component, handshake timeout, runtime failure and API/session loss show a contained error with the existing retry/close affordances. Failure never mounts package code in the host. Retry restarts only modal content and retains its validated view/props.

## Closing, refresh and cleanup

Use a host-owned modal record keyed by an ephemeral generation and the caller's stable widget ID/package identity. A single close finalization consumes that record exactly once.

1. Mark closing and reject new gateway requests from both affected runtimes. Cancel unsent confirmation requests owned by those surfaces.
2. Remove the modal runtime/port and stop its effects. Let already dispatched gateway requests from both surfaces settle before starting the replacement caller; avoid refreshing while a known write is still in progress. Show a bounded closing/loading state in the host while draining.
3. Use the existing API request deadline as the maximum drain wait, not an unlimited wait. If an operation cannot be confirmed complete, show an explicit failure notice and still allow closing/restarting. Closing cannot roll back a remote request that has already been sent.
4. End the modal session, then destroy and recreate only the calling widget's compact runtime/session. Preserve its stable board ID, package source, position, configuration and persisted state. Do not remount the board or other widgets.
5. Clear the host modal record and restore focus. A late response/close from an earlier generation must not affect a later modal or cause another restart.

The guarantee is a fresh caller mount after known requests settle, not a distributed transaction or a guarantee about background work on an external server. The widget must read its authoritative data during initialization. Concurrent shared-state writes still obey existing revision/conflict handling.

If the caller disappears, its source/version changes, the screen/space unmounts, logout occurs, or package removal makes the source unavailable, dispose its modal and sessions; do not resurrect an obsolete caller. Do not refresh an already removed widget. Application teardown cancels pending opens as well as already mounted modals.

## Development experience and example

`ld-widget dev` must support the same registry, props, SDK methods, theme/context propagation, close rule and ownership checks. Its modal and compact preview share the same development gateway/state and existing logs. Refreshing the compact preview must not reset persisted development state. Full page/project resets keep their existing documented semantics. HMR must not leave stale modal generations or ports.

Extend `showcase-counter` with a modal editor for its persisted count. Keep its existing configured goal read-only in this screen. The modal loads shared state through the SDK, saves through the same API, closes, and the original counter remounts with the saved count. Also demonstrate host-button/Escape closing. Keep existing counter behavior and focused tests.

Document the complete minimal authoring recipe, named registry export, independent memory, ordinary props, same permissions/state, automatic remount, awaiting saves, unavailable nested modals, errors and size semantics. Update SDK docs sources and regenerate outputs through the repository's documentation command. Update developer-facing widget guidance that currently describes a single-root-only runtime; do not add modal boilerplate to every generated widget.

## Expected areas of change

- `packages/contracts`: modal input/message/mount validation and SDK level compatibility.
- `packages/widget-sdk`: public API/types, sandbox mount selection, bridge controls, named-export build coverage, dev shell parity and source documentation.
- `apps/ui/app/widgets`: modal ownership/window, per-surface sandbox/session cleanup and isolated caller restart.
- `apps/ui/app/confirmations.ts`, `ConfirmDialog.vue`: surface-scoped ownership and accessible stacking/focus as needed.
- `examples/widgets/showcase-counter`: working shared-state modal example.
- `packages/create-widget` guidance: explain the optional modal recipe without changing default project behavior.
- API production behavior should remain unchanged unless implementation evidence demonstrates a narrowly necessary lifecycle fix; reuse current session, state, HTTP and permission paths.

## Verification and acceptance

Follow RED → GREEN → REFACTOR using existing Vitest suites. Cover invalid/oversized/non-JSON props, missing exports/views, busy/nested opens, open quota surviving remount, source spoofing, old SDK compatibility, stale generations, pending opens during removal, session teardown, confirmation ownership and exactly-once caller restart for all close paths.

Verify actual widget packaging preserves the named registry, imported components, styles and assets, and check both source dev mode and an installed built package. Prove both surfaces share state identity and quotas without sharing tokens or JavaScript memory. Cover shared-state conflicts and draining writes; do not substitute a mocked acknowledgement for persisted read-back.

Run focused checks first, then affected package typechecks, SDK build/docs checks and the workspace tests. Report unrelated existing failures without changing unrelated work.

Use only Orca's embedded browser for live checks: install/place the built example, open its modal from the board, edit/save/close and observe the refreshed count; close by host button and Escape inside the iframe; exercise keyboard/focus, error/retry, confirmation above the modal, two different widget instances, caller removal/source change, all themes and a short viewport. Repeat the essential flow in `ld-widget dev`. Review the final diff for scope.

## Builder discretion

Choose internal component/file names, minimal reusable helpers and test placement following existing conventions. Keep public behavior and limits above. No new dependencies, branch, commit, unrelated refactor or speculative window features.
