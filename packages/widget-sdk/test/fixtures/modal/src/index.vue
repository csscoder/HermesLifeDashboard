<script>
import Workspace from './Workspace.vue'
export const modals = { workspace: Workspace }
</script>
<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>
<template><button @click="count++">{{ count }}</button></template>
<style scoped>button { color: blue; }</style>
