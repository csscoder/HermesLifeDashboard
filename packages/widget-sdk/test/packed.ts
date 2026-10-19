import { inject } from 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    packedSdk: string
  }
}

export function packedSdk(): string {
  return inject('packedSdk')
}
