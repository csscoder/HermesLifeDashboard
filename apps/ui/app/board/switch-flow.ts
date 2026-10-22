import { afterManage, afterStaySave, type Reaction, type SaveOutcome } from './space-sync'

export interface FlowDeps {
  editing: boolean
  dirty: boolean // working copy differs from the saved screen
  saveAndStay(): Promise<SaveOutcome>
}

export type FlowResult = { ok: true } | { ok: false; reaction: Reaction }

/** Saves pending edits when editing and dirty; ok only when nothing is pending afterwards. */
export async function runPreSave(deps: FlowDeps): Promise<FlowResult> {
  if (!deps.editing || !deps.dirty) return { ok: true }
  const outcome = await deps.saveAndStay()
  return outcome === 'saved' ? { ok: true } : { ok: false, reaction: afterStaySave(outcome) }
}

/** ✕ on the active screen: never pre-saves; `ask` runs only when `needsConfirm`. */
export async function runDeleteScreen(deps: {
  needsConfirm: boolean
  ask(): Promise<boolean>
  remove(): Promise<SaveOutcome>
}): Promise<FlowResult | { ok: false; cancelled: true }> {
  if (deps.needsConfirm && !(await deps.ask())) return { ok: false, cancelled: true }
  const outcome = await deps.remove()
  return outcome === 'saved' ? { ok: true } : { ok: false, reaction: afterManage(outcome) }
}
