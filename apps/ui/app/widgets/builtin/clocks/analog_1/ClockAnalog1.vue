<script setup lang="ts">
import { onMounted, onUnmounted, useId, useTemplateRef, watch } from 'vue'
import { gsap } from 'gsap'
import { useWidget } from '@lifedashboard/widget-sdk'
import face from './clock-analog1.webp'
import { handAngles, type HandAngles } from './clock-angles'

// Dial centre in face.webp pixels, measured from the alpha bounds; nudge it if the hands look off-centre.
const CX = 625
const CY = 612

const { context } = useWidget()
const id = useId()
const hands = {
  hour: useTemplateRef<SVGGElement>('hour'),
  minute: useTemplateRef<SVGGElement>('minute'),
  second: useTemplateRef<SVGGElement>('second'),
}
const keys = ['hour', 'minute', 'second'] as const
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
// What the hands show now; GSAP tweens it, render() writes it to the SVG.
const shown: HandAngles = { hour: 0, minute: 0, second: 0 }
let target: HandAngles | undefined
let timer: ReturnType<typeof setTimeout> | undefined

function render() {
  for (const key of keys) hands[key].value?.setAttribute('transform', `rotate(${shown[key]})`)
}

/** Entrance and catch-up: all hands sweep together, the second hand last. */
function sweep(duration: number) {
  const next = (target = handAngles(new Date(), target, 'forward'))
  keys.forEach((key, index) => {
    gsap.to(shown, { [key]: next[key], duration, delay: duration && index * 0.12, ease: 'power3.inOut', overwrite: 'auto', onUpdate: render })
  })
}

/** Once a second: second and minute hands snap with an elastic overshoot, the hour hand glides. */
function tick() {
  const prev = target
  const next = (target = handAngles(new Date(), prev))
  for (const key of keys) {
    if (prev?.[key] === next[key]) continue
    const hour = key === 'hour'
    gsap.to(shown, {
      [key]: next[key],
      duration: reduced ? 0 : hour ? 0.6 : 0.55,
      ease: hour ? 'power2.out' : 'elastic.out(1.1, 0.35)',
      overwrite: 'auto',
      onUpdate: render,
    })
  }
  schedule()
}

function schedule() {
  timer = setTimeout(tick, 1000 - (Date.now() % 1000))
}

// Reduced motion: no sweep and no overshoot, the hands jump straight to the time.
function start(duration: number) {
  sweep(reduced ? 0 : duration)
  schedule()
}

function stop() {
  clearTimeout(timer)
  gsap.killTweensOf(shown)
}

onMounted(() => {
  render()
  if (context.visible) start(1.2)
})
watch(
  () => context.visible,
  (visible) => (visible ? start(0.8) : stop()),
)
onUnmounted(stop)
</script>

<template>
  <svg class="block w-full h-full" :viewBox="`${CX - 605} ${CY - 605} 1210 1210`" role="img" aria-label="Аналоговые часы">
    <defs>
      <filter :id="`${id}-shadow`" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="7" dy="11" stdDeviation="6" flood-color="#2a1608" flood-opacity="0.5" />
      </filter>
      <linearGradient :id="`${id}-wood`" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#6b4426" />
        <stop offset="0.5" stop-color="#4a2c17" />
        <stop offset="0.5" stop-color="#2f1a0c" />
        <stop offset="1" stop-color="#24130a" />
      </linearGradient>
      <radialGradient :id="`${id}-brass`" cx="0.35" cy="0.35" r="0.75">
        <stop offset="0" stop-color="#f4d58d" />
        <stop offset="0.55" stop-color="#b8863b" />
        <stop offset="1" stop-color="#6e4a17" />
      </radialGradient>
    </defs>

    <image :href="face" x="0" y="0" width="1254" height="1254" />

    <g :transform="`translate(${CX} ${CY})`">
      <!-- The shadow sits outside the rotating group, so the light stays top-left. -->
      <g :filter="`url(#${id}-shadow)`">
        <g ref="hour">
          <path d="M -15 70 L -24 0 L -12 -190 L 0 -290 L 12 -190 L 24 0 L 15 70 Z" :fill="`url(#${id}-wood)`" stroke="#1c0e05" stroke-width="3" />
        </g>
        <g ref="minute">
          <path d="M -11 85 L -17 0 L -7 -400 L 0 -470 L 7 -400 L 17 0 L 11 85 Z" :fill="`url(#${id}-wood)`" stroke="#1c0e05" stroke-width="3" />
        </g>
        <g ref="second">
          <path d="M -3.5 130 L -3.5 -500 L 0 -515 L 3.5 -500 L 3.5 130 Z" fill="#a8391d" />
          <circle cy="100" r="22" fill="#a8391d" />
          <circle cy="100" r="9" fill="#5c1d0c" />
        </g>
        <circle r="34" :fill="`url(#${id}-brass)`" stroke="#4a3010" stroke-width="3" />
        <circle r="9" fill="#3a2410" />
      </g>
    </g>
  </svg>
</template>
