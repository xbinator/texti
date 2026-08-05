/**
 * @file serverEditor.test.ts
 * @description MCP Server 编辑弹窗原始 JSON 回显测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, nextTick, type PropType } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { EditorState } from '@/components/BEditor/types';
import type { MCPServerConfig } from '@/shared/storage/tool-settings';
import ServerEditor from '@/views/settings/tools/mcp/components/ServerEditor.vue';

/**
 * 带编辑器原始 JSON 的 MCP server 测试配置。
 */
type EditableMcpServerConfig = MCPServerConfig & {
  /** 用户在编辑器中提交的原始 JSON 文本 */
  editorJsonText: string;
};

/** 弹窗测试替身。 */
const BModalStub = defineComponent({
  name: 'BModal',
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, default: '' },
    width: { type: Number, default: 640 }
  },
  emits: ['cancel', 'update:open'],
  template: '<section v-if="open" class="b-modal-stub"><slot></slot><footer><slot name="footer"></slot></footer></section>'
});

/** 按钮测试替身。 */
const BButtonStub = defineComponent({
  name: 'BButton',
  emits: ['click'],
  template: '<button type="button" class="b-button-stub" @click="$emit(\'click\')"><slot></slot></button>'
});

/** Monaco 编辑器测试替身。 */
const BMonacoStub = defineComponent({
  name: 'BMonaco',
  props: {
    editable: { type: Boolean, default: true },
    editorState: { type: Object as PropType<EditorState>, required: true },
    language: { type: String, default: 'json' },
    options: { type: Object as PropType<Record<string, unknown>>, default: (): Record<string, unknown> => ({}) },
    value: { type: String, default: '' }
  },
  emits: ['update:value'],
  setup(_props, { emit, expose }) {
    /**
     * 转发编辑器输入事件。
     * @param event - 原生输入事件
     */
    function handleInput(event: Event): void {
      if (event.target instanceof HTMLTextAreaElement) {
        emit('update:value', event.target.value);
      }
    }

    /**
     * 模拟 Monaco 聚焦 API。
     */
    function focusEditor(): void {
      return undefined;
    }

    expose({ focusEditor });

    return { handleInput };
  },
  template: '<textarea class="b-monaco-stub" :value="value" @input="handleInput"></textarea>'
});

/**
 * 创建 MCP server 测试配置。
 * @param editorJsonText - 用户提交的原始 JSON 文本
 * @returns MCP server 配置
 */
function createServer(editorJsonText: string): EditableMcpServerConfig {
  return {
    id: 'coffee-server',
    name: 'my-coffee',
    enabled: true,
    transport: 'streamableHTTP',
    url: 'https://gwmcp.lkcoffee.com/order/user/mcp',
    command: '',
    args: [],
    env: {},
    headers: {
      Authorization: 'Bearer test-token'
    },
    toolAllowlist: [],
    connectTimeoutMs: 20000,
    toolCallTimeoutMs: 30000,
    editorJsonText
  };
}

/**
 * 挂载 MCP Server 编辑器弹窗。
 * @param server - 当前编辑的 server
 * @returns 组件包装器
 */
function mountServerEditor(server: EditableMcpServerConfig): VueWrapper {
  return mount(ServerEditor, {
    props: {
      open: true,
      server
    },
    global: {
      stubs: {
        BButton: BButtonStub,
        BModal: BModalStub,
        BMonaco: BMonacoStub
      }
    }
  });
}

describe('ServerEditor', (): void => {
  it('replays the original editor JSON when editing a saved MCP server', async (): Promise<void> => {
    const rawJson = `{
  "mcpServers": {
    "my-coffee": {
      "type": "streamablehttp",
      "url": "https://gwmcp.lkcoffee.com/order/user/mcp",
      "headers": {
        "Authorization": "Bearer test-token"
      },
      "x-vendor-field": "kept"
    }
  }
}`;
    const wrapper = mountServerEditor(createServer(rawJson));

    await nextTick();

    expect((wrapper.find('.b-monaco-stub').element as HTMLTextAreaElement).value).toBe(rawJson);
    wrapper.unmount();
  });
});
