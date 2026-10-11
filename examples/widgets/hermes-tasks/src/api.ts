import type { HttpOutput } from '@lifedashboard/widget-sdk'
import type { View } from './views.ts'

export const BASE = 'http://127.0.0.1:8787/api/v1'
export const PAGE_SIZE = 200
// Spec «Views and filter»: a personal list never needs more; the UI says when rows were left out.
export const LIST_CAP = 1000
// Gateway codes after which the very same request may be sent again.
const RETRYABLE = new Set(['UNAVAILABLE', 'TIMEOUT', 'BRIDGE_CLOSED'])

export type Call = (op: 'http.get' | 'http.send', input: unknown) => Promise<unknown>
export type Priority = 'none' | 'low' | 'medium' | 'high'
export type Schedule = { kind: 'date'; date: string } | { kind: 'datetime'; datetime: string } | null

export interface ListItem {
  taskId: string
  occurrenceId: string
  title: string
  projectId: string | null
  projectName?: string
  taskVersion: number
  occurrenceVersion: number
  due: string | null
  overdue: boolean
  status: 'open' | 'completed' | 'skipped'
  recurring: boolean
  priority?: 'low' | 'medium' | 'high'
  tags?: string[]
}

export interface ListResult {
  overdue: ListItem[]
  items: ListItem[]
  truncated: boolean
}

export interface Occurrence {
  id: string
  taskId: string
  due: string | null
  status: 'open' | 'completed' | 'skipped'
  overdue: boolean
  version: number
}

export interface TaskSummary {
  id: string
  title: string
  description: string | null
  projectId: string | null
  priority: Priority
  tags: string[]
  recurrence: { frequency: 'day' | 'week' | 'month' | 'year'; interval: number } | null
  version: number
}

export interface TaskDetail {
  task: TaskSummary
  currentOccurrence: Occurrence | null
}

export interface CloseResult {
  closedOccurrence: Occurrence
  nextOccurrence: Occurrence | null
  taskVersion: number
}

export interface UpdateResult {
  task: TaskSummary
}

export interface Tag {
  name: string
  openCount: number
}

export interface Project {
  id: string
  name: string
  archived: boolean
}

export interface Workspace {
  today: string
  tags: Tag[]
}

export interface TaskPatch {
  title?: string
  description?: string | null
  priority?: Priority
  tags?: string[]
  projectId?: string | null
}

export interface NewTask {
  title: string
  tags: string[]
  schedule: Schedule
}

/** One write intention. Resent unchanged, Hermes Tasks answers a replay instead of acting twice. */
export interface Attempt {
  method: 'POST' | 'PATCH'
  path: string
  body: Record<string, unknown>
}

/** `code` is the Hermes Tasks code, or a gateway code (UNAVAILABLE, DECLINED, RATE_LIMITED, …). */
export class TasksError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'TasksError'
    this.code = code
    this.retryable = retryable
  }
}

export function toTasksError(error: unknown): TasksError {
  if (error instanceof TasksError) return error
  const raw = (error as { code?: unknown } | null)?.code
  const code = typeof raw === 'string' ? raw : 'UNAVAILABLE'
  return new TasksError(code, error instanceof Error ? error.message : String(error), RETRYABLE.has(code))
}

// crypto.randomUUID needs a secure context, which an opaque-origin frame may not be.
export function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface Envelope {
  ok?: boolean
  data?: unknown
  error?: { code?: string; message?: string; retryable?: boolean }
  meta?: { workspaceEpoch?: unknown }
}

interface Paging {
  items: string
  next: string
  cursor: string
  limit: string
}

type Query = Record<string, string | string[]>

const TASK_PAGES: Paging = { items: 'items', next: 'nextCursor', cursor: 'cursor', limit: 'limit' }
const TAG_PAGES: Paging = { items: 'tags', next: 'nextTagsCursor', cursor: 'tagsCursor', limit: 'tagsLimit' }
const VIEW_QUERY: Record<Exclude<View, 'today'>, Query> = {
  upcoming: { status: 'open', due: 'upcoming' },
  inbox: { status: 'open', projectId: 'inbox' },
  all: { status: 'open' },
}

function withQuery(path: string, query: Query): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) for (const item of [value].flat()) params.append(name, item)
  return `${path}?${params}`
}

