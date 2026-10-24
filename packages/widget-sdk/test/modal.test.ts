import { afterEach, expect, it, vi } from 'vitest'
import { createWidgetModal } from '../src/modal.ts'
import { createPortClient } from '../src/port-client.ts'

const ports: MessagePort[] = []
afterEach(() => { for (const port of ports.splice(0)) port.close() })
function setup(surface: 'widget' | 'modal' = 'widget') {
  const { port1, port2 } = new MessageChannel()
  ports.push(port1, port2)
  const messages: any[] = []
  port1.onmessage = (event: MessageEvent) => {
    messages.push(event.data)
    if (event.data.t === 'req') port1.postMessage({ t: 'res', id: event.data.id, ok: true, value: { ok: true } })
  }
  const modal = createWidgetModal(createPortClient(port2, () => {}), {
    views: ['workspace'], surface, sendClose: (reason) => port2.postMessage({ t: 'modal-close', reason }),
  })
  return { modal, messages }
}
it('sends a validated modal.open and resolves on acceptance', async () => {
  const { modal, messages } = setup()
  await expect(modal.open('workspace', { title: 'Editor' })).resolves.toBeUndefined()
  expect(messages).toEqual([{ t: 'req', id: 0, op: 'modal.open', input: { view: 'workspace', title: 'Editor', props: {} } }])
})
it('rejects unknown views locally', async () => {
  const { modal, messages } = setup()
  await expect(modal.open('unknown')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(messages).toEqual([])
})
it('rejects invalid props locally', async () => {
  const { modal, messages } = setup()
  // @ts-expect-error JavaScript callers can pass non-JSON props.
  await expect(modal.open('workspace', { props: { action: () => 1 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(messages).toEqual([])
})
it('closes one-way from a modal surface', async () => {
  const { modal, messages } = setup('modal')
  modal.close()
  modal.close()
  await vi.waitFor(() => expect(messages).toHaveLength(1))
  expect(messages).toEqual([{ t: 'modal-close', reason: 'sdk' }])
})
it('throws UNAVAILABLE on compact close and on modal open', async () => {
  expect(() => setup().modal.close()).toThrow(expect.objectContaining({ code: 'UNAVAILABLE' }))
  await expect(setup('modal').modal.open('workspace')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
})
