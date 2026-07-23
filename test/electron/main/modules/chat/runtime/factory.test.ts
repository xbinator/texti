/**
 * @file factory.test.ts
 * @description ChatRuntime 工厂冻结请求模型测试。
 */
import type { ChatRuntimeCompactInput, ChatRuntimeContinueInput, ChatRuntimeSendInput, ChatRuntimeSubmitUserChoiceInput } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import {
  createCompactRuntime,
  createContinuationRuntime,
  createSendRuntime,
  createUserChoiceRuntime
} from '../../../../../../electron/main/modules/chat/runtime/runners/factory.mjs';

/** Runtime 工厂测试模型。 */
const model = { providerId: 'provider-1', modelId: 'model-2' };
/** Runtime 工厂共享输入。 */
const base = {
  clientId: 'client-1',
  agentId: 'primary',
  turnId: 'turn-1',
  rootRuntimeId: 'runtime-a',
  model
};

describe('runtime factories', (): void => {
  it('copies the requested model into every active runtime', (): void => {
    const send = createSendRuntime(
      { ...base, rootRuntimeId: 'send', runtimeId: 'send', sessionId: 'session-1', content: 'hello' } satisfies ChatRuntimeSendInput,
      'send',
      'session-1'
    );
    const continuation = createContinuationRuntime(
      { ...base, runtimeId: 'continue', sessionId: 'session-1', messages: [] } satisfies ChatRuntimeContinueInput,
      'continue'
    );
    const compact = createCompactRuntime({ ...base, runtimeId: 'compact', sessionId: 'session-1' } satisfies ChatRuntimeCompactInput, 'compact');
    const choice = createUserChoiceRuntime(
      {
        ...base,
        runtimeId: 'choice',
        sessionId: 'session-1',
        answer: { questionId: 'question-1', toolCallId: 'tool-1', answers: ['yes'] }
      } satisfies ChatRuntimeSubmitUserChoiceInput,
      'choice'
    );

    expect([send.model, continuation.model, compact.model, choice.model]).toEqual([model, model, model, model]);
  });

  it('retains the complete lineage of a continuation runtime', (): void => {
    const runtime = createContinuationRuntime(
      {
        ...base,
        runtimeId: 'runtime-b',
        sessionId: 'session-1',
        parentAgentId: 'coordinator',
        parentRuntimeId: 'runtime-a',
        continuationOfRuntimeId: 'runtime-a',
        messages: []
      } satisfies ChatRuntimeContinueInput,
      'runtime-b'
    );

    expect(runtime).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'primary',
      runtimeId: 'runtime-b',
      parentAgentId: 'coordinator',
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a'
    });
  });

  it('copies compact and user-choice lineage without guessing missing identities', (): void => {
    const compact = createCompactRuntime(
      {
        ...base,
        runtimeId: 'runtime-compact',
        sessionId: 'session-1'
      } satisfies ChatRuntimeCompactInput,
      'runtime-compact'
    );
    const choice = createUserChoiceRuntime(
      {
        ...base,
        runtimeId: 'runtime-choice',
        sessionId: 'session-1',
        continuationOfRuntimeId: 'runtime-a',
        answer: { questionId: 'question-1', toolCallId: 'tool-1', answers: ['yes'] }
      } satisfies ChatRuntimeSubmitUserChoiceInput,
      'runtime-choice'
    );
    const invalidCompact = createCompactRuntime(
      {
        ...base,
        runtimeId: 'runtime-invalid',
        sessionId: 'session-1',
        turnId: undefined,
        rootRuntimeId: undefined
      } as unknown as ChatRuntimeCompactInput,
      'runtime-invalid'
    );

    expect(compact).toMatchObject({ turnId: 'turn-1', rootRuntimeId: 'runtime-a' });
    expect(choice).toMatchObject({
      turnId: 'turn-1',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a'
    });
    expect(invalidCompact.turnId).toBeUndefined();
    expect(invalidCompact.rootRuntimeId).toBeUndefined();
  });
});
