<template>
  <div v-if="adapter && visible" ref="wrapperRef" :class="name" :style="wrapperStyle">
    <!-- AI 生成预览区 -->
    <div v-if="previewText || loading" :class="bem('preview')">
      <div :class="bem('preview-text')">
        <BMessage :content="previewText" :max-height="200" type="text" status="streaming" :loading="loading" />
      </div>
      <div :class="bem('preview-hint')">
        <div v-if="loading" class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <BIcon icon="svg-spinners:ring-resize" :class="bem('loading-icon')" />
            <span>正在编写中...</span>
          </div>
          <BButton type="secondary" size="small" @click.stop="stopStreaming">停 止</BButton>
        </div>
        <div v-else class="flex items-center justify-between">
          <span>点击应用 AI 生成内容</span>
          <div class="flex items-center gap-4">
            <BButton type="secondary" size="small" @click.stop="closePanel">取 消</BButton>
            <BButton type="primary" size="small" @click.stop="applyGeneratedContent">应 用</BButton>
          </div>
        </div>
      </div>
    </div>

    <AInput v-else v-model:value="inputValue" v-focus size="large" placeholder="输入指令，按 Enter 发送..." :disabled="loading" @keydown="onKeydown" />
  </div>
</template>

<script setup lang="ts">
/**
 * @file SelectionAIInput.vue
 * @description 选区 AI 输入面板，通过 adapter 协议屏蔽 Tiptap/CodeMirror 差异。
 */
import type { SelectionAssistantAdapter, SelectionAssistantPosition, SelectionAssistantRange } from '../adapters/selectionAssistant';
import type { CSSProperties } from 'vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { onClickOutside, useEventListener, useResizeObserver } from '@vueuse/core';
import { message } from 'ant-design-vue';
import { vFocus } from '@/directives/focus';
import { useChat } from '@/hooks/useChat';
import { useScroller } from '@/hooks/useScroller';
import { useShortcuts } from '@/hooks/useShortcuts';
import type { ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/shared/storage/service-models/events';
import type { AvailableServiceModelConfig } from '@/stores/ai/serviceModel';
import { useServiceModelStore } from '@/stores/ai/serviceModel';
import { createNamespace } from '@/utils/namespace';
import { buildSelectionAIPrompt } from '../utils/selectionAIPrompt';

const [name, bem] = createNamespace('', 'b-markdown-selai');

interface Props {
  /** 面板是否可见 */
  visible?: boolean;
  /** 选区工具适配器 */
  adapter?: SelectionAssistantAdapter | null;
  /** 缓存选区范围 */
  selectionRange?: SelectionAssistantRange | null;
  /** 面板定位信息（由编排层注入） */
  position?: SelectionAssistantPosition | null;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  adapter: null,
  selectionRange: null,
  position: null
});

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'apply', content: string): void;
  (e: 'streaming-change', value: boolean): void;
}>();

const inputValue = ref('');
const previewText = ref('');
const loading = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});
const hasMeasuredPosition = ref(false);
const hasAutoScrolledIntoView = ref(false);
const modelConfig = ref<AvailableServiceModelConfig | null>(null);
const serviceModelStore = useServiceModelStore();
const scroller = useScroller(wrapperRef);

const providerId = computed(() => modelConfig.value?.providerId ?? '');

/**
 * AI 面板与锚点之间的垂直间距。
 */
const PANEL_GAP = 6;

/**
 * AI 面板相对容器的最小安全边距。
 */
const PANEL_PADDING = 16;

/**
 * AI 面板的期望宽度。
 */
const PREFERRED_PANEL_WIDTH = 500;

const { agent } = useChat({
  providerId,
  onText(content) {
    previewText.value += content;
  },
  onComplete() {
    loading.value = false;
    emit('streaming-change', false);
  },
  onError(error) {
    loading.value = false;
    emit('streaming-change', false);
    message.error(error.message);
  }
});

const { registerShortcut } = useShortcuts();

let unregisterEscape: (() => void) | null = null;

// ---- Position ----

/**
 * 构造隐藏态面板样式，横向始终保持容器居中。
 * @param width - 面板宽度
 * @returns 隐藏态样式对象
 */
function createHiddenWrapperStyle(width: number): CSSProperties {
  return {
    top: '0px',
    left: '50%',
    transform: 'translateX(-50%)',
    visibility: 'hidden',
    width: `${width}px`
  };
}

/**
 * 读取面板当前尺寸，优先使用 offset 尺寸，缺失时回退到 DOMRect。
 * @param element - 面板宿主节点
 * @returns 面板宽高
 */
