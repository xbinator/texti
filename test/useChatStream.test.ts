/**
 * @file useChatStream.test.ts
 * @description 校验聊天流在用户主动中止时会正确收尾助手消息并触发持久化回调。
 */
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStream } from '@/components/BChatSidebar/hooks/useChatStream';
import { create } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 被测 hook 传给底层流式 Hook 的回调集合。
 */
interface MockChatCallbacks {
  /** 流式完成回调 */
  onComplete?: () => void;
}

/**
 * 当前测试轮次里底层流式 Hook 捕获到的回调。
 */
let capturedCallbacks: MockChatCallbacks | null = null;
const streamSpy = vi.fn();

/**
 * 底层流式中止桩函数，用于模拟 Electron 流结束时的完成回调。
 */
const abortSpy = vi.fn<() => void>(() => {
  capturedCallbacks?.onComplete?.();
});

vi.mock('@/hooks/useChat', () => ({
  /**
   * 模拟底层聊天流 Hook，仅暴露本用例需要的 abort 行为。
   */
  useChat: (options: MockChatCallbacks) => {
    capturedCallbacks = options;
    return {
      agent: {
        invoke: vi.fn(),
        stream: streamSpy,
        abort: abortSpy
      }
    };
  }
}));

vi.mock('@/stores/service-model', () => ({
  /**
   * 模拟服务模型 store，避免测试初始化时依赖真实 store。
   */
  useServiceModelStore: () => ({
    getAvailableServiceConfig: vi.fn()
  })
}));

/**
 * 创建一个已经收到部分流式内容、但仍处于 loading 的助手消息。
 * @returns 可用于中止测试的助手消息。
 */
function createStreamingAssistantMessage(): Message {
  const message = create.assistantPlaceholder();
  message.parts.push({ type: 'text', text: '部分回复' });
  message.content = '部分回复';
  message.createdAt = '2026-04-30T00:00:00.000Z';
  return message;
}

describe('useChatStream abort', () => {
  beforeEach(() => {
    capturedCallbacks = null;
    abortSpy.mockClear();
    streamSpy.mockClear();
  });

  it('finalizes the current assistant message and calls onComplete once when the user aborts', () => {
    const messages = ref<Message[]>([create.userMessage('你好'), createStreamingAssistantMessage()]);
    const onComplete = vi.fn<(message: Message) => void>();
    const { stream, loading } = useChatStream({
      messages,
      onComplete
    });

    loading.value = true;
    stream.abort();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(loading.value).toBe(false);
    expect(messages.value).toHaveLength(2);
    expect(messages.value[1].loading).toBe(false);
    expect(messages.value[1].finished).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(messages.value[1]);
  });

  it('builds model-ready messages with reference index blocks instead of expanded file content', async () => {
    const messages = ref<Message[]>([
      create.userMessageFromParts([
        { type: 'text', text: '请分析这个引用' },
        {
          type: 'file-reference',
          referenceId: 'ref-1',
          documentId: 'doc-1',
          snapshotId: 'snapshot-1',
          fileName: 'draft.ts',
          path: null,
          startLine: 10,
          endLine: 20
        }
      ])
    ]);
    const { stream } = useChatStream({ messages });

    await stream.streamMessages(messages.value, {
      providerId: 'provider-1',
      modelId: 'model-1',
      toolSupport: {
        supported: false,
        unsupportedReason: 'not-configured'
      }
    });

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(streamSpy.mock.calls[0][0].messages[0].content).toContain('Available file references for this message:');
    expect(streamSpy.mock.calls[0][0].messages[0].content).toContain('ref-1: draft.ts');
    expect(streamSpy.mock.calls[0][0].messages[0].content).toContain('lines 10-20');
    expect(streamSpy.mock.calls[0][0].messages[0].content).not.toContain('附近片段');
    expect(streamSpy.mock.calls[0][0].messages[0].content).not.toContain('全文内容');
  });
});
