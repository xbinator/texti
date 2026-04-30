# Logger State Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除日志页专用的 `logViewer` store，让 `src/views/settings/logger/index.vue` 成为日志页唯一状态来源，同时保留 `LogFilterBar.vue` 并通过 `v-model` 双向绑定筛选值。

**Architecture:** 将原本位于 `src/views/settings/logger/stores/logViewer.ts` 的分页、筛选和加载状态迁移到 `index.vue`。`LogFilterBar.vue` 从直接依赖 store 改为受控子组件，只通过 `props` 接收展示值并通过 `update:*` 事件回传输入。测试同步从“store 绑定”重构为“页面状态 + 组件事件”的分层验证。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Ant Design Vue、Pinia（仅移除本页 store 依赖，不新增）、Vitest、Vue Test Utils

---

### Task 1: 先改 `LogFilterBar` 测试，锁定新的受控组件接口

**Files:**
- Modify: `test/views/settings/logger/log-filter-bar.component.test.ts`

- [ ] **Step 1: 将测试改为基于 props 挂载组件，不再依赖 Pinia store**

```ts
/**
 * 挂载过滤栏组件。
 * @param props - 组件属性。
 * @returns 挂载结果。
 */
function mountFilterBar(
  props: {
    count?: number;
    level?: LogLevel | '';
    keyword?: string;
    date?: string;
  } = {}
): VueWrapper {
  return mount(LogFilterBar, {
    props: {
      count: 0,
      level: '',
      keyword: '',
      date: '',
      ...props
    },
    global: {
      stubs: {
        BButton: {
          inheritAttrs: false,
          props: ['icon', 'type'],
          emits: ['click'],
          template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
        },
        BSelect: {
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          emits: ['update:value'],
          template: '<button class="b-select-stub" type="button" :data-value="value" v-bind="$attrs" @click="$emit(\'update:value\', \'ERROR\')"><slot /></button>'
        },
        ASelectOption: {
          template: '<div><slot /></div>'
        },
        ADatePicker: {
          inheritAttrs: false,
          props: ['value', 'placeholder'],
          emits: ['update:value'],
          template: '<button class="date-picker-stub" type="button" :data-value="value" v-bind="$attrs" @click="$emit(\'update:value\', \'2026-04-30\')"></button>'
        },
        AInput: {
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          emits: ['update:value'],
          template: '<button class="input-stub" type="button" :data-value="value" v-bind="$attrs" @click="$emit(\'update:value\', \'timeout\')"></button>'
        }
      }
    }
  });
}
```

- [ ] **Step 2: 把“绑定 store 值”测试改成“读取 props 并通过 v-model 事件回传新值”**

```ts
it('binds incoming props to the filter controls', () => {
  const wrapper = mountFilterBar({
    count: 3,
    level: 'ERROR',
    keyword: 'timeout',
    date: '2026-04-29'
  });

  expect(wrapper.text()).toContain('共 3 条记录');
  expect(wrapper.find('.b-select-stub').attributes('data-value')).toBe('ERROR');
  expect(wrapper.find('.input-stub').attributes('data-value')).toBe('timeout');
  expect(wrapper.find('.date-picker-stub').attributes('data-value')).toBe('2026-04-29');
});

it('emits v-model updates when the user changes filters', async () => {
  const wrapper = mountFilterBar();

  await wrapper.find('.b-select-stub').trigger('click');
  await wrapper.find('.input-stub').trigger('click');
  await wrapper.find('.date-picker-stub').trigger('click');

  expect(wrapper.emitted('update:level')).toEqual([['ERROR']]);
  expect(wrapper.emitted('update:keyword')).toEqual([['timeout']]);
  expect(wrapper.emitted('update:date')).toEqual([['2026-04-30']]);
});
```

- [ ] **Step 3: 运行测试，确认在组件尚未改造前先失败**

Run: `pnpm test test/views/settings/logger/log-filter-bar.component.test.ts`
Expected: FAIL，报错提示组件缺少 `props`/`emits` 接口或事件未触发

- [ ] **Step 4: Commit**

