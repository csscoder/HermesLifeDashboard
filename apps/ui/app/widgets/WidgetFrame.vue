<script setup lang="ts">
import { computed } from 'vue'
import { themeMeta } from '../theme/builtin'
import { themeClass } from '../theme/resolve'

// A resolved theme id: the widget's own choice or the one it inherits.
const props = defineProps<{ themeId: string }>()

const classes = computed(() => [
  'widget',
  `widget--theme-${themeClass(props.themeId)}`,
  `widget--skin-${themeMeta(props.themeId).skin}`,
])
</script>

<template>
  <div :class="classes">
    <div class="widget__wrapper">
      <div class="widget__box">
        <div class="widget__body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
