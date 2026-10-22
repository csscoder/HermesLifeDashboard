import { computed, ref } from 'vue'
import type { SpaceBoard, ScreenBoard } from '@lifedashboard/contracts/board'
import type { api } from '../api'

export type ConnectResult = { state: 'ready'; spaceId: string } | { state: 'pairing' | 'unavailable' }
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

/** The first space decides the app state: 401 asks for pairing; no space or no API is unavailable. */
export async function connect(client: Pick<typeof api, 'spaces'>): Promise<ConnectResult> {
  const result = await client.spaces()
  if (result.ok) return result.data[0] ? { state: 'ready', spaceId: result.data[0].id } : { state: 'unavailable' }
  return { state: result.kind === 'unauthorized' ? 'pairing' : 'unavailable' }
}

/**
 * The loaded board of one space. `idle()` is true while no build or edit mode is open. A load that
 * finishes after a mode opened is dropped, so a working copy is always saved with the revision of
 * the snapshot it was taken from (DATA-06); the save then meets any conflict or error itself.
 */
export function useSpaceSync(client: Pick<typeof api, 'board' | 'saveBoard'>, spaceId: () => string, idle: () => boolean) {
  const space = ref<SpaceBoard | null>(null)
  // True while a PUT runs: the board ignores input so the working copy cannot change meanwhile.
  const saving = ref(false)
  const loaded = computed(() => space.value !== null)

  async function load(): Promise<LoadOutcome> {
    const result = await client.board(spaceId())
    // An expired session always wins: pairing discards the working copy anyway.
    if (!result.ok && result.kind === 'unauthorized') return 'unauthorized'
    if (space.value !== null && (!idle() || saving.value)) return 'ignored'
    if (!result.ok) return 'unavailable'
    space.value = result.data
    return 'loaded'
  }

  // Saves one screen with the loaded revision; the server decides about conflicts.
  async function save(next: ScreenBoard): Promise<SaveOutcome> {
    const current = space.value
    if (!current || saving.value) return 'skipped'
    saving.value = true
    const result = await client.saveBoard(spaceId(), {
      expectedRevision: current.revision,
      screens: current.screens.map((screen) => (screen.id === next.id ? next : screen)),
    })
    saving.value = false
    if (result.ok) {
      space.value = result.data
      return 'saved'
    }
    if (result.kind === 'conflict' || result.kind === 'unauthorized' || result.kind === 'invalid') return result.kind
    return 'unavailable'
  }

  return { space, saving, loaded, load, save }
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
