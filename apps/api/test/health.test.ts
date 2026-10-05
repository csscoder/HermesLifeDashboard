import { expect, it } from 'vitest'
import { testApp } from './helpers.ts'

it('GET /health returns status ok', async () => {
  const t = await testApp()
  const response = await t.app.inject({ method: 'GET', url: '/health' })

  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ status: 'ok' })
  await t.close()
})
