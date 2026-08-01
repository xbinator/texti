<!--
  @file ServerCard.vue
  @description MCP Server 卡片组件，展示单个 server 的状态、工具列表与操作入口。
-->
<template>
  <div :class="name">
    <div :class="bem('row')">
      <div :class="bem('icon')">{{ server.name.charAt(0).toUpperCase() }}</div>
      <div :class="bem('info')">
        <div :class="bem('name')">{{ server.name }}</div>
        <div :class="bem('command')">
          <template v-if="server.transport === 'stdio'">{{ server.command }} {{ server.args.join(' ') }}</template>
          <template v-else>{{ server.transport }}</template>
        </div>
        <div v-if="status" :class="bem('status')">
          <span>运行时: {{ statusLabel(status.runtimeStatus, 'runtime') }}</span>
          <span>沙箱: {{ statusLabel(status.sandboxStatus, 'sandbox') }}</span>
          <span>扫描: {{ statusLabel(status.discoveryStatus, 'discovery') }}</span>
          <span v-if="status.message" :class="bem('status-message', { failed: status.runtimeStatus === 'failed' })">{{ status.message }}</span>
        </div>
      </div>
      <div :class="bem('actions')">
        <ASwitch :checked="server.enabled" size="small" @change="(value) => handlePatch({ enabled: Boolean(value) })" />
        <BDropdown placement="bottomRight">
          <button :class="bem('settings-btn')">
            <Icon icon="lucide:settings" :width="16" />
          </button>
          <template #overlay>
            <BDropdownMenu :options="dropdownOptions" :width="120" />
          </template>
        </BDropdown>
      </div>
    </div>

    <div v-if="discoveredTools.length > 0" :class="bem('tools')">
      <div :class="bem('tools-title')" @click="toolsCollapsed = !toolsCollapsed">
        <Icon icon="lucide:hammer" :width="14" :class="bem('tools-icon')" />
        <div :class="bem('tools-title-text')">已发现的工具</div>

        <Icon :icon="toolsCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-right'" :width="14" :class="bem('tools-arrow')" />
      </div>
      <BCollapseTransition>
        <div v-if="toolsCollapsed" :class="bem('tools-body')">
          <div v-for="tool in discoveredTools" :key="tool.toolName" :class="bem('tool-item')">
            <div :class="bem('tool-name')">{{ tool.toolName }}</div>
            <div v-if="tool.description" :class="bem('tool-desc')">{{ tool.description }}</div>
          </div>
        </div>
      </BCollapseTransition>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ServerCard.vue
 * @description MCP Server 卡片组件，展示单个 server 的状态、工具列表与操作入口。
 */
import type { MCPStatusResponse } from 'types/ai';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BDropdownMenu from '@/components/BDropdown/Menu.vue';
import type { DropdownOption } from '@/components/BDropdown/type';
import type { MCPServerConfig, MCPDiscoveredToolSnapshot } from '@/shared/storage/tool-settings';
import { createNamespace } from '@/utils/namespace';

interface Props {
  /** MCP server 配置 */
  server: MCPServerConfig;
  /** 当前 server 的运行状态 */
  status?: MCPStatusResponse | null;
  /** 已发现的工具列表 */
  discoveredTools?: MCPDiscoveredToolSnapshot[];
  /** 是否正在重启 */
  refreshing?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  status: null,
  discoveredTools: () => [],
  refreshing: false
});

const emit = defineEmits<{
  /** 编辑 server */
  (event: 'edit', server: MCPServerConfig): void;
  /** 更新 server 字段 */
  (event: 'patch', serverId: string, patch: Partial<MCPServerConfig>): void;
  /** 删除 server */
  (event: 'remove', serverId: string): void;
  /** 重启 server */
  (event: 'restart', server: MCPServerConfig): void;
  /** 启动 OAuth 认证 */
  (event: 'oauth-start', server: MCPServerConfig): void;
  /** 清除 OAuth 凭据 */
  (event: 'oauth-clear', serverId: string): void;
}>();

const [name, bem] = createNamespace('', 'server-card');

/**
 * 更新 server 配置字段。
 * @param patch - 更新字段
 */
