import type { Ref } from 'vue';
import { computed, ref } from 'vue';

type HoverBlockType = 'heading' | 'paragraph';

interface HoverIndicatorState {
  isVisible: boolean;
  label: string;
  top: string;
  type: HoverBlockType;
}

interface UseHoverIndicatorResult {
  hoverIndicator: Ref<HoverIndicatorState>;
  onContainerMouseLeave: () => void;
  onContainerMouseMove: (event: MouseEvent) => void;
}

// 指示器高度的一半，用于扩展块的命中区域，防止鼠标在指示器边缘时隐藏
const INDICATOR_HALF_HEIGHT = 14;

const BLOCK_SELECTOR =
  '.b-editor-content h1, .b-editor-content h2, .b-editor-content h3, .b-editor-content h4, .b-editor-content h5, .b-editor-content h6, .b-editor-content p';

function getIndicatorLabel(block: HTMLElement): string {
  if (block.tagName === 'P') {
    return 'T';
  }

  return block.tagName;
}

function getIndicatorType(block: HTMLElement): HoverBlockType {
  return block.tagName === 'P' ? 'paragraph' : 'heading';
}

export function useHoverIndicator(containerRef: Ref<HTMLElement | null>): UseHoverIndicatorResult {
  const currentLabel = ref('');
  const currentTop = ref('0px');
  const currentType = ref<HoverBlockType>('paragraph');
  const isVisible = ref(false);

  const hoverIndicator = computed<HoverIndicatorState>(() => ({
    isVisible: isVisible.value,
    label: currentLabel.value,
    top: currentTop.value,
    type: currentType.value
  }));

  function hideIndicator(): void {
    isVisible.value = false;
  }

  function onContainerMouseLeave(): void {
    hideIndicator();
  }

  function onContainerMouseMove(event: MouseEvent): void {
    const container = containerRef.value;

    if (!container) {
      hideIndicator();
      return;
    }

    const blocks = container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
    const block = Array.from(blocks).find((b) => {
      const rect = b.getBoundingClientRect();
      return event.clientY >= rect.top - INDICATOR_HALF_HEIGHT && event.clientY <= rect.bottom + INDICATOR_HALF_HEIGHT;
    });

    if (!block) {
      hideIndicator();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const { scrollTop } = container;
    const top = blockRect.top - containerRect.top + scrollTop + blockRect.height / 2;

    currentLabel.value = getIndicatorLabel(block);
    currentTop.value = `${top}px`;
    currentType.value = getIndicatorType(block);
    isVisible.value = true;
  }

  return {
    hoverIndicator,
    onContainerMouseLeave,
    onContainerMouseMove
  };
}
