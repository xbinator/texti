<!--
  @file index.vue
  @description 消息内容节点渲染组件，支持 Markdown、纯文本、流式光标与 Markdown 图片预览。
-->
<template>
  <div ref="rootRef" :class="bem({ streaming: props.loading, done: !props.loading })" :style="rootStyle">
    <div :class="bem('placeholder')" aria-hidden="true"></div>

    <div :class="[bem('container'), props.type === 'text' ? bem('text') : bem('markdown')]">
      <MessageNodes :blocks="parsedResult.blocks" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BMessageProps as Props, MessageNodeRenderContext, MessageNodeRenderMode, ParseMessageNodesResult } from './types';
import { computed, onMounted, onScopeDispose, provide, ref, shallowRef, watch } from 'vue';
import { useImagePreview } from '@/hooks/useImagePreview';
import { useNavigate } from '@/hooks/useNavigate';
import { asyncTo } from '@/utils/asyncTo';
import { addCssUnit } from '@/utils/css';
import { createNamespace } from '@/utils/namespace';
import MessageNodes from './components/MessageNodes';
import { MESSAGE_NODE_RENDER_CONTEXT_KEY } from './types';
import { parseMessageNodes } from './utils/messageParser';
import { getMessageByteLength, inspectMessageSafety, MESSAGE_WORKER_THRESHOLD_BYTES } from './utils/messageSafety';
import { messageRenderScheduler } from './utils/messageScheduler';
import { cancelMessageParse, parseMessageInWorker } from './utils/messageWorker';

defineOptions({ name: 'BMessage' });

const [, bem] = createNamespace('message');

const navigate = useNavigate();
const { previewImage } = useImagePreview();

const props = withDefaults(defineProps<Props>(), {
  type: 'markdown',
  loading: false,
  content: '',
  height: undefined,
  maxHeight: undefined
});

const rootStyle = computed(() => {
  return {
    height: addCssUnit(props.height),
    maxHeight: addCssUnit(props.maxHeight)
  };
});

/** 节点解析结果，使用 shallowRef 避免深度追踪整棵消息树 */
const parsedResult = shallowRef<ParseMessageNodesResult>({
  blocks: [],
  images: []
});

/**
 * BMessage 解析快照。
 */
interface MessageParseSnapshot {
  /** 原始内容。 */
  content: string;
  /** 渲染模式。 */
  mode: MessageNodeRenderMode;
  /** 是否流式。 */
  loading: boolean;
}

/**
 * 可见区域边界。
 */
interface ViewportBounds {
  /** 顶部坐标。 */
  top: number;
  /** 底部坐标。 */
  bottom: number;
  /** 区域高度。 */
  height: number;
}

const rootRef = ref<HTMLElement | null>(null);
const renderToken = Symbol('b-message-render');
let latestSnapshot: MessageParseSnapshot | null = null;
let committedSnapshot: MessageParseSnapshot | null = null;
let visibilityObserver: IntersectionObserver | null = null;
let activeWorkerRequestId: number | null = null;

/**
 * 创建不依赖 Markdown 解析器的最终纯文本兜底节点。
 * @param snapshot - 当前消息快照
 * @returns 始终展示当前完整正文的节点
 */
function createTextFallback(snapshot: MessageParseSnapshot): ParseMessageNodesResult {
  if (!snapshot.content) {
    return snapshot.loading ? { blocks: [{ type: 'cursor', id: 'block-tail-0', raw: '' }], images: [] } : { blocks: [], images: [] };
  }
  return {
    blocks: [
      {
        type: 'paragraph',
        id: snapshot.loading ? 'block-tail-0' : 'block-fallback-0',
        raw: snapshot.content,
        children: [{ type: 'text', text: snapshot.content }, ...(snapshot.loading ? [{ type: 'cursor' as const }] : [])]
      }
    ],
    images: []
  };
}

/**
 * 从 asyncTo 包装错误中读取原始错误类型，不访问错误正文。
 * @param error - 归一化或原始异常
 * @returns 稳定错误类型
 */
function getParseErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  try {
    return error.cause instanceof Error ? error.cause.name : error.name;
  } catch {
    return error.name;
  }
}

/**
 * 记录不含正文的解析失败诊断。
 * @param snapshot - 失败解析快照
 * @param path - 主线程或 Worker 路径
 * @param error - 原始错误
 */
