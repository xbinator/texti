# Logger Layout Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/views/settings/logger` 改造成贴近设计示例的时间轴卡片布局，同时统一顶部标题区、筛选区和页面容器的视觉风格，并保持现有日志查询行为不变。

**Architecture:** 本次改造限定在展示层，沿用现有 `index.vue` + `LogFilterBar.vue` + `LogTimeline.vue` + `logViewer.ts` 的边界。实现上先补一个聚焦 `LogTimeline` 结构的组件回归测试，再重构时间轴模板与样式，最后统一页面容器和过滤栏视觉，并补 changelog 与人工验证。

**Tech Stack:** Vue 3 `script setup`、Pinia、Ant Design Vue、Less、Vitest、@vue/test-utils

---

### Task 1: 为时间轴布局补一个聚焦组件测试

**Files:**
- Create: `test/views/settings/logger/log-timeline.component.test.ts`
- Test: `test/views/settings/logger/log-timeline.component.test.ts`

- [ ] **Step 1: 写出失败中的时间轴结构测试**

```typescript
/**
 * @file log-timeline.component.test.ts
 * @description 验证日志时间轴组件的新布局结构，确保左侧信息列、中轴圆点和右侧消息卡片存在。
 */
/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import LogTimeline from '@/views/settings/logger/components/LogTimeline.vue';
import type { LogEntry } from '@/shared/logger/types';

/**
 * 创建测试日志条目。
 * @param overrides - 覆盖字段。
 * @returns 日志条目。
 */
function createEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-04-29 14:32:11.123',
    scope: 'renderer',
    level: 'ERROR',
    message: 'Failed to fetch ad list: connection timeout (retry 3/3)',
    ...overrides
  };
}

/**
 * 挂载时间轴组件。
 * @param entries - 日志列表。
 * @returns 挂载结果。
 */
function mountTimeline(entries: LogEntry[]): VueWrapper {
  return mount(LogTimeline, {
    props: { entries },
    global: {
      stubs: {
        ATag: {
          props: ['color'],
          template: '<span class="tag-stub" :data-color="color"><slot /></span>'
        }
      }
    }
  });
}

describe('LogTimeline layout', () => {
  it('renders time and scope in the left column and wraps level plus message inside a content card', () => {
    const wrapper = mountTimeline([
      createEntry(),
      createEntry({
        timestamp: '2026-04-29 14:31:58.456',
        scope: 'main',
        level: 'WARN',
        message: 'Cache hit rate below threshold: 42% (expected >=60%)'
      })
    ]);

    const firstItem = wrapper.get('.log-timeline__item');

    expect(firstItem.get('.log-timeline__meta').text()).toContain('14:32:11');
    expect(firstItem.get('.log-timeline__meta').text()).toContain('渲染进程');
    expect(firstItem.find('.log-timeline__axis-dot').classes()).toContain('log-timeline__axis-dot--error');
    expect(firstItem.get('.log-timeline__card').text()).toContain('错误');
    expect(firstItem.get('.log-timeline__card').text()).toContain('Failed to fetch ad list');
  });
});
```

- [ ] **Step 2: 运行测试，确认它在当前实现下失败**

Run: `pnpm test -- test/views/settings/logger/log-timeline.component.test.ts`
Expected: FAIL，提示缺少 `.log-timeline__meta`、`.log-timeline__axis-dot` 或 `.log-timeline__card` 等新结构节点

- [ ] **Step 3: Commit**

```bash
git add test/views/settings/logger/log-timeline.component.test.ts
git commit -m "test(logger): cover timeline card layout"
```

---

### Task 2: 重构 `LogTimeline.vue` 为三列式时间轴卡片布局

**Files:**
- Modify: `src/views/settings/logger/components/LogTimeline.vue`
- Test: `test/views/settings/logger/log-timeline.component.test.ts`

- [ ] **Step 1: 用新模板和样式重写 `LogTimeline.vue`**

