import type { SpaceBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import { describe, expect, it, vi } from 'vitest'
import { afterLoad, afterManage, afterSave, afterStaySave, connect, failureOutcome, useSpaceSync } from '../app/board/space-sync'

const SPACE = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
const OTHER_SPACE = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b02'
const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const OTHER_SCREEN = '00000000-0000-4000-8000-0000000000ff'
const NEW_SCREEN = '00000000-0000-4000-8000-0000000000fe'
const A = '00000000-0000-4000-8000-00000000000a'

function screen(ids: string[]): ScreenBoard {
  return {
    id: SCREEN,
    rows: 12,
    instances: ids.map((id) => ({ id, source: { kind: 'builtin', type: 'placeholder' }, configVersion: 1, config: {} })),
    layout: ids.map((id, index) => ({ instanceId: id, x: index, y: 0, w: 1, h: 1 })),
  }
}

function board(revision: number, ids: string[] = []): SpaceBoard {
  return { spaceId: SPACE, revision, screens: [screen(ids), { id: OTHER_SCREEN, rows: 12, instances: [], layout: [] }] }
}

const ok = <T>(data: T) => ({ ok: true as const, data })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const client = { board: vi.fn(), saveBoard: vi.fn(), addScreen: vi.fn(), deleteScreen: vi.fn() }
  const view = { idle: true, spaceId: SPACE }
  const sync = useSpaceSync(client, () => view.spaceId, () => view.idle)
  return { client, view, sync }
}

async function loaded(revision = 1) {
  const s = setup()
  s.client.board.mockResolvedValueOnce(ok(board(revision)))
  expect(await s.sync.load()).toBe('loaded')
  return s
}

describe('connect', () => {
  it('is ready with the full list of spaces', async () => {
    const list = [{ id: 'r1' }, { id: 'r2' }]
    const spaces = vi.fn().mockResolvedValue(ok(list))
    expect(await connect({ spaces })).toEqual({ state: 'ready', spaces: list })
  })

  it('asks for pairing on 401', async () => {
    const spaces = vi.fn().mockResolvedValue({ ok: false, kind: 'unauthorized' })
    expect(await connect({ spaces })).toEqual({ state: 'pairing' })
  })

  it.each([
    ['no space', ok([])],
    ['an unavailable API', { ok: false, kind: 'unavailable' }],
    ['a rejected request', { ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'm' }],
  ])('is unavailable for %s', async (_name, result) => {
    expect(await connect({ spaces: vi.fn().mockResolvedValue(result) })).toEqual({ state: 'unavailable' })
  })
})

