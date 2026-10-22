import { describe, expect, it, vi } from 'vitest'
import { runDeleteScreen, runPreSave } from '../app/board/switch-flow'
import { afterManage, afterStaySave } from '../app/board/space-sync'

describe('runPreSave', () => {
  it('is ok without saving when not editing', async () => {
    const saveAndStay = vi.fn()
    expect(await runPreSave({ editing: false, dirty: true, saveAndStay })).toEqual({ ok: true })
    expect(saveAndStay).not.toHaveBeenCalled()
  })

  it('is ok without saving when editing a clean working copy', async () => {
    const saveAndStay = vi.fn()
    expect(await runPreSave({ editing: true, dirty: false, saveAndStay })).toEqual({ ok: true })
    expect(saveAndStay).not.toHaveBeenCalled()
  })

  it('is ok after a successful save of a dirty working copy', async () => {
    const saveAndStay = vi.fn().mockResolvedValue('saved')
    expect(await runPreSave({ editing: true, dirty: true, saveAndStay })).toEqual({ ok: true })
    expect(saveAndStay).toHaveBeenCalledTimes(1)
  })

  it.each(['conflict', 'invalid', 'unavailable', 'skipped'] as const)(
    'stays put with the stay-save reaction when the save is %s',
    async (outcome) => {
      const saveAndStay = vi.fn().mockResolvedValue(outcome)
      expect(await runPreSave({ editing: true, dirty: true, saveAndStay })).toEqual({ ok: false, reaction: afterStaySave(outcome) })
      expect(saveAndStay).toHaveBeenCalledTimes(1)
    },
  )

  it('never leaves edit mode or reloads on a failed save', async () => {
    const saveAndStay = vi.fn().mockResolvedValue('conflict')
    const result = await runPreSave({ editing: true, dirty: true, saveAndStay })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reaction).not.toHaveProperty('leaveMode')
    if (!result.ok) expect(result.reaction).not.toHaveProperty('reload')
  })
})

describe('runDeleteScreen', () => {
  it('asks and cancels without removing when the user declines', async () => {
    const ask = vi.fn().mockResolvedValue(false)
    const remove = vi.fn()
    expect(await runDeleteScreen({ needsConfirm: true, ask, remove })).toEqual({ ok: false, cancelled: true })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })

  it('removes after the user confirms', async () => {
    const ask = vi.fn().mockResolvedValue(true)
    const remove = vi.fn().mockResolvedValue('saved')
    expect(await runDeleteScreen({ needsConfirm: true, ask, remove })).toEqual({ ok: true })
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('removes without asking when no confirmation is needed', async () => {
    const ask = vi.fn()
    const remove = vi.fn().mockResolvedValue('saved')
    expect(await runDeleteScreen({ needsConfirm: false, ask, remove })).toEqual({ ok: true })
    expect(ask).not.toHaveBeenCalled()
  })

  it('reports a conflict with the space action reaction and no leave or reload', async () => {
    const remove = vi.fn().mockResolvedValue('conflict')
    const result = await runDeleteScreen({ needsConfirm: false, ask: vi.fn(), remove })
    expect(result).toEqual({ ok: false, reaction: afterManage('conflict') })
    expect(result).not.toHaveProperty('reaction.leaveMode')
    expect(result).not.toHaveProperty('reaction.reload')
  })
})
