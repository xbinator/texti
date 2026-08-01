<template>
  <div :class="name">
    <BBubble :show-container="showContainer" :placement="bubblePlacement" :loading="message.loading" :size="bubbleSize">
      <template v-if="showHeader" #header>
        <div :class="bem('header')">
          <div v-if="imageFiles.length" :class="bem('images')">
            <img
              v-for="(file, index) in imageFiles"
              :key="file.id"
              :src="file.url || file.path"
              :alt="file.name"
              :class="bem('image', { single: isSingleImage })"
              @click="handleImageClick(index)"
            />
          </div>
          <div v-if="otherFiles.length" :class="bem('files')">
            <div v-for="file in otherFiles" :key="file.id" :class="bem('file')">
              <BIcon icon="lucide:file" :size="14" />
              <span :class="bem('file-name')">{{ file.name }}</span>
            </div>
          </div>
        </div>
      </template>

      <div :class="bem('parts')">
        <BubblePartStatus v-if="showStatusPart" />

        <BubblePartUserInput v-else-if="isUserMessage" :part="userInputPart" />

        <template v-else>
          <template v-for="item in renderItems" :key="item.key">
            <BubblePartText v-if="item.kind === 'text'" :part="item.part" />

            <BubblePartThinking v-else-if="item.kind === 'thinking'" :part="item.part" />

            <BubblePartAgent v-else-if="item.kind === 'agent-task'" :session-id="sessionId" :assistant-message-id="message.id" :part="item.part" />

            <QuestionCard v-else-if="item.kind === 'question'" :question="item.question" :disabled="disabled" :submit-action="submitAction" />

            <BubblePartTool v-else-if="item.kind === 'tool'" :part="item.part" />

            <BubblePartWidget v-else-if="item.kind === 'widget'" :message-id="message.id" :part="item.part" :submit-action="submitAction" />

            <BubblePartStatus v-else-if="item.kind === 'status'" :part="item.part" />
          </template>
        </template>
      </div>
    </BBubble>

    <!-- 助手消息工具栏 -->
    <div v-if="showAssistantToolbar" :class="bem('toolbar')">
      <BButton type="text" size="small" square icon="lucide:git-branch" :disabled="loading" @click="handleBranchClick" />
      <BButton square type="text" size="small" icon="lucide:refresh-cw" :disabled="loading" @click="handleRegenerateClick" />
      <BButton type="text" size="small" square icon="lucide:copy" @click="handleCopy(message)" />
    </div>

    <!-- 用户消息底部：时间戳 + 回退按钮 + 复制按钮（hover 可见） -->
    <div v-if="isUserMessage && message.finished" :class="bem('toolbar', { right: isUserMessage })">
      <span :class="bem('time')">{{ formatMessageTime(message.createdAt) }}</span>
      <BButton v-if="showRollback" type="text" size="small" square icon="lucide:undo-2" @click="handleRollbackClick" />
      <BButton v-if="showContainer" type="text" size="small" square icon="lucide:copy" @click="handleCopy(message)" />
    </div>

    <!-- 回退二次确认条（inline） -->
    <div v-if="confirmRollback" :class="bem('rollback-confirm')">
      <div :class="bem('rollback-confirm-title')">确定要回退至此回答重新发起？</div>
      <span :class="bem('rollback-confirm-text')">回退将删除该消息之后的所有内容，不可撤销。</span>
      <div :class="bem('rollback-confirm-actions')">
        <BButton type="text" size="mini" @click="handleRollbackCancel">取消</BButton>
        <BButton type="primary" size="mini" @click="handleRollbackConfirm">确认</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file MessageBubble.vue
 * @description 聊天气泡组件，按结构化消息片段渲染文本、思考、工具调用和工具结果。
 */
import type { SubmitAction } from '../utils/submitAction';
import type { Message } from '../utils/types';
import type { AIAwaitingUserChoiceQuestion } from 'types/ai';
import type {
  ChatMessageCompactionPart,
  ChatMessageErrorPart,
  ChatMessagePart,
  ChatMessageTextPart,
  ChatMessageThinkingPart,
  ChatMessageToolPart
} from 'types/chat';
import { computed, ref } from 'vue';
import BBubble from '@/components/BBubble/index.vue';
import { useClipboard } from '@/hooks/useClipboard';
import type { ImagePreviewItem } from '@/hooks/useImagePreview';
import { useImagePreview } from '@/hooks/useImagePreview';
import { createNamespace } from '@/utils/namespace';
import { extractLastTextPart, isAwaitingUserChoiceResult, isWidgetToolPart, type WidgetToolPart } from '../utils/messageHelper';
import { formatMessageTime } from '../utils/timeFormat';
import BubblePartAgent from './MessageBubble/BubblePartAgent/index.vue';
import BubblePartStatus from './MessageBubble/BubblePartStatus/index.vue';
import BubblePartText from './MessageBubble/BubblePartText/index.vue';
import BubblePartThinking from './MessageBubble/BubblePartThinking/index.vue';
import BubblePartTool from './MessageBubble/BubblePartTool/index.vue';
import BubblePartUserInput from './MessageBubble/BubblePartUserInput/index.vue';
import BubblePartWidget from './MessageBubble/BubblePartWidget/index.vue';
import QuestionCard from './QuestionCard.vue';

