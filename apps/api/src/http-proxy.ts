import { HTTP_LIMITS, type HttpOutput, type HttpSendMethod } from '@lifedashboard/contracts/widget-gateway'
import { ApiError } from './errors.ts'

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
  if (!origins.has(new URL(request.url).origin)) throw new ApiError('PERMISSION_DENIED', 'The widget may not reach this origin')
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
    if (Buffer.byteLength(JSON.stringify(output)) > HTTP_LIMITS.answerBytes) throw new ApiError('UPSTREAM_ERROR', 'The response is too large')
    return output
  } catch (error) {
    if (error instanceof ApiError) throw error
    const name = error instanceof Error ? error.name : ''
    throw new ApiError('UPSTREAM_ERROR', name === 'TimeoutError' || name === 'AbortError' ? 'The service did not answer in time' : 'The service is unreachable')
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
      throw new ApiError('UPSTREAM_ERROR', 'The response is larger than 100 KB')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
