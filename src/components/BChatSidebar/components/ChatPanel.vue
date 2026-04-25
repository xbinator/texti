<template>
  <div class="chat-panel">
    <div class="chat-panel__main">
      <div ref="mainRef" class="chat-panel__container">
        <div class="chat-panel__placeholder"></div>
        <div class="chat-panel__content">
          <MessageBubble
            v-for="item in messages"
            :key="item.id"
            :message="item"
            @edit="handleEdit"
            @regenerate="handleRegenerate"
            @confirmation-action="handleConfirmationAction"
            @user-choice-submit="handleUserChoiceSubmit"
          />
        </div>
      </div>

      <!-- 滚动到底部按钮，用于滚动到最新消息 -->
      <div class="to-bottom" :class="{ 'to-bottom--visible': isBackBottom }" @click="() => scrollToBottom()">
        <Icon icon="lucide:arrow-down" />
        <div v-if="loading" class="to-bottom__loading"></div>
      </div>

      <!-- 消息为空时的提示 -->
      <div v-if="!messages.length" class="chat-panel__empty">
        <slot name="empty"></slot>
      </div>
    </div>

    <div class="chat-panel__input">
      <div class="chat-panel__input-container">
        <BPromptEditor
          ref="promptEditorRef"
          v-model:value="inputValue"
          :placeholder="placeholder"
          :max-height="200"
          variant="borderless"
          submit-on-enter
          @submit="handleSubmit"
        />

        <div class="chat-panel__input-buttons">
          <BButton v-if="loading" size="small" square icon="lucide:square" @click="handleAbort" />
          <BButton v-else size="small" square :disabled="!inputValue" icon="lucide:arrow-up" @click="handleSubmit" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ChatPanel.vue
 * @description 聊天面板组件，负责消息展示、输入、滚动和流式输出。
 */