describe('load', () => {
  it('stores the board of the space', async () => {
    const { client, sync } = setup()
    client.board.mockResolvedValueOnce(ok(board(1)))
    expect(sync.loaded.value).toBe(false)
    expect(await sync.load()).toBe('loaded')
    expect(client.board).toHaveBeenCalledWith(SPACE)
    expect(sync.space.value).toEqual(board(1))
    expect(sync.loaded.value).toBe(true)
  })

  it.each([
    ['unauthorized', 'unauthorized'],
    ['unavailable', 'unavailable'],
    ['rate-limited', 'unavailable'],
  ])('reports a failed %s load as %s and keeps nothing', async (kind, outcome) => {
    const { client, sync } = setup()
    client.board.mockResolvedValueOnce({ ok: false, kind })
    expect(await sync.load()).toBe(outcome)
    expect(sync.space.value).toBeNull()
  })

  it('replaces the board on a later load in view mode', async () => {
    const { client, sync } = await loaded(1)
    client.board.mockResolvedValueOnce(ok(board(2, [A])))
    expect(await sync.load()).toBe('loaded')
    expect(sync.space.value?.revision).toBe(2)
  })

  it('ignores a load that finishes after a mode was opened, so the save keeps the old revision', async () => {
    const { client, view, sync } = await loaded(1)
    const late = deferred<unknown>()
    client.board.mockReturnValueOnce(late.promise)
    const pending = sync.load() // the tab became visible in view mode
    view.idle = false // «Изменить» was pressed before the response
    late.resolve(ok(board(2, [A])))
    expect(await pending).toBe('ignored')
    expect(sync.space.value).toEqual(board(1))

    client.saveBoard.mockResolvedValueOnce({ ok: false, kind: 'conflict' })
    expect(await sync.save(screen([]))).toBe('conflict')
    expect(client.saveBoard.mock.calls[0]![1].expectedRevision).toBe(1)
  })

  it('ignores a load that finishes after the view moved to another space', async () => {
    const { client, view, sync } = await loaded(1)
    const late = deferred<unknown>()
    client.board.mockReturnValueOnce(late.promise)
    const pending = sync.load()
    view.spaceId = OTHER_SPACE // a switch started while the load was in flight
    late.resolve(ok({ ...board(2, [A]), spaceId: SPACE }))
    expect(await pending).toBe('ignored')
    expect(sync.space.value).toEqual(board(1))
  })

  it('ignores a failed load while a mode is open', async () => {
    const { client, view, sync } = await loaded(1)
    view.idle = false
    client.board.mockResolvedValueOnce({ ok: false, kind: 'unavailable' })
    expect(await sync.load()).toBe('ignored')
    expect(sync.space.value).toEqual(board(1))
  })

  it('reports 401 even when it arrives after a mode was opened', async () => {
    const { client, view, sync } = await loaded(1)
    const late = deferred<unknown>()
    client.board.mockReturnValueOnce(late.promise)
    const pending = sync.load()
    view.idle = false
    late.resolve({ ok: false, kind: 'unauthorized' })
    expect(await pending).toBe('unauthorized')
  })
})

describe('save', () => {
  it('is skipped before the first load', async () => {
    const { client, sync } = setup()
    expect(await sync.save(screen([A]))).toBe('skipped')
    expect(client.saveBoard).not.toHaveBeenCalled()
  })

  it('sends the loaded revision with only the given screen replaced and stores the response', async () => {
    const { client, sync } = await loaded(1)
    client.saveBoard.mockResolvedValueOnce(ok(board(2, [A])))
    expect(await sync.save(screen([A]))).toBe('saved')
    expect(client.saveBoard).toHaveBeenCalledWith(SPACE, { expectedRevision: 1, screens: board(2, [A]).screens })
    expect(sync.space.value).toEqual(board(2, [A]))
    expect(sync.saving.value).toBe(false)
  })

  it('is saving while the request runs and skips a second save', async () => {
    const { client, sync } = await loaded(1)
    const reply = deferred<unknown>()
    client.saveBoard.mockReturnValueOnce(reply.promise)
    const first = sync.save(screen([A]))
    expect(sync.saving.value).toBe(true)
    expect(await sync.save(screen([A]))).toBe('skipped')
    reply.resolve(ok(board(2, [A])))
    expect(await first).toBe('saved')
    expect(sync.saving.value).toBe(false)
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['conflict', 'conflict'],
    ['unauthorized', 'unauthorized'],
    ['invalid', 'invalid'],
    ['unavailable', 'unavailable'],
    ['rate-limited', 'unavailable'],
  ])('reports a failed %s save as %s and keeps the loaded board', async (kind, outcome) => {
    const { client, sync } = await loaded(1)
    client.saveBoard.mockResolvedValueOnce({ ok: false, kind, message: 'm' })
    expect(await sync.save(screen([A]))).toBe(outcome)
    expect(sync.space.value).toEqual(board(1))
    expect(sync.saving.value).toBe(false)
  })
})

