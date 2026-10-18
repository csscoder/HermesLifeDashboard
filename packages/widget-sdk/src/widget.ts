import { inject, provide, readonly, type InjectionKey } from 'vue'
import type { GatewayInputs, GatewayOp, GatewayOutputs, HttpOutput, HttpSendInput, StateSetOutput, WidgetContext, WidgetErrorCode } from '@lifedashboard/contracts/widget-gateway'

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
  /**
   * Reactive, read-only context owned by the host; secret config values are set/unset booleans.
   * Requires no permission; has no operation limits and never rejects.
   */
  readonly context: Readonly<WidgetContext>
  /**
   * Instance-local persistence; requires `state`. See get/set for limits and WidgetError codes.
   */
  state: {
    /**
     * Read state and its revision; requires `state`. Limited by RATE_LIMITS['state.get']
     * and the shared BRIDGE_LIMITS described on call.
     * @throws {WidgetError} SESSION_EXPIRED, PERMISSION_DENIED, INVALID_INPUT, RATE_LIMITED,
     * TIMEOUT, BRIDGE_CLOSED, UNAVAILABLE, DECLINED.
     */
    get<T>(): Promise<{ data: T | null; revision: number }>
    /**
     * Write JSON state at expectedRevision; requires `state`. Limited by STATE_MAX_BYTES,
     * RATE_LIMITS['state.set'] and the shared BRIDGE_LIMITS described on call.
     * @throws {WidgetError} CONFLICT when the revision is stale; SESSION_EXPIRED,
     * PERMISSION_DENIED, INVALID_INPUT, RATE_LIMITED, TIMEOUT, BRIDGE_CLOSED, UNAVAILABLE, DECLINED.
     */
    set(data: unknown, expectedRevision: number): Promise<{ revision: number }>
  }
  /**
   * Show a notification; requires `notifications` and may ask for user confirmation.
   * Title must be 1–80 characters (NOTIFICATION_TITLE_MAX); body may be up to 300 characters
   * (NOTIFICATION_BODY_MAX), measured by JavaScript string.length. An omitted body becomes
   * an empty string. Limited by RATE_LIMITS['notifications.send'] and the shared BRIDGE_LIMITS on call.
   * @throws {WidgetError} SESSION_EXPIRED, PERMISSION_DENIED, INVALID_INPUT, RATE_LIMITED,
   * TIMEOUT, BRIDGE_CLOSED, UNAVAILABLE, DECLINED.
   */
  notify(message: { title: string; body?: string }): Promise<void>
  /**
   * HTTP through the host; requires `network` and an approved manifest origin.
   * See get/send for limits and WidgetError codes. The host injects bound secrets;
   * exact and URL-encoded copies of secret values in response body/contentType become [REDACTED]
   * (encodeURIComponent and URLSearchParams forms). Other modified copies are not redacted.
   * @since sdk 2
   */
  http: {
    /**
     * GET without a confirmation dialog; requires `network` and an approved origin.
     * Only the optional accept header is sent by the widget. Limited by HTTP_LIMITS.urlLength,
     * HTTP_LIMITS.headerValueLength, HTTP_LIMITS.responseBytes, HTTP_LIMITS.answerBytes,
     * HTTP_LIMITS.timeoutMs (4 s upstream deadline), RATE_LIMITS['http.get'] and the shared
     * BRIDGE_LIMITS on call.
     * @returns The upstream status and UTF-8-decoded text body. Any HTTP status is a result,
     * including 4xx/5xx; redirects are not followed, so 3xx is returned as the status.
     * @throws {WidgetError} SESSION_EXPIRED, PERMISSION_DENIED, INVALID_INPUT (including a
     * secret query collision), RATE_LIMITED, TIMEOUT (bridge deadline: BRIDGE_LIMITS.requestTimeoutMs,
     * 10 s), BRIDGE_CLOSED, UNAVAILABLE (upstream timeout, unreachable host, response exceeding
     * HTTP_LIMITS.responseBytes or HTTP_LIMITS.answerBytes, or a missing bound secret whose
     * setting is named in the message), DECLINED.
     * @since sdk 2
     */
    get(url: string, options?: { accept?: string }): Promise<HttpOutput>
    /**
     * POST, PUT, PATCH or DELETE; requires `network` and an approved origin and may ask
     * for user confirmation. Widget headers are limited to accept and content-type.
     * Limited by HTTP_LIMITS.urlLength, HTTP_LIMITS.headerValueLength, HTTP_LIMITS.bodyBytes,
     * HTTP_LIMITS.responseBytes, HTTP_LIMITS.answerBytes, HTTP_LIMITS.timeoutMs (4 s upstream deadline),
     * RATE_LIMITS['http.send'] and the shared BRIDGE_LIMITS on call.
     * @returns The upstream status and UTF-8-decoded text body. Any HTTP status is a result,
     * including 4xx/5xx; redirects are not followed, so 3xx is returned as the status.
     * @throws {WidgetError} SESSION_EXPIRED, PERMISSION_DENIED, INVALID_INPUT (including a
     * secret query collision), RATE_LIMITED, TIMEOUT (bridge deadline: BRIDGE_LIMITS.confirmTimeoutMs,
     * 250 s for this confirmable operation), BRIDGE_CLOSED, UNAVAILABLE (upstream timeout,
     * unreachable host, response exceeding HTTP_LIMITS.responseBytes or HTTP_LIMITS.answerBytes,
     * or a missing bound secret whose setting is named in the message), DECLINED.
     * @since sdk 2
     */
    send(request: HttpSendInput): Promise<HttpOutput>
  }
  /**
   * Call a gateway operation directly; retained for sdk 1 widgets. Requires GATEWAY_OPS[op].permission;
   * confirmation follows GATEWAY_OPS[op].confirm. Input/output limits follow the corresponding helper
   * and RATE_LIMITS[op]. All calls share BRIDGE_LIMITS.maxMessageBytes, BRIDGE_LIMITS.maxInFlight,
   * BRIDGE_LIMITS.requestTimeoutMs and, for confirmable operations, BRIDGE_LIMITS.confirmTimeoutMs.
   * @throws {WidgetError} SESSION_EXPIRED, UNKNOWN_OP (untyped callers), PERMISSION_DENIED,
   * INVALID_INPUT, RATE_LIMITED, CONFLICT (state.set), TIMEOUT, BRIDGE_CLOSED, UNAVAILABLE, DECLINED.
   */
  call<Op extends GatewayOp>(op: Op, input: GatewayInputs[Op]): Promise<GatewayOutputs[Op]>
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
    http: {
      get: async (url, options) => (await call('http.get', options?.accept === undefined ? { url } : { url, headers: { accept: options.accept } })) as HttpOutput,
      send: async (request) => (await call('http.send', request)) as HttpOutput,
    },
    call: async <Op extends GatewayOp>(op: Op, input: GatewayInputs[Op]) => (await call(op, input)) as GatewayOutputs[Op],
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
