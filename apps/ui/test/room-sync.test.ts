import type { RoomBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import { describe, expect, it, vi } from 'vitest'
import { afterLoad, afterSave, connect, useRoomSync } from '../app/board/room-sync'

const ROOM = '0b9f4a52-4d1c-4a8e-9d3b-2f6c1e7a5b01'
const SCREEN = '5c2e8d17-93a4-4f6b-8e21-7d4b0a9c3e02'
const OTHER_SCREEN = '00000000-0000-4000-8000-0000000000ff'
const A = '00000000-0000-4000-8000-00000000000a'

function screen(ids: string[]): ScreenBoard {
  return {
    id: SCREEN,
    rows: 12,
    instances: ids.map((id) => ({ id, source: { kind: 'builtin', type: 'placeholder' }, configVersion: 1, config: {} })),
    layout: ids.map((id, index) => ({ instanceId: id, x: index, y: 0, w: 1, h: 1 })),
  }
}

function board(revision: number, ids: string[] = []): RoomBoard {
  return { roomId: ROOM, revision, screens: [screen(ids), { id: OTHER_SCREEN, rows: 12, instances: [], layout: [] }] }
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
  const client = { board: vi.fn(), saveBoard: vi.fn() }
  const view = { idle: true }
  const sync = useRoomSync(client, () => ROOM, () => view.idle)
  return { client, view, sync }
}

async function loaded(revision = 1) {
  const s = setup()
  s.client.board.mockResolvedValueOnce(ok(board(revision)))
  expect(await s.sync.load()).toBe('loaded')
  return s
}

describe('connect', () => {
  it('is ready with the first room', async () => {
    const rooms = vi.fn().mockResolvedValue(ok([{ id: 'r1' }, { id: 'r2' }]))
    expect(await connect({ rooms })).toEqual({ state: 'ready', roomId: 'r1' })
  })

  it('asks for pairing on 401', async () => {
    const rooms = vi.fn().mockResolvedValue({ ok: false, kind: 'unauthorized' })
    expect(await connect({ rooms })).toEqual({ state: 'pairing' })
  })

  it.each([
    ['no room', ok([])],
    ['an unavailable API', { ok: false, kind: 'unavailable' }],
    ['a rejected request', { ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'm' }],
  ])('is unavailable for %s', async (_name, result) => {
    expect(await connect({ rooms: vi.fn().mockResolvedValue(result) })).toEqual({ state: 'unavailable' })
  })
})

describe('load', () => {
  it('stores the board of the room', async () => {
    const { client, sync } = setup()
    client.board.mockResolvedValueOnce(ok(board(1)))
    expect(sync.loaded.value).toBe(false)
    expect(await sync.load()).toBe('loaded')
    expect(client.board).toHaveBeenCalledWith(ROOM)
    expect(sync.room.value).toEqual(board(1))
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
    expect(sync.room.value).toBeNull()
  })

  it('replaces the board on a later load in view mode', async () => {
    const { client, sync } = await loaded(1)
    client.board.mockResolvedValueOnce(ok(board(2, [A])))
    expect(await sync.load()).toBe('loaded')
    expect(sync.room.value?.revision).toBe(2)
  })

  it('ignores a load that finishes after a mode was opened, so the save keeps the old revision', async () => {
    const { client, view, sync } = await loaded(1)
    const late = deferred<unknown>()
    client.board.mockReturnValueOnce(late.promise)
    const pending = sync.load() // the tab became visible in view mode
    view.idle = false // «Изменить» was pressed before the response
    late.resolve(ok(board(2, [A])))
    expect(await pending).toBe('ignored')
    expect(sync.room.value).toEqual(board(1))

    client.saveBoard.mockResolvedValueOnce({ ok: false, kind: 'conflict' })
    expect(await sync.save(screen([]))).toBe('conflict')
    expect(client.saveBoard.mock.calls[0]![1].expectedRevision).toBe(1)
  })

  it('ignores a failed load while a mode is open', async () => {
    const { client, view, sync } = await loaded(1)
    view.idle = false
    client.board.mockResolvedValueOnce({ ok: false, kind: 'unavailable' })
    expect(await sync.load()).toBe('ignored')
    expect(sync.room.value).toEqual(board(1))
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
    expect(client.saveBoard).toHaveBeenCalledWith(ROOM, { expectedRevision: 1, screens: board(2, [A]).screens })
    expect(sync.room.value).toEqual(board(2, [A]))
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
    expect(sync.room.value).toEqual(board(1))
    expect(sync.saving.value).toBe(false)
  })
})

describe('reactions', () => {
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
