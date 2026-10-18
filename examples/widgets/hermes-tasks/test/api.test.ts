import { describe, expect, it, vi } from 'vitest'
import type { HttpOutput, HttpSendInput } from '@lifedashboard/widget-sdk'
import { BASE, createTasksApi, TasksError, type ListItem } from '../src/api.ts'

type Handler = (op: string, input: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => HttpOutput | undefined | Promise<never>

function fake(handler: Handler) {
  async function answer(op: string, input: Parameters<Handler>[1]): Promise<HttpOutput> {
    const output = await handler(op, input)
    if (output === undefined) throw new Error('No fake HTTP response')
    return output
  }
  const http = {
    get: vi.fn((url: string, _options?: { accept?: string }) => answer('http.get', { url })),
    send: vi.fn((request: HttpSendInput) => answer('http.send', request)),
  }
  return { http, api: createTasksApi(http) }
}

const meta = (epoch = 'e1') => ({ workspaceEpoch: epoch, mutationSeq: 1, asOf: '2026-10-11T08:00:00Z', replayed: false })
const reply = (status: number, payload: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(payload) })
const ok = (data: unknown, epoch?: string) => reply(200, { ok: true, data, meta: meta(epoch) })
const failure = (status: number, code: string, retryable = false) =>
  reply(status, { ok: false, error: { code, message: `${code} message`, retryable, details: null }, meta: { requestId: 'r', workspaceEpoch: 'e1' } })

function item(id: string, overdue = false): ListItem {
  return { taskId: `t${id}`, occurrenceId: `o${id}`, title: id, projectId: null, taskVersion: 1, occurrenceVersion: 1, due: '2026-10-11', overdue, status: 'open', recurring: false }
}

const query = (url: string) => new URL(url).searchParams

describe('request', () => {
  it('returns envelope data, remembers the epoch and asks for JSON', async () => {
    const { api, http } = fake(() => ok({ today: '2026-10-11', tags: [], nextTagsCursor: null }, 'e7'))
    expect(await api.workspace()).toEqual({ today: '2026-10-11', tags: [] })
    expect(api.epoch).toBe('e7')
    expect(http.get).toHaveBeenCalledWith(`${BASE}/workspace?tagsLimit=200`, { accept: 'application/json' })
  })

  it('turns an error envelope into a TasksError with its code', async () => {
    const { api } = fake(() => failure(409, 'VERSION_CONFLICT'))
    await expect(api.task('t1')).rejects.toMatchObject({ code: 'VERSION_CONFLICT', retryable: false, message: 'VERSION_CONFLICT message' })
    const busy = fake(() => failure(503, 'STORAGE_BUSY', true))
    await expect(busy.api.task('t1')).rejects.toMatchObject({ code: 'STORAGE_BUSY', retryable: true })
  })

  it('passes gateway errors on with their code; only transport codes are retryable', async () => {
    const declined = fake(() => Promise.reject(Object.assign(new Error('The user declined the call'), { code: 'DECLINED' })))
    await expect(declined.api.task('t1')).rejects.toMatchObject({ code: 'DECLINED', retryable: false })
    const down = fake(() => Promise.reject(Object.assign(new Error('The service is unreachable'), { code: 'UNAVAILABLE' })))
    await expect(down.api.task('t1')).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true, message: 'The service is unreachable' })
  })

  it('answers without JSON become a retryable UNAVAILABLE', async () => {
    const { api } = fake(() => ({ status: 404, contentType: 'text/html', body: '<h1>Not Found</h1>' }))
    const error = await api.task('t1').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(TasksError)
    expect(error).toMatchObject({ code: 'UNAVAILABLE', retryable: true, message: 'Hermes Tasks answered 404 without JSON' })
  })
})