defineOptions({ name: 'MessageBubble' });

const { clipboard } = useClipboard();
const { previewImage } = useImagePreview();

const [name, bem] = createNamespace('', 'message-bubble');

const props = defineProps<{
  /** 当前权威 Session 身份。 */
  sessionId: string | null;
  message: Message;
  /** 会话已结束时禁用交互（如 QuestionCard） */
  disabled?: boolean;
  /** 是否禁用助手消息历史操作（分支、重新生成）。 */
  loading?: boolean;
  /** 判断消息是否可回退 */
  canRollback?: (message: Message) => boolean;
  /** 可 await 的统一提交函数，用于让运行态组件等待宿主提交完成。 */
  submitAction?: (action: SubmitAction) => Promise<void> | void;
}>();

const emit = defineEmits<{
  (e: 'edit', message: Message): void;
  (e: 'branch', message: Message): void;
  (e: 'regenerate', message: Message): void;
  (e: 'rollback', message: Message): void;
}>();

/** 正文渲染条目。 */
type MessageBubbleRenderItem =
  | { key: string; kind: 'text'; part: ChatMessageTextPart | ChatMessageErrorPart }
  | { key: string; kind: 'thinking'; part: ChatMessageThinkingPart }
  | { key: string; kind: 'agent-task'; part: ChatMessageToolPart }
  | { key: string; kind: 'question'; question: AIAwaitingUserChoiceQuestion }
  | { key: string; kind: 'tool'; part: ChatMessageToolPart }
  | { key: string; kind: 'widget'; part: WidgetToolPart }
  | { key: string; kind: 'status'; part: ChatMessageCompactionPart };

/**
 * 判断消息片段是否为文本或错误片段。
 * @param part - 消息片段
 * @returns 是否为文本或错误片段
 */
function isTextLikePart(part: ChatMessagePart): part is ChatMessageTextPart | ChatMessageErrorPart {
  return part.type === 'text' || part.type === 'error';
}

/** 图片文件列表（有 url 或 path 的图片类型文件） */
const imageFiles = computed(() => props.message.files?.filter((file) => file.type === 'image' && (file.url || file.path)) ?? []);
/** 是否为单图模式 */
const isSingleImage = computed(() => imageFiles.value.length === 1);
/** 非图片文件列表（非图片类型或无 url/path 的文件） */
const otherFiles = computed(() => props.message.files?.filter((file) => file.type !== 'image' || (!file.url && !file.path)) ?? []);
/** 是否为用户消息 */
const isUserMessage = computed(() => props.message.role === 'user');
/** 是否为助手消息 */
const isAssistantMessage = computed(() => props.message.role === 'assistant');
/** 是否为中断消息 */
const isInterruptMessage = computed(() => props.message.role === 'interrupt');
/** 气泡位置：助手和错误消息靠左，用户消息靠右 */
const bubblePlacement = computed(() => (isUserMessage.value ? 'right' : 'left'));
/** 气泡尺寸。 */
const bubbleSize = computed(() => (isUserMessage.value ? 'auto' : 'fill'));
/** 是否显示头部（用户消息且有文件时显示） */
const showHeader = computed(() => isUserMessage.value && (imageFiles.value.length || otherFiles.value.length));
/** 是否显示气泡容器（用户消息且有文件时显示） */
const showContainer = computed(() => isInterruptMessage.value || !!props.message.parts?.length);
/** 是否显示状态正文。 */
const showStatusPart = computed(() => isInterruptMessage.value);
/** 是否包含可复制、分支或重新生成的助手正文。 */
const hasAssistantContent = computed<boolean>((): boolean => {
  return Boolean(
    props.message.content.trim() ||
      props.message.thinking?.trim() ||
      props.message.parts.some((part: ChatMessagePart): boolean => part.type !== 'compaction' && part.type !== 'confirmation')
  );
});
/** 是否显示助手工具栏 */
const showAssistantToolbar = computed(() => props.message.finished === true && isAssistantMessage.value && hasAssistantContent.value);