```bash
git add test/views/settings/logger/log-filter-bar.component.test.ts
git commit -m "test(logger): cover controlled filter bar contract"
```

---

### Task 2: 将 `LogFilterBar.vue` 改成受控子组件

**Files:**
- Modify: `src/views/settings/logger/components/LogFilterBar.vue`

- [ ] **Step 1: 定义 `props` 与 `emits`，移除 store 依赖**

```ts
/**
 * 组件属性定义。
 */
interface Props {
  /** 当前页面已加载的日志条数。 */
  count: number;
  /** 当前日志级别筛选。 */
  level: LogLevel | '';
  /** 当前关键词筛选。 */
  keyword: string;
  /** 当前日期筛选。 */
  date: string;
}

/**
 * 组件事件定义。
 */
interface Emits {
  /** 更新日志级别筛选。 */
  (event: 'update:level', value: LogLevel | ''): void;
  /** 更新关键词筛选。 */
  (event: 'update:keyword', value: string): void;
  /** 更新日期筛选。 */
  (event: 'update:date', value: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
```

- [ ] **Step 2: 用 `computed` 把输入控件绑定到 `v-model` 事件**

```ts
/** 日志级别筛选的双向绑定。 */
const levelModel = computed({
  get: (): LogLevel | '' => props.level,
  set: (value: LogLevel | ''): void => emit('update:level', value)
});

/** 日期筛选的双向绑定。 */
const dateModel = computed<string | undefined>({
  get: (): string | undefined => props.date || undefined,
  set: (value: string | undefined): void => emit('update:date', value || '')
});

/** 关键词筛选的双向绑定。 */
const keywordModel = computed<string>({
  get: (): string => props.keyword,
  set: (value: string): void => emit('update:keyword', value)
});
```

- [ ] **Step 3: 更新模板，让记录数读取 `count` 而不是 store**

```vue
<span class="log-header-count">共 {{ count }} 条记录</span>
```

- [ ] **Step 4: 运行测试确认组件接口转绿**

Run: `pnpm test test/views/settings/logger/log-filter-bar.component.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/settings/logger/components/LogFilterBar.vue test/views/settings/logger/log-filter-bar.component.test.ts
git commit -m "refactor(logger): convert filter bar to controlled component"
```

---

### Task 3: 为页面级状态迁移编写失败测试

**Files:**
- Create: `test/views/settings/logger/index.test.ts`

- [ ] **Step 1: 新建页面测试，mock `logger.getLogs` 并 stub 子组件输入事件**

```ts
/**
 * @file index.test.ts
 * @description 验证日志页将状态内聚到页面后仍能正确加载、筛选和分页。
 */
/* @vitest-environment jsdom */

import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoggerView from '@/views/settings/logger/index.vue';
import type { LogEntry } from '@/shared/logger/types';

const getLogsMock = vi.fn();

vi.mock('@/shared/logger', () => ({
  logger: {
    getLogs: getLogsMock,
    openLogFolder: vi.fn()
  }
}));

function createEntry(message: string): LogEntry {
  return {
    timestamp: '2026-04-30 12:00:00.000',
    level: 'INFO',
    scope: 'renderer',
    message
  };
}

function mountLoggerView(): VueWrapper {
  return mount(LoggerView, {
    global: {
      stubs: {
        BScrollbar: {
          emits: ['scroll'],
          template: '<div class="scroll-stub" @scroll="$emit(\'scroll\', $event)"><slot /></div>'
        },
        ASpin: {
          template: '<div class="spin-stub"></div>'
        },
        LogTimeline: {
          props: ['entry'],
          template: '<div class="timeline-stub">{{ entry.message }}</div>'
        },
        LogFilterBar: {
          props: ['count', 'level', 'keyword', 'date'],
          emits: ['update:level', 'update:keyword', 'update:date'],
          template: '<div class="filter-stub"></div>'
        }
      }
    }
  });
}
```

- [ ] **Step 2: 添加页面级核心行为断言**

