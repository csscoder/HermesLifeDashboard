import type { SpaceBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import type { SpaceSummary } from '@lifedashboard/contracts/space'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_SPACE_ID, SEED_SCREEN_ID } from '../src/migrations.ts'
import { call, errorCode, installPackage, pair, testApp, widgetPackage, type TestApp } from './helpers.ts'

const SPACES = '/api/v1/spaces'
const BOARD = `/api/v1/spaces/${SEED_SPACE_ID}/board`
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const placeholder = { kind: 'builtin', type: 'placeholder' } as const
const EMPTY_SCREEN = { id: SEED_SCREEN_ID, rows: 12, instances: [], layout: [] }
const W = '00000000-0000-4000-8000-00000000000c'
const oneWidget = (id: string, screenId: string) => ({
  id: screenId,
  rows: 12,
  instances: [{ id, source: { ...placeholder }, configVersion: 1, config: {} }],
  layout: [{ instanceId: id, x: 0, y: 0, w: 2, h: 2 }],
})

// B is listed before A on purpose: the saved order must read back unchanged.
// The layout follows the instance order, as every board the UI produces does.
const screen: ScreenBoard = {
  id: SEED_SCREEN_ID,
  rows: 12,
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

async function getBoard(): Promise<SpaceBoard> {
  const response = await call(t.app, { url: BOARD, cookie })
  expect(response.statusCode).toBe(200)
  return response.json().data
}

function put(payload: unknown, url = BOARD) {
  return call(t.app, { method: 'PUT', url, cookie, payload })
}

function create() {
  return call(t.app, { method: 'POST', url: SPACES, cookie, payload: {} })
}

function patch(spaceId: string, payload: unknown) {
  return call(t.app, { method: 'PATCH', url: `${SPACES}/${spaceId}`, cookie, payload })
}

function remove(spaceId: string, expectedRevision: number) {
  return call(t.app, { method: 'DELETE', url: `${SPACES}/${spaceId}`, cookie, payload: { expectedRevision } })
}

function addScreen(spaceId: string, expectedRevision: number) {
  return call(t.app, { method: 'POST', url: `${SPACES}/${spaceId}/screens`, cookie, payload: { expectedRevision } })
}

function removeScreen(spaceId: string, screenId: string, expectedRevision: number) {
  return call(t.app, { method: 'DELETE', url: `${SPACES}/${spaceId}/screens/${screenId}`, cookie, payload: { expectedRevision } })
}

async function listSpaces(): Promise<SpaceSummary[]> {
  return (await call(t.app, { url: SPACES, cookie })).json().data
}

async function boardOf(spaceId: string): Promise<SpaceBoard> {
  return (await call(t.app, { url: `${SPACES}/${spaceId}/board`, cookie })).json().data
}

describe('GET /api/v1/spaces', () => {
  it('lists the seed space', async () => {
    const response = await call(t.app, { url: '/api/v1/spaces', cookie })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([{ id: SEED_SPACE_ID, title: 'Главная', icon: '🏠', color: 'violet', position: 0, revision: 1 }])
  })
})

describe('POST /api/v1/spaces', () => {
  it('creates spaces with the next colour, the next position and one empty screen', async () => {
    const first = (await create()).json().data as SpaceSummary
    const second = (await create()).json().data as SpaceSummary
    expect(first).toEqual({ id: expect.any(String), title: 'Новое пространство', icon: '⭐', color: 'blue', position: 1, revision: 1 })
    expect(second).toEqual({ id: expect.any(String), title: 'Новое пространство', icon: '⭐', color: 'teal', position: 2, revision: 1 })
    expect((await listSpaces()).map((space) => [space.id, space.position])).toEqual([
      [SEED_SPACE_ID, 0],
      [first.id, 1],
      [second.id, 2],
    ])
    for (const id of [first.id, second.id]) {
      expect(await boardOf(id)).toEqual({
        spaceId: id,
        revision: 1,
        screens: [{ id: expect.any(String), rows: 12, instances: [], layout: [] }],
      })
    }
  })

  it('answers 400 at 20 spaces and adds nothing', async () => {
    for (let index = 1; index < 20; index++) expect((await create()).statusCode).toBe(200)
    expect(await listSpaces()).toHaveLength(20)
    const response = await create()
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toBe('At most 20 spaces')
    expect(await listSpaces()).toHaveLength(20)
  })
})

describe('PATCH /api/v1/spaces/:spaceId', () => {
  it('updates title, icon and colour, keeps the revision', async () => {
    const response = await patch(SEED_SPACE_ID, { title: '  Дом ', icon: '💼', color: 'pink' })
    expect(response.statusCode).toBe(200)
    const expected = { id: SEED_SPACE_ID, title: 'Дом', icon: '💼', color: 'pink', position: 0, revision: 1 }
    expect(response.json().data).toEqual(expected)
    expect(await listSpaces()).toEqual([expected])
  })

  it('answers 400 for a blank title and changes nothing', async () => {
    const before = await listSpaces()
    const response = await patch(SEED_SPACE_ID, { title: '' })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await listSpaces()).toEqual(before)
  })

  it('answers 404 for an unknown space', async () => {
    const response = await patch('00000000-0000-4000-8000-000000000000', { title: 'Дом' })
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })
})

