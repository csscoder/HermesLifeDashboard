import { afterEach, describe, expect, it, vi } from 'vitest'
import { discardMedia, importMedia, leaseMedia, mediaInfo, releaseMedia } from '../app/background/media-api'

afterEach(() => vi.unstubAllGlobals())
describe('background media client', () => {
  it('uploads raw bytes with encoded metadata and caller cancellation rather than a fixed timeout', async () => {
    const file = new File(['video'], 'a & b.MOV')
    const signal = new AbortController().signal
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'v', name: file.name, size: 5, mime: 'video/quicktime' } })))
    vi.stubGlobal('fetch', fetcher)
    expect(await importMedia(file, signal)).toEqual({ ok: true, data: { id: 'v', name: 'a & b.MOV', size: 5, mime: 'video/quicktime' } })
    const [path, request] = fetcher.mock.calls[0]!
    expect(path).toBe('/api/v1/background-media?name=a%20%26%20b.MOV&size=5&mime=video%2Fquicktime')
    expect(request).toMatchObject({ method: 'POST', body: file, signal, headers: { 'Content-Type': 'application/octet-stream' } })
  })
  it.each([['PNG', 'image/png'], ['JPG', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['avif', 'image/avif']])('infers %s image MIME when the file picker does not provide it', async (extension, mime) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null })))
    vi.stubGlobal('fetch', fetcher)
    const file = new File(['image'], `photo.${extension}`)
    await importMedia(file, new AbortController().signal)
    expect(fetcher.mock.calls[0]![0]).toBe(`/api/v1/background-media?name=photo.${extension}&size=5&mime=${encodeURIComponent(mime)}`)
  })
  it('preserves typed failure and encodes media paths and lease bodies', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: null })))
    vi.stubGlobal('fetch', fetcher)
    await mediaInfo('a/b'); await leaseMedia('l', ['v']); await releaseMedia('l/x'); await discardMedia('a/b')
    expect(fetcher.mock.calls.map(([path, request]) => [path, request.method, request.body])).toEqual([
      ['/api/v1/background-media/a%2Fb/metadata', 'GET', undefined],
      ['/api/v1/background-media/leases', 'POST', '{"leaseId":"l","videoIds":["v"]}'],
      ['/api/v1/background-media/leases/l%2Fx', 'DELETE', '{}'],
      ['/api/v1/background-media/a%2Fb', 'DELETE', '{}'],
    ])
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'IN_USE' } }), { status: 409 }))
    expect(await discardMedia('v')).toEqual({ ok: false, kind: 'conflict' })
  })
})
