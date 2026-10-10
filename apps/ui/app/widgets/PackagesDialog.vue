<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type { Grant, GrantMode, PackageInspection, WidgetPermission } from '@lifedashboard/contracts/widget-package'
import { api, type ApiFailure } from '../api'
import {
  CONFIRMABLE_PERMISSIONS,
  describeUploadFailure,
  filesFromEntry,
  filesFromInput,
  formatBytes,
  initialModes,
  installedPackages,
  loadPackages,
  readFolder,
  relaxedPermissions,
  savedMode,
  uploadFiles,
  type GrantModes,
  type PickedFile,
} from './catalog'

const open = defineModel<boolean>('open', { required: true })

const PERMISSIONS: Record<WidgetPermission, string> = {
  state: 'Хранить собственные данные виджета',
  notifications: 'Показывать уведомления',
}
const MODES: Record<GrantMode, string> = {
  ask: 'Спрашивать каждый раз',
  allow: 'Разрешить',
}
const VERSION_CONFLICT = 'Эта версия уже установлена с другим содержимым'

// Template ref keys differ from setup bindings (see WidgetBoard.vue).
const dialog = useTemplateRef<HTMLDialogElement>('dialogBox')
const folderInput = useTemplateRef<HTMLInputElement>('folderBox')
const message = ref<string | null>(null)
const busy = ref(false)
// The created upload and its files; the review screen shows while it is set.
const pending = ref<{ uploadId: string; inspection: PackageInspection; files: PickedFile[] } | null>(null)
// Files not sent yet; a retry sends only these.
const remaining = ref<PickedFile[]>([])
const progress = ref<{ sent: number; total: number } | null>(null)
const failedPath = ref<string | null>(null)
const confirmDelete = ref<string | null>(null)
let controller: AbortController | null = null
// Bumped by every start and cancel: an answer from an older run is discarded.
let run = 0
// Modes the user picks for new confirmable permissions on the install screen.
const modes = ref<GrantModes>({})

const manifest = computed(() => pending.value?.inspection.manifest ?? null)
const isUpdate = computed(() => installedPackages.value.some((pkg) => pkg.id === manifest.value?.id))
const heldGrants = computed(() => installedPackages.value.find((pkg) => pkg.id === manifest.value?.id)?.grants ?? [])

function permissionList(permissions: readonly WidgetPermission[]): string {
  return permissions.map((permission) => PERMISSIONS[permission]).join(', ')
}

function failureText(failure: ApiFailure, conflict: string): string {
  if (failure.kind === 'invalid') return `Пакет отклонён: ${failure.message}`
  if (failure.kind === 'conflict') return conflict
  return 'Не удалось связаться с API'
}

watch(
  open,
  (value) => {
    if (!value) {
      cancel()
      dialog.value?.close()
      return
    }
    message.value = null
    pending.value = null
    void loadPackages(api)
    dialog.value?.showModal()
  },
  { flush: 'post' },
)

async function start(files: PickedFile[]) {
  if (busy.value) return
  if (pending.value) cancel()
  const mine = ++run
  // Set before the first await so an overlapping start is rejected; a stale run never touches `busy` (cancel reset it).
  busy.value = true
  message.value = null
  const read = await readFolder(files)
  if (mine !== run) return
  if (!read.ok) {
    busy.value = false
    message.value = read.message
    return
  }
  const result = await api.createUpload(read.manifest, read.files)
  if (mine !== run) {
    // The dialog closed or another folder replaced this run: release the session nobody owns.
    if (result.ok) void api.cancelUpload(result.data.uploadId)
    return
  }
  busy.value = false
  if (!result.ok) {
    message.value = failureText(result, VERSION_CONFLICT)
    return
  }
  pending.value = { uploadId: result.data.uploadId, inspection: result.data.inspection, files }
  remaining.value = files
  progress.value = null
  failedPath.value = null
  modes.value = initialModes(result.data.inspection.newPermissions)
}

function chooseFolder(event: Event) {
  const input = event.target as HTMLInputElement
  const files = filesFromInput(input.files ?? [])
  input.value = ''
  if (files.length > 0) void start(files)
}

async function dropFolder(event: DragEvent) {
  if (busy.value) return
  const entry = event.dataTransfer?.items[0]?.webkitGetAsEntry()
  if (!entry?.isDirectory) {
    message.value = 'Перетащите папку виджета'
    return
  }
  await start(await filesFromEntry(entry as FileSystemDirectoryEntry))
}