describe('DELETE /api/v1/spaces/:spaceId', () => {
  it('deletes the space with its widgets, widget state and secrets, and keeps other spaces data', async () => {
    const other = (await create()).json().data.id as string
    const otherScreen = (await boardOf(other)).screens[0]!.id
    await put({ expectedRevision: 1, screens: [oneWidget(A, otherScreen)] }, `${SPACES}/${other}/board`)
    await put({ expectedRevision: 1, screens: [oneWidget(W, SEED_SCREEN_ID)] })
    t.db.exec(`
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${A}', '{}', 1, 'x');
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${W}', '{}', 1, 'x');
      INSERT INTO widget_secrets (widget_id, key, value, updated_at) VALUES ('${A}', 'apiKey', 'v', 'x');
    `)

    // The board save above made the revision 2.
    const response = await remove(other, 2)
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toBeNull()
    expect((await listSpaces()).map((space) => space.id)).toEqual([SEED_SPACE_ID])
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widgets WHERE id = ?').get(A)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_state WHERE widget_id = ?').get(A)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_secrets WHERE widget_id = ?').get(A)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_state WHERE widget_id = ?').get(W)).toEqual({ n: 1 })
    expect((await getBoard()).screens[0]!.instances.map((instance) => instance.id)).toEqual([W])
  })

  it('answers 409 for a stale revision and keeps the space and its widgets', async () => {
    const other = (await create()).json().data.id as string
    await put({ expectedRevision: 1, screens: [oneWidget(W, SEED_SCREEN_ID)] })
    const saved = await getBoard()
    expect(saved.revision).toBe(2)
    const response = await remove(SEED_SPACE_ID, 1)
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('REVISION_CONFLICT')
    expect((await listSpaces()).map((space) => space.id)).toEqual([SEED_SPACE_ID, other])
    expect(await getBoard()).toEqual(saved)
  })

  it('answers 400 for the last space and keeps it', async () => {
    const response = await remove(SEED_SPACE_ID, 1)
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toBe('The last space cannot be deleted')
    expect((await listSpaces()).map((space) => space.id)).toEqual([SEED_SPACE_ID])
  })

  it('answers 404 for an unknown space', async () => {
    const response = await remove('00000000-0000-4000-8000-000000000000', 1)
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })
})