function logParseFailure(snapshot: MessageParseSnapshot, path: 'main' | 'worker', error: unknown): void {
  console.error('[BMessage] message parse failed', {
    messageId: props.messageId ?? 'unknown',
    length: snapshot.content.length,
    mode: snapshot.mode,
    path,
    errorType: getParseErrorType(error)
  });
}

/**
 * 使用当前正文替换旧结果，确保异常不会表现为内容停止更新。
 * @param snapshot - 当前消息快照
 * @param path - 失败解析路径
 * @param error - 原始错误
 */
function commitTextFallback(snapshot: MessageParseSnapshot, path: 'main' | 'worker', error: unknown): void {
  if (snapshot !== latestSnapshot) return;
  logParseFailure(snapshot, path, error);
  try {
    parsedResult.value = parseMessageNodes({ content: snapshot.content, mode: 'text', loading: snapshot.loading });
  } catch {
    parsedResult.value = createTextFallback(snapshot);
  }
  committedSnapshot = snapshot;
}

/** 取消当前组件仍在等待的 Worker 结果。 */
function cancelActiveParse(): void {
  if (activeWorkerRequestId === null) return;
  cancelMessageParse(activeWorkerRequestId);
  activeWorkerRequestId = null;
}

/**
 * 等待大消息 Worker 解析，并只提交仍为最新的快照。
 * @param snapshot - Worker 解析快照
 * @param mode - 安全扫描后的实际模式
 */
async function parseWorkerSnapshot(snapshot: MessageParseSnapshot, mode: MessageNodeRenderMode): Promise<void> {
  const request = parseMessageInWorker({ content: snapshot.content, mode, loading: snapshot.loading });
  activeWorkerRequestId = request.requestId;
  const [error, result] = await asyncTo(request.result);
  if (activeWorkerRequestId === request.requestId) activeWorkerRequestId = null;
  if (snapshot !== latestSnapshot) return;
  if (error !== undefined || !result) {
    commitTextFallback(snapshot, 'worker', error);
    return;
  }
  parsedResult.value = result;
  committedSnapshot = snapshot;
}

/**
 * 查找最近的垂直滚动容器。
 * @param element - BMessage 根节点
 * @returns 最近滚动容器
 */
function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|overlay|scroll)/.test(`${style.overflow} ${style.overflowY}`)) return parent;
    parent = parent.parentElement;
  }

  return null;
}

/**
 * 获取 BMessage 所在滚动视口边界。
 * @param element - BMessage 根节点
 * @returns 视口边界
 */
function getViewportBounds(element: HTMLElement): ViewportBounds {
  const scrollContainer = findScrollContainer(element);
  if (scrollContainer) {
    const rect = scrollContainer.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height || scrollContainer.clientHeight };
  }

  const height = window.innerHeight || document.documentElement.clientHeight;
  return { top: 0, bottom: height, height };
}

/**
 * 判断根节点是否处于最近滚动视口的预加载范围内。
 * @returns 是否应高优先级渲染
 */
function isNearViewport(): boolean {
  const element = rootRef.value;
  if (!element || typeof window === 'undefined') return false;

  const rect = element.getBoundingClientRect();
  const viewport = getViewportBounds(element);
  const preloadDistance = viewport.height || window.innerHeight;
  return rect.bottom >= viewport.top - preloadDistance && rect.top <= viewport.bottom + preloadDistance;
}

/**
 * 解析最新快照并提交结果。
 * @param snapshot - 入队时的内容快照
 */
function parseSnapshot(snapshot: MessageParseSnapshot): void {
  if (snapshot !== latestSnapshot) return;

  const safety = snapshot.mode === 'markdown' ? inspectMessageSafety(snapshot.content) : { mode: snapshot.mode };
  if (safety.mode === 'markdown' && getMessageByteLength(snapshot.content) >= MESSAGE_WORKER_THRESHOLD_BYTES) {
    // Worker 完成前先提交当前纯文本，保证大消息持续增长时不会停留在旧渲染结果。
    parsedResult.value = createTextFallback(snapshot);
    committedSnapshot = snapshot;
    parseWorkerSnapshot(snapshot, safety.mode);
    return;
  }

  try {
    parsedResult.value = parseMessageNodes({
      content: snapshot.content,
      mode: safety.mode,
      loading: snapshot.loading
    });
  } catch (error) {
    commitTextFallback(snapshot, 'main', error);
    return;
  }

  committedSnapshot = snapshot;
}

/**
 * 将尚未解析的最新快照提升为高优先级。
 */
