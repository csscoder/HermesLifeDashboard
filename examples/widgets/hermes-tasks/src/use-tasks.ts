import { markRaw, onBeforeUnmount, reactive, ref, watch, type WatchStopHandle } from 'vue'
import { WidgetError, type Widget } from '@lifedashboard/widget-sdk'
import {
  createTasksApi,
  toTasksError,
  type Attempt,
  type CloseResult,
  type ListItem,
  type ListResult,
  type Project,
  type Schedule,
  type Tag,
  type TaskDetail,
  type TasksError,
} from './api.ts'
import { parseQuickAdd } from './quick-add.ts'
import type { View } from './views.ts'

const REFRESH_MS = 10_000
const RATE_PAUSE_MS = 30_000
const TOAST_MS = 5_000
const EMPTY: ListResult = { overdue: [], items: [], truncated: false }

export interface Toast {
  id: number
  text: string
  action: { label: string; run: () => void } | null
}

interface Prefs {
  view: View
  tag: string | null
}

interface MutationOptions<T> {
  pendingId?: string
  onDone?: (result: T) => void
}

/** Spec «Refresh», «Actions» and «Errors»: the widget's data and every call to Hermes Tasks. */
export function useTasks(widget: Widget) {
  const api = markRaw(createTasksApi((op, input) => widget.call(op, input)))
  const view = ref<View>('today')
  const tag = ref<string | null>(null)
  const today = ref<string | null>(null)
  const tags = ref<Tag[]>([])
  const list = ref<ListResult>(EMPTY)
  const loaded = ref(false)
  const unavailable = ref(false)
  const pending = ref<string[]>([])
  const toasts = ref<Toast[]>([])
  const openTaskId = ref<string | null>(null)
  const detail = ref<TaskDetail | null>(null)
  const projects = ref<Project[]>([])
  // A write lost to UNAVAILABLE; the banner's «Повторить» sends it again with the same key.
  let retryAction: (() => Promise<unknown>) | null = null
  let refreshing = false
  let queued = false
  let pausedUntil = 0
  let prefsRevision = 0
  let toastId = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  const stops: WatchStopHandle[] = []

  function toast(text: string, action: Toast['action'] = null): void {
    const id = ++toastId
    toasts.value = [...toasts.value, { id, text, action }]
    setTimeout(() => dismiss(id), TOAST_MS)
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }

  async function loadDetail(): Promise<void> {
    const taskId = openTaskId.value
    if (taskId === null) return
    try {
      const [task, all] = await Promise.all([api.task(taskId), api.projects()])
      if (openTaskId.value !== taskId) return
      detail.value = task
      projects.value = all
    } catch (error) {
      const failure = toTasksError(error)
      // Deleted through Hermes meanwhile.
      if (failure.code === 'NOT_FOUND') closeTask()
      else throw failure
    }
  }

  function readFailed(failure: TasksError): void {
    // A second CURSOR_STALE: the previous list stays until the next refresh.
    if (failure.code === 'CURSOR_STALE') return
    if (failure.code === 'RATE_LIMITED') pausedUntil = Date.now() + RATE_PAUSE_MS
    else if (failure.retryable) unavailable.value = true
    else toast(failure.message)
  }

  async function refresh(): Promise<void> {
    if (refreshing) {
      queued = true
      return
    }
    if (Date.now() < pausedUntil) return
    refreshing = true
    try {
      const workspace = await api.workspace()
      today.value = workspace.today
      tags.value = workspace.tags
      const wanted = { view: view.value, tag: tag.value }
      const result = await api.list(wanted.view, wanted.tag)
      // The filter changed while this ran: the queued refresh reads the new one.
      if (wanted.view === view.value && wanted.tag === tag.value) {
        list.value = result
        loaded.value = true
      }
      await loadDetail()
      if (retryAction === null) unavailable.value = false
    } catch (error) {
      readFailed(toTasksError(error))
    } finally {
      refreshing = false
      if (queued) {
        queued = false
        void refresh()
      }
    }
  }

  function mutationFailed(failure: TasksError, again: () => Promise<unknown>): void {
    switch (failure.code) {
      case 'DECLINED':
        return
      case 'VERSION_CONFLICT':
        toast('Задача изменилась в Hermes, данные обновлены')
        return
      case 'WORKSPACE_EPOCH_MISMATCH':
        toast('Данные Hermes Tasks могли быть восстановлены из резервной копии')
        return
      case 'RATE_LIMITED':
        pausedUntil = Date.now() + RATE_PAUSE_MS
        toast('Слишком много запросов, повторите позже')
        return
    }
    if (failure.retryable) {
      unavailable.value = true
      retryAction = again
    } else {
      toast(failure.message)
    }
  }

  async function mutate<T>(attempt: Attempt, options: MutationOptions<T> = {}): Promise<T | null> {
    const { pendingId, onDone } = options
    if (pendingId !== undefined) pending.value = [...pending.value, pendingId]
    try {
      const result = await api.send<T>(attempt)
      retryAction = null
      unavailable.value = false
      onDone?.(result)
      return result
    } catch (error) {
      mutationFailed(toTasksError(error), () => mutate(attempt, options))
      return null
    } finally {
      if (pendingId !== undefined) pending.value = pending.value.filter((id) => id !== pendingId)
      void refresh()
    }
  }

  function retry(): void {
    const again = retryAction
    retryAction = null
    unavailable.value = false
    void (again ? again() : refresh())
  }

  function hide(occurrenceId: string): void {
    const keep = (item: ListItem) => item.occurrenceId !== occurrenceId
    list.value = { ...list.value, overdue: list.value.overdue.filter(keep), items: list.value.items.filter(keep) }
  }

  async function close(occurrenceId: string, version: number, action: 'complete' | 'skip'): Promise<boolean> {
    const result = await mutate<CloseResult>(api.occurrenceAction(action, occurrenceId, version), {
      pendingId: occurrenceId,
      onDone: ({ closedOccurrence }) => {
        hide(occurrenceId)
        // Reopen needs the closed occurrence's new version, so the undo starts only after the answer.
        toast(action === 'complete' ? 'Выполнено' : 'Пропущено', {
          label: 'Вернуть',
          run: () => void mutate(api.occurrenceAction('reopen', closedOccurrence.id, closedOccurrence.version)),
        })
      },
    })
    return result !== null
  }

  async function reschedule(occurrenceId: string, version: number, schedule: Schedule): Promise<boolean> {
    return (await mutate(api.reschedule(occurrenceId, version, schedule), { pendingId: occurrenceId })) !== null
  }

  async function create(text: string): Promise<boolean> {
    if (today.value === null) return false
    const parsed = parseQuickAdd(text, { today: today.value, view: view.value, tag: tag.value })
    if (parsed === null) return false
    const schedule: Schedule = parsed.date === null ? null : { kind: 'date', date: parsed.date }
    return (await mutate(api.create({ title: parsed.title, tags: parsed.tags, schedule }))) !== null
  }

  function openTask(taskId: string): void {
    openTaskId.value = taskId
    detail.value = null
    loadDetail().catch((error: unknown) => readFailed(toTasksError(error)))
  }

  function closeTask(): void {
    openTaskId.value = null
    detail.value = null
  }

  async function restorePrefs(): Promise<void> {
    try {
      const saved = await widget.state.get<Prefs>()
      prefsRevision = saved.revision
      if (saved.data) {
        view.value = saved.data.view
        tag.value = saved.data.tag
      }
    } catch {
      // Defaults stay.
    }
  }

  async function savePrefs(): Promise<void> {
    const prefs: Prefs = { view: view.value, tag: tag.value }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        prefsRevision = (await widget.state.set(prefs, prefsRevision)).revision
        return
      } catch (error) {
        // Another tab saved first: take its revision and write once more. Other failures keep the old prefs.
        if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') return
        try {
          prefsRevision = (await widget.state.get<Prefs>()).revision
        } catch {
          return
        }
      }
    }
  }

  async function start(): Promise<void> {
    await restorePrefs()
    if (disposed) return
    stops.push(
      watch([view, tag], () => {
        loaded.value = false
        list.value = EMPTY
        void savePrefs()
        void refresh()
      }),
      watch(
        () => widget.context.visible,
        (visible) => {
          clearInterval(timer)
          if (!visible) return
          void refresh()
          timer = setInterval(() => void refresh(), REFRESH_MS)
        },
        { immediate: true },
      ),
    )
  }

  void start()
  onBeforeUnmount(() => {
    disposed = true
    for (const stop of stops) stop()
    clearInterval(timer)
  })

  return reactive({
    api,
    view,
    tag,
    today,
    tags,
    list,
    loaded,
    unavailable,
    pending,
    toasts,
    openTaskId,
    detail,
    projects,
    refresh,
    retry,
    close,
    reschedule,
    create,
    openTask,
    closeTask,
    loadDetail,
    toast,
    dismiss,
  })
}

export type Tasks = ReturnType<typeof useTasks>