describe('space mutations without a session', () => {
  it('answers 401 for create, update and delete', async () => {
    expect((await call(t.app, { method: 'POST', url: SPACES, payload: {} })).statusCode).toBe(401)
    expect((await call(t.app, { method: 'PATCH', url: `${SPACES}/${SEED_SPACE_ID}`, payload: { title: 'Дом' } })).statusCode).toBe(401)
    expect((await call(t.app, { method: 'DELETE', url: `${SPACES}/${SEED_SPACE_ID}`, payload: { expectedRevision: 1 } })).statusCode).toBe(401)
  })

  it('answers 401 for add and delete screen', async () => {
    expect((await call(t.app, { method: 'POST', url: `${SPACES}/${SEED_SPACE_ID}/screens`, payload: { expectedRevision: 1 } })).statusCode).toBe(401)
    expect(
      (await call(t.app, { method: 'DELETE', url: `${SPACES}/${SEED_SPACE_ID}/screens/${SEED_SCREEN_ID}`, payload: { expectedRevision: 1 } })).statusCode,
    ).toBe(401)
  })
})

describe('POST /api/v1/spaces/:spaceId/screens', () => {
  it('adds an empty screen with 12 rows at the end and bumps the revision', async () => {
    const response = await addScreen(SEED_SPACE_ID, 1)
    expect(response.statusCode).toBe(200)
    const board: SpaceBoard = response.json().data
    expect(board.revision).toBe(2)
    expect(board.screens).toHaveLength(2)
    expect(board.screens[0]).toEqual(EMPTY_SCREEN)
    expect(board.screens[1]).toEqual({ id: expect.any(String), rows: 12, instances: [], layout: [] })
    expect(board.screens[1]!.id).not.toBe(SEED_SCREEN_ID)
    expect(await getBoard()).toEqual(board)
    expect(t.db.prepare('SELECT position FROM screens WHERE space_id = ? ORDER BY position').all(SEED_SPACE_ID)).toEqual([
      { position: 0 },
      { position: 1 },
    ])
  })

  it('answers 400 at 20 screens and adds nothing', async () => {
    let revision = 1
    for (let index = 1; index < 20; index++) {
      const response = await addScreen(SEED_SPACE_ID, revision)
      expect(response.statusCode).toBe(200)
      revision = response.json().data.revision
    }
    const before = await getBoard()
    expect(before.screens).toHaveLength(20)
    const response = await addScreen(SEED_SPACE_ID, revision)
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toBe('At most 20 screens per space')
    expect(await getBoard()).toEqual(before)
  })

  it('answers 409 for a stale revision and adds nothing', async () => {
    // Another tab saved the board since revision 1 was loaded.
    expect((await put({ expectedRevision: 1, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })).statusCode).toBe(200)
    const before = await getBoard()
    const response = await addScreen(SEED_SPACE_ID, 1)
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('REVISION_CONFLICT')
    expect(await getBoard()).toEqual(before)
    expect(before.screens).toHaveLength(1)
  })

  it('answers 400 for a missing expectedRevision and adds nothing', async () => {
    const response = await call(t.app, { method: 'POST', url: `${SPACES}/${SEED_SPACE_ID}/screens`, cookie, payload: {} })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect((await getBoard()).screens).toHaveLength(1)
  })

  it('answers 404 for an unknown space', async () => {
    const response = await addScreen('00000000-0000-4000-8000-000000000000', 1)
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })

  it('lets a board save use the new screen list', async () => {
    expect((await addScreen(SEED_SPACE_ID, 1)).statusCode).toBe(200)
    const board = await getBoard()
    const response = await put({ expectedRevision: board.revision, screens: [board.screens[0]!, { ...board.screens[1]!, rows: 20 }] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.revision).toBe(3)
    expect(response.json().data.screens.map((screen: ScreenBoard) => screen.rows)).toEqual([12, 20])
  })
})

describe('DELETE /api/v1/spaces/:spaceId/screens/:screenId', () => {
  it('deletes the second of two screens with its widgets, widget state and secrets', async () => {
    const second = (await addScreen(SEED_SPACE_ID, 1)).json().data.screens[1].id as string
    expect((await put({ expectedRevision: 2, screens: [oneWidget(A, SEED_SCREEN_ID), oneWidget(W, second)] })).statusCode).toBe(200)
    t.db.exec(`
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${A}', '{}', 1, 'x');
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${W}', '{}', 1, 'x');
      INSERT INTO widget_secrets (widget_id, key, value, updated_at) VALUES ('${W}', 'apiKey', 'v', 'x');
    `)

    const response = await removeScreen(SEED_SPACE_ID, second, 3)
    expect(response.statusCode).toBe(200)
    const board: SpaceBoard = response.json().data
    expect(board.revision).toBe(4)
    expect(board.screens.map((screen) => screen.id)).toEqual([SEED_SCREEN_ID])
    expect(board.screens[0]!.instances.map((instance) => instance.id)).toEqual([A])
    expect(await getBoard()).toEqual(board)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM screens WHERE id = ?').get(second)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widgets WHERE id = ?').get(W)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_state WHERE widget_id = ?').get(W)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_secrets WHERE widget_id = ?').get(W)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widget_state WHERE widget_id = ?').get(A)).toEqual({ n: 1 })
  })

  it('deletes a middle screen and renumbers the rest to 0..n-1', async () => {
    await addScreen(SEED_SPACE_ID, 1)
    const three: SpaceBoard = (await addScreen(SEED_SPACE_ID, 2)).json().data
    const middle = three.screens[1]!.id
    const last = three.screens[2]!.id
    expect((await put({ expectedRevision: 3, screens: [EMPTY_SCREEN, three.screens[1]!, oneWidget(W, last)] })).statusCode).toBe(200)

    const response = await removeScreen(SEED_SPACE_ID, middle, 4)
    expect(response.statusCode).toBe(200)
    const board: SpaceBoard = response.json().data
    expect(board.revision).toBe(5)
    expect(board.screens.map((screen) => screen.id)).toEqual([SEED_SCREEN_ID, last])
    expect(board.screens[1]!.instances.map((instance) => instance.id)).toEqual([W])
    expect(t.db.prepare('SELECT position FROM screens WHERE space_id = ? ORDER BY position').all(SEED_SPACE_ID)).toEqual([
      { position: 0 },
      { position: 1 },
    ])
  })

  it('answers 400 for the only screen and keeps it', async () => {
    const before = await getBoard()
    const response = await removeScreen(SEED_SPACE_ID, SEED_SCREEN_ID, 1)
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(response.json().error.message).toBe('The last screen cannot be deleted; delete the space')
    expect(await getBoard()).toEqual(before)
  })

  it('answers 409 for a stale revision and keeps the screen and its widgets', async () => {
    const second = (await addScreen(SEED_SPACE_ID, 1)).json().data.screens[1].id as string
    // Another tab saved widgets on the second screen after revision 2 was loaded.
    expect((await put({ expectedRevision: 2, screens: [EMPTY_SCREEN, oneWidget(W, second)] })).statusCode).toBe(200)
    const saved = await getBoard()
    expect(saved.revision).toBe(3)
    const response = await removeScreen(SEED_SPACE_ID, second, 2)
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('REVISION_CONFLICT')
    expect(await getBoard()).toEqual(saved)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM widgets WHERE id = ?').get(W)).toEqual({ n: 1 })
  })

  it('answers 404 for an unknown space and for a screen of another space', async () => {
    const other = (await create()).json().data.id as string
    const otherScreen = (await boardOf(other)).screens[0]!.id
    const unknownSpace = await removeScreen('00000000-0000-4000-8000-000000000000', SEED_SCREEN_ID, 1)
    expect(unknownSpace.statusCode).toBe(404)
    expect(errorCode(unknownSpace)).toBe('NOT_FOUND')
    const response = await removeScreen(SEED_SPACE_ID, otherScreen, 1)
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
    expect((await boardOf(other)).screens.map((screen) => screen.id)).toEqual([otherScreen])
  })
})

