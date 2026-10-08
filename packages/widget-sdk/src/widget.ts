import { inject, provide, readonly, type InjectionKey } from 'vue'
import type { StateSetOutput, WidgetContext, WidgetErrorCode } from '@lifedashboard/contracts/widget-gateway'

/** One gateway call: resolves with the operation output or rejects with a WidgetError. */
export type WidgetCall = (op: string, input: unknown) => Promise<unknown>

export class WidgetError extends Error {
  readonly code: WidgetErrorCode

  constructor(code: WidgetErrorCode, message: string = code) {
    super(message)
    this.name = 'WidgetError'
    this.code = code
  }
}

export interface Widget {
  // Reactive; the host owns it.
  readonly context: Readonly<WidgetContext>
  state: {
    get<T>(): Promise<{ data: T | null; revision: number }>
    // Rejects with CONFLICT when `expectedRevision` is stale (DATA-06).
    set(data: unknown, expectedRevision: number): Promise<{ revision: number }>
  }
  notify(message: { title: string; body?: string }): Promise<void>
  // Other gateway operations.
  call<T>(op: string, input: unknown): Promise<T>
}

export const WIDGET_KEY: InjectionKey<Widget> = Symbol('lifedashboard.widget')

/** The same Widget over any transport: the in-process broker client or the sandbox port. */
export function createWidget(call: WidgetCall, context: WidgetContext): Widget {
  return {
    context: readonly(context) as Readonly<WidgetContext>,
    state: {
      get: async <T>() => (await call('state.get', {})) as { data: T | null; revision: number },
      set: async (data, expectedRevision) => (await call('state.set', { data, expectedRevision })) as StateSetOutput,
    },
    notify: async ({ title, body = '' }) => {
      await call('notifications.send', { title, body })
    },
    call: async <T>(op: string, input: unknown) => (await call(op, input)) as T,
  }
}

export function useWidget(): Widget {
  const widget = inject(WIDGET_KEY, null)
  if (!widget) throw new Error('useWidget() must be called inside a LifeDashboard widget')
  return widget
}

/** For WidgetHost: call inside setup() of the component that renders a built-in widget. */
export function provideInProcessWidget(deps: { call: WidgetCall; context: WidgetContext }): Widget {
  const widget = createWidget(deps.call, deps.context)
  provide(WIDGET_KEY, widget)
  return widget
}
