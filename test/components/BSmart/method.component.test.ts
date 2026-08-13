/**
 * @file method.component.test.ts
 * @description 验证 BSmartMethod 选择函数并配置参数。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import type { PropType, Ref } from 'vue';
import { defineComponent, nextTick, ref } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { BDraggableMoveEvent } from '@/components/BDraggable/types';
import BSmartMethod from '@/components/BSmart/Method.vue';
import type { BSmartInputValue, BSmartMethodAction, BSmartMethodOption, VariableOptionGroup } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue, isSmartValue } from '@/components/BSmart/utils/value';

/** BSmartMethod 源码，用于验证关键布局约束。 */
const methodSource = readFileSync('src/components/BSmart/Method.vue', 'utf8');

/**
 * 测试宿主组件实例。
 */
interface MethodHostVm {
  /** 当前方法动作列表 */
  value: BSmartMethodAction[];
}

/**
 * 测试中的方法动作拖拽项。
 */
interface MethodActionEntry {
  /** 拖拽项唯一标识 */
  key: string;
  /** 当前动作下标 */
  index: number;
  /** 当前方法动作 */
  action: BSmartMethodAction;
}

/**
 * 创建方法选项。
 * @returns 方法选项列表
 */
function createMethodOptions(): BSmartMethodOption[] {
  return [
    {
      label: 'submitOrder',
      parameters: ['orderId', 'remark'],
      value: 'submitOrder'
    },
    {
      label: 'refreshList',
      parameters: [],
      value: 'refreshList'
    }
  ];
}

/**
 * 创建变量候选。
 * @returns 变量分组选项
 */
function createVariableOptions(): VariableOptionGroup[] {
  return [
    {
      type: 'variable',
      options: [
        {
          label: '订单号',
          value: '$input.orderId'
        }
      ]
    }
  ];
}

/**
 * 挂载 BSmartMethod。
 * @param initialActions - 初始动作列表
 * @returns 组件包装器
 */
function mountMethod(initialActions: BSmartMethodAction[] = []): VueWrapper {
  const Host = defineComponent({
    name: 'MethodHost',
    components: {
      BSmartMethod
    },
    setup(): { methods: BSmartMethodOption[]; value: Ref<BSmartMethodAction[]>; variables: VariableOptionGroup[] } {
      const value = ref<BSmartMethodAction[]>(initialActions);

      return {
        methods: createMethodOptions(),
        value,
        variables: createVariableOptions()
      };
    },
    template: '<BSmartMethod v-model:value="value" :methods="methods" :variables="variables" />'
  });

  return mount(Host, {
    global: {
      components: {
        BDraggable: defineComponent({
          name: 'BDraggable',
          props: {
            handleClass: { type: String, default: '' },
            list: {
              type: Array as PropType<MethodActionEntry[]>,
              required: true
            }
          },
          emits: {
            /**
             * 发出拖拽排序事件。
             * @param event - 拖拽排序事件
             * @returns 是否允许触发事件
             */
            move: (event: BDraggableMoveEvent<MethodActionEntry>): boolean => Array.isArray(event.nextList)
          },
          template: `
            <div v-bind="$attrs" class="b-smart-method-test-draggable">
              <div v-for="(item, index) in list" :key="item.key" class="b-smart-method-test-draggable-item">
                <slot
                  :item="item"
                  :index="index"
                  :item-key="item.key"
                  :handle-class="handleClass"
                  :dragging="false"
                  :dragging-key="null"
                  :drop-position="null"
                />
              </div>
            </div>
          `
        }),
        BButton: defineComponent({
          name: 'BButtonStub',
          props: {
            text: { type: String, default: '' }
          },
          emits: {
            /**
             * 触发按钮点击。
             * @returns 是否允许触发事件
             */
            click: (): boolean => true
          },
          template: '<button v-bind="$attrs" type="button" @click="$emit(\'click\')"><slot>{{ text }}</slot></button>'
        }),
        BModal: defineComponent({
          name: 'BModalStub',
          props: {
            open: { type: Boolean, default: false }
          },
          emits: {
            /**
             * 更新弹窗可见状态。
             * @param value - 是否打开
             * @returns 是否允许触发事件
             */
            'update:open': (value: boolean): boolean => typeof value === 'boolean'
          },
          template: '<div v-if="open" class="b-smart-method-test-modal"><slot></slot><slot name="footer"></slot></div>'
        }),
        BIcon: defineComponent({
          name: 'BIconStub',
          props: {
            icon: { type: String, required: true }
          },
          template: '<span class="b-smart-method-test-icon" :data-icon="icon"></span>'
        }),
        BSmartInput: defineComponent({
          name: 'BSmartInputStub',
          props: {
            value: { type: Object as PropType<BSmartInputValue>, required: true },
            options: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            },
            placeholder: { type: String, default: '' }
          },
          emits: {
            /**
             * 更新参数值。
             * @param value - 结构化参数值
             * @returns 是否允许触发事件
             */
            'update:value': (value: BSmartInputValue): boolean => isSmartValue(value)
          },
          template: `
            <input
              class="b-smart-method-test-input"
              :placeholder="placeholder"
              :value="value.value"
              @input="$emit('update:value', { type: 'literal', value: $event.target.value })"
            />
          `
        })
      }
    }
  });
}