function handlePatch(patch: Partial<MCPServerConfig>): void {
  emit('patch', props.server.id, patch);
}

/** 工具列表折叠状态 */
const toolsCollapsed = ref(false);

/**
 * 是否为远程 server。
 */
const isRemote = computed<boolean>(() => props.server.transport === 'streamableHTTP' || props.server.transport === 'sse');

/**
 * 是否需要 OAuth 认证。
 */
const needsAuth = computed<boolean>(() => props.status?.runtimeStatus === 'needs_auth');

/**
 * 运行时状态中文映射。
 */
const runtimeStatusMap: Record<string, string> = {
  idle: '空闲',
  connecting: '连接中',
  connected: '已连接',
  failed: '失败',
  disabled: '已禁用',
  needs_auth: '需要认证',
  needs_client_registration: '需要客户端注册'
};

/**
 * 沙箱状态中文映射。
 */
const sandboxStatusMap: Record<string, string> = {
  idle: '空闲',
  starting: '启动中',
  running: '运行中',
  failed: '失败'
};

/**
 * 工具发现状态中文映射。
 */
const discoveryStatusMap: Record<string, string> = {
  idle: '空闲',
  refreshing: '刷新中',
  ready: '已完成',
  failed: '失败'
};

/**
 * 将状态值翻译为中文。
 * @param status - 原始状态值
 * @param type - 状态类型
 * @returns 中文状态名称
 */
function statusLabel(status: string, type: 'runtime' | 'sandbox' | 'discovery'): string {
  if (type === 'runtime') {
    return runtimeStatusMap[status] || status;
  }
  if (type === 'sandbox') {
    return sandboxStatusMap[status] || status;
  }
  return discoveryStatusMap[status] || status;
}

/**
 * 下拉菜单选项。
 */
const dropdownOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = [
    {
      type: 'item',
      value: 'edit',
      label: '编辑',
      icon: 'lucide:pencil',
      onClick: () => emit('edit', props.server)
    },
    {
      type: 'item',
      value: 'restart',
      label: props.refreshing ? '重启中…' : '重启',
      icon: 'lucide:refresh-cw',
      disabled: props.refreshing,
      onClick: () => emit('restart', props.server)
    }
  ];

  if (isRemote.value && props.server.oauth) {
    if (needsAuth.value) {
      options.push({
        type: 'item',
        value: 'oauth',
        label: 'OAuth 认证',
        icon: 'lucide:log-in',
        onClick: () => emit('oauth-start', props.server)
      });
    }
    options.push({
      type: 'item',
      value: 'clear-oauth',
      label: '清除 OAuth',
      icon: 'lucide:log-out',
      onClick: () => emit('oauth-clear', props.server.id)
    });
  }

  options.push(
    { type: 'divider' },
    {
      type: 'item',
      value: 'delete',
      label: '删除',
      icon: 'lucide:trash-2',
      danger: true,
      onClick: () => emit('remove', props.server.id)
    }
  );

  return options;
});
</script>

<style scoped lang="less">
.server-card {
  padding: 12px 16px;
  border-top: var(--surface-border-width) solid var(--border-tertiary);
}

.server-card__row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.server-card__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

.server-card__info {
  flex: 1;
  min-width: 0;
}

.server-card__name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.server-card__command {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.server-card__status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.server-card__status-message {
  color: var(--text-tertiary);

  &.server-card__status-message--failed {
    color: var(--color-error);
  }
}

.server-card__actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
}

.server-card__settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-base) var(--motion-easing-standard), color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
}

.server-card__tools {
  padding: 12px;
  margin-top: 12px;
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.server-card__tools-title {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
}

.server-card__tools-icon {
  flex-shrink: 0;
  margin-right: 4px;
}

.server-card__tools-title-text {
  flex: 1;
  user-select: none;
}

.server-card__tools-arrow {
  flex-shrink: 0;
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

.server-card__tools-body {
  margin-top: 10px;
}

.server-card__tool-item {
  padding: 6px 8px;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);

  + .server-card__tool-item {
    margin-top: 4px;
  }

  &:hover {
    background: var(--bg-tertiary);
  }
}

.server-card__tool-name {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
}

.server-card__tool-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
