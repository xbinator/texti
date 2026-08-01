<!--
  @file index.vue
  @description 记忆设置页，管理记忆开关、查看记忆内容、编辑记忆。
-->
<template>
  <SettingsPage :title="MENU_ITEMS.memory.label">
    <SettingsSection title="功能开关">
      <div class="memory-settings__item">
        <div class="memory-settings__meta">
          <div class="memory-settings__label">启用记忆</div>
          <div class="memory-settings__description">允许从对话中提取并记住相关上下文，以便在未来对话中提供更连贯、个性化的回应</div>
        </div>
        <div>
          <ASwitch :checked="settingStore.memoryEnabled" @change="handleToggleEnabled" />
        </div>
      </div>
    </SettingsSection>

    <SettingsSection title="记忆内容">
      <template #extra>
        <BButton size="small" @click="startEdit">编辑</BButton>
      </template>

      <div v-if="loading" class="memory-settings__loading">正在加载记忆...</div>

      <div v-else-if="memoryStore.isEmpty" class="memory-settings__empty">
        <p>暂无记忆条目</p>
        <p class="memory-settings__empty-hint">可点击右上角「编辑」手动添加，或在对话中使用「请记住」「记住这个」自动记录</p>
      </div>

      <MemoryContent v-else :content="memoryStore.rawContent" />

      <MemoryInput v-model:open="editing" />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description 记忆设置页，管理记忆开关、查看记忆内容、编辑记忆。
 */
import { onMounted, ref } from 'vue';
import { useMemoryStore } from '@/stores/ai/memory';
import { useSettingStore } from '@/stores/ui/setting';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';
import MemoryContent from './components/MemoryContent.vue';
import MemoryInput from './components/MemoryInput.vue';

const memoryStore = useMemoryStore();
const settingStore = useSettingStore();

/** 是否处于编辑模式 */
const editing = ref(false);
/** 记忆文件是否正在加载 */
const loading = ref(!memoryStore.loaded);

/**
 * 加载记忆内容，避免页面首次渲染时把未加载状态误展示为空记忆。
 */
async function loadMemoryContent(): Promise<void> {
  if (memoryStore.loaded) {
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    await memoryStore.loadMemory();
  } finally {
    loading.value = false;
  }
}

onMounted((): void => {
  loadMemoryContent().catch((error: unknown): void => {
    console.error('[memory] Failed to load memory settings content:', error);
  });
});

/**
 * 切换记忆功能开关
 * @param value - 开关状态
 */
function handleToggleEnabled(value: boolean | string | number): void {
  settingStore.memoryEnabled = Boolean(value);
  settingStore.persistSettings();
}

/**
 * 进入编辑模式，打开弹窗
 */
function startEdit(): void {
  editing.value = true;
}
</script>

<style scoped lang="less">
.memory-settings__item {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 16px;
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover,
  &:focus-within {
    background: var(--bg-hover);
  }
}

.memory-settings__meta {
  flex: 1;
  min-width: 0;
}

.memory-settings__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: none;
}

.memory-settings__description {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.memory-settings__empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  padding: 32px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}

.memory-settings__loading {
  padding: 32px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}

.memory-settings__empty-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

@media (width <= 800px) {
  .memory-settings__item {
    padding: 0 12px;
  }
}
</style>