/**
 * 按按钮文案查找按钮。
 * @param wrapper - 组件包装器
 * @param text - 按钮文案
 * @returns 按钮包装器
 */
function findButtonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((item: DOMWrapper<Element>): boolean => item.text() === text);

  if (!button) {
    throw new Error(`未找到按钮：${text}`);
  }

  return button;
}

/**
 * 按动作行按钮图标查找按钮。
 * @param wrapper - 组件包装器
 * @param icon - 图标名称
 * @returns 按钮包装器
 */
function findActionButtonByIcon(wrapper: VueWrapper, icon: string): DOMWrapper<Element> {
  const button = wrapper.findAll('.b-smart-method__action-controls button').find((item: DOMWrapper<Element>): boolean => item.attributes('icon') === icon);

  if (!button) {
    throw new Error(`未找到动作按钮：${icon}`);
  }

  return button;
}

describe('BSmartMethod', (): void => {
  it('selects a method and writes argument values after confirmation', async (): Promise<void> => {
    const wrapper = mountMethod();

    await wrapper.find('.b-smart-method__trigger').trigger('click');
    await wrapper.find('[data-method-value="submitOrder"]').trigger('click');

    const inputs = wrapper.findAll('.b-smart-method-test-input');

    expect(inputs).toHaveLength(2);

    wrapper.findAllComponents({ name: 'BSmartInputStub' })[0].vm.$emit('update:value', createVariableValue('$input.orderId'));
    await inputs[1].setValue('尽快处理');
    await findButtonByText(wrapper, '确定').trigger('click');

    expect((wrapper.vm as unknown as MethodHostVm).value).toEqual([
      {
        args: [createVariableValue('$input.orderId'), createLiteralValue('尽快处理')],
        method: 'submitOrder'
      }
    ]);
    wrapper.unmount();
  });

  it('appends a new action from the trigger', async (): Promise<void> => {
    const wrapper = mountMethod([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'submitOrder'
      }
    ]);

    await wrapper.find('.b-smart-method__trigger').trigger('click');
    await wrapper.find('[data-method-value="refreshList"]').trigger('click');
    await findButtonByText(wrapper, '确定').trigger('click');

    expect((wrapper.vm as unknown as MethodHostVm).value).toEqual([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'submitOrder'
      },
      {
        args: [],
        method: 'refreshList'
      }
    ]);
    wrapper.unmount();
  });

  it('does not render a draft action switcher in the modal', async (): Promise<void> => {
    const wrapper = mountMethod();

    await wrapper.find('.b-smart-method__trigger').trigger('click');

    expect(wrapper.find('.b-smart-method__drafts').exists()).toBe(false);
    wrapper.unmount();
  });

  it('uses a single editing action instead of draft and active action state', (): void => {
    expect(methodSource).toContain('const editingAction = ref<BSmartMethodAction>');
    expect(methodSource).not.toContain('draftAction');
    expect(methodSource).not.toContain('draftActions');
    expect(methodSource).not.toContain('activeAction');
    expect(methodSource).not.toContain('activeActionIndex');
  });

  it('uses shared method action normalization helpers', (): void => {
    expect(methodSource).toContain("import { normalizeMethodAction, normalizeMethodActions } from '@/components/BWidget/utils/widgetMethods';");
    expect(methodSource).not.toContain('function normalizeMethodAction');
    expect(methodSource).not.toContain('function normalizeMethodActions');
  });

  it('renders configured actions and removes one from the inline list', async (): Promise<void> => {
    const wrapper = mountMethod([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'submitOrder'
      }
    ]);

    expect(wrapper.find('.b-smart-method__actions').text()).toContain('submitOrder');

    await findActionButtonByIcon(wrapper, 'lucide:trash-2').trigger('click');

    expect((wrapper.vm as unknown as MethodHostVm).value).toEqual([]);
    expect(wrapper.find('.b-smart-method__actions').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps trigger text fixed to placeholder when actions exist', (): void => {
    const wrapper = mountMethod([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'submitOrder'
      }
    ]);

    expect(wrapper.find('.b-smart-method__trigger').text()).toBe('设置动作');
    wrapper.unmount();
  });

  it('edits a configured action from the inline list', async (): Promise<void> => {
    const wrapper = mountMethod([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'submitOrder'
      }
    ]);

    await findActionButtonByIcon(wrapper, 'lucide:pencil').trigger('click');
    await wrapper.find('[data-method-value="refreshList"]').trigger('click');
    await findButtonByText(wrapper, '确定').trigger('click');

    expect((wrapper.vm as unknown as MethodHostVm).value).toEqual([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'refreshList'
      }
    ]);
    wrapper.unmount();
  });

  it('keeps existing arguments when switching to another method', async (): Promise<void> => {
    const wrapper = mountMethod([
      {
        args: [createLiteralValue('one'), createLiteralValue('two'), createLiteralValue('three')],
        method: 'submitOrder'
      }
    ]);

    await findActionButtonByIcon(wrapper, 'lucide:pencil').trigger('click');
    await wrapper.find('[data-method-value="refreshList"]').trigger('click');
    await findButtonByText(wrapper, '确定').trigger('click');

    expect((wrapper.vm as unknown as MethodHostVm).value).toEqual([
      {
        args: [createLiteralValue('one'), createLiteralValue('two'), createLiteralValue('three')],
        method: 'refreshList'
      }
    ]);
    wrapper.unmount();
  });

  it('keeps a stable default height for modal panels', (): void => {
    expect(methodSource).toContain('height: 360px;');
  });

  it('uses the parameter header action instead of section meta and footer actions', async (): Promise<void> => {
    const wrapper = mountMethod();

    await wrapper.find('.b-smart-method__trigger').trigger('click');

    // 参数头部不再使用 section-meta 与 footer-actions 模式
    expect(wrapper.find('.b-smart-method__section-meta').exists()).toBe(false);
    expect(wrapper.find('.b-smart-method__footer-actions').exists()).toBe(false);

    // 「添加参数」按钮仅在已选中函数时渲染，因此先选择函数
    await wrapper.find('[data-method-value="submitOrder"]').trigger('click');
    expect(wrapper.findAll('.b-smart-method-test-input')).toHaveLength(2);

    // 参数头部 action 新增一行参数
    await findButtonByText(wrapper, '添加参数').trigger('click');

    expect(wrapper.findAll('.b-smart-method-test-input')).toHaveLength(3);
    wrapper.unmount();
  });

  it('matches sidebar layer style for inline action controls', (): void => {
    expect(methodSource).toContain('type="text" size="mini" square icon="lucide:pencil"');
    expect(methodSource).toContain('type="text" size="mini" danger square icon="lucide:trash-2"');
    expect(methodSource).toContain('.b-smart-method__action:hover .b-smart-method__action-controls');
    expect(methodSource).toContain('pointer-events: none;');
    expect(methodSource).toContain('opacity: 0;');
    expect(methodSource).not.toContain("bem('action-edit')");
    expect(methodSource).not.toContain("bem('action-delete')");
    expect(methodSource).not.toContain('data-action=');
  });

  it('renders action blocks through BDraggable and reorders actions on move', async (): Promise<void> => {
    const firstAction: BSmartMethodAction = {
      args: [createVariableValue('$input.orderId')],
      method: 'submitOrder'
    };
    const secondAction: BSmartMethodAction = {
      args: [],
      method: 'refreshList'
    };
    const wrapper = mountMethod([firstAction, secondAction]);

    expect(methodSource).toContain('<BDraggable');
    expect(methodSource).toContain('handle-class="b-smart-method__action-drag-handle"');
    expect(methodSource).toContain('@move="handleActionMove"');

    wrapper.findComponent({ name: 'BDraggable' }).vm.$emit('move', {
      nextList: [
        { action: secondAction, index: 1, key: 'action-1' },
        { action: firstAction, index: 0, key: 'action-0' }
      ],
      position: 'after',
      sourceIndex: 0,
      sourceItem: { action: firstAction, index: 0, key: 'action-0' },
      sourceKey: 'action-0',
      targetIndex: 1,
      targetItem: { action: secondAction, index: 1, key: 'action-1' },
      targetKey: 'action-1'
    } satisfies BDraggableMoveEvent<MethodActionEntry>);

    await nextTick();

    expect((wrapper.vm as unknown as MethodHostVm).value).toEqual([secondAction, firstAction]);
    wrapper.unmount();
  });

  it('uses BButton for argument removal', (): void => {
    expect(methodSource).toContain('<BButton :class="bem(\'arg-remove\')" type="text" danger square icon="lucide:trash-2"');
    expect(methodSource).not.toContain('<button :class="bem(\'arg-remove\')"');
  });
});
