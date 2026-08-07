<!--
  @file ToolPermissionGrants.vue
  @description 基础设置页 AI 工具始终允许授权管理面板。
-->
<template>
  <div class="basic-tool-permissions">
    <div class="basic-tool-permissions__header">
      <div class="basic-tool-permissions__meta">
        <div class="basic-tool-permissions__label">始终允许</div>
        <div class="basic-tool-permissions__hint">这些工具后续执行时会跳过确认</div>
      </div>
      <BButton v-if="alwaysToolPermissionGrants.length" size="small" type="secondary" @click="handleClearPermissions"> 清除全部 </BButton>
    </div>

    <div v-if="alwaysToolPermissionGrants.length === 0" class="basic-tool-permissions__empty">暂无始终允许的工具</div>
    <div v-else class="basic-tool-permissions__list">
      <div v-for="grant in alwaysToolPermissionGrants" :key="grant.toolName" class="basic-tool-permissions__row">
        <div class="basic-tool-permissions__info">
          <div class="basic-tool-permissions__name">{{ grant.label }}</div>
          <div class="basic-tool-permissions__code">{{ grant.toolName }}</div>
        </div>
        <BButton size="small" type="text" danger @click="handleRevokePermission(grant.toolName)"> 撤销 </BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useChatPermissionStore } from '@/stores/chat/permission';

defineOptions({ name: 'BasicToolPermissionGrants' });

const toolPermissionStore = useChatPermissionStore();

/**
 * 工具授权展示项。
 */
interface ToolPermissionGrantItem {
  /** 工具名称 */
  toolName: string;
  /** 展示名称 */
  label: string;
}

/** 工具名称中文标签。 */
const TOOL_PERMISSION_LABELS: Record<string, string> = {
  operate_current_webpage: '操作当前网页',
  update_settings: '修改应用设置'
};

/**
 * 读取工具展示名称。
 * @param toolName - 工具名称
 * @returns 工具展示名称
 */
function getPermissionLabel(toolName: string): string {
  return TOOL_PERMISSION_LABELS[toolName] ?? toolName;
}

/**
 * 已持久授权的 AI 工具列表。
 */
const alwaysToolPermissionGrants = computed<ToolPermissionGrantItem[]>(() =>
  Object.keys(toolPermissionStore.alwaysToolPermissionGrants)
    .sort()
    .map((toolName) => ({
      toolName,
      label: getPermissionLabel(toolName)
    }))
);

/**
 * 撤销指定工具的始终允许授权。
 * @param toolName - 工具名称
 */
function handleRevokePermission(toolName: string): void {
  toolPermissionStore.revokeToolPermission(toolName);
}

/**
 * 清除全部始终允许授权。
 */
function handleClearPermissions(): void {
  for (const toolName of Object.keys(toolPermissionStore.alwaysToolPermissionGrants)) {
    toolPermissionStore.revokeToolPermission(toolName);
  }
}
</script>

<style scoped lang="less">
.basic-tool-permissions {
  padding: 12px 16px 16px;
}

.basic-tool-permissions__header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.basic-tool-permissions__meta {
  flex: 1;
  min-width: 0;
  padding: 12px 0;
}

.basic-tool-permissions__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.basic-tool-permissions__hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.basic-tool-permissions__empty {
  padding: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) dashed var(--border-primary);
  border-radius: var(--surface-radius);
}

.basic-tool-permissions__list {
  margin-top: 8px;
  overflow: hidden;
  border: var(--surface-border-width) solid var(--border-tertiary);
  border-radius: var(--surface-radius);
}

.basic-tool-permissions__row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 8px 12px;
  background: var(--bg-primary);
}

.basic-tool-permissions__row + .basic-tool-permissions__row {
  border-top: 1px solid var(--border-tertiary);
}

.basic-tool-permissions__info {
  min-width: 0;
}

.basic-tool-permissions__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.basic-tool-permissions__code {
  margin-top: 2px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
