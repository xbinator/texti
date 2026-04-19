<template>
  <div class="b-chat">
    <Container v-if="messages.length" :loading="loading" class="b-chat__container">
      <div class="b-chat__messages">
        <MessageBubble v-for="item in messages" :key="item.id" :message="item" @edit="handleEdit" @regenerate="handleRegenerate" />
      </div>
    </Container>

    <div v-else class="b-chat__empty">
      <slot name="empty"></slot>
    </div>

    <div class="b-chat__input">
      <div class="b-chat__input__container">
        <BPromptEditor v-model:value="inputValue" :placeholder="props.placeholder" :max-height="200" variant="borderless" @submit="handleSubmit" />

        <div class="b-chat__input__buttons">
          <BButton v-if="loading" size="small" square icon="lucide:square" @click="handleAbort" />
          <BButton v-else size="small" square :disabled="!inputValue" icon="lucide:arrow-up" @click="handleSubmit" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BChatProps as Props, Message } from './types';
import type { AIServiceError, AIStreamFinishChunk } from 'types/ai';
import { nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message as aMessage } from 'ant-design-vue';
import { nanoid } from 'nanoid';
import BButton from '@/components/BButton/index.vue';
import { useChat } from '@/hooks/useChat';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';
import Container from './components/Container.vue';
import MessageBubble from './components/MessageBubble.vue';

interface ServiceConfig {
  providerId: string;
  modelId: string;
}

defineOptions({ name: 'BChat' });

const props = withDefaults(defineProps<Props>(), {
  placeholder: '输入消息...'
});

const emit = defineEmits<{ (e: 'complete', message: Message): void }>();

const inputValue = defineModel<string>('inputValue', { default: '' });
const messages = defineModel<Message[]>('messages', { default: () => [] });

const loading = ref(false);

const router = useRouter();
const serviceModelStore = useServiceModelStore();

const { agent } = useChat({
  onChunk: async (content: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];

    message.content += content;
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  onFinish: async ({ usage }: AIStreamFinishChunk): Promise<void> => {
    const message = messages.value[messages.value.length - 1];

    message.usage = usage;
  },
  onComplete: (): void => {
    loading.value = false;

    const message = messages.value[messages.value.length - 1];
    message.loading = false;
    message.finished = true;

    emit('complete', message);
  },
  onError: (error: AIServiceError): void => {
    aMessage.error(error.message);
  }
});

async function getServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await serviceModelStore.getAvailableServiceConfig('chat');
  if (config?.providerId && config?.modelId) {
    return { providerId: config.providerId, modelId: config.modelId };
  }

  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', { confirmText: '去配置', cancelText: '取消' });

  if (confirmed) {
    router.push('/settings/service-model');
  }

  return undefined;
}

function createAssistantPlaceholder(): Message {
  return { id: nanoid(), role: 'assistant', content: '', createdAt: '', loading: true };
}

function findRegenerateStartIndex(targetMessage: Message): number {
  const targetIndex = messages.value.findIndex((item) => item.id === targetMessage.id);
  if (targetIndex === -1 || targetMessage.role !== 'assistant') return -1;

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (messages.value[index].role === 'user') return index;
  }

  return -1;
}

function streamMessages(_messages: Message[], config: ServiceConfig): void {
  loading.value = true;

  agent.stream({ messages: _messages, modelId: config.modelId, providerId: config.providerId });

  messages.value.push(createAssistantPlaceholder());
}

async function handleSubmit(): Promise<void> {
  if (loading.value) return;

  const config = await getServiceConfig();
  if (!config) return;

  const content = inputValue.value.trim();
  if (!content) return;

  const message: Message = { id: nanoid(), role: 'user', content, createdAt: new Date().toISOString() };

  await props.onBeforeSend?.(message);

  messages.value.push(message);

  streamMessages(messages.value, config);

  inputValue.value = '';
}

function handleAbort(): void {
  agent.abort();
}

function handleEdit(message: Message): void {
  inputValue.value = message.content;
}

async function handleRegenerate(message: Message): Promise<void> {
  if (loading.value) return;

  const config = await getServiceConfig();
  if (!config) return;

  const startIndex = findRegenerateStartIndex(message);
  if (startIndex === -1) {
    aMessage.warning('未找到可用于重新生成的用户消息');
    return;
  }

  const _messages = messages.value.slice(0, startIndex + 1);

  await props.onBeforeRegenerate?.(_messages, message);

  messages.value = _messages;

  nextTick(() => streamMessages(_messages, config));
}
</script>

<style lang="less">
.b-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.b-chat__container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.b-chat__empty {
  flex: 1;
  min-height: 0;
}

.b-chat__messages {
  display: flex;
  flex-direction: column;
}

.b-chat__input {
  padding: 12px;
  border-top: 1px solid var(--border-primary);
}

.b-chat__input__container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  padding: 8px 0 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--input-border);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s;

  .b-prompt-variable__textarea {
    padding: 0 12px 0 0;
    background: transparent;
  }
}

.b-chat__input__buttons {
  display: flex;
  gap: 4px;
  align-items: flex-end;
  padding: 0 12px 0 0;
}

.b-chat__input__right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.b-chat__input__model-select {
  width: 100px;
  font-size: 12px;

  .ant-select-selection-item {
    font-size: 12px;
  }
}
</style>
