<!--
  @file CommentCard.vue
  @description 行内批注浮层卡片，展示被批注文本、批注内容，支持编辑和删除。
-->
<template>
  <div v-if="visible" ref="wrapperRef" :class="name" :style="wrapperStyle" @mousedown="onWrapperMousedown">
    <!-- 查看模式 -->
    <template v-if="!isEditing">
      <div :class="bem('header')">
        <div :class="bem('annotated')" :title="annotatedText">{{ annotatedText }}</div>
        <BDropdown>
          <BButton type="text" square size="small" :class="bem('more-btn')">
            <BIcon icon="lucide:more-horizontal" :size="16" />
          </BButton>
          <template #overlay>
            <div ref="dropdownRef">
              <BDropdownMenu :options="menuOptions" :width="120" />
            </div>
          </template>
        </BDropdown>
      </div>
      <div :class="bem('content')">{{ comment }}</div>
    </template>

    <!-- 编辑模式 -->
    <template v-else>
      <ATextarea v-model:value="editValue" :auto-size="{ minRows: 2, maxRows: 6 }" placeholder="编辑批注..." />
      <div :class="bem('edit-actions')">
        <BButton type="secondary" size="small" @click="cancelEditing">取消</BButton>
        <BButton type="primary" size="small" @click="saveEditing">保存</BButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @file CommentCard.vue
 * @description 行内批注浮层卡片，展示被批注文本、批注内容，支持编辑和删除。
 */
import type { SelectionAssistantPosition } from '../adapters/selectionAssistant';
import type { CSSProperties } from 'vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useEventListener, onClickOutside, useResizeObserver } from '@vueuse/core';
import type { DropdownOption } from '@/components/BDropdown/type';
import { createNamespace } from '@/utils/namespace';
import { resolveToolbarContainerRect } from '../utils/selectionToolbarPosition';

const [name, bem] = createNamespace('', 'b-markdown-comment-card');

interface Props {
  /** 卡片是否可见 */
  visible?: boolean;
  /** 批注 ID */
  commentId?: string;
  /** 被批注的原文 */
  annotatedText?: string;
  /** 批注内容 */
  comment?: string;
  /** 卡片定位信息（由 adapter 计算为相对 overlayRoot 的坐标） */
  position?: SelectionAssistantPosition | null;
  /** 浮层根容器，用于计算容器矩形 fallback */
  overlayRoot?: HTMLElement | null;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  commentId: '',
  annotatedText: '',
  comment: '',
  position: null,
  overlayRoot: null
});

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'edit', id: string, newComment: string): void;
  (e: 'delete', id: string): void;
}>();

const isEditing = ref(false);
const editValue = ref('');
const wrapperRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});
const hasMeasuredPosition = ref(false);

/**
 * 卡片与锚点之间的垂直间距。
 */
const CARD_GAP = 6;

/**
 * 卡片接近容器边缘时的内边距。
 */
const CARD_PADDING = 8;

/**
 * 处理卡片容器的 mousedown 事件。
 * 查看模式下阻止默认行为（防止编辑器失焦），编辑模式下允许焦点传入输入框。
 * @param event - 鼠标按下事件
 */
function onWrapperMousedown(event: MouseEvent): void {
  if (!isEditing.value) {
    event.preventDefault();
  }
}

/**
 * 构造隐藏态卡片样式，用于首帧测量。
 * @param width - 卡片宽度
 * @returns 隐藏态样式对象
 */
function createHiddenWrapperStyle(): CSSProperties {
  return {
    top: '0px',
    left: '50%',
    transform: 'translateX(-50%)',
    visibility: 'hidden'
  };
}

/**
 * 计算卡片纵向位置，优先显示在选区下方，空间不足时回退到上方。
 * @param position - 编排层注入的锚点信息
 * @param containerRect - 浮层容器矩形
 * @param wrapperHeight - 卡片高度
 * @returns 纵向像素值
 */
function resolveCardTop(
  position: SelectionAssistantPosition,
  containerRect: NonNullable<SelectionAssistantPosition['containerRect']>,
  wrapperHeight: number
): number {
  const preferredTop = position.anchorRect.top + position.lineHeight + CARD_GAP;
  const fallbackTop = position.anchorRect.top - wrapperHeight - CARD_GAP;
  const maxTop = containerRect.top + containerRect.height - wrapperHeight - CARD_PADDING;
  return preferredTop <= maxTop ? preferredTop : Math.max(containerRect.top + CARD_PADDING, fallbackTop);
}

/**
 * 计算卡片横向位置，居中对齐锚点，溢出时约束到容器内。
 * @param containerRect - 浮层容器矩形
 * @param wrapperWidth - 卡片宽度
 * @returns 横向样式对象
 */