export function createTasksApi(call: Call, base: string = BASE) {
  let epoch: string | null = null

  async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    let output: HttpOutput
    try {
      output = (method === 'GET'
        ? await call('http.get', { url: base + path, headers: { accept: 'application/json' } })
        : await call('http.send', {
            url: base + path,
            method,
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })) as HttpOutput
    } catch (error) {
      throw toTasksError(error)
    }
    let envelope: Envelope | null
    try {
      envelope = JSON.parse(output.body) as Envelope | null
    } catch {
      envelope = null
    }
    if (envelope === null || typeof envelope !== 'object') {
      throw new TasksError('UNAVAILABLE', `Hermes Tasks answered ${output.status} without JSON`, true)
    }
    if (typeof envelope.meta?.workspaceEpoch === 'string') epoch = envelope.meta.workspaceEpoch
    if (envelope.ok === true && output.status < 300) return envelope.data as T
    const error = envelope.error
    throw new TasksError(error?.code ?? 'UNAVAILABLE', error?.message ?? `Hermes Tasks answered ${output.status}`, error?.retryable ?? output.status >= 500)
  }

  async function readPages<T>(path: string, query: Query, paging: Paging): Promise<{ first: Record<string, unknown>; items: T[]; truncated: boolean }> {
    const items: T[] = []
    let first: Record<string, unknown> | null = null
    let cursor: string | null = null
    do {
      const page: Record<string, unknown> = await request<Record<string, unknown>>(
        'GET',
        withQuery(path, { ...query, [paging.limit]: String(PAGE_SIZE), ...(cursor === null ? {} : { [paging.cursor]: cursor }) }),
      )
      first ??= page
      items.push(...(page[paging.items] as T[]))
      cursor = (page[paging.next] as string | null | undefined) ?? null
    } while (cursor !== null && items.length < LIST_CAP)
    return { first: first!, items: items.slice(0, LIST_CAP), truncated: cursor !== null }
  }

  // CURSOR_STALE: the data changed between pages; one restart from the first page, then the caller decides.
  async function readAll<T>(path: string, query: Query, paging: Paging) {
    try {
      return await readPages<T>(path, query, paging)
    } catch (error) {
      if (!(error instanceof TasksError) || error.code !== 'CURSOR_STALE') throw error
      return readPages<T>(path, query, paging)
    }
  }

  function prepare(method: Attempt['method'], path: string, fields: Record<string, unknown>): Attempt {
    // Before the first read there is no epoch; Hermes Tasks rejects the write and the next refresh reads one.
    return { method, path, body: { ...fields, workspaceEpoch: epoch ?? '', idempotencyKey: newKey() } }
  }

  const id = encodeURIComponent

  return {
    get epoch(): string | null {
      return epoch
    },

    async workspace(): Promise<Workspace> {
      const { first, items } = await readAll<Tag>('/workspace', {}, TAG_PAGES)
      return { today: first.today as string, tags: items }
    },

    async list(view: View, tag: string | null): Promise<ListResult> {
      const tags: Query = tag === null ? {} : { tags: [tag] }
      if (view === 'today') {
        const [overdue, today] = await Promise.all([
          readAll<ListItem>('/tasks', { status: 'open', due: 'overdue', ...tags }, TASK_PAGES),
          readAll<ListItem>('/tasks', { status: 'open', due: 'today', ...tags }, TASK_PAGES),
        ])
        // A task timed earlier today is in both answers; it belongs under «Просрочено».
        return { overdue: overdue.items, items: today.items.filter((item) => !item.overdue), truncated: overdue.truncated || today.truncated }
      }
      const result = await readAll<ListItem>('/tasks', { ...VIEW_QUERY[view], ...tags }, TASK_PAGES)
      return { overdue: [], items: result.items, truncated: result.truncated }
    },

    task: (taskId: string) => request<TaskDetail>('GET', `/tasks/${id(taskId)}`),

    async projects(): Promise<Project[]> {
      return (await readAll<Project>('/projects', {}, TASK_PAGES)).items
    },

    occurrenceAction: (action: 'complete' | 'skip' | 'reopen', occurrenceId: string, version: number) =>
      prepare('POST', `/occurrences/${id(occurrenceId)}/${action}`, { expectedVersion: version }),

    reschedule: (occurrenceId: string, version: number, schedule: Schedule) =>
      prepare('POST', `/occurrences/${id(occurrenceId)}/reschedule`, { expectedVersion: version, schedule }),

    update: (taskId: string, version: number, patch: TaskPatch) => prepare('PATCH', `/tasks/${id(taskId)}`, { expectedVersion: version, ...patch }),

    create: (task: NewTask) => prepare('POST', '/tasks', { ...task }),

    send: <T>(attempt: Attempt) => request<T>(attempt.method, attempt.path, attempt.body),
  }
}

export type TasksApi = ReturnType<typeof createTasksApi>
