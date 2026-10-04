<template>
  <div class="widget-frame" data-widget-theme="default">
    <div class="widget-frame__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.widget-frame {
  box-sizing: border-box;
  height: 100%;
  overflow: hidden;
  border: var(--widget-border);
  border-radius: var(--widget-radius);
  background: var(--widget-bg);
  backdrop-filter: blur(var(--widget-blur));
  color: var(--widget-text);
}

.widget-frame__content {
  box-sizing: border-box;
  height: 100%;
  padding: var(--widget-padding);
}
</style>
