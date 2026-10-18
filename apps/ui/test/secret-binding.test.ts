import { describe, expect, it } from 'vitest'
import { bindingLine } from '../app/widgets/secret-binding'

describe('bindingLine', () => {
  it('describes a header binding with its original header name', () => {
    expect(bindingLine({ key: 'apiKey', title: 'Ключ', bind: { origin: 'https://a.example', header: 'Authorization', prefix: 'Bearer ' } }))
      .toBe('Секрет «Ключ» отправляется на https://a.example (заголовок Authorization)')
  })

  it('describes a query binding with its original parameter name', () => {
    expect(bindingLine({ key: 'apiKey', title: 'Ключ', bind: { origin: 'https://a.example', query: 'apikey' } }))
      .toBe('Секрет «Ключ» отправляется на https://a.example (параметр apikey)')
  })
})
