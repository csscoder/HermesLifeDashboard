import { describe, expect, it } from 'vitest'
import { askDelete, pendingDelete } from '../app/spaces/confirm-delete'

describe('askDelete', () => {
  it('exposes the request until the user answers it', async () => {
    const asked = askDelete('x')
    expect(pendingDelete.value?.message).toBe('x')
    pendingDelete.value?.answer(true)
    expect(await asked).toBe(true)
    expect(pendingDelete.value).toBeNull()
  })

  it('resolves a pending request with false when a second one arrives', async () => {
    const first = askDelete('a')
    const second = askDelete('b')
    expect(await first).toBe(false)
    expect(pendingDelete.value?.message).toBe('b')
    pendingDelete.value?.answer(true)
    expect(await second).toBe(true)
  })

  it('ignores a late answer to a request that was already settled', async () => {
    const first = askDelete('a')
    const stale = pendingDelete.value
    stale?.answer(false)
    expect(await first).toBe(false)
    const second = askDelete('b')
    stale?.answer(true)
    expect(pendingDelete.value?.message).toBe('b')
    pendingDelete.value?.answer(false)
    expect(await second).toBe(false)
  })
})
