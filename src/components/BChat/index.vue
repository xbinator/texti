<template>
  <div class="b-chat">
    <Container v-if="messages.length" :loading="loading" class="b-chat__container">
      <div class="b-chat__messages">
        <MessageBubble
          v-for="item in messages"
          :key="item.id"
          :message="item"
          @edit="handleEdit"
          @regenerate="handleRegenerate"
          @confirmation-action="handleConfirmationAction"
        />
      </div>
    </Container>

    <div v-else class="b-chat__empty">
      <slot name="empty"></slot>
    </div>

    <div class="b-chat__input">
      <div class="b-chat__input__container">
        <BPromptEditor
          ref="promptEditorRef"
          v-model:value="inputValue"
          :placeholder="placeholder"
          :max-height="200"
          variant="borderless"
          @submit="handleSubmit"
        />

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
import type { CachedModelMessagesResult } from './message';
import type { BChatProps as Props, Message, ServiceConfig, ToolLoopGuardConfig } from './types';
import type { AIServiceError, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
import { nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message as aMessage } from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { getModelToolSupport } from '@/ai/tools/policy';
import { executeToolCall, toTransportTools, type ExecutedToolCall } from '@/ai/tools/stream';
import BButton from '@/components/BButton/index.vue';
import { useChat } from '@/hooks/useChat';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';
import Container from './components/Container.vue';
import MessageBubble from './components/MessageBubble.vue';
import {
  appendTextPart,
  appendThinkingPart,
  appendToolCallPart,
  appendToolResultPart,
  createAssistantPlaceholder,
  createErrorMessage,
  isRemovableAssistantPlaceholder,
  toCachedModelMessages
} from './message';
import { createToolCallTracker, type ToolCallTracker } from './utils/tool-call-tracker';
import { createToolLoopGuard, type ToolLoopGuard } from './utils/tool-loop-guard';

/**
 * 工具续轮保护的默认阈值。
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

/**
 * BPromptEditor 暴露的最小聚焦能力。
 */
interface PromptEditorExpose {
  /**
   * 聚焦编辑器输入区域。
   */
  focus: () => void;
}

const loading = ref(false);
const pendingToolResults = ref<ExecutedToolCall[]>([]);
const blockedToolLoopReason = ref('');
const promptEditorRef = ref<PromptEditorExpose | null>(null);

const router = useRouter();
const serviceModelStore = useServiceModelStore();

let lastServiceConfig: ServiceConfig | null = null;
let executedToolCallIds = new Set<string>();
let currentToolRoundId = 0;
let currentToolCallTracker: ToolCallTracker = createToolCallTracker();
let currentToolLoopGuard: ToolLoopGuard = createToolLoopGuard(TOOL_LOOP_GUARD_CONFIG);
let currentModelMessageCache: CachedModelMessagesResult | undefined;

/**
 * 为一次新的流式请求切换到新的异步跟踪上下文。
 */
function startStreamRound(): void {
  currentToolRoundId += 1;
  currentToolCallTracker = createToolCallTracker();
}

/**
 * 仅重置当前工具续轮的运行时状态，不创建新的循环保护器。
 */
function resetToolLoopState(): void {
  currentToolRoundId = 0;
  currentToolCallTracker = createToolCallTracker();
  blockedToolLoopReason.value = '';
  executedToolCallIds = new Set();
  pendingToolResults.value = [];
  lastServiceConfig = null;
}

/**
 * 为新的用户请求重置工具续轮会话。
 */
function startToolLoopSession(): void {
  resetToolLoopState();
  currentToolLoopGuard = createToolLoopGuard(TOOL_LOOP_GUARD_CONFIG);
}

/**
 * 只有真正空白的 assistant 占位消息才允许在续轮前移除。
 */
function removeTrailingEmptyAssistantMessage(): void {
  const lastMessage = messages.value[messages.value.length - 1];
  if (isRemovableAssistantPlaceholder(lastMessage)) {
    messages.value.pop();
  }
}

/**
 * 在 assistant 占位消息上记录模型发起的工具调用。
 * @param chunk - 工具调用数据块
 */
function appendAssistantToolCall(chunk: AIStreamToolCallChunk): void {
  const message = messages.value[messages.value.length - 1];
  if (message?.role !== 'assistant') {
    return;
  }

  appendToolCallPart(message, chunk.toolCallId, chunk.toolName, chunk.input);
}

/**
 * 在 assistant 消息上记录工具执行结果。
 * @param result - 已执行的工具调用结果
 */
function appendAssistantToolResult(result: ExecutedToolCall): void {
  const message = messages.value[messages.value.length - 1];
  if (message?.role !== 'assistant') {
    return;
  }

  appendToolResultPart(message, result.toolCallId, result.toolName, result.result);
}

/**
 * 终止工具续轮并写入可见错误消息。
 * @param reason - 终止原因
 */
function stopToolLoop(reason: string): void {
  blockedToolLoopReason.value = reason;
  pendingToolResults.value = [];
  removeTrailingEmptyAssistantMessage();

  const message = createErrorMessage(reason);
  messages.value.push(message);
  emit('complete', message);
}

/**
 * 执行工具调用，并仅在当前轮次仍有效时写回结果。
 * @param chunk - 工具调用数据块
 * @param roundId - 发起执行时记录的轮次 ID
 */
async function executeTrackedToolCall(chunk: AIStreamToolCallChunk, roundId: number): Promise<void> {
  const result = await executeToolCall(chunk, props.tools ?? [], props.getToolContext?.());
  if (roundId !== currentToolRoundId) {
    return;
  }

  appendAssistantToolResult(result);
  pendingToolResults.value.push(result);
}

/**
 * 处理模型返回的工具调用。
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

  const trackedTask = currentToolCallTracker.track(executeTrackedToolCall(chunk, currentToolRoundId));
  await trackedTask;
}

/**
 * 读取当前可用的服务配置，不处理 UI 副作用。
 * @returns 可用服务配置，不存在时返回 undefined
 */
async function resolveServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await serviceModelStore.getAvailableServiceConfig('chat');
  if (!config?.providerId || !config?.modelId) {
    return undefined;
  }

  const toolSupport = await getModelToolSupport(config.providerId, config.modelId);
  return { providerId: config.providerId, modelId: config.modelId, toolSupport };
}

