/**
 * @file service.test.ts
 * @description AI 主进程服务返回值封装测试。
 */
import type { AIProvider } from '../../../../../electron/main/modules/ai/types.mjs';
import type { ModelMessage } from 'ai';
import type { AICreateOptions, AIInvokeResult } from 'types/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlibabaProvider } from '../../../../../electron/main/modules/ai/providers/alibaba.mjs';
import { DeepSeekProvider } from '../../../../../electron/main/modules/ai/providers/deepseek.mjs';
import { GLMProvider } from '../../../../../electron/main/modules/ai/providers/glm.mjs';
import { MiMoProvider } from '../../../../../electron/main/modules/ai/providers/mimo.mjs';
import { MiniMaxProvider } from '../../../../../electron/main/modules/ai/providers/minimax.mjs';
import { MoonshotProvider } from '../../../../../electron/main/modules/ai/providers/moonshot.mjs';
import { VolcengineProvider } from '../../../../../electron/main/modules/ai/providers/volcengine.mjs';
import { aiService, createAIInvokeResult } from '../../../../../electron/main/modules/ai/service.mjs';

/** AI SDK 外部调用边界 mock。 */
const aiSdkMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  isLoopFinished: vi.fn((): { naturalTermination: boolean } => ({ naturalTermination: true })),
  streamText: vi.fn()
}));

/** AI 服务日志边界 mock。 */
const logMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
}));

vi.mock('ai', async (importOriginal: <T = unknown>() => Promise<T>): Promise<Record<string, unknown>> => {
  const actual = await importOriginal<typeof import('ai')>();

  return {
    ...actual,
    generateText: aiSdkMocks.generateText,
    isLoopFinished: aiSdkMocks.isLoopFinished,
    streamText: aiSdkMocks.streamText
  };
});

vi.mock('../../../../../electron/main/modules/logger/service.mjs', (): { log: typeof logMocks } => ({ log: logMocks }));

/** AI 服务测试创建选项。 */
const AI_CREATE_OPTIONS: AICreateOptions = {
  providerType: 'openai',
  providerId: 'openai-test',
  providerName: 'OpenAI Test',
  apiKey: 'test-key'
};

/** 复用 AI SDK 文本生成 mock，覆盖最新 main 的中止与日志安全用例。 */
const generateTextMock = aiSdkMocks.generateText;

/** 复用被 AI 服务消费的日志 mock，避免测试写入本地日志文件。 */
const log = logMocks;

/** AI 文本生成结果夹具类型。 */
type GenerateTextResultFixture = Parameters<typeof createAIInvokeResult>[0];

/**
 * 创建 output getter 会抛错的纯文本生成结果。
 * @returns AI SDK 文本生成结果形状
 */
function createTextOnlyResultWithThrowingOutput(): GenerateTextResultFixture {
  const resultWithoutOutput = {
    text: '',
    usage: {
      inputTokens: 737,
      outputTokens: 150,
      totalTokens: 887
    }
  } satisfies Omit<GenerateTextResultFixture, 'output'>;

  return Object.defineProperty(resultWithoutOutput, 'output', {
    get: (): unknown => {
      throw new Error('No output generated');
    }
  }) as GenerateTextResultFixture;
}

/**
 * 创建结构化输出生成结果。
 * @returns AI SDK 文本生成结果形状
 */
function createStructuredResult(): GenerateTextResultFixture {
  return {
    text: '',
    output: { title: '摘要' },
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3
    }
  };
}

/**
 * 创建空的 AI SDK 事件流。
 * @returns 不产生事件的异步流
 */
async function* createEmptyStream(): AsyncGenerator<never, void, undefined> {
  yield* [];
}

/** AI SDK 可执行工具的测试窄接口。 */
interface ExecutableSdkTool {
  /** 执行一次工具调用。 */
  execute: (input: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<unknown>;
}

describe('AI SDK 7 service integration', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    vi.spyOn(aiService.aiProvider, 'create').mockReturnValue({} as ReturnType<typeof aiService.aiProvider.create>);
    vi.spyOn(aiService.aiProvider, 'createProviderOptions').mockReturnValue(undefined);
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('passes trusted system messages with v7 instructions', async (): Promise<void> => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'Compressed project context.' },
      { role: 'user', content: 'Continue the task.' }
    ];
    aiSdkMocks.generateText.mockResolvedValue({
      text: 'Generated response',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
    });

