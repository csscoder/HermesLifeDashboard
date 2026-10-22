<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { SPACE_COLORS, SPACE_LIMITS, type SpacePatch, type SpaceSummary } from '@lifedashboard/contracts/space'
import { FAN_GEOMETRY, fanLayout } from './fan-layout'
import SpacePicker from './SpacePicker.vue'

// The corner button with the fan of space bubbles. Geometry in rem, from the corner button's centre
// (2 rem from the right edge, 1.75 rem from the top), as the CSS places it.
const props = defineProps<{
  spaces: SpaceSummary[]
  currentId: string
  editing: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  create: []
  edit: [id: string, patch: SpacePatch]
}>()

// The fan closes this long after the pointer leaves it (spec «Fan»).
const CLOSE_DELAY_MS = 300
const CORNER = { x: 2, y: 1.75 }
const LIMIT_TITLE = `Не больше ${SPACE_LIMITS.spaces} пространств`

const root = useTemplateRef<HTMLElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const open = ref(false)
const pointerInside = ref(false)
// The space whose icon and colour the picker edits. While it is set, the fan stays open.
const pickerId = ref<string | null>(null)
let closeTimer: ReturnType<typeof setTimeout> | undefined

const current = computed(() => props.spaces.find((space) => space.id === props.currentId) ?? props.spaces[0])
const pickerSpace = computed(() => props.spaces.find((space) => space.id === pickerId.value) ?? null)
const canAdd = computed(() => props.spaces.length < SPACE_LIMITS.spaces)
// The «+» bubble is the last slot in edit mode only.
const slots = computed(() => fanLayout(props.spaces.length + (props.editing ? 1 : 0), FAN_GEOMETRY))
const rings = computed(() => [...new Set(slots.value.map((slot) => slot.ring))].map(ringRadius))
// The scrim covers the outermost bubble; the picker sits left of it.
const outer = computed(() => Math.max(0, ...rings.value) + FAN_GEOMETRY.size)
const pickerRight = computed(() => `min(calc(${rem(outer.value + 2.75)}), calc(100vw - 22rem))`)

function rem(value: number): string {
  return `${Math.round(value * 1000) / 1000}rem`
}

function ringRadius(ring: number): number {
  return FAN_GEOMETRY.r0 + ring * FAN_GEOMETRY.step
}

// Inline custom properties: the bubble moves from the corner to its slot (the open state in CSS).
function placed(index: number): Record<string, string> {
  const slot = slots.value[index]
  if (!slot) return {}
  const radius = ringRadius(slot.ring)
  const angle = (slot.angle * Math.PI) / 180
  return {
    '--x': rem(-(CORNER.x + radius * Math.cos(angle)) + FAN_GEOMETRY.size / 2),
    '--y': rem(CORNER.y + radius * Math.sin(angle) - FAN_GEOMETRY.size / 2),
    '--i': String(index),
  }
}

function enter() {
  pointerInside.value = true
  clearTimeout(closeTimer)
  if (!props.disabled) open.value = true
}

function leave() {
  pointerInside.value = false
  scheduleClose()
}

function scheduleClose() {
  clearTimeout(closeTimer)
  if (pickerId.value !== null) return
  closeTimer = setTimeout(closeFan, CLOSE_DELAY_MS)
}

// Focus that was on a bubble or badge moves to the corner button, so it is not lost when the fan hides.
function closeFan() {
  clearTimeout(closeTimer)
  const onFan = root.value?.contains(document.activeElement) && document.activeElement !== trigger.value
  open.value = false
  pickerId.value = null
  if (onFan) trigger.value?.focus()
}

// A pointer click opens the fan (it does not toggle it, the hover already opened it). A keyboard
// activation (detail 0) moves focus to the current bubble.
function onTrigger(event: MouseEvent) {
  if (props.disabled) return
  clearTimeout(closeTimer)
  open.value = true
  if (event.detail === 0) void focusBubble(props.currentId)
}

async function focusBubble(id: string) {
  await nextTick()
  root.value?.querySelector<HTMLElement>(`.space-switcher__bubble[data-id="${CSS.escape(id)}"]`)?.focus()
}

function choose(id: string) {
  closeFan()
  emit('select', id)
}

function create() {
  if (!canAdd.value) return
  closeFan()
  emit('create')
}

function openPicker(id: string) {
  clearTimeout(closeTimer)
  pickerId.value = id
}

function onPickerPick(patch: SpacePatch) {
  if (pickerId.value !== null) emit('edit', pickerId.value, patch)
}

// The picker closes on an outside click; the fan follows when the pointer is not over it.
function onPickerClose() {
  pickerId.value = null
  scheduleClose()
}

// Esc closes the picker first, then the fan. Handled here, so the board does not take Esc as «Отмена».
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  event.stopPropagation()
  if (pickerId.value !== null) {
    const id = pickerId.value
    const focusWasOnFan = root.value?.contains(document.activeElement) ?? false
    pickerId.value = null
    if (focusWasOnFan) void focusBubble(id)
    return
  }
  closeFan()
}

