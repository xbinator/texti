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
import { addCssUnit } from '@/utils/css';
import { createNamespace } from '@/utils/namespace';
import MessageNodes from './components/MessageNodes';
import { MESSAGE_NODE_RENDER_CONTEXT_KEY } from './types';
import { parseMessageNodes } from './utils/messageParser';
import { messageRenderScheduler } from './utils/messageScheduler';

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

  try {
    parsedResult.value = parseMessageNodes({
      content: snapshot.content,
      mode: snapshot.mode,
      loading: snapshot.loading
    });
  } catch {
    if (parsedResult.value.blocks.length > 0) return;

    try {
      parsedResult.value = parseMessageNodes({
        content: snapshot.content,
        mode: 'text',
        loading: snapshot.loading
      });
    } catch {
      parsedResult.value = { blocks: [], images: [] };
    }
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
