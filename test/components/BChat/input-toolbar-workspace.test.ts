/**
 * @file input-toolbar-workspace.test.ts
 * @description BChat 输入工具栏工作区选择入口测试。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import InputToolbar from '@/components/BChat/components/InputToolbar.vue';

/** 输入工具栏源码，用于验证悬停显示恢复按钮的样式契约。 */
const inputToolbarSource = readFileSync('src/components/BChat/components/InputToolbar.vue', 'utf8');

/**
 * BButton 轻量替身，保留属性和点击事件供工具栏断言。
 */
const ButtonStub = defineComponent({
  name: 'BButton',
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    /** 转发原生点击事件。 */
    function handleClick(): void {
      emit('click');
    }

    return (): ReturnType<typeof h> =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          onClick: handleClick
        },
        slots.default?.()
      );
  }
});

/** BIcon 测试替身，保留图标标识供工作区操作断言。 */
const IconStub = defineComponent({
  name: 'BIcon',
  props: {
    icon: { type: String, default: '' }
  },
  template: '<span class="b-icon-stub" :data-icon="icon" />'
});

/**
 * 挂载工作区工具栏测试实例。
 * @param options - 工作区覆盖与禁用状态
 * @returns 输入工具栏包装器
 */
function mountToolbar(options: { hasWorkspaceOverride?: boolean; workspaceDisabled?: boolean; showWorkspaceControl?: boolean } = {}): ReturnType<typeof mount> {
  return mount(InputToolbar, {
    props: {
      loading: false,
      inputValue: '',
      selectedModel: undefined,
      contextUsedTokens: 0,
      contextWindow: 200_000,
      supportsVision: false,
      canSubmit: false,
      workspaceLabel: 'project',
      hasWorkspaceOverride: options.hasWorkspaceOverride ?? true,
      workspaceDisabled: options.workspaceDisabled ?? false,
      showWorkspaceControl: options.showWorkspaceControl ?? true
    },
    global: {
      stubs: {
        BButton: ButtonStub,
        BIcon: IconStub,
        BUpload: true,
        ContextUsage: true,
        ModelSelector: true
      }
    }
  });
}

describe('InputToolbar workspace selector', (): void => {
  it('does not render workspace controls when the host does not enable them', (): void => {
    const wrapper = mountToolbar({ showWorkspaceControl: false });

    expect(wrapper.find('.chat-input-toolbar__workspace').exists()).toBe(false);
  });

  it('renders the workspace selector as a native button inside a continuous capsule', async (): Promise<void> => {
    const wrapper = mountToolbar();
    const workspace = wrapper.get('.chat-input-toolbar__workspace');
    const selector = workspace.get('button.chat-input-toolbar__workspace-select');
    const workspaceStyle = inputToolbarSource.match(/\.chat-input-toolbar__workspace \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';

    expect(workspace.element.compareDocumentPosition(wrapper.get('.toolbar-space').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(workspace.findComponent(ButtonStub).exists()).toBe(false);
    expect(inputToolbarSource).toContain('appearance: none;');
    expect(workspaceStyle).toContain('height: 28px;');
    expect(inputToolbarSource).toContain('overflow: hidden;');
    expect(workspaceStyle.split('&:hover')[0]).not.toContain('background: var(--bg-secondary);');
    expect(inputToolbarSource).toContain('border-radius: 18px;');
    expect(inputToolbarSource).toMatch(/&:hover,\s*&:focus-within\s*\{\s*background: var\(--bg-secondary\);/u);
    expect(inputToolbarSource).not.toContain('margin-left: 2px;');
    expect(selector.text()).toContain('project');
    expect(selector.get('.chat-input-toolbar__workspace-folder').attributes('data-icon')).toBe('lucide:folder-closed');
    expect(selector.attributes('data-testid')).toBeUndefined();
    expect(selector.attributes('aria-label')).toBeUndefined();
    expect(selector.attributes('tooltip')).toBeUndefined();
    await selector.trigger('click');

    expect(wrapper.emitted('workspace-select')).toEqual([[]]);
  });

  it('shows a native x action for a temporary workspace and emits a reset request', async (): Promise<void> => {
    const wrapper = mountToolbar();
    const workspace = wrapper.get('.chat-input-toolbar__workspace');
    const clearButton = workspace.get('button.chat-input-toolbar__workspace-clear');

    expect(workspace.findComponent(ButtonStub).exists()).toBe(false);
    expect(clearButton.find('.b-icon-stub').attributes('data-icon')).toBe('lucide:x');
    expect(inputToolbarSource).toContain('position: absolute;');
    expect(inputToolbarSource).toContain('left: 0;');
    await clearButton.trigger('click');

    expect(wrapper.emitted('workspace-clear')).toEqual([[]]);
  });

  it('reveals the clear action when the workspace group is hovered or focused', (): void => {
    expect(inputToolbarSource).toContain('&.is-overridden:hover .chat-input-toolbar__workspace-clear');
    expect(inputToolbarSource).toContain('&.is-overridden:focus-within .chat-input-toolbar__workspace-clear');
  });

  it('uses a compact 12px font for the workspace label', (): void => {
    const labelStyle = inputToolbarSource.match(/\.chat-input-toolbar__workspace-label \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';

    expect(labelStyle).toContain('font-size: 12px;');
  });

  it('does not render the clear action without a temporary workspace', (): void => {
    const wrapper = mountToolbar({ hasWorkspaceOverride: false });

    expect(wrapper.find('.chat-input-toolbar__workspace-clear').exists()).toBe(false);
  });

  it('disables workspace changes while the chat workflow is busy', (): void => {
    const wrapper = mountToolbar({ workspaceDisabled: true });

    expect(wrapper.get('button.chat-input-toolbar__workspace-select').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button.chat-input-toolbar__workspace-clear').attributes('disabled')).toBeDefined();
  });
});
