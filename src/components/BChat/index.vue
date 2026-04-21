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
 * @description AI 聊天组件，负责消息渲染、流式响应和工具续轮控制。
 */
import type { BChatProps as Props, Message, MessageToolCall, ServiceConfig, ToolLoopGuardConfig } from './types';
import type { AIServiceError, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
import { nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message as aMessage } from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { getModelToolSupport } from '@/ai/tools/policy';
import { createToolResultMessages, executeToolCall, toTransportTools, type ExecutedToolCall } from '@/ai/tools/stream';
import BButton from '@/components/BButton/index.vue';
import { useChat } from '@/hooks/useChat';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';
import Container from './components/Container.vue';
import MessageBubble from './components/MessageBubble.vue';
import { createAssistantPlaceholder, createErrorMessage, isRemovableAssistantPlaceholder, toModelMessages } from './message';
import { createToolCallTracker, type ToolCallTracker } from './utils/tool-call-tracker';
import { createToolLoopGuard, type ToolLoopGuard } from './utils/tool-loop-guard';

/**
 * 工具续轮保护的默认阈值
 */
const TOOL_LOOP_GUARD_CONFIG: ToolLoopGuardConfig = {
  maxRounds: 5,
  maxRepeatedCalls: 2
};

defineOptions({ name: 'BChat' });

const props = withDefaults(defineProps<Props>(), {
  placeholder: '输入消息...'
});

const emit = defineEmits<{ (e: 'complete', message: Message): void }>();

const inputValue = defineModel<string>('inputValue', { default: '' });
const messages = defineModel<Message[]>('messages', { default: () => [] });

const loading = ref(false);
const toolStatus = ref('');
const pendingToolResults = ref<ExecutedToolCall[]>([]);
const blockedToolLoopReason = ref('');

const router = useRouter();
const serviceModelStore = useServiceModelStore();

let lastServiceConfig: ServiceConfig | null = null;
let executedToolCallIds = new Set<string>();
let currentToolRoundId = 0;
let currentToolCallTracker: ToolCallTracker = createToolCallTracker();
let currentToolLoopGuard: ToolLoopGuard = createToolLoopGuard(TOOL_LOOP_GUARD_CONFIG);

/**
 * 为一次新的流式请求切换到新的异步跟踪上下文
 */
function startStreamRound(): void {
  currentToolRoundId += 1;
  currentToolCallTracker = createToolCallTracker();
}

/**
 * 为新的用户请求链路重置工具续轮状态
 */
function startToolLoopSession(): void {
  startStreamRound();
  currentToolLoopGuard = createToolLoopGuard(TOOL_LOOP_GUARD_CONFIG);
  blockedToolLoopReason.value = '';
  executedToolCallIds = new Set();
  pendingToolResults.value = [];
}

/**
 * 只有真正空白的 assistant 占位消息才允许在续轮前移除
 */
function removeTrailingEmptyAssistantMessage(): void {
  const lastMessage = messages.value[messages.value.length - 1];
  if (isRemovableAssistantPlaceholder(lastMessage)) {
    messages.value.pop();
  }
}

/**
 * 根据工具支持能力生成状态提示
 * @param config - 服务配置
 */
function getToolStatusText(config: ServiceConfig): string {
  const { supported, reason } = config.toolSupport;
  if (!props.tools?.length || supported) {
    return '';
  }

  return `已禁用工具调用：${reason ?? '当前服务商暂不支持 AI Tools'}`;
}

/**
 * 在 assistant 占位消息上记录模型发起的工具调用
 * @param chunk - 工具调用数据块
 */
function appendAssistantToolCall(chunk: AIStreamToolCallChunk): void {
  const message = messages.value[messages.value.length - 1];
  if (message?.role !== 'assistant') {
    return;
  }

  const toolCall: MessageToolCall = {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    input: chunk.input
  };

  message.toolCalls = [...(message.toolCalls ?? []), toolCall];
}

/**
 * 结束工具续轮并写入可见错误消息
 * @param reason - 终止原因
 */
function stopToolLoop(reason: string): void {
  blockedToolLoopReason.value = reason;
  toolStatus.value = '';
  pendingToolResults.value = [];
  removeTrailingEmptyAssistantMessage();

  const message = createErrorMessage(reason);
  messages.value.push(message);
  emit('complete', message);
}

/**
 * 执行工具调用，并仅在当前轮次仍有效时写回结果
 * @param chunk - 工具调用数据块
 * @param roundId - 发起执行时记录的轮次 ID
 */
async function executeTrackedToolCall(chunk: AIStreamToolCallChunk, roundId: number): Promise<void> {
  const result = await executeToolCall(chunk, props.tools ?? [], props.getToolContext?.());
  if (roundId !== currentToolRoundId) {
    return;
  }

  pendingToolResults.value.push(result);
  toolStatus.value = result.result.status === 'success' ? `工具已完成：${chunk.toolName}` : `工具处理完成：${chunk.toolName}`;
}

/**
 * 处理模型返回的工具调用
 * @param chunk - 工具调用数据块
 */
async function handleToolCall(chunk: AIStreamToolCallChunk): Promise<void> {
  if (executedToolCallIds.has(chunk.toolCallId)) {
    return;
  }

  executedToolCallIds.add(chunk.toolCallId);
  appendAssistantToolCall(chunk);

  const guardResult = currentToolLoopGuard.recordToolCall(chunk.toolName, chunk.input);
  if (!guardResult.allowed) {
    stopToolLoop(guardResult.reason ?? '工具调用重复次数超过限制，已停止自动续轮。');
    return;
  }

  toolStatus.value = `正在执行工具：${chunk.toolName}`;
  const trackedTask = currentToolCallTracker.track(executeTrackedToolCall(chunk, currentToolRoundId));
  await trackedTask;
}

/**
 * 获取当前可用的服务配置
 */
async function getServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await serviceModelStore.getAvailableServiceConfig('chat');
  if (config?.providerId && config?.modelId) {
    const toolSupport = await getModelToolSupport(config.providerId, config.modelId);
    return { providerId: config.providerId, modelId: config.modelId, toolSupport };
  }

  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', {
    confirmText: '去配置',
    cancelText: '取消'
  });

  if (confirmed) {
    router.push('/settings/service-model');
  }

  return undefined;
}

