import { describe, expect, it, vi } from 'vitest'
import { TasksError, type Attempt, type TaskPatch } from '../src/api.ts'
import { createAutosave, shown, type AutosaveState } from '../src/autosave.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function setup() {
  const state: AutosaveState = { version: 3, dirty: {}, saving: false, failed: null }
  const answers: ReturnType<typeof deferred<{ task: { version: number } }>>[] = []
  let key = 0
  const prepare = vi.fn((patch: TaskPatch, version: number): Attempt => ({ method: 'PATCH', path: '/tasks/t1', body: { ...patch, expectedVersion: version, idempotencyKey: `k${++key}` } }))
  const send = vi.fn((_attempt: Attempt) => {
    const answer = deferred<{ task: { version: number } }>()
    answers.push(answer)
    return answer.promise
  })
  const onSaved = vi.fn()
  const autosave = createAutosave(state, { prepare, send, onSaved })
  return { state, answers, prepare, send, onSaved, autosave }
}

const task = { title: 'Сервер', description: null, priority: 'none' as const, tags: ['a'], projectId: null }

describe('createAutosave', () => {
  it('sends one write at a time; an edit made meanwhile goes next with the returned version', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    void autosave.edit('priority', 'high')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].body).toMatchObject({ title: 'Новое', expectedVersion: 3 })
    answers[0]!.resolve({ task: { version: 4 } })
    await first
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0].body).toEqual({ priority: 'high', expectedVersion: 4, idempotencyKey: 'k2' })
    expect(state.dirty).toEqual({ priority: 'high' })
    answers[1]!.resolve({ task: { version: 5 } })
    await vi.waitFor(() => expect(state.saving).toBe(false))
    expect([state.version, state.dirty]).toEqual([5, {}])
  })

  it('keeps a field typed again during its own save', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Один')
    void autosave.edit('title', 'Два')
    answers[0]!.resolve({ task: { version: 4 } })
    await first
    expect(send.mock.calls[1]![0].body).toMatchObject({ title: 'Два', expectedVersion: 4 })
    expect(state.dirty).toEqual({ title: 'Два' })
  })

  it('does not send a draft, but keeps it dirty', async () => {
    const { state, send, autosave } = setup()
    autosave.draft('title', 'Пишу…')
    void autosave.edit('priority', 'low')
    expect(send.mock.calls[0]![0].body).toEqual({ priority: 'low', expectedVersion: 3, idempotencyKey: 'k1' })
    expect(state.dirty).toEqual({ title: 'Пишу…', priority: 'low' })
  })

  it('stops after a lost answer and resends the same attempt before later edits', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    void autosave.edit('priority', 'high')
    answers[0]!.reject(new TasksError('UNAVAILABLE', 'The service is unreachable', true))
    await first
    expect(state.failed).toEqual({ code: 'UNAVAILABLE', message: 'The service is unreachable' })
    expect(send).toHaveBeenCalledTimes(1)
    void autosave.edit('tags', ['b'])
    expect(send).toHaveBeenCalledTimes(1)

    const again = autosave.retry()
    expect(send.mock.calls[1]![0]).toBe(send.mock.calls[0]![0])
    answers[1]!.resolve({ task: { version: 4 } })
    await again
    expect(send.mock.calls[2]![0].body).toEqual({ priority: 'high', tags: ['b'], expectedVersion: 4, idempotencyKey: 'k2' })
  })

  it('after a conflict sends every dirty field as a new attempt from the re-read version', async () => {
    const { state, answers, send, prepare, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    answers[0]!.reject(new TasksError('VERSION_CONFLICT', 'changed', false))
    await first
    expect(state.dirty).toEqual({ title: 'Новое' })
    state.version = 9
    void autosave.retry()
    expect(prepare).toHaveBeenLastCalledWith({ title: 'Новое' }, 9)
    expect(send.mock.calls[1]![0].body.idempotencyKey).toBe('k2')
  })

  it('keeps the typed value after DECLINED and sends nothing on its own', async () => {
    const { state, answers, send, autosave } = setup()
    const first = autosave.edit('title', 'Новое')
    answers[0]!.reject(new TasksError('DECLINED', 'The user declined the call', false))
    await first
    expect([state.failed?.code, state.dirty]).toEqual(['DECLINED', { title: 'Новое' }])
    void autosave.edit('priority', 'low')
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('shown', () => {
  it('shows dirty fields over the server values and the server values elsewhere', () => {
    expect(shown({ ...task, priority: 'high' }, { title: 'Моё' })).toEqual({ ...task, priority: 'high', title: 'Моё' })
  })
})
