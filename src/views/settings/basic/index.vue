<!--
  @file index.vue
  @description 基础设置页，管理配色方案、编辑器视图偏好与保存策略。
-->
<template>
  <SettingsPage :title="MENU_ITEMS.basic.label">
    <SettingsSection title="配色方案">
      <div class="basic-settings__item">
        <div class="basic-settings__meta">
          <div class="basic-settings__label">外观</div>
        </div>
        <div>
          <BSelect :value="settingStore.theme" :options="themeOptions" :width="280" @change="handleThemeChange" />
        </div>
      </div>
      <div class="basic-settings__item">
        <div class="basic-settings__meta">
          <div class="basic-settings__label">主题风格</div>
        </div>
        <div>
          <BSelect :value="settingStore.themePreset" :options="presetOptions" :width="280" @change="handlePresetChange" />
        </div>
      </div>
    </SettingsSection>

    <SettingsSection title="编辑器">
      <div class="basic-settings__item">
        <div class="basic-settings__meta">
          <div class="basic-settings__label">自动保存</div>
        </div>
        <div>
          <BSelect :value="editorStore.saveStrategy" :options="saveStrategyOptions" :width="280" @change="handleSaveStrategyChange" />
        </div>
      </div>

      <div class="basic-settings__item">
        <div class="basic-settings__meta">
          <div class="basic-settings__label">默认视图模式</div>
        </div>
        <div>
          <BSelect :value="editorStore.viewMode" :options="viewModeOptions" :width="280" @change="handleViewModeChange" />
        </div>
      </div>

      <div class="basic-settings__item">
        <div class="basic-settings__meta">
          <div class="basic-settings__label">页面宽度</div>
        </div>
        <div>
          <BSelect :value="editorStore.pageWidth" :options="pageWidthOptions" :width="280" @change="handlePageWidthChange" />
        </div>
      </div>
    </SettingsSection>

    <SettingsSection title="AI 工具权限">
      <div class="basic-settings__permission-panel">
        <div class="basic-settings__permission-header">
          <div class="basic-settings__meta">
            <div class="basic-settings__label">始终允许</div>
            <div class="basic-settings__hint">这些工具后续执行时会跳过确认</div>
          </div>
          <BButton v-if="alwaysToolPermissionGrants.length" size="small" type="secondary" @click="handleClearAlwaysToolPermissions"> 清除全部 </BButton>
        </div>

        <div v-if="alwaysToolPermissionGrants.length === 0" class="basic-settings__permission-empty">暂无始终允许的工具</div>
        <div v-else class="basic-settings__permission-list">
          <div v-for="grant in alwaysToolPermissionGrants" :key="grant.toolName" class="basic-settings__permission-row">
            <div class="basic-settings__permission-info">
              <div class="basic-settings__permission-name">{{ grant.label }}</div>
              <div class="basic-settings__permission-code">{{ grant.toolName }}</div>
            </div>
            <BButton size="small" type="text" danger @click="handleRevokeToolPermission(grant.toolName)"> 撤销 </BButton>
          </div>
        </div>
      </div>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SelectOption } from '@/components/BSelect/types';
import { useChatPermissionStore } from '@/stores/chat/permission';
import type { EditorViewMode, EditorPageWidth, EditorSaveStrategy } from '@/stores/editor/preferences';
import { useEditorPreferencesStore } from '@/stores/editor/preferences';
import type { ThemeMode } from '@/stores/ui/setting';
import { useSettingStore } from '@/stores/ui/setting';
import { getPresetList } from '@/theme';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';

const editorStore = useEditorPreferencesStore();
const settingStore = useSettingStore();
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
  operate_webpage: '操作当前网页',
  update_settings: '修改应用设置'
};

/**
 * 配色方案选项。
 */
const themeOptions: SelectOption[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色主题' },
  { value: 'dark', label: '深色主题' }
];

/**
 * 主题风格选项，从注册表动态获取。
 */
const presetOptions = computed<SelectOption[]>(() => getPresetList().map((p) => ({ value: p.id, label: p.label })));

/**
 * 默认视图模式选项。
 */
const viewModeOptions: SelectOption[] = [
  { value: 'rich', label: '富文本' },
  { value: 'source', label: '源码' }
];

