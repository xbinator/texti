<template>
  <SettingsPage :title="MENU_ITEMS['service-model'].label">
    <ServiceConfig service-type="polish" title="内容编辑助手" description="指定用于内容编辑的模型" :show-prompt="false" />
  </SettingsPage>
</template>

<script setup lang="ts">
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import { MENU_ITEMS } from '@/views/settings/constants';
import ServiceConfig from './components/ServiceConfig.vue';
</script>