describe('saveAndStay', () => {
  it('sends the loaded revision and stores the response, like save', async () => {
    const { client, sync } = await loaded(1)
    client.saveBoard.mockResolvedValueOnce(ok(board(2, [A])))
    expect(await sync.saveAndStay(screen([A]))).toBe('saved')
    expect(client.saveBoard).toHaveBeenCalledWith(SPACE, { expectedRevision: 1, screens: board(2, [A]).screens })
    expect(sync.space.value).toEqual(board(2, [A]))
  })

  it('keeps the loaded board on conflict', async () => {
    const { client, sync } = await loaded(1)
    client.saveBoard.mockResolvedValueOnce({ ok: false, kind: 'conflict' })
    expect(await sync.saveAndStay(screen([A]))).toBe('conflict')
    expect(sync.space.value).toEqual(board(1))
  })

  it('is skipped while a save runs', async () => {
    const { client, sync } = await loaded(1)
    const reply = deferred<unknown>()
    client.saveBoard.mockReturnValueOnce(reply.promise)
    const first = sync.save(screen([A]))
    expect(await sync.saveAndStay(screen([A]))).toBe('skipped')
    reply.resolve(ok(board(2, [A])))
    await first
    expect(client.saveBoard).toHaveBeenCalledTimes(1)
  })
})

describe('switchSpace', () => {
  it('loads the current space even while a mode is open and replaces the board', async () => {
    const { client, view, sync } = await loaded(1)
    view.idle = false
    view.spaceId = OTHER_SPACE
    client.board.mockResolvedValueOnce(ok({ ...board(7), spaceId: OTHER_SPACE }))
    expect(await sync.switchSpace()).toBe('loaded')
    expect(client.board).toHaveBeenLastCalledWith(OTHER_SPACE)
    expect(sync.space.value).toEqual({ ...board(7), spaceId: OTHER_SPACE })
  })

  it.each([
    ['unauthorized', 'unauthorized'],
    ['unavailable', 'unavailable'],
  ])('reports a failed %s switch as %s and keeps the board', async (kind, outcome) => {
    const { client, sync } = await loaded(1)
    client.board.mockResolvedValueOnce({ ok: false, kind })
    expect(await sync.switchSpace()).toBe(outcome)
    expect(sync.space.value).toEqual(board(1))
  })
})

describe('addScreen', () => {
  const added = () => ({ ...board(2), screens: [...board(2).screens, { id: NEW_SCREEN, rows: 12, instances: [], layout: [] }] })

  it('sends the loaded revision, stores the board and returns the new last screen id', async () => {
    const { client, sync } = await loaded(1)
    client.addScreen.mockResolvedValueOnce(ok(added()))
    expect(await sync.addScreen()).toEqual({ outcome: 'saved', screenId: NEW_SCREEN })
    expect(client.addScreen).toHaveBeenCalledWith(SPACE, 1)
    expect(sync.space.value).toEqual(added())
    expect(sync.saving.value).toBe(false)
  })

  it('keeps the board on conflict and returns no screen id', async () => {
    const { client, sync } = await loaded(1)
    client.addScreen.mockResolvedValueOnce({ ok: false, kind: 'conflict' })
    expect(await sync.addScreen()).toEqual({ outcome: 'conflict' })
    expect(sync.space.value).toEqual(board(1))
  })

  it('is skipped before the first load', async () => {
    const { client, sync } = setup()
    expect(await sync.addScreen()).toEqual({ outcome: 'skipped' })
    expect(client.addScreen).not.toHaveBeenCalled()
  })

  it('is saving while the request runs and skips a second operation', async () => {
    const { client, sync } = await loaded(1)
    const reply = deferred<unknown>()
    client.addScreen.mockReturnValueOnce(reply.promise)
    const first = sync.addScreen()
    expect(sync.saving.value).toBe(true)
    expect(await sync.deleteScreen(SCREEN)).toBe('skipped')
    reply.resolve(ok(added()))
    expect(await first).toEqual({ outcome: 'saved', screenId: NEW_SCREEN })
    expect(client.deleteScreen).not.toHaveBeenCalled()
  })
})

