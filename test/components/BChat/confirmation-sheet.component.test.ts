/**
 * @file confirmation-sheet.component.test.ts
 * @description 统一 ConfirmationSheet 的 Runtime 与 Child Agent 展示边界测试。
 * @vitest-environment jsdom
 */
import type { ChatAgentConfirmationSnapshot } from 'types/chat-agent';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ConfirmationSheet from '@/components/BChat/components/ConfirmationSheet.vue';
import type { ChatConfirmationQueueItem } from '@/stores/chat/confirmationQueue';

/** BButton 测试替身。 */
const ButtonStub = {
  name: 'BButton',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
};

/** BIcon 测试替身。 */
const IconStub = {
  name: 'BIcon',
  template: '<i />'
};

/**
 * 创建 Child Agent confirmation 项。
 * @returns Agent queue item
 */
function createAgentItem(): ChatConfirmationQueueItem {
  const snapshot: ChatAgentConfirmationSnapshot = {
    confirmationId: 'confirmation-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    agentId: 'child-1',
    runtimeId: 'runtime-1',
    toolCallId: 'tool-call-1',
    changesetId: 'changeset-1',
    status: 'pending',
    version: 1,
    riskLevel: 'dangerous',
    displayPaths: ['notes.md', 'docs/guide.md'],
    resourceScopes: ['file:/workspace/notes.md', 'file:/workspace/docs/guide.md'],
    unifiedDiff: '--- a/notes.md\n+++ b/notes.md\n-before\n+after',
    baseRevision: 'a'.repeat(64),
    diffHash: 'b'.repeat(64),
    operationSetHash: 'c'.repeat(64),
    planHash: 'd'.repeat(64),
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
  return {
    source: 'agent',
    confirmationId: snapshot.confirmationId,
    snapshot,
    createdAt: snapshot.createdAt
  };
}

describe('ConfirmationSheet', (): void => {
  it('shows Child identity, scopes, full diff and integrity fingerprints without remember actions', async (): Promise<void> => {
    const wrapper = mount(ConfirmationSheet, {
      props: { confirmation: createAgentItem() },
      global: {
        stubs: {
          BButton: ButtonStub,
          BIcon: IconStub
        }
      }
    });

    expect(wrapper.text()).toContain('Child Agent 变更确认');
    expect(wrapper.text()).toContain('task-1');
    expect(wrapper.text()).toContain('child-1');
    expect(wrapper.text()).toContain('session-1');
    expect(wrapper.text()).toContain('notes.md');
    expect(wrapper.text()).toContain('file:/workspace/notes.md');
    expect(wrapper.text()).toContain('-before');
    expect(wrapper.text()).toContain('aaaaaaaaaaaa');
    expect(wrapper.text()).not.toContain('本会话允许');
    expect(wrapper.text()).not.toContain('始终允许');

    await wrapper.findAll('button')[0]?.trigger('click');
    expect(wrapper.emitted('action')).toEqual([
      [
        {
          action: 'approve',
          confirmationId: 'confirmation-1',
          source: 'agent',
          expectedVersion: 1
        }
      ]
    ]);
  });

  it('keeps Runtime remember actions and emits its displayed stable identity', async (): Promise<void> => {
    const runtimeItem: ChatConfirmationQueueItem = {
      source: 'runtime',
      confirmationId: 'runtime-confirmation-1',
      sessionId: 'session-1',
      runtimeId: 'runtime-1',
      request: {
        toolName: 'write_file',
        title: '写入文件',
        description: '是否写入 notes.md',
        riskLevel: 'write',
        allowRemember: true,
        rememberScopes: ['session', 'always']
      },
      createdAt: '2026-07-27T00:00:00.000Z'
    };
    const wrapper = mount(ConfirmationSheet, {
      props: { confirmation: runtimeItem },
      global: {
        stubs: {
          BButton: ButtonStub,
          BIcon: IconStub
        }
      }
    });

    expect(wrapper.text()).toContain('写入文件');
    expect(wrapper.text()).toContain('本会话允许');
    expect(wrapper.text()).toContain('始终允许');
    await wrapper.findAll('button')[1]?.trigger('click');
    expect(wrapper.emitted('action')).toEqual([
      [
        {
          action: 'approve-session',
          confirmationId: 'runtime-confirmation-1',
          source: 'runtime'
        }
      ]
    ]);
  });
});
