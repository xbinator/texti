# SessionHistory 虚拟滚动实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SessionHistory 引入虚拟滚动，优化大量会话时的渲染性能。

**Architecture:** 将分组数据扁平化为统一数组，使用 @vueuse/core 的 useVirtualList 实现虚拟滚动，动态高度适配分组标题（24px）和会话项（32px）。

**Tech Stack:** Vue 3 Composition API, @vueuse/core, TypeScript

---

## 文件改动概览

| 文件 | 改动 |
|------|------|
| `src/components/BChatSidebar/components/SessionHistory.vue` | useVirtualList 集成，扁平化数据，动态高度虚拟滚动 |

---

## Task 1: 实现虚拟滚动

**Files:**
- Modify: `src/components/BChatSidebar/components/SessionHistory.vue`

- [ ] **Step 1: 导入 useVirtualList**

```typescript
import { useVirtualList } from '@vueuse/core';
```

- [ ] **Step 2: 定义扁平化数据结构**

```typescript
interface FlatItem {
  type: 'header' | 'session';
  key: string;
  label?: string;
  session?: ChatSession;
}
```

- [ ] **Step 3: 创建 flatItems computed**

```typescript
const flatItems = computed<FlatItem[]>(() => {
  const result: FlatItem[] = [];
  groupedSessions.value.forEach((group) => {
    result.push({ type: 'header', key: `header-${group.key}`, label: group.label });
    group.sessions.forEach((session) => {
      result.push({ type: 'session', key: session.id, session });
    });
  });
  return result;
});
```

- [ ] **Step 4: 使用 useVirtualList**

```typescript
const { list, containerProps, wrapperProps } = useVirtualList(flatItems, {
  itemHeight: (index) => (flatItems.value[index]?.type === 'header' ? 24 : 32),
  overscan: 5
});
```

- [ ] **Step 5: 更新模板渲染**

替换原有 v-for：

```html
<div class="session-history__list" v-bind="containerProps">
  <div class="session-history__list-inner" v-bind="wrapperProps">
    <template v-for="{ data, index } in list" :key="data.key">
      <div v-if="data.type === 'header'" class="session-history__group-title">
        {{ data.label }}
      </div>
      <div
        v-else
        class="session-history__item"
        :class="{ 'is-active': data.session?.id === props.activeSessionId }"
        @click="handleSwitchSession(data.session!.id)"
      >
        <span class="session-history__content">
          <span class="session-history__item-title">{{ data.session?.title }}</span>
        </span>
        <span class="session-history__actions">
          <BButton type="text" square danger size="small" @click.stop="handleDeleteSession(data.session!.id)">
            <Icon icon="lucide:trash-2" width="14" height="14" />
          </BButton>
        </span>
      </div>
    </template>
  </div>
</div>
```

- [ ] **Step 6: 更新样式**

```less
.session-history__list {
  overflow-y: auto;
  max-height: 260px;
}

.session-history__list-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

---

## Task 2: 验证

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
node node_modules/typescript/bin/tsc --noEmit
```

预期：无类型错误

- [ ] **Step 2: 测试场景**

1. 创建多个会话，验证历史下拉列表正常显示
2. 验证分组标题正确显示
3. 验证切换会话、删除会话功能正常

---

**Plan complete.**