```vue
<!--
  @file LogTimeline.vue
  @description 日志时间轴组件，使用左侧信息列、中轴圆点连线和右侧消息卡片展示日志条目。
-->
<template>
  <div class="log-timeline">
    <div
      v-for="(entry, index) in entries"
      :key="`${entry.timestamp}-${entry.scope}-${index}`"
      class="log-timeline__item"
    >
      <div class="log-timeline__meta">
        <div class="log-timeline__time">{{ formatDisplayTime(entry.timestamp) }}</div>
        <div class="log-timeline__scope">{{ getLogScopeLabel(entry.scope) }}</div>
      </div>

      <div class="log-timeline__axis">
        <div
          class="log-timeline__axis-dot"
          :class="`log-timeline__axis-dot--${entry.level.toLowerCase()}`"
        ></div>
        <div v-if="index < entries.length - 1" class="log-timeline__axis-line"></div>
      </div>

      <div class="log-timeline__content">
        <div class="log-timeline__card">
          <div class="log-timeline__card-header">
            <ATag :color="getLogLevelColor(entry.level)">{{ getLogLevelLabel(entry.level) }}</ATag>
          </div>
          <div class="log-timeline__message">{{ entry.message }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { LogEntry } from '@/shared/logger/types';
import { getLogLevelColor, getLogLevelLabel, getLogScopeLabel } from '@/views/settings/logger/constant';

/**
 * 组件属性定义
 */
interface Props {
  /** 日志条目列表 */
  entries: LogEntry[];
}

defineProps<Props>();

/**
 * 提取用于左侧列展示的时间字符串。
 * @param timestamp - 原始时间戳。
 * @returns HH:mm:ss 格式的时间文本。
 */
function formatDisplayTime(timestamp: string): string {
  const match = timestamp.match(/\d{2}:\d{2}:\d{2}/);
  return match ? match[0] : timestamp;
}
</script>

<style scoped lang="less">
.log-timeline {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.log-timeline__item {
  display: grid;
  grid-template-columns: 132px 28px minmax(0, 1fr);
  column-gap: 18px;
  align-items: start;
}

.log-timeline__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  padding-top: 4px;
  text-align: right;
}

.log-timeline__time {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--text-secondary);
}

.log-timeline__scope {
  font-size: 13px;
  line-height: 1.3;
  color: var(--text-secondary);
}

.log-timeline__axis {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  padding-top: 6px;
}

.log-timeline__axis-dot {
  z-index: 1;
  width: 16px;
  height: 16px;
  background: #91caff;
  border: 4px solid var(--bg-primary);
  border-radius: 50%;
}

.log-timeline__axis-dot--error {
  background: #ff4d4f;
}

.log-timeline__axis-dot--warn {
  background: #faad14;
}

.log-timeline__axis-dot--info {
  background: #4096ff;
}

.log-timeline__axis-line {
  position: absolute;
  top: 22px;
  bottom: -18px;
  width: 2px;
  background: var(--border-light);
}

.log-timeline__content {
  min-width: 0;
}

.log-timeline__card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 72px;
  padding: 18px 20px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 18px;
}

.log-timeline__card-header {
  flex-shrink: 0;
  padding-top: 2px;
}

.log-timeline__message {
  min-width: 0;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
```

- [ ] **Step 2: 运行测试，确认新布局结构通过**

Run: `pnpm test -- test/views/settings/logger/log-timeline.component.test.ts`
Expected: PASS

- [ ] **Step 3: 检查新组件诊断**

Run: `pnpm exec vue-tsc --noEmit`
Expected: PASS，`LogTimeline.vue` 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/logger/components/LogTimeline.vue test/views/settings/logger/log-timeline.component.test.ts
git commit -m "feat(logger): redesign timeline card layout"
```

---

### Task 3: 统一页面容器与过滤栏视觉层级

**Files:**
- Modify: `src/views/settings/logger/index.vue`
- Modify: `src/views/settings/logger/components/LogFilterBar.vue`

- [ ] **Step 1: 调整 `index.vue` 容器、空态和加载态样式**

```vue
<!--
  @file index.vue
  @description 日志查看器主页面，使用时间轴卡片布局展示日志，并保留现有触底加载逻辑。
  首次加载在 onMounted 中触发初始日志拉取。
-->
<template>
  <div class="logger-view">
    <LogFilterBar />
    <div class="logger-view__content" @scroll="handleScroll">
      <div v-if="store.entries.length === 0 && !store.isLoading" class="log-empty">
        <AEmpty :image-style="{ height: '120px' }">
          <template #description>
            <div class="log-empty__text">暂无日志数据</div>
            <div class="log-empty__subtext">可能没有产生日志，或者被当前的过滤条件拦截</div>
          </template>
        </AEmpty>
      </div>

      <LogTimeline v-else :entries="store.entries" />

      <div v-if="store.isLoading" class="log-loading">
        <ASpin />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import LogFilterBar from './components/LogFilterBar.vue';
import LogTimeline from './components/LogTimeline.vue';
import { useLogViewerStore } from './stores/logViewer';

/** 日志查看器全局状态 */
const store = useLogViewerStore();

/**
 * 处理滚动事件，触底时加载更多。
 * @param event - 滚动事件对象。
 */
function handleScroll(event: Event): void {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  if (scrollHeight - scrollTop - clientHeight < 50) {
    store.loadMore();
  }
}

onMounted(() => {
  store.loadLogs(true);
});
</script>

<style scoped lang="less">
.logger-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #f6f7f9;
  border: 1px solid var(--border-light);
  border-radius: 20px;
}

