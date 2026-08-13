/**
 * @file variable-select-layout.test.ts
 * @description 验证变量选择菜单在窄宽度下不会压缩重叠。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import VariableSelect from '@/components/BSmart/components/VariableSelect.vue';
import type { Variable } from '@/components/BSmart/types';

/**
 * 测试用变量选择项。
 */
interface VariableSelectTestItem extends Variable {
  /** 变量树深度 */
  depth?: number;
  /** 是否存在子级变量 */
  hasChildren?: boolean;
  /** 子级变量是否展开 */
  expanded?: boolean;
  /** 是否需要展示折叠按钮占位 */
  showTogglePlaceholder?: boolean;
}

/** 变量选择菜单源码。 */
const variableSelectSource = readFileSync('src/components/BSmart/components/VariableSelect.vue', 'utf8');
/** 通用下拉菜单源码。 */
const selectDropdownSource = readFileSync('src/components/BSmart/components/_SelectDropdown.vue', 'utf8');

/**
 * 测试用 BButton 替身，保留按钮根节点和点击事件。
 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    /** 按钮类型 */
    type: {
      type: String,
      default: 'primary'
    },
    /** 按钮尺寸 */
    size: {
      type: String,
      default: 'middle'
    },
    /** 是否为方形按钮 */
    square: {
      type: Boolean,
      default: false
    },
    /** 图标名称 */
    icon: {
      type: String,
      default: ''
    },
    /** 提示文案 */
    tooltip: {
      type: String,
      default: ''
    }
  },
  emits: ['click'],
  template: '<button class="b-button" :data-icon="icon" :data-tooltip="tooltip" @click="$emit(\'click\', $event)"><slot /></button>'
});

