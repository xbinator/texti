<!--
  @file index.vue
  @description 基础设置页，管理配色方案、编辑器视图偏好与保存策略。
-->
<template>
  <SettingsPage :title="MENU_ITEMS.basic.label">
    <SettingsSection title="通用设置">
      <SettingsItem label="外观">
        <BSelect :value="settingStore.theme" :options="themeOptions" :width="280" @change="handleThemeChange" />
      </SettingsItem>
      <SettingsItem label="主题">
        <BSelect :value="settingStore.themePreset" :options="presetOptions" :width="280" @change="handlePresetChange" />
      </SettingsItem>
    </SettingsSection>

    <SettingsSection title="字体设置">
      <SettingsItem label="样式">
        <BSelect :value="settingStore.defaultFontStyle" :options="defaultFontStyleOptions" :width="280" @change="handleDefaultFontStyleChange" />
      </SettingsItem>

      <SettingsItem label="大小" :control-width="280">
        <BInputNumber
          :value="settingStore.rootFontSize"
          :min="ROOT_FONT_SIZE_MIN"
          :max="ROOT_FONT_SIZE_MAX"
          :step="ROOT_FONT_SIZE_STEP"
          :precision="0"
          :default-value="ROOT_FONT_SIZE_DEFAULT"
          @update:value="handleRootFontSizeChange"
        />
      </SettingsItem>
    </SettingsSection>

    <SettingsSection title="编辑器">
      <SettingsItem label="自动保存">
        <BSelect :value="editorStore.saveStrategy" :options="saveStrategyOptions" :width="280" @change="handleSaveStrategyChange" />
      </SettingsItem>

      <SettingsItem label="默认视图模式">
        <BSelect :value="editorStore.viewMode" :options="viewModeOptions" :width="280" @change="handleViewModeChange" />
      </SettingsItem>

      <SettingsItem label="页面宽度">
        <BSelect :value="editorStore.pageWidth" :options="pageWidthOptions" :width="280" @change="handlePageWidthChange" />
      </SettingsItem>
    </SettingsSection>

    <SettingsSection title="AI 工具权限">
      <ToolPermissionGrants />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SelectOption } from '@/components/BSelect/types';
import type { EditorViewMode, EditorPageWidth, EditorSaveStrategy } from '@/stores/editor/preferences';
import { useEditorPreferencesStore } from '@/stores/editor/preferences';
import type { DefaultFontStyle, ThemeMode } from '@/stores/ui/setting';
import { ROOT_FONT_SIZE_DEFAULT, ROOT_FONT_SIZE_MAX, ROOT_FONT_SIZE_MIN, useSettingStore } from '@/stores/ui/setting';
import { getPresetList } from '@/theme';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';
import SettingsItem from './components/SettingsItem.vue';
import ToolPermissionGrants from './components/ToolPermissionGrants.vue';
import { getCurrentFontPlatform, getDefaultFontStyleOptions } from './fontOptions';

const editorStore = useEditorPreferencesStore();
const settingStore = useSettingStore();

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
 * 默认字体样式选项，根据当前系统展示常见中文字体。
 */
const defaultFontStyleOptions = computed<SelectOption[]>(() => getDefaultFontStyleOptions(getCurrentFontPlatform(), settingStore.defaultFontStyle));

/**
 * 应用界面根字号输入步进。
 */
const ROOT_FONT_SIZE_STEP = 1;

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
 * 处理默认字体样式变更。
 * @param value - 新的默认字体样式
 */
function handleDefaultFontStyleChange(value: string | number): void {
  settingStore.setDefaultFontStyle(value as DefaultFontStyle);
}

/**
 * 处理界面根字号变更。
 * @param value - 新的根字号
 */
function handleRootFontSizeChange(value: string | number): void {
  settingStore.setRootFontSize(Number(value));
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
</script>
