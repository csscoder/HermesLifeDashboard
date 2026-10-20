import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_TASK, CREATE_COMMAND } from '../app/widgets/starter-prompt'

describe('starter prompt', () => {
  it('creates the project with the npm create mapping of @lifedashboard/create-widget', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../packages/create-widget/package.json', import.meta.url), 'utf8')) as { name: string }
    expect(pkg.name).toBe('@lifedashboard/create-widget')
    expect(CREATE_COMMAND.startsWith('npm create @lifedashboard/widget ')).toBe(true)
  })

  it('points the agent at AGENTS.md', () => {
    expect(AGENT_TASK).toContain('AGENTS.md')
  })
})