import type { CachedModelMessagesResult } from '../utils/message';
import type { BChatProps as Props, Message, ServiceConfig, ToolLoopGuardConfig } from '../utils/types';
import type { AIServiceError, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
import type { AIUserChoiceAnswerData, ChatMessageConfirmationAction, ChatMessageFileReference } from 'types/chat';
import { nextTick, ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useEventListener } from '@vueuse/core';
import { message as aMessage } from 'ant-design-vue';
import { nanoid } from 'nanoid';
import { getModelToolSupport } from '@/ai/tools/policy';
import { executeToolCall, toTransportTools, type ExecutedToolCall } from '@/ai/tools/stream';
import BButton from '@/components/BButton/index.vue';
import { buildModelReadyMessages } from '@/components/BChatSidebar/utils/fileReferenceContext';
import { createToolCallTracker, type ToolCallTracker } from '@/components/BChatSidebar/utils/toolCallTracker';
import { createToolLoopGuard, type ToolLoopGuard } from '@/components/BChatSidebar/utils/toolLoopGuard';
import type { FileReferenceChip } from '@/components/BPromptEditor/hooks/useVariableEncoder';
import { useChat } from '@/hooks/useChat';
import { chatStorage } from '@/shared/storage';
import { useServiceModelStore } from '@/stores/service-model';
import { Modal } from '@/utils/modal';
import { getScrollTop, getScroller, setScrollTop } from '@/utils/scroll';
import { append, convert, create, is, userChoice } from '../utils/message';
import MessageBubble from './MessageBubble.vue';

defineOptions({ name: 'ChatPanel' });

const props = withDefaults(defineProps<Props>(), {
  placeholder: '输入消息...'
});

const emit = defineEmits<{
  (e: 'complete', message: Message): void;
  (e: 'busy-change', busy: boolean): void;
}>();

const inputValue = defineModel<string>('inputValue', { default: '' });
const messages = defineModel<Message[]>('messages', { default: () => [] });

const BACK_BOTTOM_HEIGHT = 300;
const HISTORY_LOAD_THRESHOLD = 160;

const mainRef = ref<HTMLElement>();
const scroller = ref<HTMLElement | Window>();
const isBackBottom = ref(false);

interface PromptEditorExpose {
  focus: () => void;
  captureCursorPosition: () => void;
  insertFileReference: (reference: FileReferenceChip) => void;
}

const loading = ref(false);
const pendingToolResults = ref<ExecutedToolCall[]>([]);
const blockedToolLoopReason = ref('');
const awaitingUserChoice = ref(false);
const draftReferences = ref<ChatMessageFileReference[]>([]);
const promptEditorRef = ref<PromptEditorExpose | null>(null);

const router = useRouter();
const serviceModelStore = useServiceModelStore();

const TOOL_LOOP_GUARD_CONFIG: ToolLoopGuardConfig = {
  maxRounds: 5,
  maxRepeatedCalls: 2
};

let lastServiceConfig: ServiceConfig | null = null;
let executedToolCallIds = new Set<string>();
let currentToolRoundId = 0;
let currentToolCallTracker: ToolCallTracker = createToolCallTracker();
let currentToolLoopGuard: ToolLoopGuard = createToolLoopGuard(TOOL_LOOP_GUARD_CONFIG);
let currentModelMessageCache: CachedModelMessagesResult | undefined;

watch(loading, (value) => {
  emit('busy-change', value);
});

function isNearHistoryEdge(target: HTMLElement | Window): boolean {
  if (!('scrollTop' in target)) {
    return false;
  }

  const scrollTop = getScrollTop(target);
  const reverseMinScrollTop = target.clientHeight - target.scrollHeight;

  if (scrollTop <= 0 && reverseMinScrollTop < 0) {
    return scrollTop - reverseMinScrollTop <= HISTORY_LOAD_THRESHOLD;
  }

  return scrollTop <= HISTORY_LOAD_THRESHOLD;
}

function handleScroll(): void {
  if (!scroller.value) return;

  const scrollTop = getScrollTop(scroller.value);
  isBackBottom.value = Math.abs(scrollTop) > BACK_BOTTOM_HEIGHT;

  if (isNearHistoryEdge(scroller.value)) {
    props.onLoadHistory?.();
  }
}

function scrollToBottom(options?: { behavior?: 'smooth' | 'auto' }): void {
  const behavior = options?.behavior || 'smooth';
  nextTick(() => scroller.value && setScrollTop(scroller.value, { top: 0, behavior }));
}

async function withScrollAnchor(callback: () => Promise<void> | void): Promise<void> {
  const target = scroller.value;
  if (!target || !('scrollTop' in target)) {
    await callback();
    return;
  }

  const previousScrollHeight = target.scrollHeight;
  const previousScrollTop = target.scrollTop;

  await callback();
  await nextTick();

  const heightDelta = target.scrollHeight - previousScrollHeight;
  target.scrollTop = previousScrollTop < 0 ? previousScrollTop - heightDelta : previousScrollTop + heightDelta;
}

useEventListener(() => scroller.value, 'scroll', handleScroll);

onMounted(() => {
  scroller.value = getScroller(mainRef.value);
});

function getActiveDraftReferences(content: string): ChatMessageFileReference[] {
  return draftReferences.value.filter((reference) => content.includes(reference.token));
}

async function loadReferenceSnapshotMap(sourceMessages: Message[]): Promise<Map<string, import('types/chat').ChatReferenceSnapshot>> {
  const snapshotIds = Array.from(
    new Set(
      sourceMessages.flatMap((message) => message.references?.map((reference) => reference.snapshotId).filter((snapshotId) => snapshotId.length > 0) ?? [])
    )
  );

  if (!snapshotIds.length) {
    return new Map();
  }

  const snapshots = await chatStorage.getReferenceSnapshots(snapshotIds);
  return new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
}

function startStreamRound(): void {
  currentToolRoundId += 1;
  currentToolCallTracker = createToolCallTracker();
}

function resetToolLoopState(): void {
  currentToolRoundId = 0;
  currentToolCallTracker = createToolCallTracker();
  blockedToolLoopReason.value = '';
  executedToolCallIds = new Set();
  pendingToolResults.value = [];
  awaitingUserChoice.value = false;
  lastServiceConfig = null;
}

function startToolLoopSession(): void {
  resetToolLoopState();
  currentToolLoopGuard = createToolLoopGuard(TOOL_LOOP_GUARD_CONFIG);
}

function removeTrailingEmptyAssistantMessage(): void {
  const lastMessage = messages.value[messages.value.length - 1];
  if (is.removableAssistantPlaceholder(lastMessage)) {
    messages.value.pop();
  }
}

function appendAssistantToolCall(chunk: AIStreamToolCallChunk): void {
  const message = messages.value[messages.value.length - 1];
  if (message?.role !== 'assistant') {
    return;
  }

  append.toolCallPart(message, chunk.toolCallId, chunk.toolName, chunk.input);
}

function appendAssistantToolResult(result: ExecutedToolCall): void {
  const message = messages.value[messages.value.length - 1];
  if (message?.role !== 'assistant') {
    return;
  }

  append.toolResultPart(message, result.toolCallId, result.toolName, result.result);
}

function stopToolLoop(reason: string): void {
  blockedToolLoopReason.value = reason;
  pendingToolResults.value = [];
  removeTrailingEmptyAssistantMessage();

  const message = create.errorMessage(reason);
  messages.value.push(message);
  emit('complete', message);
}

async function executeTrackedToolCall(chunk: AIStreamToolCallChunk, roundId: number): Promise<void> {
  const result = await executeToolCall(chunk, props.tools ?? [], props.getToolContext?.());
  if (roundId !== currentToolRoundId) {
    return;
  }

  appendAssistantToolResult(result);

  if (result.result.status === 'awaiting_user_input') {
    awaitingUserChoice.value = true;
    return;
  }

  pendingToolResults.value.push(result);
}

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

async function resolveServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await serviceModelStore.getAvailableServiceConfig('chat');
  if (!config?.providerId || !config?.modelId) {
    return undefined;
  }

  const toolSupport = await getModelToolSupport(config.providerId, config.modelId);
  return { providerId: config.providerId, modelId: config.modelId, toolSupport };
}