    const [error] = await aiService.generateText(AI_CREATE_OPTIONS, {
      modelId: 'gpt-test',
      system: 'Follow the workspace rules.',
      messages
    });

    expect(error).toBeUndefined();
    expect(aiSdkMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Follow the workspace rules.',
        allowSystemInMessages: true,
        messages
      })
    );
    expect(aiSdkMocks.generateText).not.toHaveBeenCalledWith(expect.objectContaining({ system: expect.anything() }));
  });

  it('lets executable tools continue until the v7 loop naturally finishes', async (): Promise<void> => {
    aiSdkMocks.generateText.mockResolvedValue({
      text: 'Search result',
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }
    });

    const [error] = await aiService.generateText(AI_CREATE_OPTIONS, {
      modelId: 'gpt-test',
      prompt: 'Search the web.',
      tavily: { enabled: true, apiKey: 'tavily-test-key' }
    });

    expect(error).toBeUndefined();
    expect(aiSdkMocks.isLoopFinished).toHaveBeenCalledOnce();
    expect(aiSdkMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prepareStep: expect.any(Function),
        stopWhen: { naturalTermination: true },
        timeout: {
          totalMs: 300_000,
          chunkMs: 90_000,
          toolMs: 60_000
        }
      })
    );
  });

  it('lets ChatRuntime own the tool loop and force the final model step', async (): Promise<void> => {
    const stream = createEmptyStream();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    aiSdkMocks.streamText.mockReturnValue({ stream });

    const [error] = await aiService.streamText(
      AI_CREATE_OPTIONS,
      {
        modelId: 'gpt-test',
        prompt: 'Finish from existing tool results.',
        tavily: { enabled: true, apiKey: 'tavily-test-key' }
      },
      { runtimeToolLoop: true, forceFinal: true }
    );

    expect(error).toBeUndefined();
    expect(aiSdkMocks.isLoopFinished).not.toHaveBeenCalled();
    expect(aiSdkMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: 'none',
        instructions: expect.stringContaining('Do not emit tool-call markup'),
        timeout: {
          chunkMs: 90_000
        }
      })
    );
    expect(aiSdkMocks.streamText.mock.calls[0]?.[0]).not.toHaveProperty('prepareStep');
    expect(aiSdkMocks.streamText.mock.calls[0]?.[0]).not.toHaveProperty('stopWhen');
    expect(aiSdkMocks.streamText.mock.calls[0]?.[0].timeout).not.toHaveProperty('totalMs');
    expect(aiSdkMocks.streamText.mock.calls[0]?.[0].timeout).not.toHaveProperty('toolMs');
    expect(aiSdkMocks.streamText.mock.calls[0]?.[0].abortSignal).toBeUndefined();
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('keeps a local compatibility timeout for runtime Tavily tools', async (): Promise<void> => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject): void => {
          init?.signal?.addEventListener('abort', (): void => reject(new Error('tavily aborted')), { once: true });
        })
    );
    aiSdkMocks.streamText.mockReturnValue({ stream: createEmptyStream() });

    try {
      const [error] = await aiService.streamText(
        AI_CREATE_OPTIONS,
        {
          modelId: 'gpt-test',
          prompt: 'Search.',
          tavily: { enabled: true, apiKey: 'tavily-test-key' }
        },
        { runtimeToolLoop: true }
      );
      expect(error).toBeUndefined();
      const searchTool = aiSdkMocks.streamText.mock.calls[0]?.[0].tools.tavily_search as ExecutableSdkTool;
      const result = searchTool.execute({ query: 'long request' }, { toolCallId: 'tool-call-tavily' });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(result).resolves.toMatchObject({ status: 'failure', error: { code: 'TOOL_TIMEOUT' } });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('exposes final-step and total usage for generated text', async (): Promise<void> => {
    aiSdkMocks.generateText.mockResolvedValue({
      text: 'Final answer',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      finalStep: {
        usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 }
      }
    });

    const [error, result] = await aiService.generateText(AI_CREATE_OPTIONS, {
      modelId: 'gpt-test',
      prompt: 'Use tools and answer.'
    });

    expect(error).toBeUndefined();
    expect(result?.stepUsage).toEqual({ inputTokens: 7, outputTokens: 5, totalTokens: 12 });
    expect(result?.totalUsage).toEqual({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });

  it('returns the v7 full event stream', async (): Promise<void> => {
    const stream = createEmptyStream();
    aiSdkMocks.streamText.mockReturnValue({ stream });

    const [error, result] = await aiService.streamText(AI_CREATE_OPTIONS, {
      modelId: 'gpt-test',
      prompt: 'Stream a response.'
    });

    expect(error).toBeUndefined();
    expect(result?.stream).toBe(stream);
  });

  it('releases the abort controller when a runtime stream ends', async (): Promise<void> => {
    const stream = createEmptyStream();
    const removeController = vi.spyOn(aiService, 'removeController');
    aiSdkMocks.streamText.mockReturnValue({ stream });

    const [error] = await aiService.streamText(AI_CREATE_OPTIONS, {
      requestId: 'runtime-stream-cleanup',
      modelId: 'gpt-test',
      prompt: 'Stream a response.'
    });
    const onEnd = aiSdkMocks.streamText.mock.calls[0]?.[0].onEnd as (() => void) | undefined;

    expect(error).toBeUndefined();
    expect(onEnd).toBeTypeOf('function');
    onEnd?.();
    expect(removeController).toHaveBeenCalledWith('runtime-stream-cleanup');
  });

  it('does not let an older stream release a newer controller with the same request id', async (): Promise<void> => {
    aiSdkMocks.streamText.mockReturnValue({ stream: createEmptyStream() });

    await aiService.streamText(AI_CREATE_OPTIONS, { requestId: 'runtime-reused-id', modelId: 'gpt-test', prompt: 'first stream' }, { runtimeToolLoop: true });
    const firstOptions = aiSdkMocks.streamText.mock.calls[0]?.[0] as { abortSignal?: AbortSignal; onEnd?: () => void } | undefined;
    await aiService.streamText(AI_CREATE_OPTIONS, { requestId: 'runtime-reused-id', modelId: 'gpt-test', prompt: 'second stream' }, { runtimeToolLoop: true });
    const secondOptions = aiSdkMocks.streamText.mock.calls[1]?.[0] as { abortSignal?: AbortSignal; onEnd?: () => void } | undefined;

    expect(firstOptions?.abortSignal?.aborted).toBe(true);
    firstOptions?.onEnd?.();
    aiService.abortStream('runtime-reused-id');

    expect(secondOptions?.abortSignal?.aborted).toBe(true);
    secondOptions?.onEnd?.();
  });
});

