<!--
  @file WidgetItemRow.vue
  @description 小组件列表项行组件，展示单个小组件的名称、描述及启用开关。
-->
<template>
  <div class="widget-settings__item-row" role="button" tabindex="0" @click="handleOpenWidget">
    <div class="widget-settings__item-icon">{{ initial }}</div>
    <div class="widget-settings__item-info">
      <div class="widget-settings__item-name">
        {{ widget.name }}
        <span v-if="widget.parseError" class="widget-settings__item-error-badge" :title="widget.parseError">
          <Icon icon="lucide:alert-triangle" :width="12" />
        </span>
      </div>
      <div class="widget-settings__desc">{{ description }}</div>
      <div v-if="widget.parseError" class="widget-settings__item-parse-error">{{ widget.parseError }}</div>
    </div>
    <div class="widget-settings__item-actions" @click.stop>
      <ASwitch :checked="widget.enabled" size="small" :disabled="!!widget.parseError" @change="handleToggle" />
      <BDropdown placement="bottomRight" :disabled="deleting">
        <BButton type="ghost" size="small" square icon="lucide:settings" title="小组件设置" aria-label="小组件设置" :disabled="deleting" />
        <template #overlay>
          <BDropdownMenu :options="dropdownOptions" :width="120" />
        </template>
      </BDropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import type { WidgetDefinition } from '@/ai/widget/types';
import type { DropdownOption } from '@/components/BDropdown/type';
import { useNavigate } from '@/hooks/useNavigate';
import { native } from '@/shared/platform';
import { useWidgetStore } from '@/stores/ai/widget';
import logger from '@/utils/logger';
import { Modal } from '@/utils/modal';

/**
 * 小组件列表项属性。
 */
interface Props {
  /** 小组件定义 */
  widget: WidgetDefinition;
}

const props = defineProps<Props>();
const store = useWidgetStore();
const { openWidgetFile } = useNavigate();
/** 当前小组件是否正在执行删除流程。 */
const deleting = ref(false);

/** 小组件名称首字母，用于图标展示。 */
const initial = computed<string>(() => props.widget.name.charAt(0).toUpperCase());
/** 展示描述，无描述时回退到文件路径。 */
const description = computed<string>(() => props.widget.description || props.widget.filePath);

/**
 * 打开小组件编辑器，正文由目标页面文件会话从磁盘加载。
 */
async function handleOpenWidget(): Promise<void> {
  if (deleting.value) {
    return;
  }

  try {
    await openWidgetFile(props.widget.id);
  } catch (error: unknown) {
    logger.error('Open widget editor failed:', error);
    message.error('无法打开小组件编辑器');
  }
}

/**
 * 切换小组件启用状态。
 */
function handleToggle(): void {
  store.toggleWidget(props.widget.id);
}

/**
 * 将当前小组件的整个资源目录移入系统回收站，并刷新 Store。
 */
async function handleDeleteWidget(): Promise<void> {
  if (deleting.value) {
    return;
  }

  // 删除锁覆盖确认弹窗和文件操作，避免快速重复点击生成多个确认流程。
  deleting.value = true;
  let movedToTrash = false;
  try {
    const [, confirmed] = await Modal.delete(`确定要删除小组件 "${props.widget.name}" 吗？整个目录及其中的附属文件都会移入系统回收站。`);

    if (!confirmed) {
      return;
    }

    await native.trashFile(props.widget.dirPath);
    movedToTrash = true;
    await store.rescan();
    message.success(`小组件 "${props.widget.name}" 已删除`);
  } catch (error: unknown) {
    // 目录已移入回收站时只提示刷新失败，避免误导用户重复删除。
    if (movedToTrash) {
      logger.warn('Refresh widgets after deletion failed:', error);
      message.warning(`小组件 "${props.widget.name}" 已移入回收站，但列表刷新失败`);
    } else {
      logger.error('Delete widget failed:', error);
      const reason = error instanceof Error ? error.message : String(error);
      message.error(`删除小组件 "${props.widget.name}" 失败：${reason}`);
    }
  } finally {
    deleting.value = false;
  }
}

/** 小组件设置菜单。 */
const dropdownOptions = computed<DropdownOption[]>(() => [
  {
    type: 'item',
    value: 'edit',
    label: '编辑',
    disabled: deleting.value,
    onClick: handleOpenWidget
  },
  { type: 'divider' },
  {
    type: 'item',
    value: 'delete',
    label: '删除',
    danger: true,
    disabled: deleting.value,
    onClick: handleDeleteWidget
  }
]);
</script>

<style scoped lang="less">
.widget-settings__item-row {
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  outline: none;
}

.widget-settings__item-icon {
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

.widget-settings__item-info {
  flex: 1;
  min-width: 0;
}

.widget-settings__item-name {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: text;
}

.widget-settings__item-error-badge {
  display: inline-flex;
  align-items: center;
  color: var(--color-warning, #faad14);
}

.widget-settings__desc {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.widget-settings__item-parse-error {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-danger, #ff4d4f);
}

.widget-settings__item-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
}
</style>
