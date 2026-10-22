<script setup lang="ts">
import { computed } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'
import { handAngles } from './clock.ts'
import { useClock } from './use-clock.ts'

const widget = useWidget()
const { now, reducedMotion } = useClock(() => widget.context.visible)
const angles = computed(() => handAngles(new Date(now.value), !reducedMotion.value))
const second = computed(() => Math.floor(now.value / 1000))
const date = computed(() => new Date(second.value * 1000))
const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const accessibleFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short' })
const dateLabel = computed(() => dateFormat.format(date.value))
const timeLabel = computed(() => timeFormat.format(date.value))
const accessibleLabel = computed(() => `Local time: ${accessibleFormat.format(date.value)}`)
</script>

<template>
  <main class="clock">
    <svg class="clock__dial" viewBox="0 0 320 320" role="img" :aria-label="accessibleLabel">
      <circle class="clock__rim" cx="160" cy="160" r="149" />
      <g aria-hidden="true">
        <line
          v-for="tick in 60"
          :key="tick"
          class="clock__tick"
          :class="{ 'clock__tick--hour': (tick - 1) % 5 === 0 }"
          x1="160" y1="15" x2="160" :y2="(tick - 1) % 5 === 0 ? 25 : 19"
          :transform="`rotate(${(tick - 1) * 6} 160 160)`"
        />
        <g class="clock__numbers">
          <text x="160" y="58">12</text>
          <text x="266" y="170">3</text>
          <text x="160" y="286">6</text>
          <text x="54" y="170">9</text>
        </g>
        <text class="clock__label" x="160" y="94">LOCAL TIME</text>
        <text class="clock__date" x="160" y="217">{{ dateLabel }}</text>
        <text class="clock__time" x="160" y="241">{{ timeLabel }}</text>
        <line class="clock__hand clock__hand--hour" x1="160" y1="170" x2="160" y2="92" :transform="`rotate(${angles.hour} 160 160)`" />
        <line class="clock__hand clock__hand--minute" x1="160" y1="173" x2="160" y2="54" :transform="`rotate(${angles.minute} 160 160)`" />
        <line class="clock__hand clock__hand--second" x1="160" y1="186" x2="160" y2="35" :transform="`rotate(${angles.second} 160 160)`" />
        <circle class="clock__hub" cx="160" cy="160" r="6" />
        <circle class="clock__pin" cx="160" cy="160" r="2.5" />
      </g>
    </svg>
  </main>
</template>

<style scoped>
.clock {
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  padding: var(--ld-widget-padding);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.clock__dial {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  text-anchor: middle;
}

.clock__rim {
  fill: none;
  stroke: var(--ld-border-subtle);
  stroke-width: 0.75;
}

.clock__tick {
  stroke: var(--ld-border-strong);
  stroke-width: 1;
  stroke-linecap: round;
}

.clock__tick--hour {
  stroke: var(--ld-text-secondary);
  stroke-width: 1.75;
}

.clock__numbers {
  fill: var(--ld-text-primary);
  font-family: var(--ld-font-display);
  font-size: calc(26px * var(--ld-font-scale));
  font-weight: var(--ld-weight-medium);
}

.clock__label {
  fill: var(--ld-text-muted);
  font-size: calc(8px * var(--ld-font-scale));
  font-weight: var(--ld-weight-medium);
  letter-spacing: 2px;
}

.clock__date {
  fill: var(--ld-text-secondary);
  font-size: calc(10px * var(--ld-font-scale));
  font-weight: var(--ld-weight-medium);
}

.clock__time {
  fill: var(--ld-text-primary);
  font-family: var(--ld-font-mono);
  font-size: calc(17px * var(--ld-font-scale));
  font-weight: var(--ld-weight-regular);
  font-variant-numeric: tabular-nums;
}

.clock__hand {
  stroke-linecap: round;
}

.clock__hand--hour {
  stroke: var(--ld-text-primary);
  stroke-width: 5;
}

.clock__hand--minute {
  stroke: var(--ld-text-primary);
  stroke-width: 3;
}

.clock__hand--second {
  stroke: var(--ld-accent);
  stroke-width: 1.25;
}

.clock__hub {
  fill: var(--ld-surface-1-solid);
  stroke: var(--ld-text-primary);
  stroke-width: 1.5;
}

.clock__pin {
  fill: var(--ld-accent);
}
</style>