// Tab out of the fan closes it, unless the pointer is still over it or the picker is open.
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && root.value?.contains(next)) return
  if (!pointerInside.value && pickerId.value === null) closeFan()
}

watch(
  () => props.disabled,
  (off) => {
    if (off) closeFan()
  },
)
watch(
  () => props.editing,
  (on) => {
    if (!on) pickerId.value = null
  },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  clearTimeout(closeTimer)
})
</script>

<template>
  <div
    ref="root"
    class="space-switcher"
    :class="{ 'space-switcher--open': open }"
    :style="{ '--scrim-r': rem(outer), '--picker-right': pickerRight }"
    @mouseenter="enter"
    @mouseleave="leave"
    @focusout="onFocusOut"
  >
    <button
      ref="trigger"
      type="button"
      class="space-switcher__trigger"
      aria-label="Пространства"
      aria-haspopup="true"
      :aria-expanded="open"
      :disabled="disabled"
      @click="onTrigger"
    >
      <span aria-hidden="true">{{ current?.icon }}</span>
    </button>
    <div class="space-switcher__scrim" aria-hidden="true" />
    <span
      v-for="radius in rings"
      :key="radius"
      class="space-switcher__ring"
      :style="{ '--r': rem(radius) }"
      aria-hidden="true"
    />
    <div v-for="(space, index) in spaces" :key="space.id" class="space-switcher__item" :style="placed(index)">
      <button
        type="button"
        class="space-switcher__bubble"
        :data-id="space.id"
        :aria-label="space.title"
        :aria-current="space.id === currentId ? 'true' : undefined"
        :disabled="disabled"
        :style="{ '--tint': `oklch(0.6 0.12 ${SPACE_COLORS[space.color]})` }"
        @click="choose(space.id)"
      >
        <span class="space-switcher__icon" aria-hidden="true">{{ space.icon }}</span>
      </button>
      <span class="space-switcher__label" aria-hidden="true">{{ space.title }}</span>
      <button
        v-if="editing"
        type="button"
        class="space-switcher__edit"
        :aria-label="`Иконка и цвет: ${space.title}`"
        title="Иконка и цвет"
        :disabled="disabled"
        @click="openPicker(space.id)"
      >
        ✎
      </button>
    </div>
    <div v-if="editing" class="space-switcher__item" :style="placed(spaces.length)">
      <button
        type="button"
        class="space-switcher__bubble space-switcher__bubble--add"
        aria-label="Новое пространство"
        :title="canAdd ? undefined : LIMIT_TITLE"
        :disabled="disabled || !canAdd"
        @click="create"
      >
        <span aria-hidden="true">+</span>
      </button>
      <span class="space-switcher__label" aria-hidden="true">Новое пространство</span>
    </div>
    <div v-if="pickerSpace" class="space-switcher__picker">
      <SpacePicker :space="pickerSpace" @pick="onPickerPick" @close="onPickerClose" />
    </div>
  </div>
</template>

<style scoped>
/* A zero-size box in the top-right corner: the children are placed from that corner. */
.space-switcher {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 10;
  width: 0;
  height: 0;
}

.space-switcher__trigger {
  position: absolute;
  top: 0.625rem;
  right: 0.875rem;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: var(--ld-border-width) solid var(--ld-border-strong);
  border-radius: 50%;
  background: oklch(0.42 0.1 var(--space-hue));
  font: inherit;
  font-size: 1.0625rem;
  cursor: pointer;
  box-shadow: 0 0 0 0.1875rem var(--ld-state-hover);
  transition:
    transform var(--ld-duration-base) var(--ld-ease-standard),
    box-shadow var(--ld-duration-base) var(--ld-ease-standard);
}

.space-switcher--open .space-switcher__trigger {
  transform: scale(1.12);
  box-shadow: 0 0 0 0.25rem var(--ld-state-selected);
}

.space-switcher__trigger:disabled {
  opacity: 0.5;
  cursor: default;
}

.space-switcher__trigger:focus-visible,
.space-switcher__bubble:focus-visible,
.space-switcher__edit:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.1875rem;
}