async function install() {
  const current = pending.value
  if (!current) return
  busy.value = true
  failedPath.value = null
  message.value = null
  const own = (controller = new AbortController())
  const total = current.files.reduce((sum, item) => sum + item.file.size, 0)
  progress.value ??= { sent: 0, total }
  const sent = await uploadFiles(api, current.uploadId, remaining.value, own.signal, (file) => {
    if (own.signal.aborted) return
    remaining.value = remaining.value.filter((item) => item !== file)
    progress.value = { sent: progress.value!.sent + file.file.size, total }
  })
  // «Отмена» already reset the screen.
  if (own.signal.aborted) return
  if (!sent.ok) {
    busy.value = false
    failedPath.value = sent.path
    const failure = describeUploadFailure(sent)
    if (failure.restart) pending.value = null
    message.value = failure.message
    return
  }
  const result = await api.installUpload(current.uploadId, own.signal)
  if (own.signal.aborted) return
  if (!result.ok) {
    busy.value = false
    pending.value = null
    message.value = failureText(result, VERSION_CONFLICT)
    return
  }
  // New confirmable grants come out as «ask»; a failed PUT leaves that safer mode.
  const relaxed = relaxedPermissions(current.inspection.newPermissions, modes.value)
  const saved = await Promise.all(relaxed.map((permission) => api.setGrantMode(current.inspection.manifest.id, permission, 'allow')))
  busy.value = false
  pending.value = null
  progress.value = null
  message.value = saved.every((item) => item.ok) ? 'Виджет установлен' : 'Виджет установлен, но режим «Разрешить» не сохранён'
  await loadPackages(api)
}

function cancel() {
  run++
  controller?.abort()
  if (pending.value) void api.cancelUpload(pending.value.uploadId)
  pending.value = null
  progress.value = null
  busy.value = false
}

async function copy(path: string) {
  await navigator.clipboard.writeText(path)
}

async function remove(id: string) {
  // The first click asks; the confirmation block calls this again.
  if (confirmDelete.value !== id) {
    confirmDelete.value = id
    return
  }
  confirmDelete.value = null
  busy.value = true
  const result = await api.deletePackage(id)
  busy.value = false
  if (!result.ok) {
    message.value = failureText(result, 'Виджет размещён на доске, сначала уберите его с доски')
    return
  }
  message.value = null
  await loadPackages(api)
}

async function changeMode(packageId: string, grant: Grant, event: Event) {
  const select = event.target as HTMLSelectElement
  busy.value = true
  const result = await api.setGrantMode(packageId, grant.permission, select.value as GrantMode)
  if (result.ok) {
    message.value = null
    await loadPackages(api)
  } else {
    // The list keeps showing the saved mode.
    select.value = grant.mode
    message.value = 'Не удалось сохранить режим'
  }
  busy.value = false
  // The select was disabled during the request; give keyboard focus back once it is enabled.
  await nextTick()
  select.focus()
}
</script>

<template>
  <dialog ref="dialogBox" class="packages" aria-labelledby="packages-title" @close="open = false" @dragover.prevent @drop.prevent="dropFolder">
    <template v-if="pending && manifest">
      <h2 id="packages-title" class="packages__title">Установка виджета</h2>
      <dl class="packages__facts">
        <dt>Название</dt>
        <dd>{{ manifest.title }}</dd>
        <dt>Автор</dt>
        <dd>{{ manifest.author }}</dd>
        <dt>Версия</dt>
        <dd>{{ manifest.version }}</dd>
        <dt>Размер</dt>
        <dd>
          от {{ manifest.sizing.min.w }}×{{ manifest.sizing.min.h }} до {{ manifest.sizing.max.w }}×{{ manifest.sizing.max.h }}
        </dd>
        <dt>Размер файлов</dt>
        <dd>
          Код {{ formatBytes(pending.inspection.sizes.code) }}, медиа {{ formatBytes(pending.inspection.sizes.assets) }},
          исходники {{ formatBytes(pending.inspection.sizes.source) }}
        </dd>
      </dl>
      <p class="packages__warning">Это код стороннего автора</p>
      <h3 class="packages__subtitle">Разрешения</h3>
      <ul class="packages__permissions">
        <li v-for="permission in manifest.permissions" :key="permission" class="packages__grant">
          {{ PERMISSIONS[permission] }}
          <select
            v-if="modes[permission]"
            v-model="modes[permission]"
            class="packages__select"
            :aria-label="`${PERMISSIONS[permission]}: режим`"
          >
            <option value="ask">{{ MODES.ask }}</option>
            <option value="allow">{{ MODES.allow }}</option>
          </select>
          <span v-else-if="savedMode(heldGrants, permission)" class="packages__hint">
            {{ MODES[savedMode(heldGrants, permission)!] }} — меняется в списке виджетов
          </span>
        </li>
        <li v-if="manifest.permissions.length === 0">Без разрешений</li>
      </ul>
      <p v-if="isUpdate && pending.inspection.newPermissions.length > 0" class="packages__warning">
        Новые разрешения: {{ permissionList(pending.inspection.newPermissions) }}
      </p>
      <p v-if="pending.inspection.installed">Эта версия уже установлена</p>
      <progress v-if="progress" class="packages__progress" :value="progress.sent" :max="progress.total" />
      <div class="packages__actions">
        <button type="button" class="packages__button" :disabled="busy" @click="install">
          {{ failedPath ? 'Повторить' : 'Установить' }}
        </button>
        <button type="button" class="packages__button" @click="cancel">Отмена</button>
      </div>
    </template>
    <template v-else>
      <h2 id="packages-title" class="packages__title">Виджеты</h2>
      <p v-if="installedPackages.length === 0">Пакеты не установлены</p>
      <ul v-else class="packages__list">
        <li v-for="pkg in installedPackages" :key="pkg.id" class="packages__item">
          <span class="packages__name">{{ pkg.title }}</span>
          <span>{{ pkg.author }}</span>
          <span>{{ pkg.versions.map((item) => item.version).join(', ') }}</span>
          <span class="packages__grants">
            <template v-if="pkg.grants.length === 0">Без разрешений</template>
            <span v-for="grant in pkg.grants" :key="grant.permission" class="packages__grant">
              {{ PERMISSIONS[grant.permission] }}
              <select
                v-if="CONFIRMABLE_PERMISSIONS.has(grant.permission)"
                class="packages__select"
                :aria-label="`${PERMISSIONS[grant.permission]}: режим`"
                :value="grant.mode"
                :disabled="busy"
                @change="changeMode(pkg.id, grant, $event)"
              >
                <option value="ask">{{ MODES.ask }}</option>
                <option value="allow">{{ MODES.allow }}</option>
              </select>
            </span>
          </span>
          <button type="button" class="packages__button" :disabled="busy" @click="remove(pkg.id)">Удалить</button>
          <ul class="packages__sources">
            <li v-for="version in pkg.versions" :key="version.version">
              {{ version.version }} · Исходники:
              <template v-if="version.paths.source">
                <code class="packages__path">{{ version.paths.source }}</code>
                <button type="button" class="packages__button" @click="copy(version.paths.source)">Копировать</button>
              </template>
              <template v-else>Исходники не включены</template>
              <template v-if="version.paths.assets">
                · Медиа: <code class="packages__path">{{ version.paths.assets }}</code>
                <button type="button" class="packages__button" @click="copy(version.paths.assets)">Копировать</button>
              </template>
            </li>
          </ul>
          <p v-if="confirmDelete === pkg.id" class="packages__warning">
            Исходники и медиа в userwidgets/{{ pkg.id }}/ тоже будут удалены
            <button type="button" class="packages__button" :disabled="busy" @click="remove(pkg.id)">Удалить</button>
            <button type="button" class="packages__button" @click="confirmDelete = null">Отмена</button>
          </p>
        </li>
      </ul>
      <div class="packages__actions">
        <button type="button" class="packages__button" :disabled="busy" @click="folderInput?.click()">Выбрать папку</button>
        <button type="button" class="packages__button" @click="open = false">Закрыть</button>
      </div>
      <input ref="folderBox" type="file" webkitdirectory hidden @change="chooseFolder" />
    </template>
    <p class="packages__message" role="status">{{ message }}</p>
  </dialog>
