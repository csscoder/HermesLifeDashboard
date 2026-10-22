import { computed, ref } from 'vue'
import type { SpaceBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import type { SpaceSummary } from '@lifedashboard/contracts/space'
import type { api, ApiFailure, ApiResult } from '../api'

export type ConnectResult = { state: 'ready'; spaces: SpaceSummary[] } | { state: 'pairing' | 'unavailable' }
export type LoadOutcome = 'loaded' | 'ignored' | 'unauthorized' | 'unavailable'
export type SaveOutcome = 'saved' | 'skipped' | 'conflict' | 'unauthorized' | 'invalid' | 'unavailable'

/** What the board does after an outcome. A missing `notice` keeps the current one; `null` clears it. */
export interface Reaction {
  leaveMode?: true
  notice?: string | null
  api?: 'ok' | 'down'
  reload?: true
  app?: 'pairing' | 'unavailable'
}

/** 401 asks for pairing; no space or no API is unavailable. */
export async function connect(client: Pick<typeof api, 'spaces'>): Promise<ConnectResult> {
  const result = await client.spaces()
  if (result.ok) return result.data.length > 0 ? { state: 'ready', spaces: result.data } : { state: 'unavailable' }
  return { state: result.kind === 'unauthorized' ? 'pairing' : 'unavailable' }
}

/** The outcome of a failed request. Conflict, 401 and invalid data are kept apart; the rest is unavailable. */
export function failureOutcome(kind: ApiFailure['kind']): SaveOutcome {
  return kind === 'conflict' || kind === 'unauthorized' || kind === 'invalid' ? kind : 'unavailable'
}

/**
 * The loaded board of one space. `idle()` is true while no build or edit mode is open. A load that
 * finishes after a mode opened is dropped, so a working copy is always saved with the revision of
 * the snapshot it was taken from (DATA-06); the save then meets any conflict or error itself.
 */
export function useSpaceSync(
  client: Pick<typeof api, 'board' | 'saveBoard' | 'addScreen' | 'deleteScreen'>,
  spaceId: () => string,
  idle: () => boolean,
) {
  const space = ref<SpaceBoard | null>(null)
  // True while a PUT runs: the board ignores input so the working copy cannot change meanwhile.
  const saving = ref(false)
  const loaded = computed(() => space.value !== null)

  async function load(): Promise<LoadOutcome> {
    const requested = spaceId()
    const result = await client.board(requested)
    // An expired session always wins: pairing discards the working copy anyway.
    if (!result.ok && result.kind === 'unauthorized') return 'unauthorized'
    // A switch that started meanwhile owns the board now; so does a mode opened during the load.
    if (spaceId() !== requested) return 'ignored'
    if (space.value !== null && (!idle() || saving.value)) return 'ignored'
    if (!result.ok) return 'unavailable'
    space.value = result.data
    return 'loaded'
  }

  // Shared by every request that answers with the whole board, so each one is guarded and mapped alike.
  async function replaceBoard(
    request: (current: SpaceBoard) => Promise<ApiResult<SpaceBoard>>,
  ): Promise<{ outcome: SaveOutcome; board?: SpaceBoard }> {
    const current = space.value
    if (!current || saving.value) return { outcome: 'skipped' }
    saving.value = true
    const result = await request(current)
    saving.value = false
    if (!result.ok) return { outcome: failureOutcome(result.kind) }
    space.value = result.data
    return { outcome: 'saved', board: result.data }
  }

  // Saves one screen with the loaded revision; the server decides about conflicts.
  async function save(next: ScreenBoard): Promise<SaveOutcome> {
    const { outcome } = await replaceBoard((current) =>
      client.saveBoard(spaceId(), {
        expectedRevision: current.revision,
        screens: current.screens.map((screen) => (screen.id === next.id ? next : screen)),
      }),
    )
    return outcome
  }

  // Same PUT as save; the caller's reaction (afterStaySave) keeps edit mode open.
  const saveAndStay = save

  // Loads the space of spaceId() regardless of idle(): only called once the working copy is saved or discarded.
  async function switchSpace(): Promise<LoadOutcome> {
    const result = await client.board(spaceId())
    if (result.ok) {
      space.value = result.data
      return 'loaded'
    }
    return result.kind === 'unauthorized' ? 'unauthorized' : 'unavailable'
  }

  async function addScreen(): Promise<{ outcome: SaveOutcome; screenId?: string }> {
    const { outcome, board } = await replaceBoard((current) => client.addScreen(spaceId(), current.revision))
    // The API appends the new screen, so it is the last one.
    return { outcome, screenId: board?.screens.at(-1)?.id }
  }

  async function deleteScreen(screenId: string): Promise<SaveOutcome> {
    const { outcome } = await replaceBoard((current) => client.deleteScreen(spaceId(), screenId, current.revision))
    return outcome
  }

  return { space, saving, loaded, load, save, saveAndStay, switchSpace, addScreen, deleteScreen }
}

export function afterLoad(outcome: LoadOutcome): Reaction {
  if (outcome === 'loaded') return { api: 'ok' }
  if (outcome === 'ignored') return {}
  return { leaveMode: true, app: outcome === 'unauthorized' ? 'pairing' : 'unavailable' }
}

export function afterSave(outcome: SaveOutcome): Reaction {
  switch (outcome) {
    case 'saved':
      return { leaveMode: true, notice: null, api: 'ok' }
    case 'skipped':
      return {}
    case 'conflict':
      // Leaving the mode first makes the reload apply.
      return { leaveMode: true, notice: 'Доска изменена в другой вкладке', reload: true }
    case 'unauthorized':
      return { leaveMode: true, app: 'pairing' }
    case 'invalid':
      return { notice: 'Не удалось сохранить: данные отклонены' }
    case 'unavailable':
      return { notice: 'Не удалось сохранить, повторите', api: 'down' }
  }
}

/** Reaction of a save that keeps edit mode open: the caller decides whether to leave it. */
export function afterStaySave(outcome: SaveOutcome): Reaction {
  switch (outcome) {
    case 'saved':
      return { notice: null, api: 'ok' }
    case 'skipped':
      return {}
    case 'conflict':
      return { notice: 'Доска изменена в другой вкладке' }
    case 'unauthorized':
      return { leaveMode: true, app: 'pairing' }
    case 'invalid':
      return { notice: 'Не удалось сохранить: данные отклонены' }
    case 'unavailable':
      return { notice: 'Не удалось сохранить, повторите', api: 'down' }
  }
}

/** Reaction of a space or screen operation. It keeps edit mode open, so «Отмена» can retry it. */
export function afterManage(outcome: SaveOutcome): Reaction {
  if (outcome === 'conflict') return { notice: 'Пространство изменено в другой вкладке. Нажмите «Отмена» и повторите' }
  if (outcome === 'invalid') return { notice: 'Не удалось выполнить действие' }
  return afterStaySave(outcome)
}
