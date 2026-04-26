# SessionHistory 虚拟滚动实现

## 背景

SessionHistory 组件会话列表无虚拟滚动，当会话数量增多时会导致性能问题。

## 目标

引入虚拟滚动，优化大量会话时的渲染性能。

## 设计

### 1. 数据扁平化

将 `groupedSessions` 转换为扁平数组：

```typescript
interface FlatItem {
  type: 'header' | 'session';
  key: string;
  label?: string;
  session?: ChatSession;
}

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

### 2. useVirtualList 集成

```typescript
const { list, containerProps, wrapperProps } = useVirtualList(flatItems, {
  itemHeight: 32,
  overscan: 5
});
```

### 3. 渲染适配

- `item.data.type === 'header'` → 渲染分组标题（高度 24px）
- `item.data.type === 'session'` → 渲染会话项（高度 32px）

```html
<div v-bind="containerProps" class="session-history__list">
  <div v-bind="wrapperProps">
    <div v-for="{ data, index } in list" :key="data.key" class="session-history__item" :class="data.type === 'header' ? 'session-history__group-title' : ''">
      <template v-if="data.type === 'header'">
        {{ data.label }}
      </template>
      <template v-else>
        <!-- session item content -->
      </template>
    </div>
  </div>
</div>
```

### 4. 动态高度

分组标题高度 24px，会话项高度 32px：

```typescript
const { list, containerProps, wrapperProps } = useVirtualList(flatItems, {
  itemHeight: (index) => flatItems.value[index].type === 'header' ? 24 : 32,
  overscan: 5
});
```

## 改动范围

| 文件 | 改动 |
|------|------|
| `SessionHistory.vue` | 引入 useVirtualList，数据扁平化，替换原 v-for 为虚拟滚动 |