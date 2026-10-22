import type { SpaceSummary } from '@lifedashboard/contracts/space'
import type { ApiFailure, ApiResult } from '../api'
import { afterManage, failureOutcome, type Reaction } from '../board/space-sync'
import { afterDelete } from './nav'

export const LAST_SPACE_HINT = 'Последнее пространство удалить нельзя'

/** ✕ on a screen is refused only for the only screen of the only space: that delete is the space delete. */
export function canRemoveScreen(spaceCount: number, screenCount: number): boolean {
  return spaceCount > 1 || screenCount > 1
}

/** The trimmed title when the draft is non-empty and differs from the current title; null otherwise. */
export function renameTo(current: string, draft: string): string | null {
  const next = draft.trim()
  return next !== '' && next !== current ? next : null
}

export function deleteSpaceMessage(title: string): string {
  return `Удалить пространство «${title}» вместе с экраном и виджетами?`
}

// Management failures keep the current space and working copy; the reaction shows the error.
function failed(failure: ApiFailure): Reaction {
  return afterManage(failureOutcome(failure.kind))
}

export type CreateOutcome =
  | { kind: 'stopped' }
  | { kind: 'failed'; reaction: Reaction }
  | { kind: 'created'; space: SpaceSummary; switched: boolean }

/** Saves pending edits, creates a space and switches to it. A failed save stops before the create. */
export async function runCreateSpace(deps: {
  saveIfDirty(): Promise<boolean>
  createSpace(): Promise<ApiResult<SpaceSummary>>
  switchTo(spaceId: string): Promise<boolean>
}): Promise<CreateOutcome> {
  if (!(await deps.saveIfDirty())) return { kind: 'stopped' }
  const result = await deps.createSpace()
  if (!result.ok) return { kind: 'failed', reaction: failed(result) }
  return { kind: 'created', space: result.data, switched: await deps.switchTo(result.data.id) }
}

export type EditOutcome = { kind: 'updated'; space: SpaceSummary } | { kind: 'failed'; reaction: Reaction }

/** Title, icon or colour: the summary replaces the old one only when the server confirms it. */
export async function runEditSpace(request: () => Promise<ApiResult<SpaceSummary>>): Promise<EditOutcome> {
  const result = await request()
  return result.ok ? { kind: 'updated', space: result.data } : { kind: 'failed', reaction: failed(result) }
}

export type DeleteOutcome =
  | { kind: 'last' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reaction: Reaction }
  | { kind: 'deleted'; target: string; switched: boolean }

/**
 * Deletes a space after a confirmation. `ids` is the list in order; the target is the neighbour
 * (see afterDelete). The caller passes a `remove` that is revision-checked.
 */
export async function runDeleteSpace(
  space: { id: string; title: string },
  ids: readonly string[],
  deps: {
    ask(message: string): Promise<boolean>
    remove(): Promise<ApiResult<null>>
    switchTo(spaceId: string): Promise<boolean>
  },
): Promise<DeleteOutcome> {
  const target = afterDelete(ids, space.id)
  if (target === null) return { kind: 'last' }
  if (!(await deps.ask(deleteSpaceMessage(space.title)))) return { kind: 'cancelled' }
  const result = await deps.remove()
  if (!result.ok) return { kind: 'failed', reaction: failed(result) }
  return { kind: 'deleted', target, switched: await deps.switchTo(target) }
}
