<template>
  <div class="editor-sidebar">
    <BChat class="editor-sidebar__chat"> SDFS DSFAD AS </BChat>

    <div class="editor-sidebar__input">
      <BPromptEditor v-model:value="inputValue" placeholder="输入消息..." :max-height="200" :submit-on-enter="true" @submit="handleSubmit" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useAgent } from '@/hooks/useAgent';
import { useServiceModelStore } from '@/stores/service-model';
import type { AvailableServiceModelConfig } from '@/stores/service-model';

const inputValue = ref('');
const serviceModelStore = useServiceModelStore();
const currentConfig = ref<AvailableServiceModelConfig | null>(null);

const providerId = ref<string | undefined>();

const { agent } = useAgent({
  providerId,
  onChunk: (chunk: string) => {
    console.log('Received chunk:', chunk);
  },
  onComplete: () => {
    console.log('Stream completed');
  },
  onError: (error) => {
    message.error(error.message);
  }
});

onMounted(async () => {
  currentConfig.value = await serviceModelStore.getAvailableServiceConfig('chat');
  providerId.value = currentConfig.value?.providerId;
});

async function handleSubmit(): Promise<void> {
  const prompt = inputValue.value.trim();
  if (!prompt) return;

  const config = currentConfig.value;
  if (!config?.providerId || !config?.modelId) {
    console.error('No available service config');
    return;
  }

  inputValue.value = '';

  await agent.stream({
    prompt,
    modelId: config.modelId
  });
}
</script>

<style scoped lang="less">
.editor-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;

  &__chat {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  &__input {
    padding: 12px;
  }
}

.sidebar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}
</style>