describe('VariableSelect layout', (): void => {
  it('does not render an empty dropdown when no variables are available', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });

    expect(document.body.querySelector('.select-dropdown')).toBeNull();
    wrapper.unmount();
  });

  it('wraps variable item content in a vertical layout container', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '摄氏温度',
            value: 'data.weather.temperature',
            description: '当前城市的实时温度'
          }
        ],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });

    expect(document.body.querySelector('.variable-item')).not.toBeNull();
    expect(document.body.querySelector('.variable-item-main')).not.toBeNull();
    expect(document.body.querySelector('.variable-item-label')?.textContent).toBe('data.weather.temperature');
    expect(document.body.querySelector('.variable-item-value')?.textContent).toBe('摄氏温度');
    expect(document.body.querySelector('.variable-item-desc')).not.toBeNull();
    wrapper.unmount();
  });

  it('keeps $input as the primary text and shows its readable label on the right', async (): Promise<void> => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '入参',
            value: '$input',
            depth: 0
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });

    expect(document.body.querySelector('.variable-item-label')?.textContent).toBe('$input');
    expect(document.body.querySelector('.variable-item-value')?.textContent).toBe('入参');

    document.body.querySelector<HTMLElement>('.select-dropdown__item')?.click();

    expect(wrapper.emitted('select')?.[0]).toEqual([
      expect.objectContaining({
        value: '$input'
      })
    ]);
    wrapper.unmount();
  });

  it('hides the secondary variable label when no label is provided', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '',
            value: 'data.lastQuery.city'
          }
        ],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });

    expect(document.body.querySelector('.variable-item-label')?.textContent).toBe('data.lastQuery.city');
    expect(document.body.querySelector('.variable-item-value')).toBeNull();
    wrapper.unmount();
  });

  it('shows only the local path segment for nested tree variables', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '',
            value: 'data',
            depth: 0
          },
          {
            label: '',
            value: 'data.lastQuery',
            depth: 1
          },
          {
            label: '',
            value: 'data.lastQuery.city',
            depth: 2
          },
          {
            label: '',
            value: 'data["weather-data"]["feels.like"]',
            depth: 2
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });
    const labels = Array.from(document.body.querySelectorAll('.variable-item-label')).map((item: Element): string => item.textContent ?? '');

    expect(labels).toEqual(['data', 'lastQuery', 'city', 'feels.like']);
    expect(document.body.textContent).not.toContain('data.lastQuery.city');
    wrapper.unmount();
  });

  it('uses adaptive dropdown item height for variable descriptions', (): void => {
    expect(selectDropdownSource).not.toMatch(/\n\s+height:\s*32px;/);
    expect(selectDropdownSource).toContain('min-height: 32px;');
    expect(variableSelectSource).toContain('grid-template-columns: minmax(0, 1fr) auto;');
  });

  it('adds depth spacing for nested variable items', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: 'input',
            value: 'input',
            depth: 0
          },
          {
            label: '城市',
            value: 'input.city',
            depth: 1
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });
    const items = document.body.querySelectorAll<HTMLElement>('.variable-item');

    expect(items[0].style.getPropertyValue('--variable-depth')).toBe('0');
    expect(items[1].style.getPropertyValue('--variable-depth')).toBe('1');
    expect(variableSelectSource).toContain('padding-left: calc(var(--variable-depth, 0) * 24px);');
    wrapper.unmount();
  });

  it('emits toggle when the variable tree toggle is clicked', async (): Promise<void> => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: 'input',
            value: 'input',
            depth: 0,
            hasChildren: true,
            expanded: true
          },
          {
            label: '城市',
            value: 'input.city',
            depth: 1
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });
    const toggle = document.body.querySelector<HTMLElement>('.b-button');

    expect(toggle).not.toBeNull();
    await toggle?.click();

    expect(wrapper.emitted('toggle')?.[0]).toEqual([
      expect.objectContaining({
        value: 'input'
      })
    ]);
    wrapper.unmount();
  });

  it('does not render toggle placeholders for leaf items', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '同层叶子',
            value: 'input.leaf',
            depth: 1,
            showTogglePlaceholder: true
          },
          {
            label: '纯叶子',
            value: 'input.group.leaf',
            depth: 2,
            showTogglePlaceholder: false
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });

    expect(document.body.querySelectorAll('.variable-item__toggle-placeholder')).toHaveLength(0);
    expect(document.body.querySelectorAll('.variable-item.is-without-toggle')).toHaveLength(2);
    wrapper.unmount();
  });

  it('lets leaf items without toggle slots use the full content row', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '叶子节点',
            value: 'input.profile.name',
            depth: 2,
            showTogglePlaceholder: false
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });
    const item = document.body.querySelector<HTMLElement>('.variable-item');

    expect(item?.classList.contains('is-without-toggle')).toBe(true);
    expect(item?.querySelector('.variable-item__toggle-placeholder')).toBeNull();
    expect(variableSelectSource).toContain('.variable-item.is-without-toggle');
    expect(variableSelectSource).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(variableSelectSource).toContain('.variable-item.is-without-toggle .variable-item-main');
    wrapper.unmount();
  });

  it('does not add toggle column offset to root leaf items', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          {
            label: '消息',
            value: 'message',
            depth: 0,
            showTogglePlaceholder: false
          }
        ] as VariableSelectTestItem[],
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });
    const item = document.body.querySelector<HTMLElement>('.variable-item');

    expect(item?.style.getPropertyValue('--variable-leaf-offset')).toBe('0px');
    expect(item?.classList.contains('is-without-toggle')).toBe(true);
    wrapper.unmount();
  });

  it('renders only the active variable highlight', (): void => {
    const wrapper = mount(VariableSelect, {
      props: {
        visible: true,
        variables: [
          { label: '城市', value: '$input.city' },
          { label: '图片', value: '$input.image' }
        ],
        activeIndex: 1,
        position: {
          top: 0,
          left: 0,
          bottom: 0
        }
      },
      global: {
        components: {
          BButton: BButtonStub
        }
      }
    });
    expect(document.body.querySelectorAll('.select-dropdown__item.active')).toHaveLength(1);
    expect(document.body.querySelectorAll('.variable-item.is-selected')).toHaveLength(0);
    expect(variableSelectSource).not.toContain('selectedValue');
    expect(variableSelectSource).not.toContain('is-selected');
    wrapper.unmount();
  });

  it('keeps leaf items without toggle slots visually nested under their parent', (): void => {
    expect(variableSelectSource).toContain('padding-left: calc(var(--variable-depth, 0) * 24px);');
    expect(variableSelectSource).toContain('padding-left: calc(var(--variable-depth, 0) * 24px + var(--variable-leaf-offset, 0px));');
  });
});
