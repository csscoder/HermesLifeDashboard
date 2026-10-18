import { computed, shallowRef, watch, type Ref } from 'vue'
import { api } from '../api'

const cache = new Map<string, Ref<ReadonlySet<string>>>()
const failed = new Set<string>()
const EMPTY_FLAGS: ReadonlySet<string> = new Set()

function enabledKeys(flags: Record<string, boolean>): ReadonlySet<string> {
  return new Set(Object.keys(flags).filter((key) => flags[key] === true))
}

function loadFlags(widgetId: string): Ref<ReadonlySet<string>> {
  const existing = cache.get(widgetId)
  if (existing && !failed.has(widgetId)) return existing
  const initial: ReadonlySet<string> = new Set()
  const flags = existing ?? shallowRef(initial)
  flags.value = initial
  cache.set(widgetId, flags)
  failed.delete(widgetId)
  void api.widgetSecrets(widgetId).then((result) => {
    // A PUT/DELETE refresh is newer than an in-flight initial GET.
    if (flags.value === initial) {
      flags.value = result.ok ? enabledKeys(result.data) : EMPTY_FLAGS
      if (!result.ok) failed.add(widgetId)
    }
  }).catch(() => {
    if (flags.value === initial) {
      flags.value = EMPTY_FLAGS
      failed.add(widgetId)
    }
  })
  return flags
}

export function useSecretFlags(widgetId: () => string | undefined): Ref<ReadonlySet<string>> {
  const current = shallowRef<Ref<ReadonlySet<string>>>()
  watch(widgetId, (id) => {
    current.value = id === undefined ? undefined : loadFlags(id)
  }, { immediate: true, flush: 'sync' })
  return computed(() => current.value?.value ?? EMPTY_FLAGS)
}

export function refreshSecretFlags(widgetId: string, flags: Record<string, boolean>): void {
  const next = enabledKeys(flags)
  const existing = cache.get(widgetId)
  if (existing) existing.value = next
  else cache.set(widgetId, shallowRef(next))
  failed.delete(widgetId)
}