/**
 * 在缺少可用模型配置时提示用户进入设置页。
 */
async function handleMissingServiceConfig(): Promise<void> {
  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', { confirmText: '去配置', cancelText: '取消' });

  if (confirmed) {
    router.push('/settings/service-model');
  }
}

/**
 * 获取当前可用服务配置，并在缺失时执行 UI 提示。
 * @returns 可用服务配置，不存在时返回 undefined
 */
async function ensureServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await resolveServiceConfig();
  if (config) {
    return config;
  }

  await handleMissingServiceConfig();
  return undefined;
}

/**
 * 查找重新生成应截断到的 user 消息位置。
 * @param targetMessage - 目标 assistant 消息
 * @returns 重新生成起始 user 消息索引，不存在时返回 -1
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
 * 准备本轮要写入的 assistant 消息。
 * @param reuseLastAssistant - 是否复用末尾 assistant 消息
 * @returns 当前轮次承接输出的 assistant 消息
 */
function prepareAssistantMessage(reuseLastAssistant: boolean): Message {
  const lastMessage = messages.value[messages.value.length - 1];
  if (reuseLastAssistant && lastMessage?.role === 'assistant') {
    lastMessage.loading = true;
    lastMessage.finished = false;
    lastMessage.createdAt ||= new Date().toISOString();
    return lastMessage;
  }

  const placeholder = createAssistantPlaceholder();
  messages.value.push(placeholder);
  return placeholder;
}

/**
 * 发起一轮新的流式请求。
 * @param sourceMessages - 消息历史
 * @param config - 服务配置
 * @param reuseLastAssistant - 是否复用末尾 assistant 消息承接续轮结果
 */
function streamMessages(sourceMessages: Message[], config: ServiceConfig, reuseLastAssistant = false): void {
  loading.value = true;
  lastServiceConfig = config;
  startStreamRound();
  prepareAssistantMessage(reuseLastAssistant);

  currentModelMessageCache = toCachedModelMessages(sourceMessages, currentModelMessageCache);

  const continuedMessages = [...currentModelMessageCache.modelMessages];

  const tools = config.toolSupport.supported && Boolean(props.tools?.length) ? toTransportTools(props.tools ?? []) : undefined;

  // eslint-disable-next-line no-use-before-define
  agent.stream({ messages: continuedMessages, modelId: config.modelId, providerId: config.providerId, tools });
}

/**
 * 提交用户消息。
 */
async function handleSubmit(): Promise<void> {
  if (loading.value) {
    return;
  }

  const config = await ensureServiceConfig();
  if (!config) {
    return;
  }

  const content = inputValue.value.trim();
  if (!content) {
    return;
  }

  const message: Message = { id: nanoid(), role: 'user', content, parts: [{ type: 'text', text: content }], createdAt: new Date().toISOString() };

  await props.onBeforeSend?.(message);

  messages.value.push(message);
  startToolLoopSession();
  streamMessages(messages.value, config);
  inputValue.value = '';
}

