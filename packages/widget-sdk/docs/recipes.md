# Recipes

Each recipe follows the rules in [api.md](api.md) and [errors.md](errors.md).

## Visibility-aware animation

Pause animation while `widget.context.visible` is `false`. A hidden widget should not run frames. This frameless clock draws no card background, so it uses `"frame": "frameless"` in `widget.json`.

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const hand = ref(0)
let frame = 0

function tick(): void {
  hand.value = new Date().getSeconds() * 6
  frame = requestAnimationFrame(tick)
}

function stop(): void {
  cancelAnimationFrame(frame)
}

watch(() => widget.context.visible, (visible) => {
  stop()
  if (visible) tick()
}, { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <div class="clock">
    <div class="hand" :style="{ transform: `rotate(${hand}deg)` }" />
  </div>
</template>

<style scoped>
.clock {
  width: 100%;
  height: 100%;
}

.hand {
  width: 0.125rem;
  height: 50%;
  margin: 0 auto;
  background: var(--ld-text-primary);
  transform-origin: 50% 100%;
}
</style>
```

## Adapting to size class

Read `widget.context.sizeClass` and choose a layout. Do not compute classes from `size` yourself.

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const compact = computed(() => widget.context.sizeClass === 'xs' || widget.context.sizeClass === 's')
</script>

<template>
  <p v-if="compact" class="summary" v-text="'Summary'" />
  <ul v-else class="full">
    <li v-text="'Item one'" />
    <li v-text="'Item two'" />
  </ul>
</template>
```

## Polling HTTP with backoff

Poll only while the widget is visible. Retry `RATE_LIMITED`, `TIMEOUT` and `UNAVAILABLE` with growing delays. Stop on any other error. Choose `intervalMs`, `baseDelayMs` and `maxDelayMs` for your data source.

```ts
import { onBeforeUnmount, ref, watch } from 'vue'
import { WidgetError, useWidget } from '@lifedashboard/widget-sdk'

const widget = useWidget()
const RETRYABLE = new Set(['RATE_LIMITED', 'TIMEOUT', 'UNAVAILABLE'])
const message = ref('')
let failures = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function refresh(url: string, intervalMs: number, baseDelayMs: number, maxDelayMs: number): Promise<void> {
  clearTimeout(timer)
  if (!widget.context.visible) return
  let delay = intervalMs
  try {
    const { body } = await widget.http.get(url, { accept: 'application/json' })
    failures = 0
    message.value = body
  } catch (error) {
    if (!(error instanceof WidgetError) || !RETRYABLE.has(error.code)) {
      message.value = 'Refresh stopped'
      return
    }
    failures += 1
    delay = Math.min(maxDelayMs, baseDelayMs * 2 ** failures)
  }
  timer = setTimeout(() => void refresh(url, intervalMs, baseDelayMs, maxDelayMs), delay)
}

onBeforeUnmount(() => clearTimeout(timer))
```

Call `refresh` once on mount, and again when `widget.context.visible` becomes `true`. Use `watch(() => widget.context.visible, ...)` for that.

## Revision conflicts

`state.set` rejects with `CONFLICT` when another write changed the state after you read it. Read again, apply the change to the new data, and write with the new revision.

```ts
import { WidgetError, useWidget } from '@lifedashboard/widget-sdk'

interface Data {
  items: string[]
}

const widget = useWidget()

async function update(change: (data: Data) => Data): Promise<void> {
  for (;;) {
    const { data, revision } = await widget.state.get<Data>()
    try {
      await widget.state.set(change(data ?? { items: [] }), revision)
      return
    } catch (error) {
      if (!(error instanceof WidgetError) || error.code !== 'CONFLICT') throw error
    }
  }
}
```

Each retry reads the newest state. If your writes can race often, add a limit on attempts.