/* Covers the corner: the outer bubble's radius plus its size, fading out over 13.75 rem. */
.space-switcher__scrim {
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: var(--ld-scrim);
  backdrop-filter: blur(0.375rem);
  mask: radial-gradient(circle at 100% 0%, #000 0, #000 var(--scrim-r), transparent calc(var(--scrim-r) + 13.75rem));
  -webkit-mask: radial-gradient(circle at 100% 0%, #000 0, #000 var(--scrim-r), transparent calc(var(--scrim-r) + 13.75rem));
  transition: opacity var(--ld-duration-base) var(--ld-ease-standard);
}

.space-switcher--open .space-switcher__scrim {
  opacity: 1;
}

/* Dashed guide circle around the corner, one per arc. Centre: 2 rem from the right, 1.75 rem from the top. */
.space-switcher__ring {
  position: absolute;
  top: calc(1.75rem - var(--r));
  right: calc(2rem - var(--r));
  width: calc(2 * var(--r));
  height: calc(2 * var(--r));
  border: var(--ld-border-width) dashed var(--ld-border-subtle);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ld-duration-slow) var(--ld-ease-standard);
}

.space-switcher--open .space-switcher__ring {
  opacity: 1;
}

/* Closed: every item sits on the corner button, scaled down. Open: it moves to its slot on the arc. */
.space-switcher__item {
  position: absolute;
  top: 0;
  right: 0;
  width: 5rem;
  height: 5rem;
  transform: translate(0.5rem, -0.75rem) scale(0.3);
  opacity: 0;
  visibility: hidden;
  transition:
    transform var(--ld-duration-slow) var(--ld-ease-emphasized),
    opacity var(--ld-duration-base) var(--ld-ease-standard),
    visibility 0s linear var(--ld-duration-base);
}

.space-switcher--open .space-switcher__item {
  transform: translate(var(--x), var(--y)) scale(1);
  opacity: 1;
  visibility: visible;
  transition-delay: calc(var(--i) * var(--ld-duration-fast) / 6);
}

/* The hovered or focused item is drawn above its neighbours, so its label is not covered. */
.space-switcher__item:hover,
.space-switcher__item:focus-within {
  z-index: 2;
}

.space-switcher__bubble {
  position: relative;
  display: grid;
  place-items: center;
  width: 5rem;
  height: 5rem;
  padding: 0;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: 50%;
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font: inherit;
  font-size: 2.125rem;
  line-height: 1;
  cursor: pointer;
  overflow: hidden;
  transition:
    transform var(--ld-duration-base) var(--ld-ease-standard),
    border-color var(--ld-duration-fast) var(--ld-ease-standard),
    box-shadow var(--ld-duration-fast) var(--ld-ease-standard);
}

.space-switcher__bubble::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--tint);
  opacity: 0.35;
  pointer-events: none;
}

.space-switcher__icon {
  position: relative;
}

.space-switcher__bubble:hover:not(:disabled),
.space-switcher__bubble:focus-visible {
  border-color: var(--ld-border-strong);
  box-shadow: 0 0.375rem 1.25rem oklch(0 0 0 / 0.45);
}

.space-switcher--open .space-switcher__item:hover .space-switcher__bubble:not(:disabled) {
  transform: scale(1.1);
  transition-delay: 0ms;
}

.space-switcher__bubble[aria-current='true'] {
  border: 0.125rem solid var(--ld-accent);
  box-shadow: 0 0 0 0.25rem var(--ld-accent-subtle);
}

.space-switcher__bubble--add {
  border-style: dashed;
  border-color: var(--ld-border-strong);
  background: var(--ld-surface-2);
  color: var(--ld-text-muted);
  font-size: 1.875rem;
}

.space-switcher__bubble--add::before {
  display: none;
}

.space-switcher__bubble:disabled {
  opacity: 0.5;
  cursor: default;
}

/* Shown on hover over the item and on keyboard focus of it, in edit mode only. */
.space-switcher__edit {
  position: absolute;
  right: -0.25rem;
  bottom: -0.25rem;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 1.625rem;
  height: 1.625rem;
  padding: 0;
  border: 0.125rem solid var(--ld-surface-1-solid);
  border-radius: 50%;
  background: var(--ld-accent);
  color: var(--ld-on-accent);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ld-duration-fast) var(--ld-ease-standard);
}

.space-switcher__item:hover .space-switcher__edit,
.space-switcher__item:focus-within .space-switcher__edit {
  opacity: 1;
  pointer-events: auto;
}

/* Under the bubble; shown on hover and keyboard focus. It is drawn over the neighbours. */
.space-switcher__label {
  position: absolute;
  top: calc(100% + 0.375rem);
  left: 50%;
  transform: translateX(-50%);
  padding: 0.125rem 0.5rem;
  border: var(--ld-border-width) solid var(--ld-border-subtle);
  border-radius: var(--ld-radius-pill);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font-size: 0.8125rem;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ld-duration-fast) var(--ld-ease-standard);
}

.space-switcher__item:hover .space-switcher__label,
.space-switcher__item:focus-within .space-switcher__label {
  opacity: 1;
}

.space-switcher__picker {
  position: fixed;
  top: 1rem;
  right: var(--picker-right);
  z-index: 4;
}

@media (prefers-reduced-motion: reduce) {
  .space-switcher__trigger,
  .space-switcher__scrim,
  .space-switcher__ring,
  .space-switcher__item,
  .space-switcher__bubble,
  .space-switcher__edit,
  .space-switcher__label {
    transition: none;
  }

  .space-switcher--open .space-switcher__item {
    transition-delay: 0ms;
  }
}
</style>