</template>

<style scoped>
.packages {
  width: 36rem;
  max-width: calc(100vw - 2rem);
  padding: 1.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-card);
  background: var(--ld-surface-1-solid);
  color: var(--ld-text-primary);
  font-family: var(--ld-font-ui);
}

.packages::backdrop {
  background: var(--ld-scrim);
}

.packages__title {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}

.packages__subtitle {
  margin: 1rem 0 0.5rem;
  font-size: 1rem;
}

.packages__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
}

.packages__facts dt {
  color: var(--ld-text-muted);
}

.packages__facts dd {
  margin: 0;
}

.packages__warning {
  color: var(--ld-warning-text);
}

.packages__permissions,
.packages__list {
  margin: 0;
  padding: 0 0 0 1.25rem;
}

.packages__list {
  padding: 0;
  list-style: none;
}

.packages__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: var(--ld-border-width) solid var(--ld-border-subtle);
}

.packages__name {
  overflow-wrap: anywhere;
  font-weight: var(--ld-weight-strong);
}

.packages__grants {
  grid-column: 1 / -1;
  grid-row: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.25rem;
}

.packages__grant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.packages__select {
  height: var(--ld-control-height);
  padding: 0 0.5rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  min-width: 0;
  max-width: 100%;
  text-overflow: ellipsis;
}

.packages__select:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.packages__hint {
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}

.packages__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.packages__button {
  height: var(--ld-control-height);
  padding: 0 0.875rem;
  border: var(--ld-border-width) solid var(--ld-border-default);
  border-radius: var(--ld-radius-control);
  background: var(--ld-surface-3);
  color: var(--ld-text-primary);
  font: inherit;
  cursor: pointer;
}

.packages__button:focus-visible {
  outline: 0.125rem solid var(--ld-focus-ring);
  outline-offset: 0.125rem;
}

.packages__button:disabled {
  cursor: default;
  opacity: 0.5;
}

.packages__item > .packages__warning {
  grid-column: 1 / -1;
  margin: 0;
}

.packages__progress {
  width: 100%;
}

.packages__sources {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
  color: var(--ld-text-muted);
}

.packages__path {
  overflow-wrap: anywhere;
  font-family: monospace;
}

.packages__message {
  min-height: 1.25rem;
  margin: 1rem 0 0;
  color: var(--ld-text-muted);
  font-size: 0.875rem;
}
</style>
