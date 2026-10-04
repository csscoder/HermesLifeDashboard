<script setup lang="ts">
import { onMounted, ref } from 'vue'

type ApiState = 'checking' | 'ok' | 'unavailable'

const labels: Record<ApiState, string> = {
  checking: 'API: проверка…',
  ok: 'API: работает',
  unavailable: 'API: недоступен',
}

const apiState = ref<ApiState>('checking')

const HEALTH_TIMEOUT_MS = 5000

async function isApiHealthy(): Promise<boolean> {
  try {
    // The signal also aborts reading the body, so a stalled response ends as unavailable.
    const response = await fetch('/health', { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (response.status !== 200) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}

onMounted(async () => {
  apiState.value = (await isApiHealthy()) ? 'ok' : 'unavailable'
})
</script>

<template>
  <main>
    <h1>LifeDashboard</h1>
    <p>{{ labels[apiState] }}</p>
  </main>
</template>
