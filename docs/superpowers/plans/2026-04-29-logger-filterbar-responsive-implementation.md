# Logger FilterBar Responsive Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `src/views/settings/logger/components/LogFilterBar.vue` 增加响应式“更多筛选”折叠能力，在中窄宽度下保留级别与搜索，将来源和日期收进“更多筛选”入口。

**Architecture:** 保持现有 store 和筛选数据结构不变，只在 `LogFilterBar.vue` 内增加本地展开状态、隐藏筛选是否激活的计算属性，以及基于窗口宽度的响应式分支。测试聚焦 DOM 结构和可见性约束，确保宽屏展示完整筛选，中窄屏收起到“更多筛选”，并在隐藏筛选生效时给按钮激活态。

**Tech Stack:** Vue 3 `script setup`、Pinia、Ant Design Vue、@vueuse/core、Vitest、@vue/test-utils

---

### Task 1: 为 FilterBar 响应式折叠补失败测试

**Files:**
- Create: `test/views/settings/logger/log-filter-bar.component.test.ts`
- Test: `test/views/settings/logger/log-filter-bar.component.test.ts`

- [ ] **Step 1: 写出响应式折叠测试**

```typescript
/**
 * @file log-filter-bar.component.test.ts
 * @description 验证日志过滤栏在窄宽度下将来源和日期折叠进“更多筛选”。
 */
/* @vitest-environment jsdom */

import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LogFilterBar from '@/views/settings/logger/components/LogFilterBar.vue';
import { useLogViewerStore } from '@/views/settings/logger/stores/logViewer';

vi.mock('@/shared/logger', () => ({
  logger: {
    openLogFolder: vi.fn()
  }
}));

/**
 * 挂载过滤栏组件。
 * @returns 挂载结果。
 */
function mountFilterBar(): VueWrapper {
  return mount(LogFilterBar, {
    global: {
      stubs: {
        BButton: {
          props: ['icon', 'type'],
          template: '<button type="button"><slot /></button>'
        },
        BSelect: {
          props: ['value', 'placeholder', 'allowClear'],
          template: '<div class="b-select-stub"><slot /></div>'
        },
        ASelectOption: {
          template: '<div><slot /></div>'
        },
        ADatePicker: {
          props: ['value', 'placeholder'],
          template: '<div class="date-picker-stub"></div>'
        },
        AInputSearch: {
          props: ['value', 'placeholder', 'allowClear'],
          template: '<div class="input-search-stub"></div>'
        },
        ARadioGroup: {
          template: '<div class="radio-group-stub"><slot /></div>'
        },
        ARadioButton: {
          props: ['value'],
          template: '<button type="button"><slot /></button>'
        },
        APopover: {
          props: ['open'],
          template: `
            <div class="popover-stub" :data-open="String(open)">
              <slot />
              <div class="popover-stub__content"><slot name="content" /></div>
            </div>
          `
        }
      }
    }
  });
}

describe('LogFilterBar responsive collapse', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('shows more-filters button and moves scope plus date into popover content on compact width', async () => {
    const widthRef = { value: 960 };
    vi.doMock('@vueuse/core', () => ({
      useWindowSize: () => widthRef
    }));

    const wrapper = mountFilterBar();

    expect(wrapper.find('.log-filter-bar__more-trigger').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__inline-advanced').exists()).toBe(false);
    expect(wrapper.find('.log-filter-bar__popover-content').exists()).toBe(true);
  });

  it('marks more-filters trigger as active when collapsed filters have values', async () => {
    const store = useLogViewerStore();
    store.setScope('renderer');

    const wrapper = mountFilterBar();

    expect(wrapper.get('.log-filter-bar__more-trigger').classes()).toContain('log-filter-bar__more-trigger--active');
  });
});
```

- [ ] **Step 2: 运行测试并确认当前失败**