describe('reading lists', () => {
  it('follows tag pages', async () => {
    const { api, http } = fake((_op, { url }) =>
      query(url).get('tagsCursor') === null
        ? ok({ today: '2026-10-11', tags: [{ name: 'a', openCount: 1 }], nextTagsCursor: 'c1' })
        : ok({ today: '2026-10-11', tags: [{ name: 'b', openCount: 2 }], nextTagsCursor: null }),
    )
    expect((await api.workspace()).tags.map((tag) => tag.name)).toEqual(['a', 'b'])
    expect(query(http.get.mock.calls[1]![0]).get('tagsCursor')).toBe('c1')
  })

  it('merges Today: a row in both answers appears once, under overdue', async () => {
    const { api } = fake((_op, { url }) =>
      query(url).get('due') === 'overdue'
        ? ok({ items: [item('a', true)], nextCursor: null })
        : ok({ items: [item('a', true), item('b')], nextCursor: null }),
    )
    const result = await api.list('today', null)
    expect(result.overdue.map((row) => row.title)).toEqual(['a'])
    expect(result.items.map((row) => row.title)).toEqual(['b'])
  })

  it('maps views to queries', async () => {
    const { api, http } = fake(() => ok({ items: [], nextCursor: null }))
    await api.list('upcoming', null)
    await api.list('inbox', null)
    await api.list('all', null)
    const urls = http.get.mock.calls.map(([url]) => url)
    expect(urls.map((url) => Object.fromEntries(query(url)))).toEqual([
      { status: 'open', due: 'upcoming', limit: '200' },
      { status: 'open', projectId: 'inbox', limit: '200' },
      { status: 'open', limit: '200' },
    ])
  })

  it('encodes tag names in the query', async () => {
    const { api, http } = fake(() => ok({ items: [], nextCursor: null }))
    await api.list('all', 'дом & сад #1')
    const url = http.get.mock.calls[0]![0]
    expect(query(url).getAll('tags')).toEqual(['дом & сад #1'])
    expect(url).not.toContain(' ')
  })

  it('reads pages up to 1000 rows and reports the rest as truncated', async () => {
    let n = 0
    const { api, http } = fake(() => ok({ items: Array.from({ length: 200 }, () => item(String(n++))), nextCursor: 'more' }))
    const result = await api.list('all', null)
    expect(result.items).toHaveLength(1000)
    expect(result.truncated).toBe(true)
    expect(http.get).toHaveBeenCalledTimes(5)
  })

  it('restarts a request once after CURSOR_STALE, then gives up', async () => {
    const pages = [ok({ items: [item('a')], nextCursor: 'c' }), failure(409, 'CURSOR_STALE'), ok({ items: [item('a')], nextCursor: 'c' }), ok({ items: [item('b')], nextCursor: null })]
    const once = fake(() => pages.shift())
    expect((await once.api.list('all', null)).items.map((row) => row.title)).toEqual(['a', 'b'])

    const always = fake((_op, { url }) => (query(url).get('cursor') === null ? ok({ items: [item('a')], nextCursor: 'c' }) : failure(409, 'CURSOR_STALE')))
    await expect(always.api.list('all', null)).rejects.toMatchObject({ code: 'CURSOR_STALE' })
  })

  it('reads all project pages', async () => {
    const { api } = fake((_op, { url }) =>
      query(url).get('cursor') === null
        ? ok({ items: [{ id: 'p1', name: 'A', archived: false }], nextCursor: 'c' })
        : ok({ items: [{ id: 'p2', name: 'B', archived: false }], nextCursor: null }),
    )
    expect((await api.projects()).map((project) => project.id)).toEqual(['p1', 'p2'])
  })
})

describe('writes', () => {
  it('prepares an attempt with the latest epoch and a new key, and resends it unchanged', async () => {
    const { api, http } = fake((op) => (op === 'http.get' ? ok({ today: '2026-10-11', tags: [], nextTagsCursor: null }, 'e9') : ok({ task: { version: 4 } })))
    await api.workspace()
    const attempt = api.update('t 1', 3, { title: 'Новое' })
    expect(attempt).toEqual({
      method: 'PATCH',
      path: '/tasks/t%201',
      body: { expectedVersion: 3, title: 'Новое', workspaceEpoch: 'e9', idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) },
    })
    expect(api.update('t 1', 3, { title: 'Новое' }).body.idempotencyKey).not.toBe(attempt.body.idempotencyKey)
    await api.send(attempt)
    await api.send(attempt)
    const sends = http.send.mock.calls.map(([request]) => request)
    expect(sends).toEqual([
      { url: `${BASE}/tasks/t%201`, method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(attempt.body) },
      { url: `${BASE}/tasks/t%201`, method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(attempt.body) },
    ])
  })

  it('builds occurrence, reschedule and create paths', () => {
    const { api } = fake(() => ok(null))
    expect(api.occurrenceAction('skip', 'o1', 2)).toMatchObject({ method: 'POST', path: '/occurrences/o1/skip', body: { expectedVersion: 2 } })
    expect(api.reschedule('o1', 2, { kind: 'date', date: '2026-10-12' })).toMatchObject({
      method: 'POST',
      path: '/occurrences/o1/reschedule',
      body: { expectedVersion: 2, schedule: { kind: 'date', date: '2026-10-12' } },
    })
    expect(api.create({ title: 'X', tags: ['a'], schedule: null })).toMatchObject({ method: 'POST', path: '/tasks', body: { title: 'X', tags: ['a'], schedule: null } })
  })
})