/**
 * 查找重新生成应截断到的 user 消息位置
 * @param targetMessage - 目标 assistant 消息
 */
function findRegenerateStartIndex(targetMessage: Message): number {
  const targetIndex = messages.value.findIndex((item) => item.id === targetMessage.id);
  if (targetIndex === -1 || targetMessage.role !== 'assistant') {
    return -1;
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (messages.value[index].role === 'user') {
      return index;
    }
  }

  return -1;
}

/**
 * 发起一轮新的流式请求
 * @param sourceMessages - 消息历史
 * @param config - 服务配置
 * @param toolResults - 上一轮工具执行结果
 */
function streamMessages(sourceMessages: Message[], config: ServiceConfig, toolResults: ExecutedToolCall[] = []): void {
  loading.value = true;
  lastServiceConfig = config;
  startStreamRound();

  const modelMessages = toModelMessages(sourceMessages);
  const continuedMessages = toolResults.length ? [...modelMessages, ...createToolResultMessages(toolResults)] : modelMessages;
  const tools = config.toolSupport.supported && Boolean(props.tools?.length) ? toTransportTools(props.tools ?? []) : undefined;

  toolStatus.value = getToolStatusText(config);
  // eslint-disable-next-line no-use-before-define
  agent.stream({ messages: continuedMessages, modelId: config.modelId, providerId: config.providerId, tools });
  messages.value.push(createAssistantPlaceholder());
}

/**
 * 提交用户消息
 */
