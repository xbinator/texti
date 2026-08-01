<!--
  @file TodoPanel.vue
  @description 聊天侧边栏的待办任务面板，显示当前会话的 LLM 任务列表。
-->
<template>
  <div v-if="todos.length" class="todo-panel">
    <section v-if="visible" class="todo-list">
      <div class="todo-panel__header">
        <span class="todo-panel__title">任务列表</span>
        <span class="todo-panel__progress">{{ completedCount }}/{{ todos.length }}</span>
      </div>

      <TodoList :todos="todos" class="todo-panel__list" />
    </section>

    <div class="todo-panel__footer">
      <BButton type="text" size="small" class="todo-panel__toggle" @click="emit('update:visible', !visible)">
        <BIcon icon="lucide:list-checks" :size="14" class="todo-panel__toggle-icon" />
        <span>任务列表 {{ completedCount }}/{{ todos.length }}</span>
        <BIcon icon="lucide:chevron-down" :size="12" color="var(--text-tertiary)" :rotate="visible ? 180 : 0" />
      </BButton>
      <span v-if="!visible && currentTask" class="todo-panel__current-task">
        <BIcon icon="lucide:circle-dot" :size="12" class="todo-panel__current-task-icon" />
        <span class="todo-panel__current-task-text">{{ currentTask.content }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file TodoPanel.vue
 * @description 聊天侧边栏的待办任务面板，显示当前会话的 LLM 任务列表。
 */
import { computed } from 'vue';
import type { TodoItem } from '@/stores/chat/todo';
import TodoList from './TodoList.vue';

/**
 * TodoPanel 属性
 */
interface TodoPanelProps {
  /** 当前会话的任务列表 */
  todos: TodoItem[];
  /** 面板可见性，支持 v-model:visible */
  visible: boolean;
}

defineOptions({ name: 'TodoPanel' });

const props = defineProps<TodoPanelProps>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

/** 已完成任务数量 */
const completedCount = computed<number>(() => props.todos.filter((t) => t.status === 'completed').length);

/** 当前正在执行的任务（取第一个 in_progress） */
const currentTask = computed<TodoItem | undefined>(() => props.todos.find((t) => t.status === 'in_progress'));
</script>

<style scoped lang="less">
.todo-panel {
  position: relative;
  width: 100%;
  max-width: var(--b-chat-max-width, 800px);
  margin: 0 auto;
}

.todo-list {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
  overflow: hidden;
  background: var(--bg-tertiary);
  border: var(--surface-border-width) solid var(--border-secondary);
  border-radius: var(--surface-radius);
}

.todo-panel__list {
  flex-shrink: 0;
  gap: 8px;
  padding: 8px 12px;
}

.todo-panel__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-secondary);
}

.todo-panel__title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
}

.todo-panel__progress {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}

.todo-panel__footer {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  padding: 4px 12px;
  background: var(--bg-tertiary);
  border: var(--surface-border-width) solid var(--border-secondary);
  border-radius: var(--surface-radius);
}

.todo-panel__current-task {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
}

.todo-panel__current-task-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.todo-panel__toggle-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.todo-panel__current-task-text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>
