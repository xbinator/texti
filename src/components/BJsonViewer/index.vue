<!--
  @file index.vue
  @description JSON 节点图查看器，基于 Vue Flow 将 JSON 结构渲染为聚合卡片关系图。
-->
<template>
  <div :class="name">
    <div v-if="parseError" :class="bem('empty')">
      <div :class="bem('empty-title')">JSON 解析失败</div>
      <div :class="bem('empty-message')">{{ parseError }}</div>
    </div>

    <div v-else-if="hasInput && graphNodes.length === 0" :class="bem('empty')">
      <div :class="bem('empty-title')">暂无 JSON 数据</div>
      <div :class="bem('empty-message')">传入 JSON 字符串或对象后会在这里显示节点图</div>
    </div>

    <VueFlow
      v-else
      :nodes="graphNodes"
      :edges="graphEdges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :fit-view-on-init="true"
      :min-zoom="0.2"
      :max-zoom="1.8"
      :class="bem('flow')"
      @node-click="handleNodeClick"
    >
      <template #node-json="{ data }">
        <RecordNode :data="data" />
      </template>
    </VueFlow>

    <NodeDetailModal v-model:open="modalOpen" :node="selectedNode" />
  </div>
</template>

<script setup lang="ts">
import type { BJsonViewerProps, JsonFlowNodeData } from './types';
import type { NodeMouseEvent } from '@vue-flow/core';
import { computed, ref } from 'vue';
import { VueFlow } from '@vue-flow/core';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import { createNamespace } from '@/utils/namespace';
import NodeDetailModal from './components/NodeDetailModal.vue';
import RecordNode from './components/RecordNode.vue';
import { useGraph } from './hooks/useGraph';

defineOptions({ name: 'BJsonViewer' });

const props = withDefaults(defineProps<BJsonViewerProps>(), {
  content: '',
  value: undefined
});

const [name, bem] = createNamespace('json-viewer');
const { parseError, graphEdges, graphNodes } = useGraph(props);

/** 是否有实际输入（非初始化空状态）。 */
const hasInput = computed<boolean>(() => props.content?.trim().length > 0 || props.value !== undefined);

/** 当前选中的节点数据，用于 Modal 展示。 */
const selectedNode = ref<JsonFlowNodeData | null>(null);

/** Modal 显示状态。 */
const modalOpen = ref<boolean>(false);

/**
 * 处理节点点击事件，打开详情 Modal。
 * @param event - Vue Flow 节点鼠标事件
 */
function handleNodeClick(event: NodeMouseEvent): void {
  const nodeData = event.node.data as JsonFlowNodeData;
  selectedNode.value = nodeData;
  modalOpen.value = true;
}
</script>

<style lang="less">
.b-json-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  color: var(--json-viewer-value);
  background: var(--bg-primary);
}

.b-json-viewer__flow {
  width: 100%;
  height: 100%;
  font-family: var(--font-mono);
  background: transparent;
}

.b-json-viewer .vue-flow__edge-textbg {
  fill: transparent;
  stroke: transparent;
}

.b-json-viewer .vue-flow__edge-text {
  font-family: var(--font-mono);
  font-size: 20px;
  fill: var(--json-viewer-edge);
}

.b-json-viewer__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 360px;
  padding: 28px;
  text-align: center;
  background: var(--json-viewer-bg);
}

.b-json-viewer__empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--json-viewer-value);
}

.b-json-viewer__empty-message {
  max-width: 420px;
  margin-top: 8px;
  font-size: 13px;
  line-height: 20px;
  color: var(--text-secondary);
}
</style>
