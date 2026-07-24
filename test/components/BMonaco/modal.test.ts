/**
 * @file modal.test.ts
 * @description 验证 BMonaco 通用弹窗编辑器的默认值、确认与取消行为。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, nextTick, ref } from 'vue';
import type { PropType } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { EditorState } from '@/components/BEditor/types';
import BMonacoModal from '@/components/BMonaco/Modal.vue';

/**
 * BMonaco 弹窗测试宿主属性。
 */
interface BMonacoModalHostProps {
  /** 弹窗是否打开 */
  open?: boolean;
  /** 编辑器模型值 */
  value?: unknown;
  /** 默认编辑器模型值 */
  defaultValue?: unknown;
}

/**
 * 创建测试用编辑器状态。
 * @param content - 编辑器内容
 * @returns 编辑器状态
 */
function createEditorState(content: string): EditorState {
  return {
    id: 'modal-test',
    name: 'modal-test.json',
    path: null,
    ext: 'json',
    content
  };
}

const BModalStub = defineComponent({
  name: 'BModalStub',
  props: {
    open: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: ''
    },
    width: {
      type: [Number, String],
      default: 500
    }
  },
  emits: ['cancel', 'update:open'],
  setup(_props, { emit }) {
    /**
     * 模拟弹窗取消事件。
     */
    function handleCancel(): void {
      emit('cancel');
      emit('update:open', false);
    }

    return { handleCancel };
  },
  template: `
    <div v-if="open" class="b-monaco-modal-stub" :data-title="title" :data-width="width">
      <slot></slot>
      <footer><slot name="footer"></slot></footer>
      <button class="b-monaco-modal-cancel-stub" @click="handleCancel"></button>
    </div>
  `
});

const BButtonStub = defineComponent({
  name: 'BButtonStub',
  emits: ['click'],
  setup(_props, { emit }) {
    /**
     * 转发按钮点击事件。
     */
    function handleClick(): void {
      emit('click');
    }

    return { handleClick };
  },
  template: '<button class="b-button-stub" @click="handleClick"><slot></slot></button>'
});

const BMonacoStub = defineComponent({
  name: 'BMonacoStub',
  props: {
    editorState: {
      type: Object,
      default: (): Record<string, unknown> => ({})
    },
    language: {
      type: String,
      default: ''
    },
    value: {
      type: String,
      default: ''
    }
  },
  emits: ['update:value', 'save'],
  setup(_props, { emit, expose }) {
    /**
     * 转发编辑器输入事件。
     * @param event - 原生输入事件
     */
    function handleInput(event: Event): void {
      if (event.target instanceof HTMLTextAreaElement) {
        emit('update:value', event.target.value);
      }
    }

    /**
     * 模拟 Monaco 聚焦。
     */
    function focusEditor(): void {
      return undefined;
    }

    /**
     * 模拟 Monaco 保存快捷键。
     */
    function handleSave(): void {
      emit('save');
    }

    expose({ focusEditor });

    return { handleInput, handleSave };
  },
  template: `
    <div>
      <textarea class="b-monaco-stub" :value="value" @input="handleInput"></textarea>
      <button class="b-monaco-save-stub" @click="handleSave"></button>
    </div>
  `
});

