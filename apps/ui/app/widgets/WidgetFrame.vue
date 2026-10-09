<script setup lang="ts">
import { computed } from 'vue'
import type { DropShadow } from '@lifedashboard/contracts/board'
import { themeMeta } from '../theme/builtin'
import { themeClass, type FrameSkin } from '../theme/resolve'
import { shadowCss } from '../theme/shadow'

// A resolved theme id: the widget's own choice or the one it inherits. `skin` and `foreign` come from
// resolveWidgetLook; without them the frame draws the theme's own skin (the build draft).
const props = defineProps<{ themeId: string; skin?: FrameSkin; foreign?: boolean; shadow?: DropShadow | null }>()

const skin = computed(() => props.skin ?? themeMeta(props.themeId).skin)
const classes = computed(() => [
  'widget',
  `widget--theme-${themeClass(props.themeId)}`,
  `widget--skin-${skin.value}`,
  { 'widget--foreign': props.foreign },
])
// Inline style beats the skin's layered box-shadow. A bare widget gets drop-shadow, which follows its
// content's alpha outline (the round clock dial); a card is a rectangle, and filter would break Glass blur.
const wrapperStyle = computed(() => {
  if (!props.shadow) return undefined
  const css = shadowCss(props.shadow)
  return skin.value === 'bare' ? { filter: `drop-shadow(${css})` } : { boxShadow: css }
})
</script>

<template>
  <div :class="classes">
    <div class="widget__wrapper" :style="wrapperStyle">
      <div class="widget__box">
        <div class="widget__body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