function resolveHorizontalStyle(containerRect: NonNullable<SelectionAssistantPosition['containerRect']>, wrapperWidth: number): CSSProperties {
  const anchorCenter = (props.position?.anchorRect?.left ?? 0) + (props.position?.anchorRect.width ?? 0) / 2;
  let left = anchorCenter - wrapperWidth / 2;
  const minLeft = containerRect.left + CARD_PADDING;
  const maxLeft = containerRect.left + containerRect.width - wrapperWidth - CARD_PADDING;

  left = Math.max(minLeft, Math.min(maxLeft, left));

  // 显式检查卡片右侧是否超出容器右边界（当 maxLeft < minLeft 时 clamping 可能失效）
  const containerRight = containerRect.left + containerRect.width;

  if (left + wrapperWidth > containerRight) {
    left = containerRight - wrapperWidth;
  }

  return {
    left: `${left}px`,
    transform: 'none'
  };
}

/**
 * 根据编排层注入的 position 更新卡片定位。
 * 坐标已由 adapter 计算为相对 overlayRoot 的值。
 */
function syncFloatPosition(): void {
  const { position } = props;
  const wrapperElement = wrapperRef.value;
  if (!position || !wrapperElement) return;

  const containerRect = resolveToolbarContainerRect(position, props.overlayRoot);

  const { width: wrapperWidth, height: wrapperHeight } = wrapperElement.getBoundingClientRect();

  if (wrapperWidth <= 0 || wrapperHeight <= 0) {
    hasMeasuredPosition.value = false;
    wrapperStyle.value = createHiddenWrapperStyle();
    return;
  }

  const top = resolveCardTop(position, containerRect, wrapperHeight);
  const horizontalStyle = resolveHorizontalStyle(containerRect, wrapperWidth);

  wrapperStyle.value = {
    top: `${top}px`,
    visibility: 'visible',
    ...horizontalStyle
  };
  hasMeasuredPosition.value = true;
}

/**
 * 进入编辑模式。
 */
function startEditing(): void {
  editValue.value = props.comment;
  isEditing.value = true;
}

/**
 * 取消编辑。
 */
function cancelEditing(): void {
  isEditing.value = false;
  editValue.value = '';
}

/**
 * 保存编辑后的批注内容。
 */
function saveEditing(): void {
  const trimmed = editValue.value.trim();
  if (!trimmed) return;
  emit('edit', props.commentId, trimmed);
  isEditing.value = false;
  editValue.value = '';
}

/**
 * 删除批注。
 */
function handleDelete(): void {
  emit('delete', props.commentId);
}

/**
 * 下拉菜单选项。
 */
const menuOptions = computed<DropdownOption[]>(() => [
  { value: 'edit', label: '编辑', icon: 'lucide:pencil', onClick: startEditing },
  { type: 'divider' },
  { value: 'delete', label: '删除', icon: 'lucide:trash-2', danger: true, onClick: handleDelete }
]);

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      isEditing.value = false;
      editValue.value = '';
      hasMeasuredPosition.value = false;
      wrapperStyle.value = createHiddenWrapperStyle();
      nextTick(syncFloatPosition);
    } else {
      hasMeasuredPosition.value = false;
      isEditing.value = false;
      editValue.value = '';
    }
  },
  { immediate: true }
);

watch(
  () => props.position,
  () => {
    if (!props.visible) return;
    if (!hasMeasuredPosition.value) {
      wrapperStyle.value = createHiddenWrapperStyle();
    }
    nextTick(syncFloatPosition);
  }
);

useResizeObserver(wrapperRef, () => {
  syncFloatPosition();
});

onClickOutside(
  wrapperRef,
  () => {
    if (props.visible) {
      emit('update:visible', false);
    }
  },
  { ignore: [dropdownRef] }
);

useEventListener(window, 'resize', () => {
  if (props.visible) syncFloatPosition();
});

onBeforeUnmount(() => {
  wrapperStyle.value = {};
});
</script>

<style lang="less" scoped>
.b-markdown-comment-card {
  position: absolute;
  z-index: 1001;
  width: 320px;
  max-width: calc(100% - 32px);
  padding: 6px 10px;
  background: var(--bg-elevated);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
}

.b-markdown-comment-card__header {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.b-markdown-comment-card__annotated {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.b-markdown-comment-card__more-btn {
  flex-shrink: 0;
}

.b-markdown-comment-card__content {
  max-height: 200px;
  overflow: auto;
  font-size: 14px;
  color: var(--text-primary);
  user-select: text;
}

.b-markdown-comment-card__edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
