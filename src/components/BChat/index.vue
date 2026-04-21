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
        <BPromptEditor v-model:value="inputValue" :placeholder="placeholder" :max-height="200" variant="borderless" @submit="handleSubmit" />

        <div class="b-chat__input__buttons">
          <BButton v-if="loading" size="small" square icon="lucide:square" @click="handleAbort" />
          <BButton v-else size="small" square :disabled="!inputValue" icon="lucide:arrow-up" @click="handleSubmit" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BChat/index.vue
 * @description AI 聊天组件，支持消息流式输出和 AI 工具调用
 */
import type { BChatProps as Props, Message } from './types';
import type { ModelMessage } from 'ai';
import type { AIServiceError, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
import { nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message as aMessage } from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { getModelToolSupport, type AIToolProviderSupport } from '@/ai/tools/policy';
import { createToolResultMessages, executeToolCall, toTransportTools, type ExecutedToolCall } from '@/ai/tools/stream';
import BButton from '@/components/BButton/index.vue';
import { useChat } from '@/hooks/useChat';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';
import Container from './components/Container.vue';
import MessageBubble from './components/MessageBubble.vue';

/**
 * 服务配置信息
 */
interface ServiceConfig {
  /** 服务商 ID */
  providerId: string;
  /** 模型 ID */
  modelId: string;
  /** 工具支持能力 */
  toolSupport: AIToolProviderSupport;
}

defineOptions({ name: 'BChat' });

const props = withDefaults(defineProps<Props>(), {
  placeholder: '输入消息...'
});

const emit = defineEmits<{ (e: 'complete', message: Message): void }>();

const inputValue = defineModel<string>('inputValue', { default: '' });
const messages = defineModel<Message[]>('messages', { default: () => [] });

/** 加载状态 */
const loading = ref(false);
/** 工具执行状态文本 */
const toolStatus = ref('');
/** 待处理的工具调用结果队列 */
const pendingToolResults = ref<ExecutedToolCall[]>([]);
/** 已执行的工具调用 ID 集合，用于防止重复执行 */
const executedToolCallIds = ref<Set<string>>(new Set());

const router = useRouter();
const serviceModelStore = useServiceModelStore();
/** 最近一次请求的服务配置，用于工具循环时复用 */
let lastServiceConfig: ServiceConfig | null = null;

/**
 * 将组件消息转换为 AI SDK 的 ModelMessage 格式
 * @param sourceMessages - 组件内部消息列表
 * @returns AI SDK 兼容的消息格式
 */
function toModelMessages(sourceMessages: Message[]): ModelMessage[] {
  return sourceMessages.map((item) => ({ role: item.role, content: item.content }));
}

/**
 * 移除末尾空的 assistant 消息
 * @description 工具循环时，当前轮次的空 assistant 占位不写入历史
 */
function removeTrailingEmptyAssistantMessage(): void {
  const lastMessage = messages.value[messages.value.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant') {
    return;
  }

  if (!lastMessage.content && !lastMessage.usage) {
    messages.value.pop();
  }
}

/**
 * 处理工具调用事件
 * @param chunk - 工具调用数据块
 * @description 执行工具调用并将结果加入待处理队列
 */
async function handleToolCall(chunk: AIStreamToolCallChunk): Promise<void> {
  // 防止重复执行同一个工具调用
  if (executedToolCallIds.value.has(chunk.toolCallId)) {
    return;
  }

  executedToolCallIds.value.add(chunk.toolCallId);
  toolStatus.value = `正在执行工具：${chunk.toolName}`;

  // 执行工具调用并收集结果
  const result = await executeToolCall(chunk, props.tools ?? [], props.getToolContext?.());
  pendingToolResults.value.push(result);

  // 更新状态显示
  toolStatus.value = result.result.status === 'success' ? `工具已完成：${chunk.toolName}` : `工具处理完成：${chunk.toolName}`;
}

/**
 * useChat hook 配置
 * @description 定义消息流的各种回调处理
 */
const { agent } = useChat({
  /** 处理流式内容块 */
  onText: async (content: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];

    message.content = (message.content ?? '') + content;
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  /** 处理思考内容 */
  onThinking: async (thinking: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];

    message.thinking = (message.thinking ?? '') + thinking;
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  /** 处理流式完成事件 */
  onFinish: async ({ usage }: AIStreamFinishChunk): Promise<void> => {
    const message = messages.value[messages.value.length - 1];

    message.usage = usage;
  },
  /** 处理工具调用事件 */
  onToolCall: handleToolCall,
  /** 处理请求完成事件 */
  onComplete: (): void => {
    loading.value = false;

    const message = messages.value[messages.value.length - 1];
    if (message) {
      message.loading = false;
      message.finished = true;
    }

    // 工具轮次完成后立即发起下一轮，当前轮次的空 assistant 占位不写入历史
    if (pendingToolResults.value.length && lastServiceConfig) {
      const nextToolResults = [...pendingToolResults.value];

      pendingToolResults.value = [];
      removeTrailingEmptyAssistantMessage();

      nextTick(() => {
        // eslint-disable-next-line no-use-before-define
        streamMessages(messages.value, lastServiceConfig as ServiceConfig, nextToolResults);
      });
      return;
    }

    // 清理状态
    executedToolCallIds.value = new Set();
    toolStatus.value = '';

    emit('complete', message);
  },
  /** 处理错误事件 */
  onError: (error: AIServiceError): void => {
    aMessage.error(error.message);
  }
});

/**
 * 获取当前可用的服务配置
 * @returns 服务配置，如果未配置则引导用户去设置页面
 */
async function getServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await serviceModelStore.getAvailableServiceConfig('chat');
  if (config?.providerId && config?.modelId) {
    const toolSupport = await getModelToolSupport(config.providerId, config.modelId);

    return { providerId: config.providerId, modelId: config.modelId, toolSupport };
  }

  // 未配置服务时引导用户去设置
  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', { confirmText: '去配置', cancelText: '取消' });

  if (confirmed) {
    router.push('/settings/service-model');
  }

  return undefined;
}

