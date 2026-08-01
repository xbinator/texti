/**
 * @file theme-page-token-styles.test.ts
 * @description Verifies page-level and default layout chrome consume theme design tokens.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 读取源码。
 * @param filePath - 仓库相对文件路径
 * @returns 文件源码
 */
function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

describe('page theme token styles', (): void => {
  it('uses design tokens in default layout chrome', (): void => {
    const layoutSource = readSource('src/layouts/default/index.vue');
    const updateNoticeSource = readSource('src/layouts/default/components/HeaderUpdateNotice.vue');
    const tabMenuSource = readSource('src/layouts/default/components/HeaderTabMenu.vue');
    const headerTabSource = readSource('src/layouts/default/components/HeaderTab.vue');
    const dropZoneSource = readSource('src/layouts/default/components/MainDropZone.vue');
    const shortcutsSource = readSource('src/layouts/default/components/ShortcutsHelp.vue');
    const chatSiderSource = readSource('src/layouts/default/components/ChatSider.vue');

    expect(layoutSource).toContain('transition: background var(--motion-duration-base) var(--motion-easing-standard);');
    expect(layoutSource).toContain('overflow: hidden;');
    expect(layoutSource).toContain('overflow-x: clip;');
    expect(layoutSource).toContain('min-width: 0;');
    expect(layoutSource).not.toContain('<BButton icon="lucide:blocks"');
    expect(layoutSource).toContain('class="b-layout-welcome-tab"');
    expect(layoutSource).toContain('border: var(--button-border-width) solid var(--button-border);');
    expect(layoutSource).toContain('box-shadow: var(--button-pressed-shadow);');
    expect(layoutSource).toContain('transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));');
    expect(updateNoticeSource).toContain('border: var(--control-border-width) solid color-mix');
    expect(updateNoticeSource).toContain('border-radius: var(--radius-full);');
    expect(updateNoticeSource).toContain('background var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(tabMenuSource).toContain('border: var(--overlay-border-width) solid var(--dropdown-border);');
    expect(tabMenuSource).toContain('border-radius: var(--overlay-radius);');
    expect(tabMenuSource).toContain('box-shadow: var(--shadow-lg);');
    expect(tabMenuSource).toContain('border-radius: var(--control-radius);');
    expect(headerTabSource).toContain('border-radius: var(--control-radius);');
    expect(headerTabSource).toContain('border: var(--button-border-width) solid var(--button-border);');
    expect(headerTabSource).toContain('box-shadow: var(--button-shadow);');
    expect(headerTabSource).toContain('box-shadow: var(--button-active-shadow);');
    expect(headerTabSource).toContain('transition: color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(headerTabSource).toContain('border-radius: var(--radius-full);');
    expect(dropZoneSource).toContain('border-radius: var(--surface-radius);');
    expect(shortcutsSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(shortcutsSource).toContain('border-radius: var(--overlay-radius);');
    expect(shortcutsSource).toContain('border-radius: var(--control-radius);');
    expect(shortcutsSource).toContain('font-family: var(--font-mono);');
    expect(chatSiderSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(chatSiderSource).toContain('border-radius: var(--surface-radius);');
  });

  it('uses design tokens in page shells and navigation surfaces', (): void => {
    const welcomeSource = readSource('src/views/welcome/index.vue');
    const skillSource = readSource('src/views/skill/index.vue');
    const chatSource = readSource('src/views/chat/index.vue');
    const settingsSource = readSource('src/views/settings/index.vue');
    const basicSettingsSource = readSource('src/views/settings/basic/index.vue');
    const widgetSource = readSource('src/views/widget/index.vue');
    const providerDetailSource = readSource('src/views/settings/provider/detail.vue');

    expect(welcomeSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(welcomeSource).toContain('border-radius: var(--surface-radius);');
    expect(welcomeSource).toContain('border-radius: var(--control-radius);');
    expect(welcomeSource).toContain('background var(--motion-duration-base) var(--motion-easing-standard)');
    expect(skillSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(skillSource).toContain('border-radius: var(--surface-radius);');
    expect(skillSource).toContain('border: var(--control-border-width) solid var(--border-tertiary);');
    expect(skillSource).toContain('opacity var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(chatSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(chatSource).toContain('border-radius: var(--surface-radius);');
    expect(settingsSource).not.toContain('<BButton');
    expect(settingsSource).toContain('<div class="sidebar-item"');
    expect(settingsSource).toContain('class="sidebar-item"');
    expect(settingsSource).toContain('class="sidebar-collapse-btn"');
    expect(settingsSource).toContain('<button type="button" class="sidebar-collapse-btn"');
    expect(settingsSource).toContain('border: var(--button-border-width) solid var(--button-border);');
    expect(settingsSource).toContain('border-radius: var(--control-radius);');
    expect(settingsSource).toContain('transition: width var(--motion-duration-slow) var(--motion-easing-standard);');
    expect(settingsSource).toContain('box-shadow: var(--button-shadow);');
    expect(settingsSource).toContain('box-shadow: var(--button-active-shadow);');
    expect(settingsSource).toContain('box-shadow: var(--button-pressed-shadow);');
    expect(settingsSource).toContain('transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));');
    expect(basicSettingsSource).toContain('border: var(--surface-border-width) dashed var(--border-primary);');
    expect(basicSettingsSource).toContain('border-radius: var(--surface-radius);');
    expect(widgetSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(widgetSource).toContain('border-radius: var(--surface-radius);');
    expect(widgetSource).toContain('border-radius: var(--control-radius);');
    expect(providerDetailSource).toContain('border-radius: var(--surface-radius);');
  });

  it('uses design tokens in settings tool pages', (): void => {
    const logTimelineSource = readSource('src/views/settings/logger/components/LogTimeline.vue');
    const serverEditorSource = readSource('src/views/settings/tools/mcp/components/ServerEditor.vue');
    const serverCardSource = readSource('src/views/settings/tools/mcp/components/ServerCard.vue');
    const memoryInputSource = readSource('src/views/settings/tools/memory/components/MemoryInput.vue');
    const memoryContentSource = readSource('src/views/settings/tools/memory/components/MemoryContent.vue');
    const skillCreatorSource = readSource('src/views/settings/tools/skill/components/SkillCreator.vue');
    const skillItemSource = readSource('src/views/settings/tools/skill/components/SkillItemRow.vue');
    const skillIndexSource = readSource('src/views/settings/tools/skill/index.vue');
    const widgetCreatorSource = readSource('src/views/settings/tools/widget/components/WidgetCreator.vue');
    const widgetItemSource = readSource('src/views/settings/tools/widget/components/WidgetItemRow.vue');
    const widgetIndexSource = readSource('src/views/settings/tools/widget/index.vue');

    expect(logTimelineSource).toContain('font-family: var(--font-mono);');
    expect(logTimelineSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(logTimelineSource).toContain('border-radius: var(--surface-radius);');
    expect(logTimelineSource).toContain('border-radius: var(--control-radius);');
    expect(logTimelineSource).toContain('border-radius: var(--radius-full);');
    expect(serverEditorSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(serverEditorSource).toContain('border-radius: var(--input-radius);');
    expect(serverEditorSource).toContain('font-family: var(--font-mono);');
    expect(serverCardSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(serverCardSource).toContain('border-radius: var(--surface-radius);');
    expect(serverCardSource).toContain('border-radius: var(--control-radius);');
    expect(serverCardSource).toContain('font-family: var(--font-mono);');
    expect(memoryInputSource).toContain('border-radius: var(--radius-full);');
    expect(memoryInputSource).toContain('transition: color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(memoryContentSource).toContain('font-family: var(--font-mono);');
    expect(memoryContentSource).toContain('border: var(--surface-border-width) solid var(--border-secondary);');
    expect(memoryContentSource).toContain('border-radius: var(--surface-radius);');
    expect(memoryContentSource).toContain('border-radius: var(--control-radius);');
    expect(skillCreatorSource).toContain('border: var(--surface-border-width) dashed var(--border-secondary);');
    expect(skillCreatorSource).toContain('border-radius: var(--surface-radius);');
    expect(skillCreatorSource).toContain('border-radius: var(--control-radius);');
    expect(skillItemSource).toContain('border-radius: var(--control-radius);');
    expect(skillIndexSource).toContain('border-radius: var(--control-radius);');
    expect(widgetCreatorSource).toContain('border: var(--surface-border-width) dashed var(--border-secondary);');
    expect(widgetCreatorSource).toContain('border-radius: var(--surface-radius);');
    expect(widgetCreatorSource).toContain('border-radius: var(--control-radius);');
    expect(widgetItemSource).toContain('border-radius: var(--control-radius);');
    expect(widgetIndexSource).toContain('border-radius: var(--control-radius);');
  });

  it('uses design tokens in widget page deep panels', (): void => {
    const panelSidebarSource = readSource('src/views/widget/components/PanelSidebar.vue');
    const sidebarStateSource = readSource('src/views/widget/components/SidebarState.vue');
    const sidebarActionSource = readSource('src/views/widget/components/SidebarAction.vue');
    const sidebarLayerSource = readSource('src/views/widget/components/SidebarLayer.vue');
    const schemaTreeSource = readSource('src/views/widget/components/PageSetter/SchemaTreeEditor.vue');

    expect(panelSidebarSource).toContain('transition: width var(--motion-duration-slow) var(--motion-easing-standard)');
    expect(sidebarStateSource).toContain('transition: color var(--motion-duration-fast) var(--motion-easing-standard);');
    expect(sidebarActionSource).toContain('transition: color var(--motion-duration-fast) var(--motion-easing-standard);');
    expect(sidebarLayerSource).toContain('border-radius: var(--control-radius);');
    expect(sidebarLayerSource).toContain('opacity var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(schemaTreeSource).toContain('border: var(--surface-border-width) dashed var(--border-primary);');
    expect(schemaTreeSource).toContain('border-radius: var(--surface-radius);');
    expect(schemaTreeSource).toContain('border-radius: var(--control-radius);');
  });
});
