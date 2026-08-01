<!--
  @file SidebarAction.vue
  @description Widget页面侧边栏动作面板，直接承载运行脚本代码编辑器；顶部「展开」按钮可请求扩展侧栏宽度以获得更大的编辑区域。
-->
<template>
  <SidebarPanel title="动作面板" :padding="0">
    <template #help>
      <BIcon
        class="action-help-icon"
        icon="lucide:circle-alert"
        role="button"
        :size="14"
        tabindex="0"
        @click="openActionHelp"
        @keydown.enter="openActionHelp"
        @keydown.space.prevent="openActionHelp"
      />
    </template>
    <template #extra>
      <BButton
        :icon="isExpanded ? 'lucide:minimize-2' : 'lucide:maximize-2'"
        size="mini"
        square
        :type="isExpanded ? 'secondary' : 'ghost'"
        @click="toggleExpand"
      />
    </template>
    <CodeEditor v-model:value="dataItem" :active="props.active" @save="emit('save')" />
  </SidebarPanel>

  <!-- 动作脚本编写说明抽屉 -->
  <ActionHelp v-model:open="actionHelpOpen" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { WidgetData } from '@/components/BWidget/types';
import SidebarPanel from './_SidebarPanel.vue';
import CodeEditor from './CodeEditor.vue';
import ActionHelp from './PageSetter/ActionHelp.vue';

defineOptions({ name: 'SidebarAction' });

/**
 * 动作侧栏入参。
 */
interface Props {
  /** 当前动作侧栏是否处于可见激活态，用于驱动编辑器刷新和聚焦。 */
  active?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  active: false
});
const dataItem = defineModel<WidgetData>('value', { required: true });
const emit = defineEmits<{
  /** 请求保存当前 Widget 文件（来自 CodeEditor 的 Ctrl+S） */
  save: [];
  /** 请求展开侧栏（占据除右侧设置面板与 tabs 列之外的所有空间） */
  expand: [];
  /** 请求收起侧栏（恢复默认宽度） */
  collapse: [];
}>();

/** 当前是否处于展开态。 */
const isExpanded = ref(false);

/**
 * 切换展开 / 收起态，并向上抛出对应事件。
 */
function toggleExpand(): void {
  isExpanded.value = !isExpanded.value;
  if (isExpanded.value) {
    emit('expand');
  } else {
    emit('collapse');
  }
}

/** 动作脚本编写说明抽屉开关状态。 */
const actionHelpOpen = ref(false);

/**
 * 打开动作脚本编写说明抽屉。
 */
function openActionHelp(): void {
  actionHelpOpen.value = true;
}
</script>

<style lang="less" scoped>
.action-help-icon {
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

.action-help-icon:hover,
.action-help-icon:focus {
  color: var(--color-primary);
}
</style>
