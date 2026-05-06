/* @vitest-environment jsdom */
/**
 * @file useSelectionAssistant.test.ts
 * @description useSelectionAssistant 在 source 模式下的新选区起始行为测试。
 */

import type { SelectionAssistantAdapter, SelectionAssistantCapabilities, SelectionAssistantPosition, SelectionAssistantRange } from '@/components/BEditor/adapters/selectionAssistant';
import { defineComponent, nextTick, watchEffect } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useSelectionAssistant, type SelectionAssistantStatus } from '@/components/BEditor/hooks/useSelectionAssistant';

/**
 * 选区事件处理器集合。
 */
interface BoundHandlers {
  onSelectionChange: () => void;
  onFocus: () => void;
  onBlur: (event?: FocusEvent) => void;
  onPointerDownInsideEditor?: (event: PointerEvent) => void;
  onPointerSelectionStart?: (event: PointerEvent) => void;
  onPointerSelectionEnd?: (event: PointerEvent) => void;
  onPointerDownOutsideEditor?: (event: PointerEvent) => void;
  onEscape?: () => void;
}

let currentSelection: SelectionAssistantRange | null = null;
let boundHandlers: BoundHandlers | null = null;

const clearSelectionHighlight = vi.fn();
const showSelectionHighlight = vi.fn();

/**
 * 测试用 adapter。
 */
const adapter: SelectionAssistantAdapter = {
  getCapabilities(): SelectionAssistantCapabilities {
    return {
      actions: {
        ai: true,
        reference: true
      }
    };
  },
  isEditable(): boolean {
    return true;
  },
  getSelection(): SelectionAssistantRange | null {
    return currentSelection ? { ...currentSelection } : null;
  },
  restoreSelection(): void {},
  getPanelPosition(): SelectionAssistantPosition | null {
    return null;
  },
  getToolbarPosition(): SelectionAssistantPosition | null {
    return null;
  },
  showSelectionHighlight(range: SelectionAssistantRange): void {
    showSelectionHighlight(range);
  },
  clearSelectionHighlight(): void {
    clearSelectionHighlight();
  },
  async applyGeneratedContent(): Promise<void> {},
  buildSelectionReference() {
    return null;
  },
  bindSelectionEvents(handlers): () => void {
    boundHandlers = handlers;
    return (): void => {
      boundHandlers = null;
    };
  }
};

let latestStatus: SelectionAssistantStatus = 'idle';

/**
 * 挂载 useSelectionAssistant 的测试组件。
 */
const HookHarness = defineComponent({
  name: 'SelectionAssistantHarness',
  setup() {
    const assistant = useSelectionAssistant({
      adapter: () => adapter,
      isEditable: () => true
    });

    watchEffect((): void => {
      latestStatus = assistant.status.value;
    });

    return () => null;
  }
});

describe('useSelectionAssistant', () => {
  afterEach(() => {
    currentSelection = null;
    boundHandlers = null;
    latestStatus = 'idle';
    clearSelectionHighlight.mockReset();
    showSelectionHighlight.mockReset();
  });

  test('clears the previous source highlight as soon as a new pointer selection starts', async () => {
    mount(HookHarness);
    await nextTick();
    clearSelectionHighlight.mockClear();
    showSelectionHighlight.mockClear();

    currentSelection = {
      from: 0,
      to: 5,
      text: 'hello'
    };
    boundHandlers?.onSelectionChange();
    await nextTick();

    expect(latestStatus).toBe('toolbar-visible');
    expect(showSelectionHighlight).toHaveBeenCalledTimes(1);

    boundHandlers?.onPointerDownInsideEditor?.(new PointerEvent('pointerdown'));
    await nextTick();

    expect(clearSelectionHighlight).toHaveBeenCalledTimes(1);
    expect(latestStatus).toBe('idle');
  });

  test('keeps toolbar hidden while pointer selection is still in progress and shows it after pointerup', async () => {
    mount(HookHarness);
    await nextTick();
    clearSelectionHighlight.mockClear();
    showSelectionHighlight.mockClear();

    boundHandlers?.onPointerSelectionStart?.(new PointerEvent('pointerdown'));
    currentSelection = {
      from: 1,
      to: 6,
      text: 'ello '
    };
    boundHandlers?.onSelectionChange();
    await nextTick();

    expect(latestStatus).toBe('idle');
    expect(showSelectionHighlight).toHaveBeenCalledTimes(1);

    boundHandlers?.onPointerSelectionEnd?.(new PointerEvent('pointerup'));
    await nextTick();

    expect(latestStatus).toBe('toolbar-visible');
    expect(showSelectionHighlight).toHaveBeenCalledTimes(2);
  });
});