async function handleSubmit(): Promise<void> {
  if (loading.value) {
    return;
  }

  const config = await getServiceConfig();
  if (!config) {
    return;
  }

  const content = inputValue.value.trim();
  if (!content) {
    return;
  }

  const message: Message = {
    id: nanoid(),
    role: 'user',
    content,
    createdAt: new Date().toISOString()
  };

  await props.onBeforeSend?.(message);

  messages.value.push(message);
  startToolLoopSession();
  streamMessages(messages.value, config);
  inputValue.value = '';
}

/**
 * 中止当前请求
 */
function handleAbort(): void {
  startToolLoopSession();
  toolStatus.value = '';
  // eslint-disable-next-line no-use-before-define
  agent.abort();
}

/**
 * 将消息回填到输入框
 * @param message - 待编辑的消息
 */
function handleEdit(message: Message): void {
  inputValue.value = message.content;
}

/**
 * 重新生成 assistant 消息
 * @param message - 待重新生成的 assistant 消息
 */
async function handleRegenerate(message: Message): Promise<void> {
  if (loading.value) {
    return;
  }

  const config = await getServiceConfig();
  if (!config) {
    return;
  }

  const startIndex = findRegenerateStartIndex(message);
  if (startIndex === -1) {
    aMessage.warning('未找到可用于重新生成的用户消息');
    return;
  }

  const sourceMessages = messages.value.slice(0, startIndex + 1);
  await props.onBeforeRegenerate?.(sourceMessages, message);

  messages.value = sourceMessages;
  startToolLoopSession();
  nextTick(() => streamMessages(sourceMessages, config));
}

/**
 * useChat hook 配置
 */
const { agent } = useChat({
  /**
   * 追加模型文本输出
   * @param content - 增量文本
   */
  onText: async (content: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    message.content = (message.content ?? '') + content;
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  /**
   * 追加模型思考输出
   * @param thinking - 增量思考
   */
  onThinking: async (thinking: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    message.thinking = (message.thinking ?? '') + thinking;
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  /**
   * 记录 usage
   * @param finishChunk - 完成数据块
   */
  onFinish: async ({ usage }: AIStreamFinishChunk): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    message.usage = usage;
  },
  onToolCall: handleToolCall,
  /**
   * 收口当前轮次，并在有工具结果时决定是否继续下一轮
   */
  onComplete: async (): Promise<void> => {
    loading.value = false;
    const roundId = currentToolRoundId;
    const tracker = currentToolCallTracker;

    await tracker.waitForAll();
    if (roundId !== currentToolRoundId) {
      return;
    }

    if (blockedToolLoopReason.value) {
      executedToolCallIds = new Set();
      return;
    }

    const message = messages.value[messages.value.length - 1];
    if (message) {
      message.loading = false;
      message.finished = true;
    }

    if (message?.role === 'error') {
      return;
    }

    if (pendingToolResults.value.length && lastServiceConfig) {
      const roundGuardResult = currentToolLoopGuard.advanceRound();
      if (!roundGuardResult.allowed) {
        executedToolCallIds = new Set();
        stopToolLoop(roundGuardResult.reason ?? '工具调用轮次超过限制，已停止自动续轮。');
        return;
      }

      const nextToolResults = [...pendingToolResults.value];
      pendingToolResults.value = [];
      removeTrailingEmptyAssistantMessage();

      nextTick(() => {
        streamMessages(messages.value, lastServiceConfig as ServiceConfig, nextToolResults);
      });
      return;
    }

    executedToolCallIds = new Set();
    toolStatus.value = '';

    if (message) {
      emit('complete', message);
    }
  },
  /**
   * 将服务异常显示到聊天记录中
   * @param error - 错误对象
   */
  onError: (error: AIServiceError): void => {
    loading.value = false;
    startToolLoopSession();
    toolStatus.value = '';
    removeTrailingEmptyAssistantMessage();

    const message = createErrorMessage(error.message);
    messages.value.push(message);
    emit('complete', message);
  }
});
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