function getWrapperSize(element: HTMLElement): { width: number; height: number } {
  const width = element.offsetWidth || element.getBoundingClientRect().width;
  const height = element.offsetHeight || element.getBoundingClientRect().height;
  return { width, height };
}

/**
 * 根据容器宽度计算面板最终宽度。
 * @param containerWidth - 浮层容器宽度
 * @returns 受安全边距约束后的面板宽度
 */
function resolvePanelWidth(containerWidth: number): number {
  const maxWidth = Math.max(0, containerWidth - PANEL_PADDING * 2);
  return Math.min(PREFERRED_PANEL_WIDTH, maxWidth);
}

/**
 * 在面板可见时根据内容重新同步宽度，避免横向居中时样式宽度滞后。
 * @returns void
 */
function syncWrapperWidth(): void {
  const wrapperElement = wrapperRef.value;
  const containerWidth = props.position?.containerRect?.width ?? window.innerWidth;
  if (!wrapperElement) return;

  wrapperElement.style.width = `${resolvePanelWidth(containerWidth)}px`;
}

/**
 * 当横向居中后，若面板宽度超出容器可用区域，则回退为左侧贴边。
 * @param containerRect - 浮层容器矩形
 * @param wrapperWidth - 面板宽度
 * @returns 横向定位样式
 */
function resolveHorizontalStyle(containerRect: SelectionAssistantPosition['containerRect'], wrapperWidth: number): CSSProperties {
  if (!containerRect) {
    return {
      left: '50%',
      transform: 'translateX(-50%)'
    };
  }

  const minLeft = containerRect.left + PANEL_PADDING;
  const maxLeft = containerRect.left + containerRect.width - wrapperWidth - PANEL_PADDING;
  const centeredLeft = containerRect.left + containerRect.width / 2 - wrapperWidth / 2;
  const clampedLeft = Math.min(Math.max(centeredLeft, minLeft), maxLeft);

  if (Math.abs(clampedLeft - centeredLeft) < 0.5) {
    return {
      left: '50%',
      transform: 'translateX(-50%)'
    };
  }

  return {
    left: `${clampedLeft}px`,
    transform: 'none'
  };
}

/**
 * 计算面板纵向位置，优先显示在选区下方，空间不足时回退到上方。
 * @param position - 编排层注入的锚点信息
 * @param containerRect - 浮层容器矩形
 * @param wrapperHeight - 面板高度
 * @returns 纵向像素值
 */
function resolvePanelTop(
  position: SelectionAssistantPosition,
  containerRect: NonNullable<SelectionAssistantPosition['containerRect']>,
  wrapperHeight: number
): number {
  const preferredTop = position.anchorRect.top + position.lineHeight + PANEL_GAP;
  const fallbackTop = position.anchorRect.top - wrapperHeight - PANEL_GAP;
  const maxTop = containerRect.top + containerRect.height - wrapperHeight - PANEL_PADDING;
  return preferredTop <= maxTop ? preferredTop : Math.max(containerRect.top + PANEL_PADDING, fallbackTop);
}

/**
 * 面板接近滚动容器底部时滚动进视区，避免确认区被遮挡。
 * @returns void
 */
function scrollIntoViewIfObscured(): void {
  const wrapperElement = wrapperRef.value;
  if (!wrapperElement || hasAutoScrolledIntoView.value) return;

  const rect = wrapperElement.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const containerBottom = scrollerRect.height > 0 ? scrollerRect.bottom : scroller.scrollInfo.height;
  const isObscured = rect.bottom > containerBottom - 400;

  if (isObscured) {
    hasAutoScrolledIntoView.value = true;
    scroller.scrollToElement(wrapperElement, 'smooth');
  }
}

/**
 * 根据编排层注入的 position 更新面板定位。
 * 坐标已由 adapter 计算为相对 overlayRoot 的值。
 */
function syncFloatPosition(): void {
  const { position } = props;
  const wrapperElement = wrapperRef.value;
  if (!position || !wrapperElement) return;

  const containerRect = position.containerRect ?? {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight
  };

  const width = resolvePanelWidth(containerRect.width);

  // 优先使用 offset 尺寸，未完成布局时回退到 DOMRect，兼容首帧与测试环境。
  const { width: wrapperWidth, height: wrapperHeight } = getWrapperSize(wrapperElement);

  if (wrapperWidth <= 0 || wrapperHeight <= 0) {
    hasMeasuredPosition.value = false;
    wrapperStyle.value = createHiddenWrapperStyle(width);
    return;
  }

  const top = resolvePanelTop(position, containerRect, wrapperHeight);
  const horizontalStyle = resolveHorizontalStyle(position.containerRect ?? containerRect, wrapperWidth);

  wrapperStyle.value = {
    top: `${top}px`,
    visibility: 'visible',
    width: `${width}px`,
    ...horizontalStyle
  };
  hasMeasuredPosition.value = true;

  nextTick(scrollIntoViewIfObscured);
}

