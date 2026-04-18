import type { Ref } from 'vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';

interface UseAutoCollapseOptions {
  defaultCollapsed?: boolean;
  threshold: number;
}

interface UseAutoCollapseReturn {
  collapsed: Ref<boolean>;
  isAutoCollapsed: Ref<boolean>;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
}

export function useAutoCollapse(target: Ref<HTMLElement | null>, options: UseAutoCollapseOptions): UseAutoCollapseReturn {
  const { defaultCollapsed = false, threshold } = options;
  const collapsed = ref<boolean>(defaultCollapsed);
  const isAutoCollapsed = ref<boolean>(false);
  let hasMeasured = false;
  let resizeObserver: ResizeObserver | null = null;

  function updateAutoCollapsed(width: number): void {
    const nextAutoCollapsed = width < threshold;
    if (hasMeasured && isAutoCollapsed.value === nextAutoCollapsed) return;

    hasMeasured = true;
    isAutoCollapsed.value = nextAutoCollapsed;
    collapsed.value = nextAutoCollapsed;
  }

  function setCollapsed(value: boolean): void {
    collapsed.value = value;
  }

  function toggleCollapsed(): void {
    collapsed.value = !collapsed.value;
  }

  onMounted(() => {
    const element = target.value;
    if (!element) return;

    updateAutoCollapsed(element.getBoundingClientRect().width);

    resizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const [entry] = entries;
      if (!entry) return;
      updateAutoCollapsed(entry.contentRect.width);
    });

    resizeObserver.observe(element);
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return {
    collapsed,
    isAutoCollapsed,
    setCollapsed,
    toggleCollapsed
  };
}
