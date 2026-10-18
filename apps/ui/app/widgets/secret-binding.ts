import type { BoundSecret } from '@lifedashboard/contracts/widget-secrets'

export function bindingLine(secret: BoundSecret): string {
  const { title, bind } = secret
  const target = 'header' in bind ? `заголовок ${bind.header}` : `параметр ${bind.query}`
  return `Секрет «${title}» отправляется на ${bind.origin} (${target})`
}
