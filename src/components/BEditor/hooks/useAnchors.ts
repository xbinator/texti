import type { Ref } from 'vue';
import { ref } from 'vue';
import { useThrottleFn } from '@vueuse/core';

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

const HEADING_SELECTOR = '.b-editor-content h1, .b-editor-content h2, .b-editor-content h3, .b-editor-content h4, .b-editor-content h5, .b-editor-content h6';

export function useAnchors(layoutRef: Ref<HTMLElement | null>): UseBEditorAnchorsResult {
  const activeAnchorId = ref('');

  function getScrollContainer(): HTMLDivElement | null {
    return layoutRef.value?.querySelector('.b-editor-scrollbar .scrollbar__wrap') ?? null;
  }

  function getHeadingElements(): HTMLHeadingElement[] {
    return Array.from(layoutRef.value?.querySelectorAll(HEADING_SELECTOR) ?? []).filter(
      (heading): heading is HTMLHeadingElement => heading instanceof HTMLHeadingElement
    );
  }

  function handleChangeAnchor(record: AnchorRecord): void {
    activeAnchorId.value = record.id;

    if (!record.id) {
      getScrollContainer()?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const element = layoutRef.value?.querySelector<HTMLElement>(`#${CSS.escape(record.id)}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const updateActiveAnchor = useThrottleFn(() => {
    const container = getScrollContainer();
    if (!container) {
      return;
    }

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
