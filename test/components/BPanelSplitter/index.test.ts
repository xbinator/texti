/**
 * @file index.test.ts
 * @description 验证 BPanelSplitter 拖拽生命周期与 WebView 覆盖场景。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BPanelSplitter from '@/components/BPanelSplitter/index.vue';

/**
 * 创建鼠标事件。
 * @param type - 鼠标事件类型
 * @param clientX - 鼠标水平位置
 * @returns 鼠标事件
 */
function createMouseEvent(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX
  });
}

/**
 * 挂载一个带外层宽度的分割面板。
 * @returns Vue Test Utils 包装器
 */
function mountSplitter(): VueWrapper {
  const TestHost = defineComponent({
    components: {
      BPanelSplitter
    },
    setup(): { size: Ref<number> } {
      /** 面板宽度模型。 */
      const size = ref(300);

      return { size };
    },
    template: `
      <div style="width: 1000px; height: 500px;">
        <BPanelSplitter v-model:size="size" position="right" :min-width="100" :max-width="500">
          <div>content</div>
        </BPanelSplitter>
      </div>
    `
  });

  return mount(TestHost, {
    attachTo: document.body
  });
}

describe('BPanelSplitter', (): void => {
  beforeEach((): void => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        /** 当前观察目标数量，仅用于让测试替身保持可执行行为。 */
        private observedCount = 0;

        /**
         * 记录观察目标，测试中无需触发布局回调。
         */
        observe(): void {
          this.observedCount += 1;
        }

        /**
         * 取消单个目标观察，测试中无需实现。
         */
        unobserve(): void {
          this.observedCount = Math.max(0, this.observedCount - 1);
        }

        /**
         * 取消所有观察，测试中无需实现。
         */
        disconnect(): void {
          this.observedCount = 0;
        }
      }
    );
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.body.className = '';
    document.body.style.userSelect = '';
  });

  it('finishes dragging when the mouse is released on the drag shield', async (): Promise<void> => {
    const wrapper = mountSplitter();
    const line = wrapper.find('.b-panel-splitter__line');

    await line.trigger('mousedown', { clientX: 300 });
    await nextTick();

    const dragShield = document.body.querySelector<HTMLElement>('.b-panel-splitter__drag-shield');
    expect(dragShield).not.toBeNull();

    window.dispatchEvent(createMouseEvent('mousemove', 360));
    await nextTick();
    expect(wrapper.find('.b-panel-splitter__section').attributes('style')).toContain('width: 360px;');

    dragShield?.dispatchEvent(createMouseEvent('mouseup', 360));
    await nextTick();

    expect(document.body.querySelector('.b-panel-splitter__drag-shield')).toBeNull();
    expect(wrapper.find('.b-panel-splitter__line').classes()).not.toContain('b-panel-splitter__line--dragging');

    window.dispatchEvent(createMouseEvent('mousemove', 480));
    await nextTick();
    expect(wrapper.find('.b-panel-splitter__section').attributes('style')).toContain('width: 360px;');
  });

  it('emits resize-start when the user begins dragging', async (): Promise<void> => {
    const wrapper = mountSplitter();
    const splitter = wrapper.findComponent(BPanelSplitter);

    await wrapper.find('.b-panel-splitter__line').trigger('mousedown', { clientX: 300 });

    expect(splitter.emitted('resize-start')).toHaveLength(1);

    window.dispatchEvent(createMouseEvent('mouseup', 300));
  });

  it('keeps external classes on the splitter root for layout states', (): void => {
    const updateSize = vi.fn<(_value: number) => void>();
    const wrapper = mount(BPanelSplitter, {
      props: {
        class: 'chat-sider--expanded',
        size: 300,
        'onUpdate:size': updateSize
      },
      slots: {
        default: '<div>content</div>'
      },
      attachTo: document.body
    });

    expect(wrapper.find('.b-panel-splitter').classes()).toContain('chat-sider--expanded');
  });
});
