import { GatewayFailure, HTTP_LIMITS, type HttpOutput, type HttpSendMethod } from './widget-gateway.ts'
import { injectSecret, redactSecrets, type BoundSecret } from './widget-secrets.ts'

export interface ProxyRequest {
  url: string
  method: 'GET' | HttpSendMethod
  headers?: Record<string, string>
  body?: string
}

/**
 * Spec 2026-10-11 «Operations»: one request to an approved origin. No redirects, cookies or extra
 * headers; bounded in time and size. Any upstream status is a result; failures are UPSTREAM_ERROR.
 */
export async function proxyHttp(request: ProxyRequest, origins: ReadonlySet<string>, timeoutMs: number = HTTP_LIMITS.timeoutMs): Promise<HttpOutput> {
  if (!origins.has(new URL(request.url).origin)) throw new GatewayFailure('PERMISSION_DENIED', 'The widget may not reach this origin')
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers ?? {},
      body: request.body,
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const output: HttpOutput = {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await readText(response),
    }
    if (new TextEncoder().encode(JSON.stringify(output)).byteLength > HTTP_LIMITS.answerBytes) throw new GatewayFailure('UPSTREAM_ERROR', 'The response is too large')
    return output
  } catch (error) {
    if (error instanceof GatewayFailure) throw error
    const name = error instanceof Error ? error.name : ''
    throw new GatewayFailure('UPSTREAM_ERROR', name === 'TimeoutError' || name === 'AbortError' ? 'The service did not answer in time' : 'The service is unreachable')
  }
}

// The timeout signal also covers this read, so a stalled body ends as «did not answer in time».
async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > HTTP_LIMITS.responseBytes) {
      await reader.cancel()
      throw new GatewayFailure('UPSTREAM_ERROR', 'The response is larger than 100 KB')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

export async function performHttp(
  input: ProxyRequest,
  context: { origins: ReadonlySet<string>; secrets: readonly BoundSecret[]; values: ReadonlyMap<string, string> },
  timeoutMs?: number,
): Promise<HttpOutput> {
  const { values } = context
  const origin = new URL(input.url).origin
  if (!context.origins.has(origin)) throw new GatewayFailure('PERMISSION_DENIED', 'The widget may not reach this origin')
  const bindings = context.secrets.filter(({ bind }) => bind.origin === origin)
  // Check all values before injection, so a later missing setting wins over a query collision.
  for (const { key, title } of bindings) {
    if (!values.has(key)) throw new GatewayFailure('UPSTREAM_ERROR', `Secret «${title}» is not set`)
  }
  let request = { url: input.url, headers: { ...input.headers } }
  for (const { key, bind } of bindings) {
    const injected = injectSecret(request, bind, values.get(key)!)
    if ('error' in injected) {
      const name = 'query' in bind ? bind.query : ''
      throw new GatewayFailure('INVALID_INPUT', `The URL already contains the secret parameter "${name}"`)
    }
    request = injected
  }
  const output = await proxyHttp({ ...input, ...request }, context.origins, timeoutMs)
  const redactions = [...values.values()]
  return {
    ...output,
    body: redactSecrets(output.body, redactions),
    contentType: output.contentType === null ? null : redactSecrets(output.contentType, redactions),
  }
}
