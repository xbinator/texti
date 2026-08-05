<!--
  @file index.vue
  @description 独立Widget工具页面。
-->
<template>
  <main class="widget-page" tabindex="0" :style="widgetPageStyle" @blur="session.actions.onBlur">
    <section v-if="session.isLoading.value" class="widget-page__state" role="status">正在加载 Widget...</section>

    <section v-else-if="session.loadError.value" class="widget-page__state" role="alert">
      <p>{{ session.loadError.value.message }}</p>
      <button class="widget-page__retry" type="button" @click="session.actions.onReload">重新加载</button>
    </section>

    <template v-else>
      <PanelSidebar
        v-model:value="session.data.value"
        v-model:size="sidebarWidth"
        :active-element-id="activeElementId"
        :elements="session.data.value.elements"
        :selected-element-ids="selectedElementIds"
        :settings-width="settingsWidth"
        @save="session.actions.onSave"
        @select-elements="layer.select"
        @copy-elements="layer.copy"
        @delete-elements="layer.remove"
        @move-elements="layer.move"
      />

      <section ref="canvasRef" class="widget-page__canvas">
        <BWidget
          ref="widgetRef"
          :fit-viewport-inset="widgetFitViewportInset"
          :select="selectedTarget"
          :value="session.data.value"
          @selection-change="onSelectionUpdate"
          @update:select="onSelectUpdate"
          @update:value="onDataUpdate"
        />
      </section>

      <BPanelSplitter v-model:size="settingsWidth" class="widget-page__settings" position="left" :min-width="220" :max-width="320">
        <PanelSettings
          v-model:value="session.data.value"
          v-model:select="selectedTarget"
          :selected-element-ids="selectedElementIds"
          @element-command="(command) => onElementCommand({ command })"
          @multi-command="(command) => onMultiCommand({ command })"
          @multi-layout-change="onMultiLayoutChange"
          @multi-style-change="onMultiStyleChange"
        />
      </BPanelSplitter>
    </template>
  </main>
</template>

<script setup lang="ts">
import type { WidgetComponentRef } from './hooks/types';
import type { CSSProperties } from 'vue';
import { computed, ref } from 'vue';
import type { WidgetViewportInset } from '@/components/BWidget/types';
import PanelSettings from './components/PanelSettings.vue';
import PanelSidebar from './components/PanelSidebar.vue';
import { useCanvasDrop } from './hooks/useCanvasDrop';
import { useLayerActions } from './hooks/useLayerActions';
import { useMultiSelection } from './hooks/useMultiSelection';
import { useSelection } from './hooks/useSelection';
import { useSession } from './hooks/useSession';

/**
 * Widget 页面根节点样式变量。
 */
type WidgetPageStyle = CSSProperties & {
  /** 右侧设置覆盖面板宽度，用于画布内浮动控件避让。 */
  '--widget-page-settings-width': string;
};

/** 左侧侧边栏页签列宽度，需与 PanelSidebar 样式变量保持一致。 */
const WIDGET_SIDEBAR_TABS_WIDTH = 45;

const widgetRef = ref<WidgetComponentRef>();
const canvasRef = ref<HTMLElement | null>(null);
const session = useSession();
const sidebarWidth = ref(320);
const settingsWidth = ref(300);
const widgetPageStyle = computed<WidgetPageStyle>(
  (): WidgetPageStyle => ({
    '--widget-page-settings-width': `${settingsWidth.value}px`
  })
);
/** BWidget 内容适配时应避让的实际可视区域边距。 */
const widgetFitViewportInset = computed<Partial<WidgetViewportInset>>(
  (): Partial<WidgetViewportInset> => ({
    left: WIDGET_SIDEBAR_TABS_WIDTH + sidebarWidth.value,
    right: settingsWidth.value
  })
);
const { selectedTarget, selectedElementIds, activeElementId, onDataUpdate, onSelectUpdate, onSelectionUpdate } = useSelection({
  session,
  settingsWidth
});

useCanvasDrop({ canvasRef, widgetRef });

// 创建侧栏图层操作处理器。
const layer = useLayerActions({
  session,
  selectedTarget,
  selectedElementIds,
  widgetRef
});

const { onMultiCommand, onElementCommand, onMultiLayoutChange, onMultiStyleChange } = useMultiSelection({
  session,
  selectedElementIds,
  widgetRef
});
</script>

<style lang="less" scoped>
.widget-page {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.widget-page__canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

.widget-page__state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: var(--text-secondary);
}

.widget-page__retry {
  padding: 6px 14px;
  color: var(--text-primary);
  cursor: pointer;
  background: var(--bg-secondary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);

  &:hover {
    background: var(--bg-tertiary);
  }
}

.widget-page__settings {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  pointer-events: none;
}

.widget-page__settings :deep(.b-panel-splitter__section),
.widget-page__settings :deep(.b-panel-splitter__line) {
  pointer-events: auto;
}

.widget-page :deep(.b-widget-toolbar__group--bottom-left) {
  right: calc(var(--widget-page-settings-width) + 12px);
}
</style>
