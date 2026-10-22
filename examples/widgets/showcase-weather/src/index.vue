<script setup lang="ts">
import { computed } from 'vue'
import { useWidget } from '@lifedashboard/widget-sdk'
import { conditionFor } from './weather.ts'
import { useWeather } from './use-weather.ts'

const widget = useWidget()
const { data, loading, error, stale, refresh } = useWeather(widget)
const condition = computed(() => data.value ? conditionFor(data.value.code, data.value.isDay) : null)
</script>

<template>
  <section class="weather" :data-size="widget.context.sizeClass" aria-label="Current weather">
    <header class="weather__header">
      <div class="weather__location">
        <p class="weather__eyebrow">Current weather</p>
        <h1 :title="widget.context.config.city">{{ widget.context.config.city || 'Weather' }}</h1>
      </div>
      <button class="weather__refresh" type="button" aria-label="Refresh weather" :disabled="loading" @click="refresh">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M5.8 7.5a7 7 0 0 1 11.6-1L20 12M4 12l2.6 5.5a7 7 0 0 0 11.6-1" />
        </svg>
      </button>
    </header>

    <div v-if="data" class="weather__current" :aria-busy="loading">
      <div class="weather__hero">
        <p class="weather__temperature" :aria-label="`${Math.round(data.temperature)} degrees Celsius`">
          {{ Math.round(data.temperature) }}<span class="weather__degree">°</span><span class="weather__unit">C</span>
        </p>
        <svg class="weather__icon" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <g v-if="condition?.icon === 'sun'">
            <circle cx="50" cy="50" r="20" class="weather__icon-fill" />
            <path d="M50 12v8M50 80v8M12 50h8M80 50h8M23 23l6 6M71 71l6 6M23 77l6-6M71 29l6-6" />
          </g>
          <path v-else-if="condition?.icon === 'moon'" class="weather__icon-fill" d="M68 17a34 34 0 1 0 15 52A34 34 0 0 1 68 17Z" />
          <g v-else>
            <g v-if="condition?.icon === 'sun-cloud'">
              <circle cx="65" cy="32" r="16" class="weather__icon-fill" />
              <path d="M65 7v5M65 52v5M40 32h5M85 32h5M47 14l4 4M79 46l4 4M79 18l4-4" />
            </g>
            <path class="weather__cloud" d="M27 68a15 15 0 0 1-1-30 23 23 0 0 1 44-1 16 16 0 1 1 5 31Z" />
            <path v-if="condition?.icon === 'rain'" d="m32 78-4 8m22-8-4 8m22-8-4 8" />
            <path v-else-if="condition?.icon === 'snow'" d="M30 79v9m-4-7 8 5m0-5-8 5m32-7v9m-4-7 8 5m0-5-8 5" />
            <path v-else-if="condition?.icon === 'storm'" d="m51 74-9 11h10l-5 10" />
            <path v-else-if="condition?.icon === 'fog'" d="M19 79h61M27 89h45" />
          </g>
        </svg>
      </div>
      <p class="weather__condition">{{ condition?.label }}</p>
      <p class="weather__range"><span>High {{ Math.round(data.high) }}°</span><span>Low {{ Math.round(data.low) }}°</span></p>
    </div>

    <div v-else class="weather__empty" role="status">
      <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
        <path d="M27 68a15 15 0 0 1-1-30 23 23 0 0 1 44-1 16 16 0 1 1 5 31Z" />
        <path d="M33 81h34" />
      </svg>
      <p>{{ error ? 'Weather unavailable' : 'Loading weather…' }}</p>
      <span>{{ error ? 'Refresh to try again.' : 'Connecting to Open-Meteo' }}</span>
    </div>

    <dl v-if="data" class="weather__metrics">
      <div><dt>Feels like</dt><dd>{{ Math.round(data.feelsLike) }}<span>°C</span></dd></div>
      <div><dt>Humidity</dt><dd>{{ Math.round(data.humidity) }}<span>%</span></dd></div>
      <div><dt>Wind</dt><dd>{{ Math.round(data.wind) }}<span>km/h</span></dd></div>
    </dl>

    <footer class="weather__footer">
      <span class="weather__source">Open-Meteo.com</span>
      <span class="weather__status" :class="{ 'weather__status--stale': stale }" role="status" :title="data?.timezone">
        <template v-if="stale">Stale · {{ data?.localTime }}</template>
        <template v-else-if="loading">Updating…</template>
        <template v-else-if="data">Model · {{ data.localTime }}</template>
        <template v-else-if="error">Unavailable</template>
      </span>
    </footer>
  </section>
</template>

<style scoped>
.weather {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: calc(var(--ld-gap) * 0.8);
  height: 100%;
  min-height: 0;
  padding: var(--ld-widget-padding);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
  font-size: calc(1rem * var(--ld-font-scale));
  line-height: var(--ld-leading);
  container-type: size;
}