function promoteScheduledRender(): void {
  const snapshot = latestSnapshot;
  if (!snapshot || snapshot === committedSnapshot) return;

  messageRenderScheduler.enqueue({
    token: renderToken,
    priority: 'high',
    run: (): void => parseSnapshot(snapshot)
  });
}

/**
 * 监听 BMessage 进入最近滚动容器的预加载范围。
 */
function setupVisibilityObserver(): void {
  const element = rootRef.value;
  if (!element || typeof IntersectionObserver === 'undefined') return;

  const scrollContainer = findScrollContainer(element);
  const viewport = getViewportBounds(element);
  visibilityObserver = new IntersectionObserver(
    (entries: IntersectionObserverEntry[]): void => {
      if (entries.some((entry: IntersectionObserverEntry): boolean => entry.isIntersecting)) promoteScheduledRender();
    },
    {
      root: scrollContainer,
      rootMargin: `${viewport.height || window.innerHeight}px 0px`
    }
  );
  visibilityObserver.observe(element);
}

/**
 * 为当前 Props 创建或替换调度任务。
 */
function scheduleRender(): void {
  cancelActiveParse();
  const snapshot: MessageParseSnapshot = {
    content: props.content,
    mode: props.type,
    loading: props.loading
  };

  latestSnapshot = snapshot;
  messageRenderScheduler.enqueue({
    token: renderToken,
    priority: props.loading || isNearViewport() ? 'high' : 'normal',
    run: (): void => parseSnapshot(snapshot)
  });
}

/**
 * 打开指定索引的图片预览。
 * @param index - 图片索引
 */
async function previewImageAt(index: number): Promise<void> {
  const { images } = parsedResult.value;

  if (!images.length) return;

  await previewImage({
    images,
    startPosition: index,
    showCarousel: images.length > 1
  });
}

const renderContext: MessageNodeRenderContext = {
  get images() {
    return parsedResult.value.images;
  },
  previewImageAt,
  navigateLink: navigate.onLink
};

provide(MESSAGE_NODE_RENDER_CONTEXT_KEY, renderContext);

watch(() => [props.content, props.loading, props.type] as const, scheduleRender, { immediate: true });

onMounted((): void => {
  scheduleRender();
  setupVisibilityObserver();
});

onScopeDispose(() => {
  cancelActiveParse();
  latestSnapshot = null;
  committedSnapshot = null;
  visibilityObserver?.disconnect();
  visibilityObserver = null;
  messageRenderScheduler.cancel(renderToken);
});
</script>

<style lang="less">
@import url('@/assets/styles/markdown.less');

.b-message {
  position: relative;
  display: flex;
  flex-direction: column-reverse;
  overflow-y: auto;
  line-height: 1.7;
  overflow-wrap: break-word;
  .scrollbar-base();
}

.b-message__placeholder {
  flex: 1 0 auto;
  pointer-events: none;
}

.b-message__container {
  width: 100%;
}

.b-message__text {
  white-space: pre-wrap;
}

.b-message__markdown {
  .markdown-base();

  img {
    cursor: zoom-in;
    user-select: none;
    -webkit-user-drag: none;
  }
}

.b-message__table-scroller {
  position: relative;
  min-width: 0;
  max-width: 100%;
  margin: 0.6em 0;
  container-type: inline-size;
  overflow-x: auto;
  .scrollbar-base();
}

.b-message__table-scroller > table {
  width: max-content;
  min-width: 100%;
  margin: 0;
}

.b-message__table-toolbar {
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  width: 100%;
  height: 0;
  pointer-events: none;
}

.b-message__table-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin: 4px 8px 0 0;
  color: var(--text-secondary);
  pointer-events: auto;
  cursor: pointer;
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-secondary);
  border-radius: var(--control-radius);
  opacity: 0;
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-message__table-copy:hover,
.b-message__table-copy:focus-visible {
  color: var(--color-primary);
  background: var(--bg-secondary);
  border-color: var(--border-primary);
}

.b-message__table-scroller:hover .b-message__table-copy,
.b-message__table-scroller:focus-within .b-message__table-copy {
  opacity: 1;
}

.b-message__table-cell-content {
  max-width: 60cqw;
  overflow-wrap: anywhere;
}

.b-message__cursor {
  display: inline-block;
  width: 1px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--color-primary);
  border-radius: 1px;
  animation: b-stream-cursor-blink 0.8s steps(1) infinite;
}

.b-message__component-placeholder {
  padding: 8px 10px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: var(--surface-border-width) solid var(--border-secondary);
  border-radius: var(--surface-radius);
}

@keyframes b-stream-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0;
  }
}
</style>
