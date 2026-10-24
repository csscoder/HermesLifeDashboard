<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { BACKGROUND_PATTERN_SIZES, defaultBackground, type ScreenBackground } from '@lifedashboard/contracts/board'
import { discardMedia, importMedia, mediaInfo } from './media-api'
import { probeMedia } from './import-media'

const props = defineProps<{ background: ScreenBackground | null; disabled: boolean }>()
const emit = defineEmits<{ change: [background: ScreenBackground | null] }>()
const filename = ref('')
const phase = ref<'checking' | 'uploading' | null>(null)
const error = ref('')
const patternScale = computed(() => Math.max(1, Math.round(props.background?.pattern.scale ?? 1)))
const patternSize = computed(() => {
  const shape = props.background?.pattern.shape
  if (!shape || shape === 'none') return ''
  const { width, height } = BACKGROUND_PATTERN_SIZES[shape]
  return `${width * patternScale.value}×${height * patternScale.value} px`
})
let active = true
let generation = 0
let metadataGeneration = 0
let controller: AbortController | null = null
let lastPatternShape: Exclude<ScreenBackground['pattern']['shape'], 'none'> = 'diagonal'
watch(() => props.background?.pattern.shape, shape => {
  if (shape && shape !== 'none') lastPatternShape = shape
}, { immediate: true, flush: 'sync' })

watch(() => props.background?.mediaId, async id => {
  const ticket = ++metadataGeneration
  filename.value = ''
  if (!id) return
  const result = await mediaInfo(id)
  if (!active || ticket !== metadataGeneration || props.background?.mediaId !== id) return
  if (result.ok) filename.value = result.data.name
  else error.value = 'Не удалось получить сведения о фоне. Файл может быть недоступен.'
}, { immediate: true })

function cancel() {
  generation++
  controller?.abort()
  controller = null
  phase.value = null
}
watch(() => props.disabled, disabled => { if (disabled) cancel() }, { flush: 'sync' })
onUnmounted(() => { active = false; metadataGeneration++; cancel() })

async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || props.disabled) return
  cancel()
  const ticket = generation
  const operation = new AbortController()
  controller = operation
  error.value = ''
  phase.value = 'checking'
  const current = () => active && !props.disabled && ticket === generation && !operation.signal.aborted
  try {
    await probeMedia(file, operation.signal)
    if (!current()) return
    phase.value = 'uploading'
    const result = await importMedia(file, operation.signal)
    if (!current()) {
      if (result.ok) void discardMedia(result.data.id)
      return
    }
    if (!result.ok) {
      error.value = 'Не удалось импортировать фон. Проверьте соединение и формат файла.'
      return
    }
    metadataGeneration++
    filename.value = result.data.name
    emit('change', defaultBackground(result.data.id, result.data.mime.startsWith('image/') ? 'image' : 'video'))
  } catch (cause) {
    if (current()) error.value = cause instanceof Error ? cause.message : 'Не удалось проверить файл фона.'
  } finally {
    if (ticket === generation) {
      phase.value = null
      controller = null
    }
  }
}

function remove() {
  if (props.disabled) return
  cancel()
  metadataGeneration++
  filename.value = ''
  error.value = ''
  emit('change', null)
}
function set(field: 'opacity' | 'dim', event: Event) {
  if (!props.disabled && props.background)
    emit('change', { ...props.background, [field]: Number((event.target as HTMLInputElement).value) / 100 })
}
function togglePattern(event: Event) {
  if (props.disabled || !props.background) return
  const shape = props.background.pattern.shape
  if (shape !== 'none') lastPatternShape = shape
  emit('change', {
    ...props.background,
    pattern: { ...props.background.pattern, shape: (event.target as HTMLInputElement).checked ? lastPatternShape : 'none' },
  })
}
function pattern(field: keyof ScreenBackground['pattern'], event: Event) {
  if (props.disabled || !props.background) return
  const raw = (event.target as HTMLInputElement).value
  const value = field === 'opacity' ? Number(raw) / 100 : field === 'scale' ? Number(raw) : raw
  emit('change', { ...props.background, pattern: { ...props.background.pattern, [field]: value } })
}
</script>

