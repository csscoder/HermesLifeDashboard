import { toTasksError, type Attempt, type Priority, type TaskPatch, type TasksError } from './api.ts'

export interface AutosaveState {
  version: number
  // Typed but not confirmed by Hermes Tasks; a refresh never overwrites these.
  dirty: TaskPatch
  saving: boolean
  // Set by a failed write; nothing is sent again until retry().
  failed: { code: string; message: string } | null
}

export interface AutosaveDeps {
  prepare(patch: TaskPatch, version: number): Attempt
  send(attempt: Attempt): Promise<{ task: { version: number } }>
  onSaved?(): void
  onFailed?(error: TasksError): void
}

export interface Editable {
  title: string
  description: string | null
  priority: Priority
  tags: string[]
  projectId: string | null
}

/** Spec «Autosave»: one write per task in flight, later edits merged into the next one. */
export function createAutosave(state: AutosaveState, deps: AutosaveDeps) {
  // Fields the user committed (change or blur); a draft is dirty but not sent.
  const committed = new Set<keyof TaskPatch>()
  // The attempt that lost its answer, resent unchanged by retry().
  let lost: { attempt: Attempt; patch: TaskPatch } | null = null

  async function run(attempt: Attempt, patch: TaskPatch): Promise<void> {
    state.saving = true
    try {
      const result = await deps.send(attempt)
      state.version = result.task.version
      for (const field of Object.keys(patch) as (keyof TaskPatch)[]) {
        if (same(state.dirty[field], patch[field])) {
          delete state.dirty[field]
          committed.delete(field)
        }
      }
      state.saving = false
      deps.onSaved?.()
      // Not awaited: this write is done; the next one runs on its own.
      void flush()
    } catch (error) {
      const failure = toTasksError(error)
      state.saving = false
      state.failed = { code: failure.code, message: failure.message }
      lost = failure.retryable ? { attempt, patch } : null
      deps.onFailed?.(failure)
    }
  }

  function flush(): Promise<void> {
    if (state.saving || state.failed !== null || committed.size === 0) return Promise.resolve()
    const patch: TaskPatch = {}
    for (const field of committed) Object.assign(patch, { [field]: state.dirty[field] })
    return run(deps.prepare(patch, state.version), patch)
  }

  return {
    draft<K extends keyof TaskPatch>(field: K, value: TaskPatch[K]): void {
      state.dirty[field] = value
    },

    edit<K extends keyof TaskPatch>(field: K, value: TaskPatch[K]): Promise<void> {
      state.dirty[field] = value
      committed.add(field)
      return flush()
    },

    /** After a lost answer: that attempt unchanged, then later edits. Otherwise a new attempt from `state.version`. */
    retry(): Promise<void> {
      if (state.saving || state.failed === null) return Promise.resolve()
      state.failed = null
      const kept = lost
      lost = null
      return kept ? run(kept.attempt, kept.patch) : flush()
    },
  }
}

export function shown(task: Editable, dirty: TaskPatch): Editable {
  return { title: task.title, description: task.description, priority: task.priority, tags: task.tags, projectId: task.projectId, ...dirty }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
