import { computed, nextTick, watch, type Ref } from 'vue'
import type { ScreenBoard, SpaceBoard } from '@lifedashboard/contracts/board'
import type { LoadOutcome } from './space-sync'

/** The screen `id` names in `screens`; the first one when it names none; null when there are none. */
export function screenNamed<T extends { id: string }>(screens: readonly T[], id: string | null): T | null {
  return screens.find((screen) => screen.id === id) ?? screens[0] ?? null
}

/** The screen on display (`doc`) and the id model that names it. */
export function useScreenModel(options: {
  space: Ref<SpaceBoard | null>
  spaceId: Ref<string | null>
  screenId: Ref<string | null>
}) {
  const { space, spaceId, screenId } = options
  const doc = computed(() => screenNamed(space.value?.screens ?? [], screenId.value))
  // Keeps the model on the screen on display.
  watch(doc, (screen) => {
    if (screen && screen.id !== screenId.value) screenId.value = screen.id
  })

  /**
   * Switches to `target`. The remembered screen is written only after the target is loaded: until then
   * the id still names a screen of the old space, so the target's id is never replaced by a fallback.
   * Returns the outcome and the screen id on display.
   */
  async function switchTo(
    target: string,
    remembered: string | null,
    load: () => Promise<LoadOutcome>,
  ): Promise<{ outcome: LoadOutcome; screenId: string | null }> {
    const previousSpace = spaceId.value
    // The id model is set first, because the load reads it; the parent applies the write on its next render.
    spaceId.value = target
    await nextTick()
    const outcome = await load()
    if (outcome !== 'loaded') {
      spaceId.value = previousSpace
      return { outcome, screenId: null }
    }
    const screen = screenNamed(space.value?.screens ?? [], remembered)
    screenId.value = screen?.id ?? null
    return { outcome, screenId: screen?.id ?? null }
  }

  return { doc, switchTo }
}