const BMonacoModalHost = defineComponent({
  name: 'BMonacoModalHost',
  components: {
    BMonacoModal
  },
  props: {
    defaultValue: {
      type: null as unknown as PropType<unknown>,
      default: undefined
    },
    open: {
      type: Boolean,
      default: true
    },
    value: {
      type: null as unknown as PropType<unknown>,
      default: undefined
    }
  },
  emits: ['cancel', 'confirm', 'update:open', 'update:value'],
  setup(props: BMonacoModalHostProps, { emit }) {
    const modalOpen = ref<boolean>(props.open ?? true);
    const modalValue = ref<unknown>(props.value);
    const editorState = ref<EditorState>(createEditorState(''));

    /**
     * 同步弹窗开关模型。
     * @param nextOpen - 最新弹窗开关状态
     */
    function handleOpenUpdate(nextOpen: boolean): void {
      modalOpen.value = nextOpen;
      emit('update:open', nextOpen);
    }

    /**
     * 同步编辑器文本模型。
     * @param nextValue - 最新文本
     */
    function handleValueUpdate(nextValue: unknown): void {
      modalValue.value = nextValue;
      editorState.value = createEditorState('');
      emit('update:value', nextValue);
    }

    /**
     * 转发确认事件。
     * @param nextValue - 确认模型值
     */
    function handleConfirm(nextValue: unknown): void {
      emit('confirm', nextValue);
    }

    /**
     * 转发取消事件。
     */
    function handleCancel(): void {
      emit('cancel');
    }

    return {
      editorState,
      handleCancel,
      handleConfirm,
      handleOpenUpdate,
      handleValueUpdate,
      modalOpen,
      modalValue
    };
  },
  template: `
    <BMonacoModal
      :default-value="defaultValue"
      :editor-state="editorState"
      language="json"
      :open="modalOpen"
      title="JSON 编辑"
      :value="modalValue"
      @cancel="handleCancel"
      @confirm="handleConfirm"
      @update:open="handleOpenUpdate"
      @update:value="handleValueUpdate"
    />
  `
});

/**
 * 挂载 BMonaco 弹窗。
 * @param props - 组件属性
 * @returns 测试包装器
 */
function mountMonacoModal(props: { open?: boolean; value?: unknown; defaultValue?: unknown }): VueWrapper {
  const mountProps: BMonacoModalHostProps = {
    open: props.open ?? true,
    value: props.value,
    defaultValue: props.defaultValue
  };

  return mount(BMonacoModalHost, {
    props: mountProps as Record<string, unknown>,
    global: {
      stubs: {
        BButton: BButtonStub,
        BModal: BModalStub,
        BMonaco: BMonacoStub
      }
    }
  });
}

describe('BMonacoModal', (): void => {
  it('uses default object value when opened without a current value', async (): Promise<void> => {
    const defaultValue = { ready: true };
    const wrapper = mountMonacoModal({ value: undefined, defaultValue });

    await nextTick();

    expect((wrapper.find('.b-monaco-stub').element as HTMLTextAreaElement).value).toBe(JSON.stringify(defaultValue, null, 2));
    expect(wrapper.emitted('update:value')?.[0]).toEqual([defaultValue]);
    wrapper.unmount();
  });

  it('keeps current value instead of overwriting it with default value', (): void => {
    const wrapper = mountMonacoModal({ value: '{ "current": true }', defaultValue: '{ "default": true }' });

    expect((wrapper.find('.b-monaco-stub').element as HTMLTextAreaElement).value).toBe('{ "current": true }');
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });

  it('updates object model and closes when saving valid JSON', async (): Promise<void> => {
    const wrapper = mountMonacoModal({ value: { draft: true } });

    await wrapper.find('.b-monaco-stub').setValue('{ "saved": true }');
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.emitted('update:value')?.[0]).toEqual([{ saved: true }]);
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ saved: true }]);
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false]);
    wrapper.unmount();
  });

  it('ignores inner Monaco save events so shortcuts do not close the modal', async (): Promise<void> => {
    const wrapper = mountMonacoModal({ value: { draft: true } });

    await wrapper.find('.b-monaco-stub').setValue('{ "shortcut": true }');
    await nextTick();
    await wrapper.find('.b-monaco-save-stub').trigger('click');

    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.emitted('update:open')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps object model unchanged and shows feedback for invalid JSON', async (): Promise<void> => {
    const wrapper = mountMonacoModal({ value: { draft: true } });

    await wrapper.find('.b-monaco-stub').setValue('{broken');
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.emitted('update:open')).toBeUndefined();
    expect(wrapper.find('.b-monaco-modal__error').text()).toContain('JSON 必须是合法格式');
    wrapper.unmount();
  });

  it('emits cancel and closes when cancelling the modal', async (): Promise<void> => {
    const wrapper = mountMonacoModal({ value: '{ "draft": true }' });

    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '取消')
      ?.trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false]);
    wrapper.unmount();
  });
});