describe('deleteScreen', () => {
  const remaining = () => ({ ...board(2), screens: [board(2).screens[1]!] })

  it('sends the loaded revision and stores the board', async () => {
    const { client, sync } = await loaded(1)
    client.deleteScreen.mockResolvedValueOnce(ok(remaining()))
    expect(await sync.deleteScreen(SCREEN)).toBe('saved')
    expect(client.deleteScreen).toHaveBeenCalledWith(SPACE, SCREEN, 1)
    expect(sync.space.value).toEqual(remaining())
    expect(sync.saving.value).toBe(false)
  })

  it('keeps the board on conflict', async () => {
    const { client, sync } = await loaded(1)
    client.deleteScreen.mockResolvedValueOnce({ ok: false, kind: 'conflict' })
    expect(await sync.deleteScreen(SCREEN)).toBe('conflict')
    expect(sync.space.value).toEqual(board(1))
  })

  it.each([
    ['invalid', 'invalid'],
    ['unavailable', 'unavailable'],
    ['rate-limited', 'unavailable'],
  ])('reports a failed %s delete as %s', async (kind, outcome) => {
    const { client, sync } = await loaded(1)
    client.deleteScreen.mockResolvedValueOnce({ ok: false, kind })
    expect(await sync.deleteScreen(SCREEN)).toBe(outcome)
    expect(sync.saving.value).toBe(false)
  })
})

describe('failureOutcome', () => {
  it.each([
    ['conflict', 'conflict'],
    ['unauthorized', 'unauthorized'],
    ['session-expired', 'unavailable'],
    ['invalid', 'invalid'],
    ['unavailable', 'unavailable'],
    ['rate-limited', 'unavailable'],
    ['upstream', 'unavailable'],
  ] as const)('maps a %s failure to %s', (kind, outcome) => {
    expect(failureOutcome(kind)).toBe(outcome)
  })
})

describe('reactions', () => {
  it.each([
    ['saved', { notice: null, api: 'ok' }],
    ['skipped', {}],
    // Stays in edit mode: the working copy is kept for a retry (spec «Revision checks»).
    ['conflict', { notice: 'Доска изменена в другой вкладке' }],
    ['unauthorized', { leaveMode: true, app: 'pairing' }],
    ['invalid', { notice: 'Не удалось сохранить: данные отклонены' }],
    ['unavailable', { notice: 'Не удалось сохранить, повторите', api: 'down' }],
  ] as const)('after a %s stay-save: %o', (outcome, reaction) => {
    expect(afterStaySave(outcome)).toEqual(reaction)
  })

  it.each([
    ['saved', { notice: null, api: 'ok' }],
    ['skipped', {}],
    ['conflict', { notice: 'Пространство изменено в другой вкладке. Нажмите «Отмена» и повторите' }],
    ['unauthorized', { leaveMode: true, app: 'pairing' }],
    ['invalid', { notice: 'Не удалось выполнить действие' }],
    ['unavailable', { notice: 'Не удалось сохранить, повторите', api: 'down' }],
  ] as const)('after a %s space or screen action: %o', (outcome, reaction) => {
    expect(afterManage(outcome)).toEqual(reaction)
  })

  it.each([
    ['loaded', { api: 'ok' }],
    ['ignored', {}],
    // A 401 discards an open working copy and shows pairing (spec «App states»).
    ['unauthorized', { leaveMode: true, app: 'pairing' }],
    ['unavailable', { leaveMode: true, app: 'unavailable' }],
  ] as const)('after a %s load: %o', (outcome, reaction) => {
    expect(afterLoad(outcome)).toEqual(reaction)
  })

  it.each([
    ['saved', { leaveMode: true, notice: null, api: 'ok' }],
    ['skipped', {}],
    ['conflict', { leaveMode: true, notice: 'Доска изменена в другой вкладке', reload: true }],
    ['unauthorized', { leaveMode: true, app: 'pairing' }],
    // The mode and the working copy stay so the user can retry or cancel (DATA-05).
    ['invalid', { notice: 'Не удалось сохранить: данные отклонены' }],
    ['unavailable', { notice: 'Не удалось сохранить, повторите', api: 'down' }],
  ] as const)('after a %s save: %o', (outcome, reaction) => {
    expect(afterSave(outcome)).toEqual(reaction)
  })
})