describe('createAIInvokeResult', (): void => {
  it('does not read SDK output when no structured output was requested', (): void => {
    const result = createAIInvokeResult(createTextOnlyResultWithThrowingOutput(), false);

    expect(result).toEqual<AIInvokeResult>({
      text: '',
      stepUsage: {
        inputTokens: 737,
        outputTokens: 150,
        totalTokens: 887
      },
      totalUsage: {
        inputTokens: 737,
        outputTokens: 150,
        totalTokens: 887
      }
    });
    expect(result).not.toHaveProperty('output');
  });

  it('passes through SDK output when structured output was requested', (): void => {
    expect(createAIInvokeResult(createStructuredResult(), true)).toEqual<AIInvokeResult>({
      text: '',
      output: { title: '摘要' },
      stepUsage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3
      },
      totalUsage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3
      }
    });
  });
});

describe('AIService.generateText abort', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('keeps the fixed safety deadline for direct generation', async (): Promise<void> => {
    const deadlineController = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadlineController.signal);
    vi.spyOn(aiService.aiProvider, 'create').mockReturnValue({} as ReturnType<typeof aiService.aiProvider.create>);
    generateTextMock.mockImplementationOnce(
      (options: { abortSignal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject): void => {
          options.abortSignal?.addEventListener('abort', (): void => reject(new Error('deadline reached')), { once: true });
        })
    );

    const invocation = aiService.generateText(AI_CREATE_OPTIONS, {
      requestId: 'direct-generation-deadline',
      modelId: 'model-1',
      prompt: 'generate once'
    });
    await vi.waitFor((): void => {
      expect(generateTextMock).toHaveBeenCalledTimes(1);
    });
    deadlineController.abort();
    const [error] = await invocation;

    expect(timeoutSpy).toHaveBeenCalledWith(300_000);
    expect(error).toBeDefined();
  });

  it('registers requestId abort signal and cancels synchronous generation', async (): Promise<void> => {
    const createOptions: AICreateOptions = {
      providerType: 'openai',
      providerId: 'provider-1',
      providerName: 'OpenAI'
    };
    vi.spyOn(aiService.aiProvider, 'create').mockReturnValue({} as ReturnType<typeof aiService.aiProvider.create>);
    generateTextMock.mockImplementationOnce(
      (options: { abortSignal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject): void => {
          options.abortSignal?.addEventListener('abort', (): void => reject(new Error('aborted')), { once: true });
        })
    );

    const invocation = aiService.generateText(createOptions, {
      requestId: 'summary-runtime-1',
      modelId: 'model-1',
      prompt: 'compress'
    });
    await vi.waitFor((): void => {
      expect(generateTextMock).toHaveBeenCalledTimes(1);
    });
    aiService.abortStream('summary-runtime-1');
    const [error] = await invocation;

    expect(error).toBeDefined();
    expect(generateTextMock.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('AIService sensitive logging', (): void => {
  it('logs only invocation metadata without prompt or structured output', async (): Promise<void> => {
    const promptSecret = 'PRIVATE_COMPACTION_SOURCE_CONTENT';
    const outputSecret = 'PRIVATE_STRUCTURED_SUMMARY_CONTENT';
    const infoSpy = vi.spyOn(log, 'info').mockImplementation((): void => undefined);
    vi.spyOn(aiService.aiProvider, 'create').mockReturnValue({} as ReturnType<typeof aiService.aiProvider.create>);
    generateTextMock.mockResolvedValueOnce({
      text: '',
      output: { secret: outputSecret },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    });

    await aiService.generateText(
      { providerType: 'openai', providerId: 'provider-1', providerName: 'OpenAI' },
      {
        requestId: 'summary-runtime-sensitive',
        modelId: 'model-1',
        prompt: promptSecret,
        output: { schema: { type: 'object' } }
      }
    );

    const serializedLogs = JSON.stringify(infoSpy.mock.calls);
    expect(serializedLogs).toContain('summary-runtime-sensitive');
    expect(serializedLogs).toContain('model-1');
    expect(serializedLogs).not.toContain(promptSecret);
    expect(serializedLogs).not.toContain(outputSecret);
    infoSpy.mockRestore();
  });

  it('does not log provider errors that may echo private request content', async (): Promise<void> => {
    const errorSecret = 'PRIVATE_PROVIDER_REQUEST_ECHO';
    const errorSpy = vi.spyOn(log, 'error').mockImplementation((): void => undefined);
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation((): void => undefined);
    vi.spyOn(aiService.aiProvider, 'create').mockReturnValue({} as ReturnType<typeof aiService.aiProvider.create>);
    generateTextMock.mockRejectedValueOnce(new Error(errorSecret));

    await aiService.generateText(
      { providerType: 'openai', providerId: 'provider-1', providerName: 'OpenAI' },
      { requestId: 'summary-runtime-error', modelId: 'model-1', prompt: 'private prompt' }
    );

    const loggedText = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((value: unknown): string => (value instanceof Error ? `${value.message}\n${value.stack ?? ''}` : String(value)))
      .join('\n');
    expect(loggedText).not.toContain(errorSecret);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('DeepSeekProvider.createProviderOptions', (): void => {
  it('maps disabled generic reasoning to DeepSeek thinking disabled options', (): void => {
    const provider = new DeepSeekProvider();

    expect(provider.createProviderOptions({ modelId: 'deepseek-chat', reasoning: { enabled: false } })).toEqual({
      deepseek: {
        thinking: { type: 'disabled' }
      }
    });
  });

  it('does not add DeepSeek provider options unless reasoning is explicitly disabled', (): void => {
    const provider = new DeepSeekProvider();

    expect(provider.createProviderOptions({ modelId: 'deepseek-chat' })).toBeUndefined();
    expect(provider.createProviderOptions({ modelId: 'deepseek-chat', reasoning: { enabled: true } })).toBeUndefined();
  });
});

describe('AlibabaProvider.createProviderOptions', (): void => {
  it('maps enabled generic reasoning to Alibaba enableThinking options', (): void => {
    const provider = new AlibabaProvider();

    expect(provider.createProviderOptions({ modelId: 'qwen3.7-max', reasoning: { enabled: true } })).toEqual({
      alibaba: {
        enableThinking: true
      }
    });
  });

  it('maps disabled generic reasoning to Alibaba enableThinking options', (): void => {
    const provider = new AlibabaProvider();

    expect(provider.createProviderOptions({ modelId: 'qwen3.7-max', reasoning: { enabled: false } })).toEqual({
      alibaba: {
        enableThinking: false
      }
    });
  });

  it('does not add Alibaba provider options unless reasoning is explicit', (): void => {
    const provider = new AlibabaProvider();

    expect(provider.createProviderOptions({ modelId: 'qwen3.7-max' })).toBeUndefined();
  });
});

describe('VolcengineProvider.createProviderOptions', (): void => {
  it('maps enabled generic reasoning to Volcengine thinking enabled options', (): void => {
    const provider = new VolcengineProvider();

    expect(provider.createProviderOptions({ modelId: 'doubao-seed-2.0-pro', reasoning: { enabled: true } })).toEqual({
      volcengine: {
        thinking: { type: 'enabled' }
      }
    });
  });

  it('maps disabled generic reasoning to Volcengine thinking disabled options', (): void => {
    const provider = new VolcengineProvider();

    expect(provider.createProviderOptions({ modelId: 'doubao-seed-2.0-pro', reasoning: { enabled: false } })).toEqual({
      volcengine: {
        thinking: { type: 'disabled' }
      }
    });
  });

  it('does not add Volcengine provider options unless reasoning is explicit', (): void => {
    const provider = new VolcengineProvider();

    expect(provider.createProviderOptions({ modelId: 'doubao-seed-2.0-pro' })).toBeUndefined();
  });
});

describe('MoonshotProvider.createProviderOptions', (): void => {
  it('maps enabled generic reasoning to Kimi thinking enabled options', (): void => {
    const provider = new MoonshotProvider();

    expect(provider.createProviderOptions({ modelId: 'kimi-k2.7-code', reasoning: { enabled: true } })).toEqual({
      moonshot: {
        thinking: { type: 'enabled', keep: 'all' }
      }
    });
  });

  it('does not send unsupported Kimi thinking disabled options', (): void => {
    const provider = new MoonshotProvider();

    expect(provider.createProviderOptions({ modelId: 'kimi-k2.7-code', reasoning: { enabled: false } })).toBeUndefined();
    expect(provider.createProviderOptions({ modelId: 'kimi-k2.7-code' })).toBeUndefined();
  });
});

describe('OpenAI-compatible provider option defaults', (): void => {
  it('does not add provider options for GLM unless a supported mapping is introduced', (): void => {
    const provider: AIProvider = new GLMProvider();

    expect(provider.createProviderOptions?.({ modelId: 'glm-5.2', reasoning: { enabled: true } })).toBeUndefined();
  });

  it('does not add provider options for MiniMax unless a supported mapping is introduced', (): void => {
    const provider: AIProvider = new MiniMaxProvider();

    expect(provider.createProviderOptions?.({ modelId: 'MiniMax-M3', reasoning: { enabled: true } })).toBeUndefined();
  });

  it('does not add provider options for MiMo unless a supported mapping is introduced', (): void => {
    const provider: AIProvider = new MiMoProvider();

    expect(provider.createProviderOptions?.({ modelId: 'mimo-v2.5-pro', reasoning: { enabled: true } })).toBeUndefined();
  });
});