Run: `pnpm exec vitest run test/views/settings/logger/log-filter-bar.component.test.ts`
Expected: FAIL，提示缺少 `log-filter-bar__more-trigger`、`log-filter-bar__inline-advanced` 或 `log-filter-bar__popover-content`

---

### Task 2: 在 `LogFilterBar.vue` 实现“更多筛选”折叠

**Files:**
- Modify: `src/views/settings/logger/components/LogFilterBar.vue`
- Test: `test/views/settings/logger/log-filter-bar.component.test.ts`

- [ ] **Step 1: 为 `LogFilterBar.vue` 增加响应式折叠实现**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { logger } from '@/shared/logger';
import { useLogViewerStore } from '../stores/logViewer';

const COMPACT_WIDTH = 1100;
const isMoreOpen = ref(false);
const { width } = useWindowSize();
const isCompact = computed(() => width.value <= COMPACT_WIDTH);
const hasCollapsedFilters = computed(() => Boolean(store.filterScope || store.selectedDate));
const shouldShowInlineAdvanced = computed(() => !isCompact.value);
</script>
```

```vue
<template>
  <div class="log-toolbar">
    <div class="log-header">...</div>

    <div class="log-filter-bar">
      <ARadioGroup v-model:value="levelModel">...</ARadioGroup>

      <div v-if="shouldShowInlineAdvanced" class="log-filter-bar__inline-advanced">
        <BSelect ... />
        <ADatePicker ... />
      </div>

      <APopover v-else v-model:open="isMoreOpen" trigger="click" placement="bottomLeft">
        <template #content>
          <div class="log-filter-bar__popover-content">
            <BSelect ... />
            <ADatePicker ... />
          </div>
        </template>

        <BButton
          type="text"
          class="log-filter-bar__more-trigger"
          :class="{ 'log-filter-bar__more-trigger--active': hasCollapsedFilters }"
        >
          更多筛选
        </BButton>
      </APopover>

      <div class="log-filter-bar-spacer"></div>
      <AInputSearch ... />
    </div>
  </div>
</template>
```

```less
.log-filter-bar__inline-advanced {
  display: flex;
  gap: 12px;
  align-items: center;
}

.log-filter-bar__more-trigger {
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  background: var(--bg-primary);

  &--active {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    border-color: var(--color-primary-border);
  }
}

.log-filter-bar__popover-content {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 340px;
}
```

- [ ] **Step 2: 运行新增测试，确认通过**

Run: `pnpm exec vitest run test/views/settings/logger/log-filter-bar.component.test.ts`
Expected: PASS

- [ ] **Step 3: 检查 `LogFilterBar.vue` 诊断**

Run: `pnpm exec eslint src/views/settings/logger/components/LogFilterBar.vue test/views/settings/logger/log-filter-bar.component.test.ts --ext .vue,.ts`
Expected: PASS

---

### Task 3: 收尾验证与日志记录

**Files:**
- Modify: `changelog/2026-04-29.md`
- Test: `test/views/settings/logger/log-filter-bar.component.test.ts`
- Test: `test/views/settings/logger/log-timeline.component.test.ts`

- [ ] **Step 1: 在 changelog 下追加折叠筛选记录**

```markdown
- 为日志过滤栏增加响应式“更多筛选”折叠：窄宽度下保留级别和搜索，将来源与日期收进弹出层，并在隐藏筛选生效时高亮入口。
```

- [ ] **Step 2: 运行定向测试**

Run: `pnpm exec vitest run test/views/settings/logger/log-filter-bar.component.test.ts test/views/settings/logger/log-timeline.component.test.ts`
Expected: PASS

- [ ] **Step 3: 手工验证**

```text
1. 打开 /settings/logger
2. 缩小窗口到中窄宽度，确认来源和日期折叠到“更多筛选”
3. 点击“更多筛选”，确认弹层展示来源和日期控件
4. 选择来源或日期后，确认“更多筛选”入口进入激活态
5. 放大窗口，确认来源和日期回到主工具栏
```
