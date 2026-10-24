import { reactive } from 'vue'
import { WidgetError, type Widget } from '@lifedashboard/widget-sdk'

export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function createCounter(storage: Widget['state']) {
  const state = reactive({ count: 0, ready: false, busy: false, error: '' })
  let revision = 0

  async function read(): Promise<boolean> {
    state.ready = false
    try {
      const saved = await storage.get<unknown>()
      const data = saved.data
      if (data !== null && (
        typeof data !== 'object' || Array.isArray(data) || !('count' in data)
        || !isCount(data.count)
      )) {
        state.error = 'Saved progress is invalid. It has not been changed.'
        return false
      }
      state.count = data === null ? 0 : (data as { count: number }).count
      revision = saved.revision
      state.ready = true
      state.error = ''
      return true
    } catch {
      state.error = 'Could not load progress. Please try again.'
      return false
    }
  }

  async function load(): Promise<void> {
    if (state.busy) return
    state.busy = true
    state.error = ''
    try {
      await read()
    } finally {
      state.busy = false
    }
  }

  async function change(delta: 1 | -1): Promise<void> {
    if (state.busy || !state.ready) return
    state.busy = true
    state.error = ''
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const next = Math.max(0, state.count + delta)
        if (!Number.isSafeInteger(next) || next === state.count) return
        try {
          const saved = await storage.set({ count: next }, revision)
          revision = saved.revision
          state.count = next
          return
        } catch (error) {
          if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') {
            // A lost answer may already have committed; reload instead of replaying the click.
            state.ready = false
            state.error = 'Save not confirmed. Reload progress before trying again.'
            return
          }
          if (!await read()) return
          if (attempt === 1) state.error = 'Progress changed elsewhere. Please try again.'
        }
      }
    } finally {
      state.busy = false
    }
  }

  return { state, load, change }
}
