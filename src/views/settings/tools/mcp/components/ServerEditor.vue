<template>
  <BModal v-model:open="open" :title="modalTitle" :width="640" @cancel="handleCancel">
    <div class="server-editor-modal">
      <div class="server-editor-modal__editor">
        <BMonaco
          ref="editorRef"
          v-model:value="jsonText"
          language="json"
          :editable="true"
          :editor-state="editorState"
          :options="{ wordWrap: true, search: false }"
        />
      </div>
    </div>

    <template #footer>
      <BButton type="secondary" @click="handleCancel">取消</BButton>
      <BButton type="primary" @click="handleConfirm">保存</BButton>
    </template>
  </BModal>
</template>

<script setup lang="ts">
/**
 * @file ServerEditorModal.vue
 * @description MCP Server 添加/编辑弹窗，内置 Monaco JSON 编辑器，点击保存时校验。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import type { EditorState } from '@/components/BEditor/types';
import BMonaco from '@/components/BMonaco/index.vue';
import type { MCPServerConfig } from '@/shared/storage/tool-settings';
import { parseMCPServerEditorDraft } from '../utils/parseMCPServer';

interface Props {
  /** 当前编辑的 server，空时为新增模式 */
  server?: MCPServerConfig | null;
}

const props = withDefaults(defineProps<Props>(), {
  server: null
});

const emit = defineEmits<{
  /**
   * 用户确认保存当前 JSON 草稿。
   * @param event - 事件名
   * @param jsonText - 编辑器中的原始 JSON 文本
   */
  (event: 'confirm', jsonText: string): void;
  /**
   * 用户取消编辑。
   * @param event - 事件名
   */
  (event: 'cancel'): void;
}>();

/** 弹窗开关状态（v-model） */
const open = defineModel<boolean>('open', { required: true });

/**
 * MCP Server JSON 编辑器的占位示例。
 * 支持两种格式（直接粘贴第三方文档配置即可）：
 * 1. mcpServers 包裹格式（Claude Desktop / 第三方文档常见）
 * 2. 扁平格式：{ "name": "...", "command": "...", ... }
 */
const MCP_SERVER_JSON_PLACEHOLDER = `{
  "mcpServers": {
    "example-server": {
      "command": "npx",
      "args": ["-y", "mcp-server-example"]
    }
  }
}`;

/**
 * 将 MCP server 配置序列化为编辑器使用的 JSON。
 * @param server - 当前编辑的 server，空时返回示例 JSON
 * @returns 格式化后的 JSON 字符串
 */
function serializeMCPServerEditorDraft(server: MCPServerConfig | null): string {
  if (!server) {
    return MCP_SERVER_JSON_PLACEHOLDER;
  }

  const isRemote = server.transport === 'streamableHTTP' || server.transport === 'sse';
  return JSON.stringify(
    {
      name: server.name,
      transport: server.transport,
      ...(isRemote ? { url: server.url, headers: server.headers } : { command: server.command, args: server.args, env: server.env }),
      ...(isRemote && server.oauth ? { enableOAuth: true } : {}),
      toolAllowlist: server.toolAllowlist,
      toolCallTimeoutMs: server.toolCallTimeoutMs
    },
    null,
    2
  );
}

const modalTitle = computed<string>(() => (props.server ? '编辑 MCP Server' : '添加 MCP Server'));
const editorRef = ref<InstanceType<typeof BMonaco> | null>(null);
const jsonText = ref(serializeMCPServerEditorDraft(props.server ?? null));

/**
 * 供 BMonaco 使用的编辑器状态。
 * 这里仅承载 Monaco 所需的最小元信息，真实草稿仍由 jsonText 驱动。
 * @returns 统一编辑器状态
 */
const editorState = computed<EditorState>(() => ({
  id: props.server?.id ?? 'mcp-server-draft',
  name: props.server?.name ?? 'mcp-server.json',
  path: null,
  ext: 'json',
  content: jsonText.value
}));

/**
 * 根据当前模式重置编辑器内容。
 */
function resetEditorContent() {
  jsonText.value = serializeMCPServerEditorDraft(props.server ?? null);
}

/**
 * 聚焦 Monaco 编辑器。
 */
function focusEditor() {
  if (!editorRef.value || typeof editorRef.value.focusEditor !== 'function') {
    return;
  }

  editorRef.value.focusEditor();
}

/**
 * 处理取消操作。
 */
function handleCancel(): void {
  emit('cancel');
  open.value = false;
}

/**
 * 处理确认保存操作。
 * 点击时校验 JSON，合法则直接传递原始文本给父组件处理。
 */
function handleConfirm(): void {
  const result = parseMCPServerEditorDraft(jsonText.value);
  if (!result.draft || result.error) {
    message.error(result.error || 'JSON 配置格式错误');
    return;
  }

  emit('confirm', jsonText.value);
}

watch(
  () => [open.value, props.server] as const,
  async ([isOpen]): Promise<void> => {
    if (!isOpen) {
      return;
    }

    // 每次打开弹窗时都回填最新 server 配置，避免连续编辑时残留上次输入。
    resetEditorContent();
    await nextTick();
    focusEditor();
  },
  { immediate: true }
);
</script>

<style scoped lang="less">
.server-editor-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-editor-modal__editor {
  position: relative;
  min-height: 320px;
  padding: 1px;
  background: var(--input-bg);
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard);
}

.server-editor-modal__editor:hover {
  border-color: var(--border-hover);
}

.server-editor-modal__editor:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-active-shadow);
}

.server-editor-modal__editor :deep(.b-editor-monaco),
.server-editor-modal__editor :deep(.b-editor-monaco__host) {
  min-height: 320px;
}

.server-editor-modal__editor :deep(.monaco-editor),
.server-editor-modal__editor :deep(.monaco-editor-background) {
  background: var(--input-bg);
}

.server-editor-modal__editor :deep(.monaco-editor .margin),
.server-editor-modal__editor :deep(.monaco-editor .monaco-editor-background) {
  background: var(--input-bg);
}

.server-editor-modal__editor :deep(.monaco-editor .view-lines) {
  font-family: var(--font-mono);
}
</style>
