/**
 * @file components.test.ts
 * @description 基础设置页局部组件测试。
 * @vitest-environment jsdom
 */
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatPermissionStore } from '@/stores/chat/permission';
import BasicSettingsItem from '@/views/settings/basic/components/SettingsItem.vue';
import ToolPermissionGrants from '@/views/settings/basic/components/ToolPermissionGrants.vue';

/**
 * BButton 测试替身，保留点击交互。
 */
const BButtonStub = defineComponent({
  name: 'BButton',
  emits: ['click'],
  template: '<button class="b-button-stub" type="button" @click="$emit(\'click\', $event)"><slot /></button>'
});

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

describe('BasicSettingsItem', (): void => {
  it('renders label, hint and control content with fixed control width', (): void => {
    const wrapper = mount(BasicSettingsItem, {
      props: {
        label: '界面大小',
        hint: '调整整体 UI 显示尺寸',
        controlWidth: 280
      },
      slots: {
        default: '<input class="font-size-input" />'
      }
    });

    expect(wrapper.find('.basic-settings-item__label').text()).toBe('界面大小');
    expect(wrapper.find('.basic-settings-item__hint').text()).toBe('调整整体 UI 显示尺寸');
    expect(wrapper.find('.basic-settings-item__control .font-size-input').exists()).toBe(true);
    expect(wrapper.find('.basic-settings-item__control').attributes('style') ?? '').toContain('--basic-settings-item-control-width: 280px;');

    wrapper.unmount();
  });
});

describe('ToolPermissionGrants', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('renders readable labels for stored always-allowed tool grants', (): void => {
    const store = useChatPermissionStore();
    store.grantToolPermission('operate_current_webpage', 'always');
    store.grantToolPermission('update_settings', 'always');

    const wrapper = mount(ToolPermissionGrants, {
      global: {
        stubs: {
          BButton: BButtonStub
        }
      }
    });

    expect(wrapper.text()).toContain('始终允许');
    expect(wrapper.text()).toContain('操作当前网页');
    expect(wrapper.text()).toContain('修改应用设置');

    wrapper.unmount();
  });

  it('revokes and clears stored always-allowed tool grants', async (): Promise<void> => {
    const store = useChatPermissionStore();
    store.grantToolPermission('operate_current_webpage', 'always');
    store.grantToolPermission('update_settings', 'always');

    const wrapper = mount(ToolPermissionGrants, {
      global: {
        stubs: {
          BButton: BButtonStub
        }
      }
    });

    await findPermissionRow(wrapper, '操作当前网页').find('button').trigger('click');
    expect(store.alwaysToolPermissionGrants.operate_current_webpage).toBeUndefined();
    expect(store.alwaysToolPermissionGrants.update_settings).toBe(true);

    await findButtonByText(wrapper, '清除全部').trigger('click');
    expect(store.alwaysToolPermissionGrants).toEqual({});
    expect(wrapper.text()).toContain('暂无始终允许的工具');

    wrapper.unmount();
  });
});
