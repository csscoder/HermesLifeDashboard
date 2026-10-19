<script setup>
import { ref } from 'vue'
import { FakeVueLib } from 'fake-vue-lib'
const count = ref(0)
</script>
<template><FakeVueLib /><button @click="count++">{{ count }}</button></template>
