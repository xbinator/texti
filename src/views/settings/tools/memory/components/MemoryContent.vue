<!--
  @file MemoryContent.vue
  @description 记忆内容只读展示组件，按分区展示记忆条目，支持鼠标悬停显示重置入口。
-->
<template>
  <div class="memory-content">
    <pre class="memory-settings__pre">{{ content }}</pre>

    <!-- 操作按钮容器：定位在右上角，鼠标悬停容器时显示 -->
    <div class="memory-content__actions">
      <div class="memory-content__reset" @click="handleReset">
        <BIcon icon="lucide:trash-2" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file MemoryContent.vue
 * @description 记忆内容只读展示组件，按分区展示记忆条目，支持鼠标悬停显示重置入口。
 */
import { h } from 'vue';
import type { VNode } from 'vue';
import { message } from 'ant-design-vue';
import { useMemoryStore } from '@/stores/ai/memory';
import { Modal } from '@/utils/modal';

/**
 * 组件 props
 */
interface Props {
  /** 要展示的记忆内容 */
  content: string;
}

defineProps<Props>();

const memoryStore = useMemoryStore();

/** 重置确认弹窗的主文案 */
const RESET_CONFIRM_MAIN = '重置记忆，此操作将清空当前全部记忆，该操作不可恢复';
/** 重置确认弹窗的提示文案（小字灰色） */
const RESET_CONFIRM_HINT = '若「生成对话记忆」处于开启状态，后续对话仍会生成新的记忆；如需彻底停用，请同时关闭记忆功能';

/**
 * 构造重置确认弹窗的内容 VNode：主文案 + 小字灰色提示
 * @returns 内容 VNode
 */
function buildResetConfirmContent(): VNode {
  return h('div', [
    RESET_CONFIRM_MAIN,
    h(
      'div',
      {
        class: 'memory-content-reset-hint'
      },
      RESET_CONFIRM_HINT
    )
  ]);
}

/**
 * 点击重置按钮：弹出确认框，确认后清空全部记忆
 */
async function handleReset(): Promise<void> {
  const [cancelled, confirmed] = await Modal.delete(buildResetConfirmContent(), {
    title: '重置记忆',
    width: 420
  });

  // 用户取消或未确认时直接返回
  if (cancelled || !confirmed) return;

  try {
    await memoryStore.clearAll();
    message.success('记忆已重置');
  } catch {
    message.error('重置记忆失败，请稍后重试');
  }
}
</script>

<style scoped lang="less">
.memory-content {
  position: relative;
  margin: 12px 16px;
}

.memory-settings__pre {
  padding: 12px 16px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-all;
  white-space: pre-wrap;
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-secondary);
  border-radius: var(--surface-radius);
}

.memory-content__actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  align-items: center;
  opacity: 0;
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);

  // 容器悬停时显示操作按钮组
  .memory-content:hover & {
    opacity: 1;
  }
}

.memory-content__reset {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 12px;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--color-danger);
    background: var(--bg-hover);
  }
}

:global(.memory-content-reset-hint) {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