/** 是否显示回退按钮（仅在后面还有消息时显示） */
const showRollback = computed(() => isUserMessage.value && props.message.finished === true && props.canRollback?.(props.message));
/** 用户输入按原始 content 展示，结构化 parts 仅用于 Runtime 与草稿恢复。 */
const userInputPart = computed<ChatMessageTextPart>(() => ({ id: `${props.message.id}:user-input`, type: 'text', text: props.message.content }));
/** 图片预览条目列表 */
const imagePreviewItems = computed<ImagePreviewItem[]>(() =>
  imageFiles.value.map((file) => ({
    src: file.url || file.path || '',
    name: file.name,
    mimeType: file.mimeType
  }))
);

/** 正文渲染条目。 */
const renderItems = computed<MessageBubbleRenderItem[]>(() =>
  props.message.parts.flatMap((part, index): MessageBubbleRenderItem[] => {
    const key = part.id ?? `${part.type}-${index}`;
    if (part.type === 'confirmation') return [];
    if (isTextLikePart(part)) return [{ key, kind: 'text', part }];
    if (part.type === 'thinking') return [{ key, kind: 'thinking', part }];
    if (part.type === 'compaction') return [{ key, kind: 'status', part }];
    if (part.type === 'tool' && part.toolName === 'delegate_task') return [{ key, kind: 'agent-task', part }];
    if (!props.disabled && isAwaitingUserChoiceResult(part)) return [{ key, kind: 'question', question: part.result.data }];
    if (isWidgetToolPart(part)) return [{ key: `widget:${part.toolCallId}`, kind: 'widget', part }];
    if (part.type === 'tool') return [{ key, kind: 'tool', part }];
    return [];
  })
);

/**
 * 打开图片预览。
 * @param index - 图片索引
 */
async function handleImageClick(index: number): Promise<void> {
  await previewImage({
    images: imagePreviewItems.value,
    startPosition: index
  });
}

/**
 * 复制消息内容
 * @param message - 待复制的聊天消息
 */
function handleCopy(message: Message): void {
  const content = extractLastTextPart(message);
  clipboard(content, { successMessage: '已复制到剪贴板' });
}

/**
 * 触发助手消息分支。
 */
function handleBranchClick(): void {
  if (props.loading) return;
  emit('branch', props.message);
}

/**
 * 触发助手消息重新生成。
 */
function handleRegenerateClick(): void {
  if (props.loading) return;
  emit('regenerate', props.message);
}

/** 是否处于回退二次确认态（inline 确认条） */
const confirmRollback = ref(false);

/**
 * 点击回退按钮：不直接 emit，而是切到确认态，展示 inline 确认条。
 */
function handleRollbackClick(): void {
  confirmRollback.value = true;
}

/**
 * 确认回退：向上 emit rollback 并收起确认条。
 */
function handleRollbackConfirm(): void {
  confirmRollback.value = false;
  emit('rollback', props.message);
}

/**
 * 取消回退：仅收起确认条。
 */
function handleRollbackCancel(): void {
  confirmRollback.value = false;
}
</script>

<style scoped lang="less">
.message-bubble {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
  user-select: text;

  &:hover {
    .message-bubble__toolbar {
      opacity: 1;
    }
  }
}

.message-bubble:last-child {
  margin-bottom: 0;
}

.message-bubble__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-bubble__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.message-bubble__image {
  overflow: hidden;
  cursor: pointer;
  object-fit: cover;
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);

  &.message-bubble__image--single {
    max-width: 200px;
    max-height: 200px;
    object-fit: contain;
  }

  &:not(.message-bubble__image--single) {
    width: 60px;
    height: 60px;
  }
}

.message-bubble__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.message-bubble__file {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  max-width: 220px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--radius-full);
}

.message-bubble__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-bubble__parts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-bubble__toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;

  &.message-bubble__toolbar--right {
    justify-content: flex-end;
    opacity: 0;
    transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
  }
}

.message-bubble__time {
  font-size: 11px;
  color: var(--text-primary);
  user-select: none;
}

.message-bubble__rollback-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 10px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: var(--surface-radius);
  box-shadow: 0 0 0 var(--surface-border-width) var(--border-primary);
}

.message-bubble__rollback-confirm-title {
  font-weight: 600;
  color: var(--text-primary);
}

.message-bubble__rollback-confirm-text {
  flex: 1;
  min-width: 0;
}

.message-bubble__rollback-confirm-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
  justify-content: flex-end;
}
</style>