<template>
  <section class="background-editor" aria-label="Фон экрана">
    <h4>Фон экрана</h4>
    <label class="background-editor__field">
      {{ background ? 'Заменить фон' : 'Добавить фон' }}
      <input aria-label="Файл фона" type="file" accept="video/*,image/png,image/jpeg,image/webp,image/avif,.mp4,.m4v,.mov,.webm,.png,.jpg,.jpeg,.webp,.avif" :disabled="disabled" @change="choose">
    </label>
    <p v-if="filename" class="background-editor__filename" :title="filename">{{ filename }}</p>
    <p v-if="phase" role="status" aria-live="polite" class="background-editor__hint">{{ phase === 'checking' ? 'Проверка файла…' : 'Импорт фона…' }}</p>
    <button v-if="phase" type="button" :disabled="disabled" @click="cancel">Отменить импорт</button>
    <p v-if="error" role="alert" class="background-editor__error">{{ error }}</p>
    <p class="background-editor__hint">Видео: MP4, M4V, MOV, WebM. Изображения: PNG, JPEG, WebP, AVIF. Копия сохранится в приложении. Видео без звука.</p>
    <template v-if="background">
      <label class="background-editor__field">
        <span>{{ background.kind === 'image' ? 'Прозрачность изображения' : 'Прозрачность видео' }} <output>{{ Math.round(background.opacity * 100) }}%</output></span>
        <input :aria-label="background.kind === 'image' ? 'Прозрачность изображения' : 'Прозрачность видео'" type="range" min="0" max="100" step="1" :value="background.opacity * 100" :disabled="disabled" @input="set('opacity', $event)">
      </label>
      <label class="background-editor__field">
        <span>Затемнение <output>{{ Math.round(background.dim * 100) }}%</output></span>
        <input aria-label="Затемнение" type="range" min="0" max="100" step="1" :value="background.dim * 100" :disabled="disabled" @input="set('dim', $event)">
      </label>
      <label class="background-editor__toggle">
        <input aria-label="Сетка поверх фона" type="checkbox" :checked="background.pattern.shape !== 'none'" :disabled="disabled" @change="togglePattern">
        Сетка поверх фона
      </label>
      <template v-if="background.pattern.shape !== 'none'">
        <label class="background-editor__field">
          Форма сетки
          <select aria-label="Форма сетки" :value="background.pattern.shape" :disabled="disabled" @change="pattern('shape', $event)">
            <option value="diagonal">Диагональ</option>
            <option value="circles">Круги</option>
            <option value="squares">Квадраты</option>
            <option value="triangles">Треугольники</option>
            <option value="diamonds">Ромбы</option>
            <option value="crosses">Крестики</option>
          </select>
        </label>
        <label class="background-editor__color">
          Цвет сетки
          <input aria-label="Цвет сетки" type="color" :value="background.pattern.color" :disabled="disabled" @input="pattern('color', $event)">
        </label>
        <label class="background-editor__field">
          <span>Прозрачность сетки <output>{{ Math.round(background.pattern.opacity * 100) }}%</output></span>
          <input aria-label="Прозрачность сетки" type="range" min="0" max="100" step="1" :value="background.pattern.opacity * 100" :disabled="disabled" @input="pattern('opacity', $event)">
        </label>
        <label class="background-editor__field">
          <span>Увеличение сетки <output>{{ patternSize }}</output></span>
          <input aria-label="Увеличение сетки" type="range" min="1" max="4" step="1" :value="patternScale" :disabled="disabled" @input="pattern('scale', $event)">
        </label>
      </template>
      <button type="button" :disabled="disabled" @click="remove">Убрать фон</button>
    </template>
  </section>
</template>

<style scoped>
.background-editor { display: grid; gap: 0.625rem; margin-top: 0.875rem; padding-top: 0.875rem; border-top: var(--ld-border-width) solid var(--ld-border-default); }
h4, p { margin: 0; }
h4 { font-size: inherit; color: var(--ld-text-primary); }
.background-editor__field { display: grid; gap: 0.375rem; color: var(--ld-text-muted); min-width: 0; }
.background-editor__field > span, .background-editor__color { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
output { color: var(--ld-text-secondary); font-variant-numeric: tabular-nums; }
input, select, button { min-width: 0; max-width: 100%; font: inherit; }
input[type='file'] { width: 100%; font-size: 0.75rem; }
input[type='file']::file-selector-button, select, button { padding: 0.5rem; border: var(--ld-border-width) solid var(--ld-border-default); border-radius: var(--ld-radius-control); background: var(--ld-surface-3); color: var(--ld-text-primary); cursor: pointer; }
input[type='range'] { width: 100%; margin: 0; accent-color: var(--ld-accent); }
input[type='color'] { width: 3rem; height: 2rem; padding: 0.125rem; border: var(--ld-border-width) solid var(--ld-border-default); border-radius: var(--ld-radius-control); background: var(--ld-surface-3); cursor: pointer; }
.background-editor__color { color: var(--ld-text-muted); }
.background-editor__toggle { display: flex; align-items: center; gap: 0.5rem; color: var(--ld-text-secondary); }
input[type='checkbox'] { accent-color: var(--ld-accent); }
.background-editor__hint { color: var(--ld-text-muted); font-size: 0.75rem; }
.background-editor__filename { overflow-wrap: anywhere; color: var(--ld-text-secondary); }
.background-editor__error { color: var(--ld-danger-text); }
:disabled { opacity: 0.5; cursor: default; }
:focus-visible { outline: 0.125rem solid var(--ld-focus-ring); outline-offset: 0.125rem; }
</style>