async function handleMissingServiceConfig(): Promise<void> {
  const [, confirmed] = await Modal.confirm('提示', '当前未配置可用的大模型服务', { confirmText: '去配置', cancelText: '取消' });

  if (confirmed) {
    router.push('/settings/service-model');
  }
}

async function ensureServiceConfig(): Promise<ServiceConfig | undefined> {
  const config = await resolveServiceConfig();
  if (config) {
    return config;
  }

  await handleMissingServiceConfig();
  return undefined;
}

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

function prepareAssistantMessage(reuseLastAssistant: boolean): Message {
  const lastMessage = messages.value[messages.value.length - 1];
  if (reuseLastAssistant && lastMessage?.role === 'assistant') {
    lastMessage.loading = true;
    lastMessage.finished = false;
    lastMessage.createdAt ||= new Date().toISOString();
    return lastMessage;
  }

  const placeholder = create.assistantPlaceholder();
  messages.value.push(placeholder);
  return placeholder;
}

async function streamMessages(sourceMessages: Message[], config: ServiceConfig, reuseLastAssistant = false): Promise<void> {
  loading.value = true;
  lastServiceConfig = config;
  startStreamRound();
  prepareAssistantMessage(reuseLastAssistant);

  const snapshotsById = await loadReferenceSnapshotMap(sourceMessages);
  currentModelMessageCache = convert.toCachedModelMessages(buildModelReadyMessages(sourceMessages, snapshotsById), currentModelMessageCache);

  const continuedMessages = [...currentModelMessageCache.modelMessages];

  const tools = config.toolSupport.supported && Boolean(props.tools?.length) ? toTransportTools(props.tools ?? []) : undefined;

  // eslint-disable-next-line no-use-before-define
  agent.stream({ messages: continuedMessages, modelId: config.modelId, providerId: config.providerId, tools });
}

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

  const activeReferences = getActiveDraftReferences(content);
  const message: Message = {
    id: nanoid(),
    role: 'user',
    content,
    parts: [{ type: 'text', text: content }],
    references: activeReferences.length ? activeReferences : undefined,
    createdAt: new Date().toISOString()
  };

  await props.onBeforeSend?.(message);

  messages.value.push(message);
  startToolLoopSession();
  streamMessages(messages.value, config);
  inputValue.value = '';
  draftReferences.value = [];
}

function handleAbort(): void {
  resetToolLoopState();
  // eslint-disable-next-line no-use-before-define
  agent.abort();
}

function handleEdit(message: Message): void {
  inputValue.value = message.content;
  draftReferences.value = [...(message.references ?? [])];
}

async function handleConfirmationAction(confirmationId: string, action: ChatMessageConfirmationAction): Promise<void> {
  await props.onConfirmationAction?.(confirmationId, action);
}

async function handleUserChoiceSubmit(answer: AIUserChoiceAnswerData): Promise<void> {
  if (loading.value) {
    return;
  }

  const submitted = userChoice.submitAnswer(messages.value, answer);
  if (!submitted) {
    return;
  }

  const config = lastServiceConfig ?? (await ensureServiceConfig());
  if (!config) {
    return;
  }

  awaitingUserChoice.value = false;
  pendingToolResults.value = [];
  nextTick(() => {
    streamMessages(messages.value, config, true);
  });
}

function focusInput(): void {
  promptEditorRef.value?.focus();
}

