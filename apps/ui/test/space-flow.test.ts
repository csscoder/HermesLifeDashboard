import type { SpaceSummary } from '@lifedashboard/contracts/space'
import { describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../app/api'
import { afterManage } from '../app/board/space-sync'
import {
  canRemoveScreen,
  deleteSpaceMessage,
  renameTo,
  runCreateSpace,
  runDeleteSpace,
  runEditSpace,
} from '../app/spaces/space-flow'

const SPACE: SpaceSummary = { id: 's-new', title: 'Новое пространство', icon: '⭐', color: 'violet', position: 1, revision: 1 }
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data })
const conflict = { ok: false, kind: 'conflict' } as const

describe('canRemoveScreen', () => {
  it('is false only for the only screen of the last space', () => {
    expect(canRemoveScreen(1, 1)).toBe(false)
  })

  it.each([
    [1, 2],
    [2, 1],
    [3, 1],
  ])('is true with %i space(s) and %i screen(s)', (spaces, screens) => {
    expect(canRemoveScreen(spaces, screens)).toBe(true)
  })
})

describe('renameTo', () => {
  it('returns the trimmed title when it changed', () => {
    expect(renameTo('Дом', '  Работа ')).toBe('Работа')
  })

  it.each([
    ['unchanged after trimming', 'Дом', '  Дом  '],
    ['empty', 'Дом', '   '],
  ])('returns null when the title is %s', (_name, current, draft) => {
    expect(renameTo(current, draft)).toBeNull()
  })
})

describe('deleteSpaceMessage', () => {
  it('names the space', () => {
    expect(deleteSpaceMessage('Дом')).toBe('Удалить пространство «Дом» вместе с экраном и виджетами?')
  })
})

describe('runCreateSpace', () => {
  const deps = () => ({
    saveIfDirty: vi.fn().mockResolvedValue(true),
    createSpace: vi.fn().mockResolvedValue(ok(SPACE)),
    switchTo: vi.fn().mockResolvedValue(true),
  })

  it('stops without creating when the pending edits were not saved', async () => {
    const d = deps()
    d.saveIfDirty.mockResolvedValue(false)
    expect(await runCreateSpace(d)).toEqual({ kind: 'stopped' })
    expect(d.createSpace).not.toHaveBeenCalled()
  })

  it('creates the space and switches to it', async () => {
    const d = deps()
    expect(await runCreateSpace(d)).toEqual({ kind: 'created', space: SPACE, switched: true })
    expect(d.switchTo).toHaveBeenCalledWith('s-new')
  })

  it('keeps the created space but reports a failed switch', async () => {
    const d = deps()
    d.switchTo.mockResolvedValue(false)
    expect(await runCreateSpace(d)).toEqual({ kind: 'created', space: SPACE, switched: false })
  })

  it('reports a failed create without switching', async () => {
    const d = deps()
    d.createSpace.mockResolvedValue({ ok: false, kind: 'invalid', code: 'VALIDATION_ERROR', message: 'm' })
    expect(await runCreateSpace(d)).toEqual({ kind: 'failed', reaction: afterManage('invalid') })
    expect(d.switchTo).not.toHaveBeenCalled()
  })
})

describe('runEditSpace', () => {
  it('returns the server summary on success', async () => {
    const renamed = { ...SPACE, title: 'Работа' }
    expect(await runEditSpace(async () => ok(renamed))).toEqual({ kind: 'updated', space: renamed })
  })

  it('reports a failure with its reaction and no summary', async () => {
    expect(await runEditSpace(async () => conflict)).toEqual({ kind: 'failed', reaction: afterManage('conflict') })
  })
})

describe('runDeleteSpace', () => {
  const ids = ['a', 'b', 'c']
  const at = (id: string) => ({ id, title: 'Дом' })

  const deps = () => ({
    ask: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(ok(null)),
    switchTo: vi.fn().mockResolvedValue(true),
  })

  it('does nothing when the user declines', async () => {
    const d = deps()
    d.ask.mockResolvedValue(false)
    expect(await runDeleteSpace(at('b'), ids, d)).toEqual({ kind: 'cancelled' })
    expect(d.remove).not.toHaveBeenCalled()
  })

  it('moves to the previous space after deleting a later one', async () => {
    const d = deps()
    expect(await runDeleteSpace(at('b'), ids, d)).toEqual({ kind: 'deleted', target: 'a', switched: true })
    expect(d.switchTo).toHaveBeenCalledWith('a')
  })

  it('moves to the next space when the first one is deleted', async () => {
    const d = deps()
    expect(await runDeleteSpace(at('a'), ids, d)).toEqual({ kind: 'deleted', target: 'b', switched: true })
  })

  it('keeps the current space and reports a failed delete', async () => {
    const d = deps()
    d.remove.mockResolvedValue(conflict)
    expect(await runDeleteSpace(at('b'), ids, d)).toEqual({ kind: 'failed', reaction: afterManage('conflict') })
    expect(d.switchTo).not.toHaveBeenCalled()
  })

  it('never deletes the last space', async () => {
    const d = deps()
    expect(await runDeleteSpace(at('a'), ['a'], d)).toEqual({ kind: 'last' })
    expect(d.ask).not.toHaveBeenCalled()
  })

  it('reports a failed switch after a successful delete', async () => {
    const d = deps()
    d.switchTo.mockResolvedValue(false)
    expect(await runDeleteSpace(at('b'), ids, d)).toEqual({ kind: 'deleted', target: 'a', switched: false })
  })
})
