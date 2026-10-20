import { describe, expect, it } from 'vitest'
import { packageManager } from '../src/install.ts'

describe('packageManager', () => {
  it.each([
    ['pnpm/10.30.2 npm/? node/v24.21.0 darwin arm64', 'pnpm'],
    ['yarn/4.5.0 npm/? node/v24.21.0 darwin arm64', 'yarn'],
    ['npm/11.6.0 node/v24 darwin arm64', 'npm'],
    ['bun/1.2 npm/? node/v24 darwin arm64', 'npm'],
    [undefined, 'npm'],
  ] as const)('%j → %s', (userAgent, expected) => {
    expect(packageManager(userAgent)).toBe(expected)
  })
})
