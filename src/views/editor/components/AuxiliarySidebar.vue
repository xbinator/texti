<template>
  <div class="editor-sidebar">
    <BChat class="editor-sidebar__chat" />

    <div class="editor-sidebar__input">
      <BPromptEditor
        v-model:value="inputValue"
        placeholder="输入消息..."
        :max-height="200"
        :submit-on-enter="true"
        :disabled="isStreaming"
        @submit="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useAgent } from '@/hooks/useAgent';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';

const router = useRouter();
const inputValue = ref('');
const isStreaming = ref(false);
const serviceModelStore = useServiceModelStore();

const { agent } = useAgent({
  providerId: '', // 动态设置见下方
  onChunk: (chunk: string) => {
    console.log('Received chunk:', chunk);
  },
  onComplete: () => {
    isStreaming.value = false;
  },
  onError: (error) => {
    message.error(error.message);
    isStreaming.value = false;
  }
});

async function getServiceConfig() {
  const config = await serviceModelStore.getAvailableServiceConfig('chat');

  if (config?.providerId && config?.modelId) return config;

  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', { confirmText: '去填写', cancelText: '取消' });

  if (confirmed) router.push('/settings/service-model');
}

async function handleSubmit(): Promise<void> {
  const prompt = inputValue.value.trim();
  if (!prompt || isStreaming.value) return;

  const config = await getServiceConfig();
  if (!config) return;

  inputValue.value = '';
  isStreaming.value = true;

  await agent.stream({ prompt, modelId: config.modelId });

  isStreaming.value = false;
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
}

.editor-sidebar__chat {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editor-sidebar__input {
  padding: 12px;
  border-top: 1px solid var(--border-color, rgb(0 0 0 / 6%));
  transition: opacity 0.2s ease;

  &:has([disabled]) {
    opacity: 0.6;
  }
}
</style>
