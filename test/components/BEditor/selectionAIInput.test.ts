/**
 * @file selectionAIInput.test.ts
 * @description SelectionAIInput 浮层边界收敛测试。
 * @vitest-environment jsdom
 */

import type { SelectionAssistantAdapter, SelectionAssistantPosition } from '@/components/BEditor/adapters/selectionAssistant';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SelectionAIInput from '@/components/BEditor/components/SelectionAIInput.vue';

vi.mock('@/hooks/useChat', () => ({
  /**
   * 提供最小 chat hook mock，避免测试触发真实流式请求。
   * @returns mock chat agent
   */
  useChat: () => ({
    agent: {
      abort: vi.fn(),
      stream: vi.fn()
    }
  })
}));

vi.mock('@/hooks/useShortcuts', () => ({
  /**
   * 提供最小快捷键注册 mock。
   * @returns mock shortcut registrar
   */
  useShortcuts: () => ({
    registerShortcut: () => (): void => {}
  })
}));

vi.mock('@/stores/serviceModel', () => ({
  /**
   * 提供最小模型配置 store mock。
   * @returns mock service model store
   */
  useServiceModelStore: () => ({
    getAvailableServiceConfig: vi.fn().mockResolvedValue({
      providerId: 'provider',
      modelId: 'model',
      customPrompt: '{{SELECTED_TEXT}} {{USER_INPUT}}'
    })
  })
}));

/**
 * 输入框占位组件。
 */
const InputStub = defineComponent({
  props: {
    value: {
      type: String,
      default: ''
    },
    size: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    },
    placeholder: {
      type: String,
      default: ''
    }
  },
  emits: ['update:value', 'keydown'],
  /**
   * 暴露 focus 方法，模拟真实输入组件实例。
   * @param _props - 组件 props
   * @param context - setup 上下文
   * @returns 输入框渲染函数
   */
  setup(_props, context) {
    context.expose({
      focus: (): void => {}
    });
    return {};
  },
  template: '<input class="mock-ai-input" :value="value" :disabled="disabled" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />'
});

/**
 * 按钮占位组件。
 */
const ButtonStub = defineComponent({
  template: '<button><slot /></button>'
});

/**
 * 消息预览占位组件。
 */
const MessageStub = defineComponent({
  template: '<div class="mock-message"></div>'
});

/**
 * 图标占位组件。
 */
const IconStub = defineComponent({
  template: '<i class="mock-icon"></i>'
});

/**
 * 构造最小 adapter mock。
 * @returns mock adapter
 */
function createAdapter(): SelectionAssistantAdapter {
  return {
    getCapabilities: () => ({ actions: {} }),
    isEditable: () => true,
    getSelection: () => null,
    restoreSelection: (): void => {},
    getPanelPosition: () => null,
    getToolbarPosition: () => null,
    showSelectionHighlight: (): void => {},
    clearSelectionHighlight: (): void => {},
    applyGeneratedContent: async (): Promise<void> => {},
    buildSelectionReference: () => null,
    bindSelectionEvents: () => (): void => {}
  };
}

/**
 * 创建测试用定位信息。
 * @param anchorLeft - 锚点横坐标
 * @param anchorTop - 锚点纵坐标
 * @returns 测试定位信息
 */
function createPosition(anchorLeft: number, anchorTop: number): SelectionAssistantPosition {
  return {
    anchorRect: {
      top: anchorTop,
      left: anchorLeft,
      width: 0,
      height: 20
    },
    lineHeight: 20,
    containerRect: {
      top: 0,
      left: 0,
      width: 320,
      height: 180
    }
  };
}

/**
 * 读取面板样式中的像素值。
 * @param element - 面板宿主节点
 * @param property - 样式属性
 * @returns 像素数值
 */
function readPx(element: HTMLElement, property: 'top' | 'left' | 'width'): number {
  return Number.parseFloat(element.style[property]);
}

/**
 * 使用 DOMRect 模拟面板真实渲染尺寸。
 * @param element - 面板宿主节点
 */
function mockPanelRect(element: HTMLElement): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => new DOMRect(0, 0, 240, 80)
  });
}

describe('SelectionAIInput', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('keeps the panel hidden until the first measured position is ready', async () => {
    const wrapper = mount(SelectionAIInput, {
      props: {
        visible: true,
        adapter: createAdapter(),
        position: createPosition(160, 40)
      },
      global: {
        stubs: {
          AInput: InputStub,
          BButton: ButtonStub,
          BMessage: MessageStub,
          Icon: IconStub
        }
      }
    });

    await nextTick();

    const panel = wrapper.get('.ai-input-wrapper').element as HTMLElement;

    expect(panel.style.visibility).toBe('hidden');
  });

  test('clamps horizontal position within the overlay container', async () => {
    const wrapper = mount(SelectionAIInput, {
      props: {
        visible: true,
        adapter: createAdapter(),
        position: createPosition(300, 40)
      },
      global: {
        stubs: {
          AInput: InputStub,
          BButton: ButtonStub,
          BMessage: MessageStub,
          Icon: IconStub
        }
      }
    });

    await nextTick();

    const panel = wrapper.get('.ai-input-wrapper').element as HTMLElement;
    Object.defineProperty(panel, 'offsetWidth', {
      configurable: true,
      get(): number {
        return 240;
      }
    });
    Object.defineProperty(panel, 'offsetHeight', {
      configurable: true,
      get(): number {
        return 80;
      }
    });

    window.dispatchEvent(new Event('resize'));
    await nextTick();

    expect(readPx(panel, 'left')).toBe(64);
    expect(readPx(panel, 'width')).toBe(240);
    expect(panel.style.visibility).toBe('visible');
  });

  test('uses bounding client rect measurements when offset size is unavailable', async () => {
    const wrapper = mount(SelectionAIInput, {
      props: {
        visible: true,
        adapter: createAdapter(),
        position: createPosition(300, 40)
      },
      global: {
        stubs: {
          AInput: InputStub,
          BButton: ButtonStub,
          BMessage: MessageStub,
          Icon: IconStub
        }
      }
    });

    await nextTick();

    const panel = wrapper.get('.ai-input-wrapper').element as HTMLElement;
    Object.defineProperty(panel, 'offsetWidth', {
      configurable: true,
      get(): number {
        return 0;
      }
    });
    Object.defineProperty(panel, 'offsetHeight', {
      configurable: true,
      get(): number {
        return 0;
      }
    });
    mockPanelRect(panel);

    window.dispatchEvent(new Event('resize'));
    await nextTick();

    expect(readPx(panel, 'left')).toBe(64);
    expect(readPx(panel, 'width')).toBe(240);
    expect(panel.style.visibility).toBe('visible');
  });

  test('renders above the anchor when there is not enough space below', async () => {
    const wrapper = mount(SelectionAIInput, {
      props: {
        visible: true,
        adapter: createAdapter(),
        position: createPosition(160, 130)
      },
      global: {
        stubs: {
          AInput: InputStub,
          BButton: ButtonStub,
          BMessage: MessageStub,
          Icon: IconStub
        }
      }
    });

    await nextTick();

    const panel = wrapper.get('.ai-input-wrapper').element as HTMLElement;
    Object.defineProperty(panel, 'offsetWidth', {
      configurable: true,
      get(): number {
        return 240;
      }
    });
    Object.defineProperty(panel, 'offsetHeight', {
      configurable: true,
      get(): number {
        return 80;
      }
    });

    window.dispatchEvent(new Event('resize'));
    await nextTick();

    expect(readPx(panel, 'top')).toBe(44);
  });
});
