/**
 * @file index.test.ts
 * @description 基础设置页主题入口和 AI 工具权限管理测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { computed, defineComponent, type PropType } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectOption } from '@/components/BSelect/types';
import { useChatPermissionStore } from '@/stores/chat/permission';
import BasicSettingsPage from '@/views/settings/basic/index.vue';

vi.mock('@/theme', () => ({
  getPresetList: (): Array<{ id: string; label: string }> => [{ id: 'default', label: '默认' }]
}));

/**
 * SettingsPage 测试替身。
 */
const SettingsPageStub = defineComponent({
  name: 'SettingsPage',
  props: {
    title: { type: String, required: true }
  },
  template: '<main><h1>{{ title }}</h1><slot /></main>'
});

/**
 * SettingsSection 测试替身。
 */
const SettingsSectionStub = defineComponent({
  name: 'SettingsSection',
  props: {
    title: { type: String, required: true }
  },
  template: '<section><h2>{{ title }}</h2><slot /></section>'
});

/**
 * BSelect 测试替身，保留 value/options/change 交互。
 */
const BSelectStub = defineComponent({
  name: 'BSelect',
  props: {
    value: { type: [String, Number], default: '' },
    options: { type: Array as PropType<SelectOption[]>, default: () => [] },
    width: { type: Number, default: undefined }
  },
  emits: ['change'],
  setup(_props, { emit }) {
    const selectedOption = computed<SelectOption | undefined>(() => _props.options.find((option): boolean => option.value === _props.value));

    /**
     * 转发 select change 事件。
     * @param event - DOM change 事件
     */
    function handleChange(event: Event): void {
      emit('change', (event.target as HTMLSelectElement).value);
    }

    /**
     * 关闭下拉菜单的测试替身。
     */
    function closeDropdown(): number {
      return 0;
    }

    return {
      closeDropdown,
      handleChange,
      selectedOption
    };
  },
  template: `
    <div v-bind="$attrs" class="b-select-stub" :data-value="String(value)">
      <select class="b-select-stub__select" :value="value" @change="handleChange">
        <option v-for="option in options" :key="String(option.value)" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <div v-if="$slots.dropdownFooter" class="b-select-stub__footer">
        <slot
          name="dropdownFooter"
          :closeDropdown="closeDropdown"
          :selected="value"
          :selectedOption="selectedOption"
        ></slot>
      </div>
    </div>
  `
});

/**
 * BModal 测试替身，保留 open 与 footer 插槽渲染。
 */
const BModalStub = defineComponent({
  name: 'BModal',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' }
  },
  emits: ['update:open'],
  template: `
    <section v-if="open" class="b-modal-stub" :data-title="title">
      <header class="b-modal-stub__header">{{ title }}</header>
      <div class="b-modal-stub__body"><slot /></div>
      <footer class="b-modal-stub__footer"><slot name="footer" /></footer>
    </section>
  `
});

/**
 * BButton 测试替身，保留点击事件和 disabled 属性。
 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button class="b-button-stub" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
});

/**
 * BInputNumber 测试替身，避免依赖组件自动导入。
 */
const BInputNumberStub = defineComponent({
  name: 'BInputNumber',
  props: {
    value: { type: [String, Number], default: '' }
  },
  template: '<input class="b-input-number-stub" :value="value" />'
});

/**
 * 挂载基础设置页。
 * @returns 组件 wrapper
 */
function mountBasicSettingsPage(): VueWrapper {
  return mount(BasicSettingsPage, {
    global: {
      stubs: {
        SettingsPage: SettingsPageStub,
        SettingsSection: SettingsSectionStub,
        BSelect: BSelectStub,
        BModal: BModalStub,
        BButton: BButtonStub,
        BInputNumber: BInputNumberStub
      }
    }
  });
}

/**
 * 根据按钮文案查找按钮。
 * @param wrapper - 组件包装器
 * @param text - 按钮文案
 * @returns 按钮包装器
 */
function findButtonByText(wrapper: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const button = wrapper.findAll<HTMLButtonElement>('button').find((item: DOMWrapper<HTMLButtonElement>): boolean => item.text().includes(text));

  if (!button) {
    throw new Error(`未找到按钮：${text}`);
  }

  return button;
}

/**
 * 根据工具展示名查找权限行。
 * @param wrapper - 组件包装器
 * @param label - 工具展示名
 * @returns 权限行包装器
 */
function findPermissionRow(wrapper: VueWrapper, label: string): DOMWrapper<Element> {
  const row = wrapper.findAll('.basic-tool-permissions__row').find((item: DOMWrapper<Element>): boolean => item.text().includes(label));

  if (!row) {
    throw new Error(`未找到权限行：${label}`);
  }

  return row;
}

describe('BasicSettingsPage tool permissions', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('renders persisted tool permission grants with readable labels', (): void => {
    const store = useChatPermissionStore();
    store.grantToolPermission('operate_current_webpage', 'always');
    store.grantToolPermission('update_settings', 'always');

    const wrapper = mountBasicSettingsPage();

    expect(wrapper.text()).toContain('AI 工具权限');
    expect(wrapper.text()).toContain('操作当前网页');
    expect(wrapper.text()).toContain('修改应用设置');
  });

  it('does not expose the global tool permission mode in basic settings', (): void => {
    const wrapper = mountBasicSettingsPage();

    expect(wrapper.text()).not.toContain('权限模式');
  });

  it('renders the font style setting with its default option', (): void => {
    const wrapper = mountBasicSettingsPage();

    expect(wrapper.text()).toContain('字体设置');
    expect(wrapper.text()).toContain('样式');
    expect(wrapper.text()).toContain('默认');
  });

  it('renders the custom theme entry in the theme preset dropdown footer', (): void => {
    const wrapper = mountBasicSettingsPage();

    expect(wrapper.text()).toContain('自定义主题');
  });

  it('opens the custom theme entry modal when the footer button is clicked', async (): Promise<void> => {
    const wrapper = mountBasicSettingsPage();

    await findButtonByText(wrapper, '自定义主题').trigger('click');

    expect(wrapper.find('.b-modal-stub').exists()).toBe(true);
    expect(wrapper.text()).toContain('后续将在这里接入自定义主题编辑器');
  });

  it('revokes one persisted tool permission grant', async (): Promise<void> => {
    const store = useChatPermissionStore();
    store.grantToolPermission('operate_current_webpage', 'always');
    store.grantToolPermission('update_settings', 'always');
    const wrapper = mountBasicSettingsPage();

    await findPermissionRow(wrapper, '操作当前网页').find('button').trigger('click');

    expect(store.alwaysToolPermissionGrants.operate_current_webpage).toBeUndefined();
    expect(store.alwaysToolPermissionGrants.update_settings).toBe(true);
    expect(wrapper.text()).not.toContain('操作当前网页');
  });

  it('clears all persisted tool permission grants', async (): Promise<void> => {
    const store = useChatPermissionStore();
    store.grantToolPermission('operate_current_webpage', 'always');
    store.grantToolPermission('update_settings', 'always');
    const wrapper = mountBasicSettingsPage();

    await findButtonByText(wrapper, '清除全部').trigger('click');

    expect(store.alwaysToolPermissionGrants).toEqual({});
    expect(wrapper.text()).toContain('暂无始终允许的工具');
  });
});
