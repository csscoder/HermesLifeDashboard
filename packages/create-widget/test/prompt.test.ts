import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { askTitle } from '../src/prompt.ts'

describe('askTitle', () => {
  it('asks for the title and returns the trimmed answer', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let shown = ''
    output.on('data', (chunk: Buffer) => { shown += chunk.toString('utf8') })
    const answer = askTitle(input, output)
    input.write('  Мои часы  \n')
    await expect(answer).resolves.toBe('Мои часы')
    expect(shown).toContain('Widget title: ')
  })
})
