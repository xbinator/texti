<!--
  @file index.vue
  @description 搜索工具设置页，负责管理 Tavily 的启用状态与 API Key。
-->
<template>
  <SettingsPage :title="MENU_ITEMS.search.label">
    <SettingsSection title="基础配置">
      <div class="search-tools-settings__item">
        <div class="search-tools-settings__meta">
          <div class="search-tools-settings__label">启用 Tavily 工具</div>
          <div class="search-tools-settings__description">启用后，聊天工具链才会向模型暴露 Tavily 搜索与正文提取工具。</div>
        </div>
        <ASwitch :checked="store.tavily.enabled" @change="handleEnabledChange" />
      </div>

      <div class="search-tools-settings__item">
        <div class="search-tools-settings__meta">
          <div class="search-tools-settings__label">Tavily API Key</div>
        </div>
        <div class="search-tools-settings__input">
          <AInputPassword :value="store.tavily.apiKey" placeholder="请输入 Tavily API Key" @update:value="handleApiKeyChange" />
        </div>
      </div>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { useToolSettingsStore } from '@/stores/ai/toolSettings';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';

const store = useToolSettingsStore();

/**
 * 处理 Tavily 启用状态更新。
 * @param value - 开关值
 */
async function handleEnabledChange(value: boolean | string | number): Promise<void> {
  await store.setTavilyEnabled(Boolean(value));
}

/**
 * 处理 API Key 更新。
 * @param value - 新 API Key
 */
async function handleApiKeyChange(value: string): Promise<void> {
  await store.setTavilyApiKey(value);
}
</script>

<style scoped lang="less">
.search-tools-settings__item {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 16px;
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  & + & {
    border-top: var(--surface-border-width) solid var(--border-tertiary);
  }

  &:hover,
  &:focus-within {
    background: var(--bg-hover);
  }
}

.search-tools-settings__meta {
  flex: 1;
  min-width: 0;
}

.search-tools-settings__input {
  width: 280px;
}

.search-tools-settings__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: none;
}

.search-tools-settings__description {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

@media (width <= 800px) {
  .search-tools-settings__item {
    flex-direction: column;
    align-items: flex-start;
  }

  .search-tools-settings__item :deep(.b-select) {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .search-tools-settings__item {
    transition: none;
  }
}
</style>
