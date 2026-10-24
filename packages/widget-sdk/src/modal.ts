import { parseModalOpen } from '@lifedashboard/contracts/widget-modal'
import { WidgetError, type WidgetCall, type WidgetModal } from './widget.ts'

export function createWidgetModal(call: WidgetCall, options: {
  views: readonly string[]
  surface: 'widget' | 'modal'
  sendClose(reason: 'sdk' | 'escape'): void
}): WidgetModal {
  let closed = false
  return {
    async open(view, input) {
      if (options.surface === 'modal') throw new WidgetError('UNAVAILABLE')
      const parsed = parseModalOpen({ view, ...input })
      if (!parsed.ok) throw new WidgetError('INVALID_INPUT', parsed.error)
      if (!options.views.includes(parsed.value.view)) throw new WidgetError('INVALID_INPUT', 'Unknown modal view')
      await call('modal.open', parsed.value)
    },
    close() {
      if (options.surface === 'widget') throw new WidgetError('UNAVAILABLE')
      if (closed) return
      closed = true
      options.sendClose('sdk')
    },
  }
}
