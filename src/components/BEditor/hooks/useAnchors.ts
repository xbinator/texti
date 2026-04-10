import type { Ref } from 'vue';
import { ref } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import BScrollbar from '@/components/BScrollbar/index.vue';

export interface AnchorRecord {
  id: string;
  level: number;
  text: string;
}

interface UseBEditorAnchorsResult {
  activeAnchorId: Ref<string>;
  handleChangeAnchor: (record: AnchorRecord) => void;
  handleEditorScroll: () => void;
}

const HEADING_SELECTOR = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => `.b-editor-content ${tag}`).join(', ');

export function useAnchors(layoutRef: Ref<HTMLElement | null>, scrollbarRef: Ref<InstanceType<typeof BScrollbar> | null>): UseBEditorAnchorsResult {
  const activeAnchorId = ref('');

  function getHeadingElements(): HTMLHeadingElement[] {
    return Array.from(layoutRef.value?.querySelectorAll(HEADING_SELECTOR) ?? []).filter(
      (heading): heading is HTMLHeadingElement => heading instanceof HTMLHeadingElement
    );
  }

  function handleChangeAnchor(record: AnchorRecord): void {
    activeAnchorId.value = record.id;

    if (!record.id) {
      scrollbarRef.value?.scrollTo({ top: 0 });
      return;
    }

    const element = layoutRef.value?.querySelector<HTMLElement>(`#${CSS.escape(record.id)}`);
    if (element) {
      element.scrollIntoView({ block: 'start' });
    }
  }

  const updateActiveAnchor = useThrottleFn(() => {
    const container = scrollbarRef.value?.getScrollElement();
    if (!container) return;

    if (container.scrollTop < 50) {
      activeAnchorId.value = '';
      return;
    }

    const headings = getHeadingElements();
    if (!headings.length) {
      return;
    }

    let currentId = '';
    const threshold = container.getBoundingClientRect().top + 100;

    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= threshold) {
        currentId = heading.id;
      }
    });

    if (currentId !== activeAnchorId.value) {
      activeAnchorId.value = currentId;
    }
  }, 100);

  function handleEditorScroll(): void {
    updateActiveAnchor();
  }

  return {
    activeAnchorId,
    handleChangeAnchor,
    handleEditorScroll
  };
}