/**
 * 创建 assistant 消息占位符
 * @returns 空的 assistant 消息对象
 */
function createAssistantPlaceholder(): Message {
  return { id: nanoid(), role: 'assistant', content: '', thinking: '', createdAt: '', loading: true };
}

/**
 * 查找重新生成的起始消息索引
 * @param targetMessage - 目标消息（需要重新生成的 assistant 消息）
 * @returns 对应 user 消息的索引，未找到返回 -1
 */
function findRegenerateStartIndex(targetMessage: Message): number {
  const targetIndex = messages.value.findIndex((item) => item.id === targetMessage.id);
  if (targetIndex === -1 || targetMessage.role !== 'assistant') return -1;

  // 向前查找最近的 user 消息
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (messages.value[index].role === 'user') return index;
  }

  return -1;
}

/**
 * 发起流式消息请求
 * @param _messages - 消息历史
 * @param config - 服务配置
 * @param toolResults - 工具调用结果（用于多轮工具调用）
 */
function streamMessages(_messages: Message[], config: ServiceConfig, toolResults: ExecutedToolCall[] = []): void {
  loading.value = true;
  lastServiceConfig = config;

  const modelMessages = toModelMessages(_messages);
  // 如果有工具结果，追加到消息历史中
  const continuedMessages = toolResults.length ? [...modelMessages, ...createToolResultMessages(toolResults)] : modelMessages;

  const { supported, reason } = config.toolSupport;

  const tools = supported && Boolean(props.tools?.length) ? toTransportTools(props.tools ?? []) : undefined;

  // provider 未验证时直接降级为普通对话，避免把未兼容的 tool schema 发给模型侧
  toolStatus.value = !supported && props.tools?.length ? `已禁用工具调用：${reason ?? '当前服务商暂不支持 AI Tools'}` : '';

  agent.stream({ messages: continuedMessages, modelId: config.modelId, providerId: config.providerId, tools });

  // 添加 assistant 消息占位符，用于接收流式内容
  messages.value.push(createAssistantPlaceholder());
}

/**
 * 处理消息提交
 * @description 用户发送消息时调用
 */
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

/**
 * 中止当前请求
 * @description 清理工具状态并中止流式请求
 */
function handleAbort(): void {
  pendingToolResults.value = [];
  executedToolCallIds.value = new Set();
  toolStatus.value = '';
  agent.abort();
}

/**
 * 处理消息编辑
 * @param message - 要编辑的消息
 * @description 将消息内容填入输入框
 */
function handleEdit(message: Message): void {
  inputValue.value = message.content;
}

/**
 * 处理消息重新生成
 * @param message - 要重新生成的消息
 * @description 删除目标消息之后的历史，重新发起请求
 */
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

.b-chat__tool-status {
  padding: 0 16px 12px;
  font-size: 12px;
  color: var(--text-secondary);
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
  padding: 12px 0 12px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;

  .b-prompt-editor {
    padding: 0 12px 0 0;
    background-color: transparent;
    border: none;
    border-radius: 0;
  }
}

.b-chat__input__buttons {
  padding: 0 12px 0 0;
}
</style>
