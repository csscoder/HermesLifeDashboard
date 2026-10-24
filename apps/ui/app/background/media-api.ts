import type { BackgroundMedia } from '@lifedashboard/contracts/board'
import { apiRequest } from '../api'

const mediaPath = (id: string) => `/background-media/${encodeURIComponent(id)}`

export const importMedia = (file: File, signal: AbortSignal) => apiRequest<BackgroundMedia>(
  'POST',
  `/background-media?name=${encodeURIComponent(file.name)}&size=${file.size}&mime=${encodeURIComponent(mediaMime(file))}`,
  file,
  signal,
)
export const mediaInfo = (id: string) => apiRequest<BackgroundMedia>('GET', `${mediaPath(id)}/metadata`)
export const leaseMedia = (leaseId: string, videoIds: string[]) => apiRequest<null>('POST', '/background-media/leases', { leaseId, videoIds })
export const releaseMedia = (leaseId: string) => apiRequest<null>('DELETE', `/background-media/leases/${encodeURIComponent(leaseId)}`, {})
export const discardMedia = (id: string) => apiRequest<null>('DELETE', mediaPath(id), {})

function mediaMime(file: File): string {
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' } as Record<string, string>)[extension ?? ''] ?? file.type
}