describe('GET /api/v1/spaces/:spaceId/board', () => {
  it('returns the empty seed board', async () => {
    expect(await getBoard()).toEqual({
      spaceId: SEED_SPACE_ID,
      revision: 1,
      screens: [EMPTY_SCREEN],
    })
  })

  it('answers 404 for an unknown space', async () => {
    const response = await call(t.app, { url: '/api/v1/spaces/00000000-0000-4000-8000-000000000000/board', cookie })
    expect(response.statusCode).toBe(404)
    expect(errorCode(response)).toBe('NOT_FOUND')
  })
})

describe('PUT /api/v1/spaces/:spaceId/board', () => {
  it('stores rows and reads them back, also on an empty screen', async () => {
    const response = await put({ expectedRevision: 1, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({ spaceId: SEED_SPACE_ID, revision: 2, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
    expect(await getBoard()).toEqual({ spaceId: SEED_SPACE_ID, revision: 2, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
  })

  it('accepts a placement below the configured rows', async () => {
    const red = { ...screen, rows: 4, layout: [{ instanceId: B, x: 4, y: 20, w: 2, h: 2 }, screen.layout[1]!] }
    const response = await put({ expectedRevision: 1, screens: [red] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([red])
  })

  it('saves, increments the revision and round-trips order and nested config', async () => {
    const response = await put({ expectedRevision: 1, screens: [screen] })
    expect(response.statusCode).toBe(200)
    const saved: SpaceBoard = response.json().data
    expect(saved).toEqual({ spaceId: SEED_SPACE_ID, revision: 2, screens: [screen] })
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
    expect((await put({ expectedRevision: 2, screens: [EMPTY_SCREEN] })).statusCode).toBe(200)
    expect((await getBoard()).screens).toEqual([EMPTY_SCREEN])
  })

  it('answers 409 for a stale revision and changes nothing', async () => {
    await put({ expectedRevision: 1, screens: [screen] })
    const response = await put({ expectedRevision: 1, screens: [{ ...EMPTY_SCREEN, rows: 30 }] })
    expect(response.statusCode).toBe(409)
    expect(errorCode(response)).toBe('REVISION_CONFLICT')
    expect(await getBoard()).toEqual({ spaceId: SEED_SPACE_ID, revision: 2, screens: [screen] })
  })

  const overlapping = structuredClone(screen)
  overlapping.layout[0] = { instanceId: B, x: 2, y: 2, w: 2, h: 2 }
  const outside = structuredClone(screen)
  outside.layout[0] = { instanceId: B, x: 23, y: 0, w: 2, h: 2 }
  const duplicate = structuredClone(screen)
  duplicate.instances[1]!.id = B
  const withoutRows = { id: screen.id, instances: screen.instances, layout: screen.layout }
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
    ['missing rows', { expectedRevision: 2, screens: [withoutRows] }],
    ['rows below 4', { expectedRevision: 2, screens: [{ ...screen, rows: 3 }] }],
    ['rows above 100', { expectedRevision: 2, screens: [{ ...screen, rows: 101 }] }],
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

  it('answers 400 when a widget id belongs to another space and changes neither space', async () => {
    const otherSpace = '00000000-0000-4000-8000-0000000000aa'
    const otherSpaceScreen = '00000000-0000-4000-8000-0000000000ab'
    t.db.exec(`
      INSERT INTO spaces (id, title, position, revision, created_at, updated_at) VALUES ('${otherSpace}', 'Other', 1, 1, 'x', 'x');
      INSERT INTO screens (id, space_id, position) VALUES ('${otherSpaceScreen}', '${otherSpace}', 0);
      INSERT INTO widgets (id, screen_id, source_kind, source_type, config, config_version, x, y, w, h)
      VALUES ('${A}', '${otherSpaceScreen}', 'builtin', 'placeholder', '{}', 1, 0, 0, 1, 1);
    `)
    // The target space already holds B, so a partial replacement would be visible.
    const onlyB: ScreenBoard = { id: SEED_SCREEN_ID, rows: 12, instances: [screen.instances[0]!], layout: [screen.layout[0]!] }
    const before = (await put({ expectedRevision: 1, screens: [onlyB] })).json().data
    const response = await put({ expectedRevision: 2, screens: [screen] })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain(A)
    expect(await getBoard()).toEqual(before)
    expect(t.db.prepare('SELECT screen_id FROM widgets WHERE id = ?').get(A)).toEqual({ screen_id: otherSpaceScreen })
  })

  it('answers 404 for an unknown space', async () => {
    const response = await put({ expectedRevision: 1, screens: [screen] }, '/api/v1/spaces/00000000-0000-4000-8000-000000000000/board')
    expect(response.statusCode).toBe(404)
  })

  it('requires a session', async () => {
    const response = await call(t.app, { method: 'PUT', url: BOARD, payload: { expectedRevision: 1, screens: [screen] } })
    expect(response.statusCode).toBe(401)
  })
})

describe('package widgets on the board', () => {
  const pomodoro = { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' } as const

  function installVersion(): void {
    t.db.exec(`
      INSERT INTO widget_packages (id, title, author, created_at) VALUES ('dev.test.hello', 'Hello', 'test', 'x');
      INSERT INTO widget_package_versions (package_id, version, hash, manifest, installed_at)
      VALUES ('dev.test.hello', '1.0.0', '${'a'.repeat(64)}', '{}', 'x');
    `)
  }

  const withPackage: ScreenBoard = {
    id: SEED_SCREEN_ID,
    rows: 12,
    instances: [
      { id: A, source: { ...pomodoro }, configVersion: 1, config: {} },
      { id: B, source: { ...placeholder }, configVersion: 1, config: {} },
    ],
    layout: [
      { instanceId: A, x: 0, y: 0, w: 3, h: 3 },
      { instanceId: B, x: 4, y: 0, w: 2, h: 2 },
    ],
  }

  it('saves and reads back a package source', async () => {
    installVersion()
    const response = await put({ expectedRevision: 1, screens: [withPackage] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([withPackage])
    expect(t.db.prepare('SELECT source_kind, source_type, source_version FROM widgets WHERE id = ?').get(A)).toEqual({
      source_kind: 'package',
      source_type: 'dev.test.hello',
      source_version: '1.0.0',
    })
    expect(t.db.prepare('SELECT source_version FROM widgets WHERE id = ?').get(B)).toEqual({ source_version: null })
  })

  it('answers 400 for a package version that is not installed and changes nothing', async () => {
    const response = await put({ expectedRevision: 1, screens: [withPackage] })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain('dev.test.hello@1.0.0 is not installed')
    expect(await getBoard()).toEqual({ spaceId: SEED_SPACE_ID, revision: 1, screens: [EMPTY_SCREEN] })
  })

  it('keeps widget state across a save that keeps the widget and drops it with the widget', async () => {
    installVersion()
    await put({ expectedRevision: 1, screens: [withPackage] })
    t.db.exec(`
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${A}', '{"n":1}', 1, 'x');
      INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES ('${B}', '{"n":2}', 1, 'x');
    `)
    const onlyA: ScreenBoard = { id: SEED_SCREEN_ID, rows: 12, instances: [withPackage.instances[0]!], layout: [withPackage.layout[0]!] }
    expect((await put({ expectedRevision: 2, screens: [onlyA] })).statusCode).toBe(200)
    expect(t.db.prepare('SELECT widget_id FROM widget_state').all()).toEqual([{ widget_id: A }])
  })
})

describe('package widget version transitions', () => {
  const origin = 'https://api.example.com'
  const nextOrigin = 'https://other.example.com'
  const header = (name: string, prefix?: string) => ({ origin, header: name, ...(prefix === undefined ? {} : { prefix }) })
  const query = (name: string) => ({ origin, query: name })
  const beforeBindings = {
    sameHeader: header('X-Key'), sameQuery: query('token'), changedHeader: header('X-Old'),
    changedOrigin: header('X-Origin'), changedPrefix: header('X-Prefix', 'Bearer '),
    changedQuery: query('old'), changedKind: header('X-Kind'), removed: header('X-Removed'), plain: header('X-Plain'),
  }
  let original: ScreenBoard

  beforeEach(async () => {
    for (const version of ['1.0.0', '2.0.0']) {
      await installPackage(t, cookie, widgetPackage((pkg) => {
        pkg.manifest.sdk = 2
        pkg.manifest.version = version
        pkg.manifest.permissions = ['state', 'network']
        pkg.manifest.network = [origin, nextOrigin]
        const bindings = version === '1.0.0' ? beforeBindings : {
          sameHeader: header('x-key'), sameQuery: query('token'), changedHeader: header('X-New'),
          changedOrigin: { origin: nextOrigin, header: 'X-Origin' }, changedPrefix: header('X-Prefix', 'Basic '),
          changedQuery: query('new'), changedKind: query('kind'),
        }
        pkg.manifest.settings = { type: 'object', properties: Object.fromEntries(Object.entries(bindings)
          .map(([key, bind]) => [key, { type: 'secret', title: key, bind }])) }
        if (version === '2.0.0') {
          pkg.manifest.sizing = { default: { w: 4, h: 4 }, min: { w: 4, h: 4 }, max: { w: 6, h: 6 } }
          pkg.manifest.settings.properties.plain = { type: 'string', title: 'Plain', default: '' }
        }
      }))
    }
    original = oneWidget(A, SEED_SCREEN_ID)
    original.instances[0]!.source = { kind: 'package', packageId: 'dev.test.hello', version: '1.0.0' }
    original.instances[0]!.appearance = { themeId: 'builtin:glass', shadow: null }
    original.layout[0] = { instanceId: A, x: 0, y: 0, w: 3, h: 3 }
    const saved = await put({ expectedRevision: 1, screens: [original] })
    expect(saved.statusCode, saved.body).toBe(200)
    t.db.prepare('INSERT INTO widget_state (widget_id, data, revision, updated_at) VALUES (?, ?, 7, ?)').run(A, '{"count":42}', 'x')
    for (const key of Object.keys(beforeBindings)) {
      const saved = await call(t.app, { method: 'PUT', url: `/api/v1/widgets/${A}/secrets/${key}`, cookie, payload: { value: 'test-secret-value' } })
      expect(saved.statusCode).toBe(200)
    }
  })

  function upgrade(w = 4, h = 4): ScreenBoard {
    const next = structuredClone(original)
    next.instances[0]!.source = { kind: 'package', packageId: 'dev.test.hello', version: '2.0.0' }
    next.layout[0] = { instanceId: A, x: 0, y: 0, w, h }
    return next
  }

  function state() { return t.db.prepare('SELECT data, revision FROM widget_state WHERE widget_id = ?').get(A) }
  function secretKeys() { return (t.db.prepare('SELECT key FROM widget_secrets WHERE widget_id = ? ORDER BY key').all(A) as { key: string }[]).map(({ key }) => key) }

  it('preserves state and only secrets with unchanged key and binding', async () => {
    const next = upgrade()
    const response = await put({ expectedRevision: 2, screens: [next] })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.screens).toEqual([next])
    expect(state()).toEqual({ data: '{"count":42}', revision: 7 })
    expect(secretKeys()).toEqual(['sameHeader', 'sameQuery'])
  })

  it.each([[3, 4], [4, 3], [7, 4], [4, 7]])('rejects target sizing %sx%s without changing source or data', async (w, h) => {
    const response = await put({ expectedRevision: 2, screens: [upgrade(w, h)] })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect((await getBoard()).screens).toEqual([original])
    expect(state()).toEqual({ data: '{"count":42}', revision: 7 })
    expect(secretKeys()).toEqual(Object.keys(beforeBindings).sort())
  })

  it('retains source and secrets after a revision conflict', async () => {
    const response = await put({ expectedRevision: 1, screens: [upgrade()] })
    expect([response.statusCode, errorCode(response)]).toEqual([409, 'REVISION_CONFLICT'])
    expect((await getBoard()).screens).toEqual([original])
    expect(state()).toEqual({ data: '{"count":42}', revision: 7 })
    expect(secretKeys()).toEqual(Object.keys(beforeBindings).sort())
  })

  it('rolls back secret cleanup when a later widget fails target sizing', async () => {
    const before = structuredClone(original)
    before.instances.push({ ...structuredClone(original.instances[0]!), id: B })
    before.layout.push({ instanceId: B, x: 6, y: 0, w: 3, h: 3 })
    expect((await put({ expectedRevision: 2, screens: [before] })).statusCode).toBe(200)
    const next = upgrade()
    next.instances.push({ ...structuredClone(next.instances[0]!), id: B })
    next.layout.push({ instanceId: B, x: 6, y: 0, w: 3, h: 4 })
    const response = await put({ expectedRevision: 3, screens: [next] })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect((await getBoard()).screens).toEqual([before])
    expect(state()).toEqual({ data: '{"count":42}', revision: 7 })
    expect(secretKeys()).toEqual(Object.keys(beforeBindings).sort())
  })

  it.each(['builtin', 'package'] as const)('drops state and secrets when the same UUID changes to another %s source', async (kind) => {
    await installPackage(t, cookie, widgetPackage((pkg) => { pkg.manifest.id = 'dev.test.other' }))
    const next = structuredClone(original)
    next.instances[0]!.source = kind === 'builtin' ? { ...placeholder } : { kind: 'package', packageId: 'dev.test.other', version: '1.0.0' }
    expect((await put({ expectedRevision: 2, screens: [next] })).statusCode).toBe(200)
    expect((await getBoard()).screens).toEqual([next])
    expect(state()).toBeUndefined()
    expect(secretKeys()).toEqual([])
  })
})

describe('widget appearance', () => {
  const look = { themeId: 'builtin:bare', shadow: { x: 2, y: 4, blur: 12, color: '#102030', opacity: 0.25 } }
  const styled = (appearance: unknown) => ({
    ...screen,
    instances: [{ ...screen.instances[0]!, appearance }, screen.instances[1]!],
  })

  it('round-trips appearance after config and leaves the key out for widgets without one', async () => {
    const response = await put({ expectedRevision: 1, screens: [styled(look)] })
    expect(response.statusCode).toBe(200)
    const board = await getBoard()
    expect(JSON.stringify(board.screens[0])).toBe(JSON.stringify(styled(look)))
    expect(board.screens[0]!.instances[1]).not.toHaveProperty('appearance')
  })

  it('stores NULL for an empty appearance and reads the old board JSON back', async () => {
    const response = await put({ expectedRevision: 1, screens: [styled({ themeId: null, shadow: null })] })
    expect(response.statusCode).toBe(200)
    expect(t.db.prepare('SELECT appearance FROM widgets ORDER BY rowid').all()).toEqual([{ appearance: null }, { appearance: null }])
    expect(JSON.stringify((await getBoard()).screens[0])).toBe(JSON.stringify(screen))
  })

  it('answers 400 for an invalid appearance and changes nothing', async () => {
    const response = await put({ expectedRevision: 1, screens: [styled({ themeId: null, shadow: { ...look.shadow, blur: 49 } })] })
    expect(response.statusCode).toBe(400)
    expect(errorCode(response)).toBe('VALIDATION_ERROR')
    expect(await getBoard()).toEqual({ spaceId: SEED_SPACE_ID, revision: 1, screens: [EMPTY_SCREEN] })
  })
})
