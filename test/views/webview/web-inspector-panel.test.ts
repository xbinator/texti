/**
 * @file web-inspector-panel.test.ts
 * @description 验证 WebView DOM 检查看板的元素区块操作。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent } from 'vue';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { WebviewElementSelection } from '@/views/webview/shared/types';
import InspectorPanel from '@/views/webview/web/components/InspectorPanel.vue';

/**
 * 创建测试用元素选择结果。
 * @returns 元素选择结果
 */
function createElementSelection(): WebviewElementSelection {
  return {
    tagName: 'DIV',
    id: 'target',
    className: 'target-card',
    text: '目标元素',
    selector: 'div#target',
    attributes: [],
    ancestors: [],
    computedStyles: {},
    rect: {
      x: 12,
      y: 24,
      pageX: 12,
      pageY: 24,
      width: 120,
      height: 36
    }
  };
}

/**
 * 挂载 DOM 检查看板。
 * @param selection - 当前选中元素
 * @returns Vue Test Utils 包装器
 */
function mountInspectorPanel(selection: WebviewElementSelection = createElementSelection()): VueWrapper {
  return shallowMount(InspectorPanel, {
    props: {
      selection
    },
    global: {
      stubs: {
        BButton: defineComponent({
          name: 'BButtonStub',
          props: {
            icon: {
              type: String,
              default: ''
            },
            tooltip: {
              type: String,
              default: ''
            }
          },
          emits: ['click'],
          template: '<button class="b-button-stub" :data-icon="icon" :title="tooltip" @click="$emit(\'click\', $event)"><slot /></button>'
        }),
        BIcon: true,
        BSectionBlock: defineComponent({
          name: 'BSectionBlockStub',
          props: {
            title: {
              type: String,
              required: true
            }
          },
          template:
            '<section class="section-block-stub" :data-title="title">' +
            '<header><span>{{ title }}</span>' +
            '<div class="section-block-stub__extra"><slot name="extra" /></div>' +
            '</header><slot /></section>'
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: {
              type: String,
              required: true
            }
          },
          template: '<div class="section-item-stub" :data-label="label"><span>{{ label }}</span><slot /></div>'
        })
      }
    }
  });
}

describe('webview InspectorPanel', (): void => {
  it('moves selected element screenshot into the element section extra area', async (): Promise<void> => {
    const selection = createElementSelection();
    const wrapper = mountInspectorPanel(selection);
    const elementSection = wrapper.get('[data-title="元素"]');
    const screenshotButton = elementSection.get('.section-block-stub__extra .b-button-stub');

    expect(wrapper.find('[data-icon="lucide:copy"]').exists()).toBe(false);
    expect(screenshotButton.attributes('data-icon')).toBe('lucide:camera');

    await screenshotButton.trigger('click');

    expect(wrapper.emitted('captureSelectedElementScreenshot')?.[0]).toEqual([selection]);
    wrapper.unmount();
  });
});
