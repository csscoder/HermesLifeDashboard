import {
  checkGatewayCall, createRateLimiter, GATEWAY_OPS, GatewayFailure, widgetFailure,
  type GatewayInputs, type GatewayOutputs, type WidgetErrorCode,
} from '@lifedashboard/contracts/widget-gateway'
import { performHttp, type ProxyRequest } from '@lifedashboard/contracts/widget-http'
import type { WidgetPackageManifest } from '@lifedashboard/contracts/widget-package'
import { secretsOf } from '@lifedashboard/contracts/widget-secrets'

export type ConfirmMode = 'allow' | 'decline'
export type DevCallResult = { ok: true; value: unknown } | { ok: false; code: WidgetErrorCode; message: string }

export interface DevGateway {
  call(op: string, input: unknown, confirm: ConfirmMode, shell?: string): Promise<DevCallResult>
  reset(): void
}

export function createDevGateway(deps: {
  manifest: () => WidgetPackageManifest
  secrets: () => ReadonlyMap<string, string>
  log: (kind: 'gateway', message: string, shell?: string) => void
  now?: () => number
}): DevGateway {
  const now = deps.now ?? Date.now
  let allowCall = createRateLimiter(now)
  let data = 'null'
  let revision = 0

  return {
    async call(op, input, confirm, shell) {
      let target = ''

      async function execute(): Promise<DevCallResult> {
        const manifest = deps.manifest()
        const call = checkGatewayCall(op, input, new Set(manifest.permissions))
        if (!call.ok) return { ok: false, ...widgetFailure(call.code, call.message) }
        // Production spends the limit when it issues the confirmation, so a declined call costs capacity too.
        if (!allowCall('dev', call.op)) throw new GatewayFailure('RATE_LIMITED', 'Too many calls')
        if (GATEWAY_OPS[call.op].confirm !== 'never' && confirm === 'decline') {
          return { ok: false, code: 'DECLINED', message: 'The user declined the call' }
        }

        let value: GatewayOutputs[keyof GatewayOutputs]
        switch (call.op) {
          case 'state.get':
            value = { data: JSON.parse(data) as unknown, revision }
            break
          case 'state.set': {
            const { data: nextData, expectedRevision } = call.input as GatewayInputs['state.set']
            const current = revision
            if (current !== expectedRevision) throw new GatewayFailure('CONFLICT', 'The widget state changed since it was read')
            data = JSON.stringify(nextData)
            revision = current + 1
            value = { revision }
            break
          }
          case 'notifications.send':
            value = { ok: true }
            break
          case 'http.get':
          case 'http.send': {
            const request: ProxyRequest = call.op === 'http.get'
              ? { ...call.input as GatewayInputs['http.get'], method: 'GET' }
              : call.input as GatewayInputs['http.send']
            value = await performHttp(request, {
              origins: new Set(manifest.network ?? []),
              secrets: secretsOf(manifest.settings),
              values: deps.secrets(),
            })
            target = ` ${request.method} ${new URL(request.url).origin} ${value.status}`
            break
          }
        }
        return { ok: true, value }
      }

      let result: DevCallResult
      try {
        result = await execute()
      } catch (error) {
        if (!(error instanceof GatewayFailure)) throw error
        result = { ok: false, ...widgetFailure(error.code, error.message) }
      }
      deps.log('gateway', result.ok ? `${op} ok${target}` : `${op} ${result.code}: ${result.message}`, shell)
      return result
    },
    reset() {
      data = 'null'
      revision = 0
      allowCall = createRateLimiter(now)
    },
  }
}