.logger-view__content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 48px 0;
  background: transparent;

  &__text {
    margin-top: 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__subtext {
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
}

.log-loading {
  display: flex;
  justify-content: center;
  padding: 24px 0 12px;
}
</style>
```

- [ ] **Step 2: 调整 `LogFilterBar.vue` 标题区、操作区和筛选区样式**

```vue
<!--
  @file LogFilterBar.vue
  @description 日志过滤工具栏，提供级别筛选、来源筛选、搜索和文件夹打开功能。
  交互直接调用 Pinia Store，不通过父组件中转。
-->
<template>
  <div class="log-toolbar">
    <div class="log-header">
      <div class="log-header-title">
        <h3>运行日志</h3>
        <span class="log-header-count">共 {{ store.entries.length }} 条记录</span>
      </div>
      <div class="log-header-actions">
        <BButton icon="lucide:refresh-cw" type="text" @click="store.loadLogs(true)"> 刷新 </BButton>
        <BButton icon="lucide:folder-open" type="text" @click="logger.openLogFolder()"> 打开目录 </BButton>
      </div>
    </div>

    <div class="log-filter-bar">
      <ARadioGroup v-model:value="levelModel">
        <ARadioButton value=""> 全部 </ARadioButton>
        <ARadioButton value="ERROR"> 错误 </ARadioButton>
        <ARadioButton value="WARN"> 警告 </ARadioButton>
        <ARadioButton value="INFO"> 信息 </ARadioButton>
      </ARadioGroup>

      <BSelect v-model:value="scopeModel" placeholder="全部来源" allow-clear style="width: 148px">
        <ASelectOption value=""> 全部来源 </ASelectOption>
        <ASelectOption value="main"> 主进程 </ASelectOption>
        <ASelectOption value="renderer"> 渲染进程 </ASelectOption>
        <ASelectOption value="preload"> 预加载脚本 </ASelectOption>
      </BSelect>

      <ADatePicker v-model:value="dateModel" placeholder="选择日期" style="width: 168px" value-format="YYYY-MM-DD" />

      <div class="log-filter-bar-spacer"></div>

      <AInputSearch v-model:value="keywordModel" placeholder="搜索日志内容..." allow-clear style="width: 320px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { logger } from '@/shared/logger';
import { useLogViewerStore } from '../stores/logViewer';

/** 日志查看器全局状态 */
const store = useLogViewerStore();

/** 级别筛选 v-model 计算属性 */
const levelModel = computed({
  get: () => store.filterLevel,
  set: (val: 'ERROR' | 'WARN' | 'INFO' | '') => store.setLevel(val)
});

/** 来源筛选 v-model 计算属性 */
const scopeModel = computed({
  get: () => store.filterScope,
  set: (val: 'main' | 'renderer' | 'preload' | '') => store.setScope(val)
});

/** 日期筛选 v-model 计算属性 */
const dateModel = computed({
  get: () => store.selectedDate || undefined,
  set: (val: string | undefined) => store.setDate(val || '')
});

/** 关键字搜索 v-model 计算属性 */
const keywordModel = computed({
  get: () => store.keyword,
  set: (val: string) => store.setKeyword(val)
});
</script>

<style scoped lang="less">
.log-toolbar {
  padding: 18px 20px 0;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 16px;
}

.log-header-title {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.log-header-title h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.log-header-count {
  font-size: 13px;
  color: var(--text-tertiary);
}

.log-header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.log-filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 18px;
}

.log-filter-bar-spacer {
  flex: 1;
}
</style>
```

- [ ] **Step 3: 检查最近修改文件的诊断与样式问题**

Run: `pnpm exec eslint src/views/settings/logger/index.vue src/views/settings/logger/components/LogFilterBar.vue src/views/settings/logger/components/LogTimeline.vue --ext .vue`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/views/settings/logger/index.vue src/views/settings/logger/components/LogFilterBar.vue
git commit -m "style(logger): unify page and toolbar layout"
```

---

### Task 4: 补 changelog 并完成最终验证

**Files:**
- Modify: `changelog/2026-04-29.md`
- Test: `test/views/settings/logger/log-timeline.component.test.ts`

- [ ] **Step 1: 在 `changelog/2026-04-29.md` 的 `## Changed` 下追加一条日志查看器布局改版记录**

```markdown
## Changed
- 将日志查看器调整为时间轴卡片布局：左侧展示时间和来源，中轴使用级别圆点与连线，右侧使用消息卡片；同时统一顶部标题区、筛选区和页面容器的视觉层级。
```

- [ ] **Step 2: 运行目标测试和必要检查**

Run: `pnpm test -- test/views/settings/logger/log-timeline.component.test.ts`
Expected: PASS

Run: `pnpm exec vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 手工验证页面效果**

```text
1. 打开 `/settings/logger`
2. 确认顶部显示“运行日志”标题、记录数、刷新和打开目录按钮
3. 确认筛选栏使用统一圆角白色卡片承载
4. 确认日志项左侧为时间和来源，中间为圆点与连线，右侧为消息卡片
5. 分别观察 ERROR / WARN / INFO 的圆点与标签颜色是否正确
6. 拉动滚动条触底，确认可继续加载更多日志
7. 使用长消息日志，确认正文不会横向溢出
```

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-04-29.md
git commit -m "docs(changelog): record logger layout refresh"
```
