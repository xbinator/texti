<script lang="tsx">
import type { DropdownOption, DropdownOptionItem } from './type';
import type { PropType, VNodeChild } from 'vue';
import { computed, defineComponent } from 'vue';
import { Icon } from '@iconify/vue';
import { Dropdown } from 'ant-design-vue';
import BTruncateText from '../BTruncateText/index.vue';

const submenuAlign = {
  targetOffset: [-9, 0] as [number, number]
};

interface MenuProps {
  value: string | number | Array<string | number>;
  options: DropdownOption[];
  rowClass: string;
  width: string | number;
}

const Menu = defineComponent({
  name: 'BDropdownMenu',
  props: {
    value: {
      type: [String, Number, Array] as PropType<MenuProps['value']>,
      default: () => []
    },
    options: {
      type: Array as PropType<MenuProps['options']>,
      required: true
    },
    rowClass: {
      type: String,
      default: ''
    },
    width: {
      type: [String, Number] as PropType<MenuProps['width']>,
      default: 'auto'
    }
  },
  emits: {
    'update:value': (value: string | number): boolean => typeof value === 'string' || typeof value === 'number',
    change: (record: DropdownOptionItem): boolean => typeof record === 'object' && record !== null
  },
  setup(props, { emit, slots }) {
    const active = computed<string | number | Array<string | number>>({
      get: (): string | number | Array<string | number> => props.value,
      set: (value: string | number | Array<string | number>): void => {
        if (!Array.isArray(value)) {
          emit('update:value', value);
        }
      }
    });

    const menuWidth = computed<string>(() => (typeof props.width === 'number' ? `${props.width}px` : props.width));

    function renderMenuContent(record: DropdownOptionItem): VNodeChild {
      return slots.menu?.({ record }) ?? <BTruncateText text={record.label} />;
    }

    function handleClickMenu(record: DropdownOptionItem): void {
      if (record.disabled) return;

      if (!Array.isArray(active.value) && record.value !== active.value) {
        active.value = record.value;
      }

      record.onClick?.();
      emit('change', record);
    }

    function renderMenuItem(item: DropdownOptionItem, index: number, content: VNodeChild): VNodeChild {
      const itemClass = [
        item.class,
        props.rowClass,
        {
          disabled: item.disabled,
          danger: item.danger
        },
        item.color
      ];

      return (
        <div key={`item-${index}`} class={['b-dropdown-menu-item', itemClass]} onClick={() => handleClickMenu(item)}>
          {content}
        </div>
      );
    }

    function renderSubmenu(item: DropdownOptionItem, index: number, children: DropdownOption[]): VNodeChild {
      return renderMenuItem(
        item,
        index,
        <Dropdown
          placement={'rightTop' as 'top'}
          align={submenuAlign}
          disabled={item.disabled}
          overlayClassName="b-dropdown-overlay"
          v-slots={{
            overlay: (): VNodeChild => (
              <Menu
                value={props.value}
                options={children}
                rowClass={props.rowClass}
                width={props.width}
                onUpdate:value={(value: string | number): void => emit('update:value', value)}
                onChange={(record: DropdownOptionItem): void => emit('change', record)}
                v-slots={{
                  menu: ({ record }: { record: DropdownOptionItem }): VNodeChild => renderMenuContent(record)
                }}
              />
            )
          }}
        >
          <div class="b-dropdown-menu-item-content">
            {renderMenuContent(item)}
            <Icon class="b-dropdown-menu-item-arrow" icon="lucide:chevron-right" />
          </div>
        </Dropdown>
      );
    }

    function renderOption(item: DropdownOption, index: number): VNodeChild {
      if (item.type === 'divider') {
        return <div key={`divider-${index}`} class="b-dropdown-menu-item-divider"></div>;
      }

      const { children } = item;

      if (children && children.length > 0) {
        return renderSubmenu(item, index, children);
      }

      return renderMenuItem(item, index, renderMenuContent(item));
    }

    return (): VNodeChild => (
      <div class="b-dropdown-menu" style={{ width: menuWidth.value }} onContextmenu={(event: MouseEvent): void => event.preventDefault()}>
        {props.options.map((item, index) => renderOption(item, index))}
      </div>
    );
  }
});

export default Menu;
</script>

<style scoped>
.b-dropdown-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  line-height: 32px;
  background: var(--dropdown-bg);
  border: 1px solid var(--dropdown-border);
  border-radius: 6px;
}

.b-dropdown-menu-item {
  display: flex;
  align-items: center;
  padding: 0 8px;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 6px;
}

.b-dropdown-menu-item:hover {
  color: var(--text-primary);
  background-color: var(--dropdown-item-hover-bg);
}

.b-dropdown-menu-item.disabled {
  cursor: default;
  background-color: transparent;
  opacity: 0.3;
}

.b-dropdown-menu-item.danger {
  color: var(--color-danger);
}

.b-dropdown-menu-item-divider {
  height: 1px;
  margin: 3px 8px;
  border-top: 1px solid var(--dropdown-divider);
}

.b-dropdown-menu-item-content {
  display: flex;
  flex: 1;
  align-items: center;
  width: 0;
}
</style>
