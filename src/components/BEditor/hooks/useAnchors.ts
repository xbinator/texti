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
  setActiveAnchorId: (anchorId: string) => void;
}

interface BScrollbarExposed {
  getScrollElement: () => HTMLDivElement | null;
  scrollTo: (options: ScrollToOptions) => void;
}

const RICH_HEADING_SELECTOR = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => `.b-editor-content ${tag}`).join(', ');
const SOURCE_HEADING_SELECTOR = '.source-editor-codemirror .cm-line[id]';
const HEADING_SELECTOR = `${RICH_HEADING_SELECTOR}, ${SOURCE_HEADING_SELECTOR}`;

export function useAnchors(layoutRef: Ref<HTMLElement | null>, scrollbarRef: Ref<InstanceType<typeof BScrollbar> | null>): UseBEditorAnchorsResult {
  const activeAnchorId = ref('');

  function getScrollbar(): BScrollbarExposed | null {
    return scrollbarRef.value as unknown as BScrollbarExposed | null;
  }

  function getHeadingElements(): HTMLElement[] {
    return Array.from(layoutRef.value?.querySelectorAll(HEADING_SELECTOR) ?? []).filter(
      (heading): heading is HTMLElement => heading instanceof HTMLElement
    );
  }

  function scrollElementToTop(element: HTMLElement): void {
    const scrollbar = getScrollbar();
    const container = scrollbar?.getScrollElement();
    if (!scrollbar || !container) {
      element.scrollIntoView({ block: 'start' });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const nextTop = container.scrollTop + (elementRect.top - containerRect.top);

    scrollbar.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
  }

  function handleChangeAnchor(record: AnchorRecord): void {
    activeAnchorId.value = record.id;

    if (!record.id) {
      getScrollbar()?.scrollTo({ top: 0 });
      return;
    }

    const element = layoutRef.value?.querySelector<HTMLElement>(`#${CSS.escape(record.id)}`);
    if (element) {
      scrollElementToTop(element);
    }
  }

  const updateActiveAnchor = useThrottleFn(() => {
    const container = getScrollbar()?.getScrollElement();
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

  function setActiveAnchorId(anchorId: string): void {
    activeAnchorId.value = anchorId;
  }

  return {
    activeAnchorId,
    handleChangeAnchor,
    handleEditorScroll,
    setActiveAnchorId
  };
}