```ts
it('loads logs on mount with the default page size', async () => {
  getLogsMock.mockResolvedValue([createEntry('first')]);

  mountLoggerView();
  await nextTick();
  await nextTick();

  expect(getLogsMock).toHaveBeenCalledWith({
    limit: 100,
    offset: 0
  });
});

it('resets pagination when a filter changes', async () => {
  getLogsMock
    .mockResolvedValueOnce([createEntry('first')])
    .mockResolvedValueOnce([createEntry('filtered')]);

  const wrapper = mountLoggerView();
  await nextTick();
  await nextTick();

  wrapper.getComponent({ name: 'LogFilterBar' }).vm.$emit('update:keyword', 'timeout');
  await nextTick();
  await nextTick();

  expect(getLogsMock).toHaveBeenLastCalledWith({
    keyword: 'timeout',
    limit: 100,
    offset: 0
  });
});
```

- [ ] **Step 3: 补一个“重置时恢复 hasMore”与“触底走 `onLoadMore`”的断言**

```ts
it('restores pagination after reset and requests the next page on scroll', async () => {
  getLogsMock
    .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => createEntry(`entry-${index}`)))
    .mockResolvedValueOnce([createEntry('next-page')])
    .mockResolvedValueOnce([createEntry('refreshed')]);

  const wrapper = mountLoggerView();
  await nextTick();
  await nextTick();

  const scrollHost = wrapper.get('.scroll-stub').element as HTMLElement;
  Object.defineProperties(scrollHost, {
    scrollTop: { configurable: true, value: 60 },
    scrollHeight: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 20 }
  });

  await wrapper.get('.scroll-stub').trigger('scroll');
  await nextTick();
  await nextTick();

  expect(getLogsMock).toHaveBeenNthCalledWith(2, {
    limit: 100,
    offset: 100
  });

  wrapper.getComponent({ name: 'LogFilterBar' }).vm.$emit('update:level', 'ERROR');
  await nextTick();
  await nextTick();

  expect(getLogsMock).toHaveBeenNthCalledWith(3, {
    level: 'ERROR',
    limit: 100,
    offset: 0
  });
});
```

- [ ] **Step 4: 运行测试并确认在页面尚未迁移前失败**

Run: `pnpm test test/views/settings/logger/index.test.ts`
Expected: FAIL，报错页面仍依赖 `useLogViewerStore` 或筛选事件未驱动页面刷新

- [ ] **Step 5: Commit**

```bash
git add test/views/settings/logger/index.test.ts
git commit -m "test(logger): add page-state localization coverage"
```

---

### Task 4: 将状态和加载逻辑迁移到 `index.vue`

**Files:**
- Modify: `src/views/settings/logger/index.vue`

- [ ] **Step 1: 在页面内声明原 store 持有的状态**

```ts
/** 每页加载的日志条数。 */
const PAGE_SIZE = 100;

/** 当前加载的日志条目列表。 */
const entries = ref<LogEntry[]>([]);
/** 是否正在加载。 */
const isLoading = ref(false);
/** 当前日志级别筛选。 */
const filterLevel = ref<LogLevel | ''>('');
/** 当前关键词筛选。 */
const keyword = ref('');
/** 当前选中的日期筛选。 */
const selectedDate = ref('');
/** 当前分页偏移量。 */
const offset = ref(0);
/** 是否还有更多日志。 */
const hasMore = ref(true);
```

- [ ] **Step 2: 把查询、重置与分页逻辑迁入页面**

```ts
/**
 * 构建当前日志查询参数。
 * @param nextOffset - 本次请求的分页偏移量。
 * @returns 日志查询参数。
 */
function buildQueryOptions(nextOffset: number): LogQueryOptions {
  return {
    level: filterLevel.value || undefined,
    keyword: keyword.value || undefined,
    date: selectedDate.value || undefined,
    limit: PAGE_SIZE,
    offset: nextOffset
  };
}

/**
 * 加载日志列表。
 * @param reset - 是否重置并从第一页开始加载。
 */
async function loadLogs(reset = false): Promise<void> {
  if (isLoading.value) return;
  isLoading.value = true;

  const nextOffset = reset ? 0 : offset.value;

  try {
    const result = await logger.getLogs(buildQueryOptions(nextOffset));

    if (reset) {
      entries.value = result;
      offset.value = result.length;
      hasMore.value = result.length >= PAGE_SIZE;
      return;
    }

    entries.value = [...entries.value, ...result];
    offset.value += result.length;
    hasMore.value = result.length >= PAGE_SIZE;
  } catch {
    // 加载失败时保持现有数据。
  } finally {
    isLoading.value = false;
  }
}

/**
 * 触底时尝试加载更多日志。
 */
function onLoadMore(): void {
  if (!hasMore.value || isLoading.value) return;
  loadLogs(false);
}
```

