import type { RoomBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_ROOM_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { call, errorCode, pair, testApp, type TestApp } from './helpers.ts'

const BOARD = `/api/v1/rooms/${SEED_ROOM_ID}/board`
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const placeholder = { kind: 'builtin', type: 'placeholder' } as const
const EMPTY_SCREEN = { id: SEED_SCREEN_ID, instances: [], layout: [] }

// B is listed before A on purpose: the saved order must read back unchanged.
// The layout follows the instance order, as every board the UI produces does.
const screen: ScreenBoard = {
  id: SEED_SCREEN_ID,
  instances: [
    { id: B, source: { ...placeholder }, configVersion: 1, config: { title: 'x', nested: { list: [1, 'two', null] } } },
    { id: A, source: { ...placeholder }, configVersion: 1, config: {} },
  ],
  layout: [
    { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
    { instanceId: A, x: 0, y: 0, w: 4, h: 4 },
  ],
}

let t: TestApp
let cookie: string

beforeEach(async () => {
  t = await testApp()
  cookie = await pair(t)
})

afterEach(async () => {
  await t.close()
})

async function getBoard(): Promise<RoomBoard> {
  const response = await call(t.app, { url: BOARD, cookie })
  expect(response.statusCode).toBe(200)
  return response.json().data
}

function put(payload: unknown, url = BOARD) {
  return call(t.app, { method: 'PUT', url, cookie, payload })
}

describe('GET /api/v1/rooms', () => {
  it('lists the seed room', async () => {
    const response = await call(t.app, { url: '/api/v1/rooms', cookie })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([{ id: SEED_ROOM_ID, title: 'Главная', position: 0, revision: 1 }])
  })
})

describe('GET /api/v1/rooms/:roomId/board', () => {
  it('returns the empty seed board', async () => {
    expect(await getBoard()).toEqual({
      roomId: SEED_ROOM_ID,
      revision: 1,
      screens: [{ id: SEED_SCREEN_ID, instances: [], layout: [] }],
    })
  })

  it('answers 404 for an unknown room', async () => {
    const response = await call(t.app, { url: '/api/v1/rooms/00000000-0000-4000-8000-000000000000/board', cookie })
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })
})

describe('PUT /api/v1/rooms/:roomId/board', () => {
  it('saves, increments the revision and round-trips order and nested config', async () => {
    const response = await put({ expectedRevision: 1, screens: [screen] })
    expect(response.statusCode).toBe(200)
    const saved: RoomBoard = response.json().data
    expect(saved).toEqual({ roomId: SEED_ROOM_ID, revision: 2, screens: [screen] })
    expect(JSON.stringify(saved.screens[0])).toBe(JSON.stringify(screen))
    expect(await getBoard()).toEqual(saved)
  })

  it('returns the layout in instance order', async () => {
    const swapped = { ...screen, layout: [screen.layout[1]!, screen.layout[0]!] }
    const response = await put({ expectedRevision: 1, screens: [swapped] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([screen])
  })

  it('replaces the previous widgets', async () => {
    await put({ expectedRevision: 1, screens: [screen] })
    const empty = { id: SEED_SCREEN_ID, instances: [], layout: [] }
    expect((await put({ expectedRevision: 2, screens: [empty] })).statusCode).toBe(200)
    expect((await getBoard()).screens).toEqual([empty])
  })

  it('answers 409 for a stale revision and changes nothing', async () => {
    await put({ expectedRevision: 1, screens: [screen] })
    const response = await put({ expectedRevision: 1, screens: [{ id: SEED_SCREEN_ID, instances: [], layout: [] }] })
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('REVISION_CONFLICT')
    expect(await getBoard()).toEqual({ roomId: SEED_ROOM_ID, revision: 2, screens: [screen] })
  })

  const overlapping = structuredClone(screen)
  overlapping.layout[0] = { instanceId: B, x: 2, y: 2, w: 2, h: 2 }
  const outside = structuredClone(screen)
  outside.layout[0] = { instanceId: B, x: 11, y: 0, w: 2, h: 2 }
  const duplicate = structuredClone(screen)
  duplicate.instances[1]!.id = B
  const otherScreen = { ...structuredClone(screen), id: '00000000-0000-4000-8000-0000000000ff' }

  // Each rejected payload targets a non-empty saved board (revision 2): a rejection must keep
  // every stored widget, not only the revision.
  it.each([
    ['an overlap', { expectedRevision: 2, screens: [overlapping] }],
    ['a rect outside the grid', { expectedRevision: 2, screens: [outside] }],
    ['a duplicate instance id', { expectedRevision: 2, screens: [duplicate] }],
    ['an unknown screen', { expectedRevision: 2, screens: [otherScreen] }],
    ['a missing screen', { expectedRevision: 2, screens: [] }],
    ['an extra screen', { expectedRevision: 2, screens: [screen, otherScreen] }],
    ['a missing expectedRevision', { screens: [EMPTY_SCREEN] }],
    ['a non-integer expectedRevision', { expectedRevision: 1.5, screens: [EMPTY_SCREEN] }],
  ])('answers 400 for %s and changes nothing', async (_name, payload) => {
    const before = (await put({ expectedRevision: 1, screens: [screen] })).json().data
    const response = await put(payload)
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await getBoard()).toEqual(before)
  })

  it('answers 400 for malformed JSON and changes nothing', async () => {
    const before = (await put({ expectedRevision: 1, screens: [screen] })).json().data
    const response = await call(t.app, { method: 'PUT', url: BOARD, cookie, payload: '{"expectedRevision":', contentType: 'application/json' })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await getBoard()).toEqual(before)
  })

  it('answers 400 when a widget id belongs to another room and changes neither room', async () => {
    const otherRoom = '00000000-0000-4000-8000-0000000000aa'
    const otherRoomScreen = '00000000-0000-4000-8000-0000000000ab'
    t.db.exec(`
      INSERT INTO rooms (id, title, position, revision, created_at, updated_at) VALUES ('${otherRoom}', 'Other', 1, 1, 'x', 'x');
      INSERT INTO screens (id, room_id, position) VALUES ('${otherRoomScreen}', '${otherRoom}', 0);
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('${A}', '${otherRoomScreen}', 'builtin', 'placeholder', '{}', 1, 0, 0, 1, 1);
    `)
    // The target room already holds B, so a partial replacement would be visible.
    const onlyB: ScreenBoard = { id: SEED_SCREEN_ID, instances: [screen.instances[0]!], layout: [screen.layout[0]!] }
    const before = (await put({ expectedRevision: 1, screens: [onlyB] })).json().data
    const response = await put({ expectedRevision: 2, screens: [screen] })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain(A)
    expect(await getBoard()).toEqual(before)
    expect(t.db.prepare('SELECT screen_id FROM widgets WHERE id = ?').get(A)).toEqual({ screen_id: otherRoomScreen })
  })

  it('answers 404 for an unknown room', async () => {
    const response = await put({ expectedRevision: 1, screens: [screen] }, '/api/v1/rooms/00000000-0000-4000-8000-000000000000/board')
    expect(response.statusCode).toBe(404)
  })

  it('requires a session', async () => {
    const response = await call(t.app, { method: 'PUT', url: BOARD, payload: { expectedRevision: 1, screens: [screen] } })
    expect(response.statusCode).toBe(401)
  })
})