/**
 * 页宽模式选项。
 */
const pageWidthOptions: SelectOption[] = [
  { value: 'default', label: '默认' },
  { value: 'wide', label: '宽版' },
  { value: 'full', label: '全宽' }
];

/**
 * 保存策略选项。
 */
const saveStrategyOptions: SelectOption[] = [
  { value: 'off', label: '关闭', tips: '不自动保存，需手动保存所有更改' },
  { value: 'onBlur', label: '失焦保存', tips: '编辑器失去焦点时，自动保存已修改的内容' },
  { value: 'onChange', label: '实时保存', tips: '内容变更时立即自动保存' }
];

/**
 * 读取工具展示名称。
 * @param toolName - 工具名称
 * @returns 工具展示名称
 */
function getToolPermissionLabel(toolName: string): string {
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
      label: getToolPermissionLabel(toolName)
    }))
);

/**
 * 处理配色方案变更。
 * @param value - 新的主题模式
 */
function handleThemeChange(value: string | number): void {
  settingStore.setTheme(value as ThemeMode);
}

/**
 * 处理主题风格变更。
 * @param value - 新的预设 ID
 */
function handlePresetChange(value: string | number): void {
  settingStore.setThemePreset(value as string);
}

/**
 * 处理默认视图模式变更。
 * @param value - 新的默认视图模式
 */
function handleViewModeChange(value: string | number): void {
  editorStore.setViewMode(value as EditorViewMode);
}

/**
 * 处理页面宽度变更。
 * @param value - 新的页面宽度模式
 */
function handlePageWidthChange(value: string | number): void {
  editorStore.setPageWidth(value as EditorPageWidth);
}

/**
 * 处理自动保存策略变更。
 * @param value - 新的自动保存策略
 */
function handleSaveStrategyChange(value: string | number): void {
  editorStore.setSaveStrategy(value as EditorSaveStrategy);
}

/**
 * 撤销指定工具的始终允许授权。
 * @param toolName - 工具名称
 */
function handleRevokeToolPermission(toolName: string): void {
  toolPermissionStore.revokeToolPermission(toolName);
}

/**
 * 清除全部始终允许授权。
 */
function handleClearAlwaysToolPermissions(): void {
  for (const toolName of Object.keys(toolPermissionStore.alwaysToolPermissionGrants)) {
    toolPermissionStore.revokeToolPermission(toolName);
  }
}
</script>

<style scoped lang="less">
// ─── Item ─────────────────────────────────────────────────────────────────────
.basic-settings__item {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 16px;
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  & + & {
    border-top: var(--surface-border-width) solid var(--border-tertiary);
  }

  &:hover {
    background: var(--bg-hover);
  }

  &:focus-within {
    background: var(--bg-hover);
  }
}

.basic-settings__meta {
  flex: 1;
  min-width: 0;
  padding: 12px 0;
}

.basic-settings__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.basic-settings__hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.basic-settings__permission-panel {
  padding: 12px 16px 16px;
}

.basic-settings__permission-header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.basic-settings__permission-empty {
  padding: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) dashed var(--border-primary);
  border-radius: var(--surface-radius);
}

.basic-settings__permission-list {
  margin-top: 8px;
  overflow: hidden;
  border: var(--surface-border-width) solid var(--border-tertiary);
  border-radius: var(--surface-radius);
}

.basic-settings__permission-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 8px 12px;
  background: var(--bg-primary);
}

.basic-settings__permission-row + .basic-settings__permission-row {
  border-top: 1px solid var(--border-tertiary);
}

.basic-settings__permission-info {
  min-width: 0;
}

.basic-settings__permission-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.basic-settings__permission-code {
  margin-top: 2px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
  font-size: 11px;
  color: var(--text-tertiary);
}

// ─── Responsive ───────────────────────────────────────────────────────────────

@media (width <= 720px) {
  .basic-settings__item {
    flex-direction: column;
    align-items: flex-start;

    :deep(.b-select) {
      width: 100%;
    }
  }
}

// ─── Accessibility ────────────────────────────────────────────────────────────

@media (prefers-reduced-motion: reduce) {
  .basic-settings__item {
    transition: none;
  }
}
</style>