- [ ] **Step 3: 把模板与筛选栏改为显式双向绑定**

```vue
<LogFilterBar
  v-model:level="filterLevel"
  v-model:keyword="keyword"
  v-model:date="selectedDate"
  :count="entries.length"
/>
```

```ts
function handleScroll(event: Event): void {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  if (scrollHeight - scrollTop - clientHeight < 50) {
    onLoadMore();
  }
}
```

- [ ] **Step 4: 用 `watch` 统一处理筛选刷新，避免首屏重复加载**

```ts
watch([filterLevel, keyword, selectedDate], () => {
  offset.value = 0;
  hasMore.value = true;
  loadLogs(true);
});

onMounted(() => {
  loadLogs(true);
});
```

- [ ] **Step 5: 运行页面测试确认迁移转绿**

Run: `pnpm test test/views/settings/logger/index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/views/settings/logger/index.vue test/views/settings/logger/index.test.ts
git commit -m "refactor(logger): localize page state in logger view"
```

---

### Task 5: 删除 store 并清理引用

**Files:**
- Delete: `src/views/settings/logger/stores/logViewer.ts`
- Modify: `src/views/settings/logger/components/LogFilterBar.vue`
- Search: store 聚合导出文件（如存在）

- [ ] **Step 1: 确认 `LogFilterBar.vue` 已不再导入 `useLogViewerStore`，并删除相关 import 与实例代码**

```ts
import { computed } from 'vue';
import { logger } from '@/shared/logger';
import type { LogLevel } from '@/shared/logger/types';
```

- [ ] **Step 2: 删除页面专用 store 文件**

Run: `rm <project>/src/views/settings/logger/stores/logViewer.ts`
Expected: 文件被删除

- [ ] **Step 3: 搜索并清理残余引用**

Run: `rg -n "useLogViewerStore|stores/logViewer|logViewer" <project>/src <project>/test`
Expected: 不再有 `logViewer` store 的业务引用；若有聚合导出文件命中，继续删除对应 export

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/logger/components/LogFilterBar.vue src/views/settings/logger/stores/logViewer.ts
git commit -m "refactor(logger): remove page-specific log viewer store"
```

---

### Task 6: 最终验证与变更记录

**Files:**
- Modify: `changelog/2026-04-30.md`

- [ ] **Step 1: 在 changelog 中记录这次内部状态重构**

```md
- 将日志查看页状态从 `logViewer` store 收回到 `index.vue`，并把 `LogFilterBar` 改为通过 `v-model` 受控绑定。
```

- [ ] **Step 2: 运行针对性 lint 与测试**

Run: `pnpm exec eslint <project>/src/views/settings/logger/index.vue <project>/src/views/settings/logger/components/LogFilterBar.vue <project>/test/views/settings/logger/log-filter-bar.component.test.ts <project>/test/views/settings/logger/index.test.ts`
Expected: PASS

Run: `pnpm test test/views/settings/logger/log-filter-bar.component.test.ts test/views/settings/logger/index.test.ts test/views/settings/logger/log-timeline.component.test.ts`
Expected: PASS

- [ ] **Step 3: 执行一次 `logger` 页相关引用的最终检查**

Run: `rg -n "useLogViewerStore|stores/logViewer|logViewer" <project>/src <project>/test`
Expected: 只允许命中文档或 changelog，不再命中运行时代码和测试里的旧 store 依赖

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-04-30.md docs/superpowers/specs/2026-04-30-logger-state-localization-design.md docs/superpowers/plans/2026-04-30-logger-state-localization.md
git commit -m "docs(logger): document page state localization"
```