.weather :where(p, h1, dl, dd) { margin: 0; }
.weather h1, .weather__condition, .weather__range, .weather__metrics, .weather__footer { line-height: 1.2; }
.weather__header { display: flex; align-items: center; justify-content: space-between; gap: var(--ld-gap); }
.weather__location { min-width: 0; }
.weather__eyebrow { color: var(--ld-text-muted); font-size: 0.65em; font-weight: var(--ld-weight-medium); letter-spacing: calc(var(--ld-tracking) + 0.12em); text-transform: uppercase; }
.weather h1 { overflow: hidden; color: var(--ld-text-primary); font-size: 1.35em; font-weight: var(--ld-weight-strong); text-overflow: ellipsis; white-space: nowrap; }
.weather__refresh { display: grid; flex-shrink: 0; place-items: center; width: var(--ld-control-height); height: var(--ld-control-height); padding: calc(var(--ld-gap) * 0.6); border: var(--ld-border-width) solid var(--ld-border-subtle); border-radius: var(--ld-radius-pill); background: var(--ld-surface-2); color: var(--ld-text-secondary); cursor: pointer; transition: background var(--ld-duration-fast) var(--ld-ease-standard); }
.weather__refresh:hover { background: var(--ld-state-hover); }
.weather__refresh:focus-visible { outline: 2px solid var(--ld-focus-ring); outline-offset: 3px; }
.weather__refresh:disabled { color: var(--ld-text-disabled); cursor: wait; }
.weather__refresh svg { width: 100%; height: 100%; }
.weather__current { display: flex; flex: 1 0 auto; flex-direction: column; justify-content: center; }
.weather__hero { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--ld-gap) * 0.5); }
.weather__temperature { display: flex; align-items: flex-start; font-family: var(--ld-font-display); font-size: clamp(2.25em, min(22cqw, 24cqh), 6em); font-weight: var(--ld-weight-regular); letter-spacing: -0.065em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.weather__degree { margin-top: 0.035em; font-size: 0.7em; }
.weather__unit { align-self: center; margin-left: 0.2em; color: var(--ld-text-muted); font-size: 0.2em; letter-spacing: var(--ld-tracking); }
.weather__icon { flex-shrink: 0; width: min(34cqw, 26cqh); height: min(34cqw, 26cqh); color: var(--ld-accent-text); }
.weather__icon-fill { fill: var(--ld-accent-subtle); }
.weather__cloud { fill: var(--ld-surface-2); }
.weather__condition { margin-top: calc(var(--ld-gap) * 0.35); font-size: 1.05em; font-weight: var(--ld-weight-medium); }
.weather__range { display: flex; gap: var(--ld-gap); margin-top: calc(var(--ld-gap) * 0.35); color: var(--ld-text-secondary); font-size: 0.8em; }
.weather__metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: calc(var(--ld-gap) * 0.5); padding-top: var(--ld-gap); border-top: var(--ld-border-width) solid var(--ld-border-subtle); }
.weather__metrics dt { color: var(--ld-text-muted); font-size: 0.68em; }
.weather__metrics dd { margin-top: calc(var(--ld-gap) * 0.3); font-size: 1.2em; font-weight: var(--ld-weight-medium); font-variant-numeric: tabular-nums; }
.weather__metrics dd span { margin-left: 0.15em; color: var(--ld-text-secondary); font-size: 0.55em; font-weight: var(--ld-weight-regular); }
.weather__footer { display: flex; justify-content: space-between; gap: calc(var(--ld-gap) * 0.5); color: var(--ld-text-muted); font-size: 0.65em; white-space: nowrap; }
.weather__status--stale { color: var(--ld-warning-text); }
.weather__empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--ld-gap) * 0.4); text-align: center; }
.weather__empty svg { width: min(27cqw, 27cqh); color: var(--ld-text-muted); }
.weather__empty p { font-size: 0.95em; font-weight: var(--ld-weight-medium); }
.weather__empty span { color: var(--ld-text-muted); font-size: 0.75em; }
.weather[data-size="m"] .weather__metrics, .weather[data-size="s"] .weather__metrics, .weather[data-size="xs"] .weather__metrics { display: none; }
.weather[data-size="m"] h1 { font-size: 1.1em; }
.weather[data-size="m"] .weather__temperature { font-size: clamp(2em, min(22cqw, 24cqh), 4.5em); }
.weather[data-size="m"] .weather__condition { font-size: 0.9em; }

@container (max-height: 13.75rem) {
  .weather__metrics { display: none; }
  .weather__eyebrow { display: none; }
  .weather__range { display: none; }
  .weather .weather__temperature { font-size: clamp(1.5em, min(20cqw, 18cqh), 3em); }
  .weather__icon { width: min(28cqw, 24cqh); height: min(28cqw, 24cqh); }
  .weather .weather__condition { margin-top: calc(var(--ld-gap) * 0.15); font-size: 0.8em; }
  .weather__footer { flex-wrap: wrap; row-gap: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .weather__refresh { transition: none; }
}
</style>