/**
 * 中止当前请求。
 */
function handleAbort(): void {
  resetToolLoopState();
  // eslint-disable-next-line no-use-before-define
  agent.abort();
}

/**
 * 将消息回填到输入框。
 * @param message - 待编辑的消息
 */
function handleEdit(message: Message): void {
  inputValue.value = message.content;
}

/**
 * 处理确认卡片操作。
 * @param confirmationId - 确认项 ID
 * @param action - 确认动作
 */
async function handleConfirmationAction(confirmationId: string, action: 'approve' | 'cancel'): Promise<void> {
  await props.onConfirmationAction?.(confirmationId, action);
}

/**
 * 对外暴露输入框聚焦能力，供宿主组件在切换或新建会话后恢复输入焦点。
 */
function focusInput(): void {
  promptEditorRef.value?.focus();
}

/**
 * 重新生成 assistant 消息。
 * @param message - 待重新生成的 assistant 消息
 */
async function handleRegenerate(message: Message): Promise<void> {
  if (loading.value) {
    return;
  }

  const config = await ensureServiceConfig();
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
 * useChat hook 配置。
 */
const { agent } = useChat({
  /**
   * 追加模型文本输出。
   * @param content - 增量文本
   */
  onText: async (content: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    appendTextPart(message, content);
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  /**
   * 追加模型思考输出。
   * @param thinking - 增量思考文本
   */
  onThinking: async (thinking: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    appendThinkingPart(message, thinking);
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  /**
   * 记录 usage 信息。
   * @param finishChunk - 完成数据块
   */
  onFinish: async ({ usage }: AIStreamFinishChunk): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    message.usage = usage;
  },
  onToolCall: handleToolCall,
  /**
   * 收口当前轮次，并在有工具结果时决定是否继续下一轮。
   */
  onComplete: async (): Promise<void> => {
    // 重置加载状态
    loading.value = false;
    // 保存当前轮次 ID 和工具调用追踪器，用于后续的异步一致性检查
    const roundId = currentToolRoundId;
    const tracker = currentToolCallTracker;

    // 等待所有工具调用完成
    await tracker.waitForAll();
    // 如果轮次 ID 不存在或不一致（说明已被新的轮次替换），则直接返回
    if (!roundId || roundId !== currentToolRoundId) {
      return;
    }

    // 如果工具循环被阻止（如用户中断或错误），清空已执行的工具调用 ID 集合并返回
    if (blockedToolLoopReason.value) {
      executedToolCallIds = new Set();
      return;
    }

    // 获取最后一条消息并标记为已完成
    const message = messages.value[messages.value.length - 1];
    if (message) {
      message.loading = false;
      message.finished = true;
    }

    // 如果最后一条消息是错误消息，直接返回
    if (message?.role === 'error') {
      return;
    }

    // 如果有待处理的工具结果且存在服务配置，则继续下一轮工具调用
    if (pendingToolResults.value.length && lastServiceConfig) {
      // 尝试推进到下一轮，检查是否超过轮次限制
      const roundGuardResult = currentToolLoopGuard.advanceRound();
      if (!roundGuardResult.allowed) {
        // 超过轮次限制，清空状态并停止工具循环
        executedToolCallIds = new Set();
        stopToolLoop(roundGuardResult.reason ?? '工具调用轮次超过限制，已停止自动续轮。');
        return;
      }

      // 清空待处理工具结果，结构化结果已经写入当前 assistant 消息片段。
      pendingToolResults.value = [];
      // 中间轮次的 assistant 消息也需要先持久化，避免工具调用和工具结果只存在于内存里。
      if (message) {
        emit('complete', message);
      }
      // 在下一个 tick 中发起下一轮流式请求
      nextTick(() => {
        streamMessages(messages.value, lastServiceConfig as ServiceConfig, true);
      });
      return;
    }

    // 没有待处理的工具结果，清空已执行的工具调用 ID 集合
    executedToolCallIds = new Set();

    // 触发完成事件
    if (message) {
      emit('complete', message);
    }
  },
  /**
   * 将服务异常显示到聊天记录中。
   * @param error - 错误对象
   */
  onError: (error: AIServiceError): void => {
    loading.value = false;
    resetToolLoopState();
    removeTrailingEmptyAssistantMessage();

    const message = createErrorMessage(error.message);
    messages.value.push(message);
    emit('complete', message);
  }
});

defineExpose({ focusInput });
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