// ---- Selection ----

/**
 * 关闭面板时将光标收缩到原选区起始位置。
 */
function collapseToSelectionStart(): void {
  const { adapter, selectionRange: range } = props;
  if (!adapter || !range) return;

  adapter.restoreSelection({
    from: range.from,
    to: range.from,
    text: '',
    docVersion: range.docVersion,
    snapshotId: range.snapshotId
  });
}

// ---- State ----

function resetState(): void {
  inputValue.value = '';
  previewText.value = '';
  loading.value = false;
}

function stopStreaming(): void {
  if (loading.value) {
    agent.abort();
    emit('streaming-change', false);
  }
}

function closePanel(): void {
  stopStreaming();
  resetState();
  collapseToSelectionStart();
  emit('update:visible', false);
}

// ---- Model Config ----

async function fetchModelConfig(): Promise<void> {
  modelConfig.value = await serviceModelStore.getAvailableServiceConfig('polish');
}

function onServiceModelUpdated(event: CustomEvent<ServiceModelUpdatedDetail>): void {
  if (event.detail.serviceType !== 'polish') return;
  fetchModelConfig();
}

useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, onServiceModelUpdated);

fetchModelConfig();

// ---- Visible Watch ----

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      hasMeasuredPosition.value = false;
      hasAutoScrolledIntoView.value = false;
      wrapperStyle.value = createHiddenWrapperStyle(PREFERRED_PANEL_WIDTH);
      fetchModelConfig();
      // 合并到同一个 nextTick，减少微任务调度
      nextTick(() => {
        syncWrapperWidth();
        syncFloatPosition();
      });
      unregisterEscape = registerShortcut({ key: 'escape', handler: closePanel });
    } else {
      hasMeasuredPosition.value = false;
      hasAutoScrolledIntoView.value = false;
      resetState();
      unregisterEscape?.();
      unregisterEscape = null;
    }
  },
  { immediate: true }
);

// 监听 position 变化，重新定位面板
watch(
  () => props.position,
  () => {
    if (!props.visible) return;
    if (!hasMeasuredPosition.value) {
      wrapperStyle.value = createHiddenWrapperStyle(PREFERRED_PANEL_WIDTH);
    }
    syncWrapperWidth();
    nextTick(syncFloatPosition);
  }
);

useResizeObserver(wrapperRef, (): void => {
  syncFloatPosition();
});

useEventListener(window, 'resize', (): void => {
  if (props.visible) syncFloatPosition();
});

// ---- AI ----

async function sendInstruction(): Promise<void> {
  const value = inputValue.value.trim();
  const range = props.selectionRange;
  const config = modelConfig.value;

  if (!value || loading.value || !range || range.from === range.to) return;

  if (!config?.providerId || !config?.modelId) {
    message.warning('未找到可用的模型配置');
    return;
  }

  const prompt = buildSelectionAIPrompt(range.text, value);
  loading.value = true;
  emit('streaming-change', true);
  agent.stream({ modelId: config.modelId, prompt });
}

function applyGeneratedContent(): void {
  if (!previewText.value) return;
  emit('apply', previewText.value);
}

// ---- Events ----

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendInstruction();
  }

  // 作为 useShortcuts 全局拦截的兜底
  if (event.key === 'Escape') {
    event.preventDefault();
    closePanel();
  }
}

onClickOutside(wrapperRef, () => {
  if (!loading.value) closePanel();
});

// ---- Lifecycle ----

onBeforeUnmount(() => {
  unregisterEscape?.();
  unregisterEscape = null;
});
</script>

<style lang="less" scoped>
.b-markdown-selai {
  position: absolute;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: calc(100% - 32px);
}

// ---- 预览确认区 ----
.b-markdown-selai__preview {
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-secondary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    border-color: var(--border-primary);
  }
}

.b-markdown-selai__preview-text {
  padding: 9px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.b-markdown-selai__preview-hint {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-tertiary);
  border-radius: 0 0 8px 8px;
}

.b-markdown-selai__loading-icon {
  flex-shrink: 0;
  font-size: 12px;
}
</style>