function captureInputCursor(): void {
  promptEditorRef.value?.captureCursorPosition();
}

function insertFileReference(reference: FileReferenceChip): void {
  const token = `{{file-ref:${reference.referenceId}}}`;
  draftReferences.value = [
    ...draftReferences.value.filter((item) => item.id !== reference.referenceId),
    {
      id: reference.referenceId,
      token,
      documentId: reference.documentId,
      fileName: reference.fileName,
      line: String(reference.line),
      path: reference.filePath,
      snapshotId: ''
    }
  ];
  promptEditorRef.value?.insertFileReference(reference);
}

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

const { agent } = useChat({
  onText: async (content: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    append.textPart(message, content);
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  onThinking: async (thinking: string): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    append.thinkingPart(message, thinking);
    message.loading = false;
    message.createdAt ||= new Date().toISOString();
  },
  onFinish: async ({ usage }: AIStreamFinishChunk): Promise<void> => {
    const message = messages.value[messages.value.length - 1];
    message.usage = usage;
  },
  onToolCall: handleToolCall,
  onComplete: async (): Promise<void> => {
    loading.value = false;
    const roundId = currentToolRoundId;
    const tracker = currentToolCallTracker;

    await tracker.waitForAll();
    if (!roundId || roundId !== currentToolRoundId) {
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

    if (awaitingUserChoice.value || userChoice.findPending(messages.value)) {
      if (message) {
        emit('complete', message);
      }
      return;
    }

    if (pendingToolResults.value.length && lastServiceConfig) {
      const roundGuardResult = currentToolLoopGuard.advanceRound();
      if (!roundGuardResult.allowed) {
        executedToolCallIds = new Set();
        stopToolLoop(roundGuardResult.reason ?? '工具调用轮次超过限制，已停止自动续轮。');
        return;
      }

      pendingToolResults.value = [];
      if (message) {
        emit('complete', message);
      }
      nextTick(() => {
        streamMessages(messages.value, lastServiceConfig as ServiceConfig, true);
      });
      return;
    }

    executedToolCallIds = new Set();

    if (message) {
      emit('complete', message);
    }
  },
  onError: (error: AIServiceError): void => {
    loading.value = false;
    resetToolLoopState();
    removeTrailingEmptyAssistantMessage();

    const message = create.errorMessage(error.message);
    messages.value.push(message);
    emit('complete', message);
  }
});

defineExpose({ focusInput, captureInputCursor, insertFileReference, scrollToBottom, withScrollAnchor });
</script>

<style scoped lang="less">
@import url('@/assets/styles/scrollbar.less');

.chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-panel__main {
  position: relative;
  flex: 1;
  height: 0;
}

.chat-panel__container {
  display: flex;
  flex-direction: column-reverse;
  height: 100%;
  padding: var(--b-chat-padding, 16px);
  overflow-y: auto;
  scrollbar-gutter: stable;

  .scrollbar-style();
}

.chat-panel__content {
  width: 100%;
  max-width: var(--b-chat-max-width, 800px);
  margin: 0 auto;
}

.chat-panel__placeholder {
  flex: 1;
  pointer-events: none;
}

.chat-panel__empty {
  position: absolute;
  top: 50%;
  left: 50%;
  font-size: 14px;
  white-space: nowrap;
  transform: translate(-50%, -50%);
}

.chat-panel__input {
  padding: 12px;
  border-top: 1px solid var(--border-primary);
}

.chat-panel__input-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  padding: 12px 0 12px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-primary);
  border-radius: 6px;

  .b-prompt-editor {
    padding: 0 12px 0 0;
    background-color: transparent;
    border: none;
    border-radius: 0;
  }
}

.chat-panel__input-buttons {
  padding: 0 12px 0 0;
}

.to-bottom {
  position: absolute;
  bottom: 20px;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  font-size: 18px;
  color: var(--color-primary);
  pointer-events: none;
  cursor: pointer;
  user-select: none;
  background: var(--bg-primary);
  border-radius: 50%;
  box-shadow: 0 0 4px 0 rgb(0 0 0 / 2%), 0 6px 10px 0 rgb(47 53 64 / 10%);
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 0.2s ease;
}

.to-bottom--visible {
  pointer-events: auto;
  opacity: 1;
}

.to-bottom__loading {
  position: absolute;
  width: 44px;
  height: 44px;
  border: 2px solid var(--border-secondary);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: to-bottom-loading 1s linear infinite;
}

@keyframes to-bottom-loading {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
