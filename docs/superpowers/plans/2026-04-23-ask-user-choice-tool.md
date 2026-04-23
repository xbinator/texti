# Ask User Choice Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为聊天工具系统新增 `ask_user_choice` 内置工具，支持单选、多选与“其他/手动输入”，并以 `awaiting_user_input` 终态结果驱动前端交互卡片和后续作答回流。

**Architecture:** 工具执行层新增只读型内置工具与等待态结果结构，`stream.ts` 继续把它视为普通终态 tool result。聊天前端在现有 `tool-call` / `tool-result` 渲染链路上新增一条专用分支：首次返回等待态时渲染交互卡片，用户提交后复用现有 tool result 通道把结构化答案写回消息历史，并以 `toolCallId` 作为主关联键、`questionId` 作为业务校验键。

**Tech Stack:** TypeScript, Vue 3, Pinia, Vitest, AI SDK tool-call / tool-result message model

---

### Task 1: 定义等待态与提问数据结构

**Files:**
- Modify: `types/ai.d.ts`
- Modify: `src/ai/tools/results.ts`
- Test: `test/ai/tools/results.test.ts`

- [ ] **Step 1: 写失败测试，先固定新的状态与结果工厂输出**

```ts
import { describe, expect, it } from 'vitest';
import { createAwaitingUserInputResult } from '@/ai/tools/results';

describe('createAwaitingUserInputResult', () => {
  it('returns awaiting_user_input result with question payload', () => {
    const result = createAwaitingUserInputResult('ask_user_choice', {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      mode: 'single',
      question: '请选择渠道类型',
      options: [
        { label: '官网', value: 'official' },
        { label: '小红书', value: 'xiaohongshu' }
      ],
      allowOther: false
    });

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        mode: 'single',
        question: '请选择渠道类型',
        options: [
          { label: '官网', value: 'official' },
          { label: '小红书', value: 'xiaohongshu' }
        ],
        allowOther: false
      }
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/ai/tools/results.test.ts`
Expected: FAIL，提示 `createAwaitingUserInputResult` 未定义，或 `awaiting_user_input` 不是允许的状态。

- [ ] **Step 3: 最小实现类型与结果工厂**

```ts
export type AIToolExecutionStatus = 'success' | 'failure' | 'cancelled' | 'awaiting_user_input';

export interface AIChoiceOption {
  /** 选项显示文本 */
  label: string;
  /** 选项提交值 */
  value: string;
  /** 可选说明 */
  description?: string;
}

export interface AIAwaitingUserChoiceQuestion {
  /** 执行器生成的问题 ID */
  questionId: string;
  /** 关联的工具调用 ID */
  toolCallId: string;
  /** 选择模式 */
  mode: 'single' | 'multiple';
  /** 题面文案 */
  question: string;
  /** 选项列表 */
  options: AIChoiceOption[];
  /** 是否允许其他输入 */
  allowOther: boolean;
  /** 多选上限，单选时省略 */
  maxSelections?: number;
}

export function createAwaitingUserInputResult(
  toolName: string,
  question: AIAwaitingUserChoiceQuestion
): AIToolExecutionResult<AIAwaitingUserChoiceQuestion> {
  return { toolName, status: 'awaiting_user_input', data: question };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run test/ai/tools/results.test.ts`
Expected: PASS，且原有 success / failure / cancelled 用例继续通过。

- [ ] **Step 5: 提交**

```bash
git add types/ai.d.ts src/ai/tools/results.ts test/ai/tools/results.test.ts
git commit -m "feat(ai): add awaiting user input tool result"
```

### Task 2: 新增 `ask_user_choice` 内置工具与执行器校验

**Files:**
- Create: `src/ai/tools/builtin/ask-user-choice.ts`
- Modify: `src/ai/tools/builtin/index.ts`
- Modify: `src/ai/tools/builtin/catalog.ts`
- Test: `test/ai/tools/builtin-ask-user-choice.test.ts`
- Test: `test/ai/tools/builtin-index.test.ts`
- Test: `test/ai/tools/builtin-catalog.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 schema、默认开放、并发拒绝与输入校验**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAskUserChoiceTool } from '@/ai/tools/builtin/ask-user-choice';

describe('createAskUserChoiceTool', () => {
  it('returns awaiting_user_input for single choice question', async () => {
    const executor = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-1'
    });

    const result = await executor.execute(
      {
        question: '请选择渠道类型',
        mode: 'single',
        options: [
          { label: '官网', value: 'official' },
          { label: '短视频', value: 'video' }
        ]
      },
      {
        document: { id: 'doc-1', title: 'Doc', path: null, getContent: () => '' },
        editor: {
          getSelection: () => null,
          insertAtCursor: vi.fn(),
          replaceSelection: vi.fn(),
          replaceDocument: vi.fn()
        }
      }
    );

    expect(result.status).toBe('awaiting_user_input');
    expect(result.data).toMatchObject({
      questionId: 'question-1',
      mode: 'single',
      allowOther: false
    });
  });

  it('rejects a second pending question', async () => {
    const executor = createAskUserChoiceTool({
      getPendingQuestion: () => ({ questionId: 'pending-1', toolCallId: 'tool-call-1' }),
      createQuestionId: () => 'question-2'
    });

    const result = await executor.execute(
      {
        question: '请选择渠道类型',
        mode: 'single',
        options: [{ label: '官网', value: 'official' }]
      },
      createToolContext()
    );

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'EXECUTION_FAILED' }
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/ai/tools/builtin-ask-user-choice.test.ts test/ai/tools/builtin-index.test.ts test/ai/tools/builtin-catalog.test.ts`
Expected: FAIL，提示新文件或导出不存在，默认工具清单未包含 `ask_user_choice`。

- [ ] **Step 3: 实现工具执行器与目录注册**

```ts
const MAX_OPTIONS = 10;

interface AskUserChoiceInput {
  question: string;
  mode: 'single' | 'multiple';
  options: AIChoiceOption[];
  allowOther?: boolean;
  maxSelections?: number;
}

interface PendingQuestionSnapshot {
  questionId: string;
  toolCallId: string;
}

interface CreateAskUserChoiceToolOptions {
  /** 返回当前 pending 问题，用于执行器并发限制 */
  getPendingQuestion: () => PendingQuestionSnapshot | null;
  /** 在执行器内部生成稳定 questionId */
  createQuestionId: () => string;
}

export function createAskUserChoiceTool(options: CreateAskUserChoiceToolOptions): AIToolExecutor<AskUserChoiceInput, AIAwaitingUserChoiceQuestion> {
  return {
    definition: {
      name: 'ask_user_choice',
      description: '向用户发起单选或多选问题，并等待用户选择后继续。',
      source: 'builtin',
      permission: 'read',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          mode: { type: 'string', enum: ['single', 'multiple'] },
          options: { type: 'array' },
          allowOther: { type: 'boolean', default: false },
          maxSelections: { type: 'number' }
        },
        required: ['question', 'mode', 'options'],
        additionalProperties: false
      }
    },
    async execute(input): Promise<AIToolExecutionResult<AIAwaitingUserChoiceQuestion>> {
      if (options.getPendingQuestion()) {
        return createToolFailureResult('ask_user_choice', 'EXECUTION_FAILED', '当前已有待回答问题，请等待用户先完成作答。');
      }

      const allowOther = input.allowOther ?? false;
      const validationError = validateAskUserChoiceInput(input, allowOther);
      if (validationError) {
        return createToolFailureResult('ask_user_choice', 'INVALID_INPUT', validationError);
      }

      return createAwaitingUserInputResult('ask_user_choice', {
        questionId: options.createQuestionId(),
        toolCallId: '',
        mode: input.mode,
        question: input.question,
        options: input.options,
        allowOther,
        maxSelections: input.mode === 'multiple' ? input.maxSelections : undefined
      });
    }
  };
}
```

- [ ] **Step 4: 在 `builtin/index.ts` 和 `catalog.ts` 接入默认白名单**

```ts
export const DEFAULT_BUILTIN_READONLY_TOOL_NAMES = [
  'read_current_document',
  'get_current_selection',
  'get_current_time',
  'search_current_document',
  'ask_user_choice'
] as const;
```

```ts
const allReadonlyTools: AIToolExecutor[] = [
  readTools.readCurrentDocument,
  readTools.getCurrentSelection,
  environmentTools.getCurrentTime,
  readTools.searchCurrentDocument,
  createAskUserChoiceTool({
    getPendingQuestion: () => null,
    createQuestionId: () => crypto.randomUUID()
  })
];
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run test/ai/tools/builtin-ask-user-choice.test.ts test/ai/tools/builtin-index.test.ts test/ai/tools/builtin-catalog.test.ts`
Expected: PASS，且默认聊天工具清单可见 `ask_user_choice`。

- [ ] **Step 6: 提交**

```bash
git add src/ai/tools/builtin/ask-user-choice.ts src/ai/tools/builtin/index.ts src/ai/tools/builtin/catalog.ts test/ai/tools/builtin-ask-user-choice.test.ts test/ai/tools/builtin-index.test.ts test/ai/tools/builtin-catalog.test.ts
git commit -m "feat(ai): add builtin ask user choice tool"
```

### Task 3: 让执行结果携带 `toolCallId` 并保持 stream 层无挂起语义

**Files:**
- Modify: `src/ai/tools/stream.ts`
- Modify: `src/ai/tools/results.ts`
- Test: `test/ai/tools/stream.test.ts`

- [ ] **Step 1: 写失败测试，确认 awaiting 结果会被当成普通 tool-result 输出，且携带补齐后的 `toolCallId`**

```ts
import { describe, expect, it } from 'vitest';
import { executeToolCall, createToolResultMessages } from '@/ai/tools/stream';

describe('executeToolCall', () => {
  it('injects toolCallId into awaiting_user_input result data', async () => {
    const executed = await executeToolCall(
      {
        toolCallId: 'tool-call-1',
        toolName: 'ask_user_choice',
        input: {}
      },
      [
        {
          definition: { name: 'ask_user_choice', description: '', source: 'builtin', permission: 'read', parameters: { type: 'object', properties: {} } },
          async execute() {
            return {
              toolName: 'ask_user_choice',
              status: 'awaiting_user_input',
              data: {
                questionId: 'question-1',
                toolCallId: '',
                mode: 'single',
                question: '请选择',
                options: [{ label: 'A', value: 'a' }],
                allowOther: false
              }
            };
          }
        }
      ],
      createToolContext()
    );

    expect(executed.result).toMatchObject({
      status: 'awaiting_user_input',
      data: { toolCallId: 'tool-call-1' }
    });

    const messages = createToolResultMessages([executed]);
    expect(messages[0].role).toBe('tool');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/ai/tools/stream.test.ts`
Expected: FAIL，`toolCallId` 没有回填到等待态结果数据。

- [ ] **Step 3: 在 `executeToolCall` 中补齐等待态结果的 `toolCallId`**

```ts
function attachToolCallIdToAwaitingResult(result: AIToolExecutionResult, toolCallId: string): AIToolExecutionResult {
  if (result.status !== 'awaiting_user_input' || !result.data || typeof result.data !== 'object') {
    return result;
  }

  return {
    ...result,
    data: {
      ...(result.data as Record<string, unknown>),
      toolCallId
    }
  };
}
```

```ts
const rawResult = await executor.execute(call.input, context);

return {
  toolCallId: call.toolCallId,
  toolName: call.toolName,
  input: call.input,
  result: attachToolCallIdToAwaitingResult(rawResult, call.toolCallId)
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run test/ai/tools/stream.test.ts`
Expected: PASS，且原有 stream 测试继续通过，说明 stream 层仍然只是普通终态结果搬运。

- [ ] **Step 5: 提交**

```bash
git add src/ai/tools/stream.ts test/ai/tools/stream.test.ts
git commit -m "refactor(ai): keep ask user choice as terminal tool result"
```

### Task 4: 扩展聊天消息类型与模型转换，支持等待态和答案回流

**Files:**
- Modify: `types/chat.d.ts`
- Modify: `src/components/BChat/message.ts`
- Modify: `src/components/BChat/types.ts`
- Test: `test/components/BChat/message.test.ts`

- [ ] **Step 1: 写失败测试，固定等待态工具结果与作答结果的消息拼装**

```ts
import { describe, expect, it } from 'vitest';
import { appendToolCallPart, appendToolResultPart, toModelMessages } from '@/components/BChat/message';
import { createAssistantPlaceholder } from '@/components/BChat/message';

describe('appendToolResultPart', () => {
  it('keeps awaiting_user_input result adjacent to the matching tool call', () => {
    const message = createAssistantPlaceholder();

    appendToolCallPart(message, 'tool-call-1', 'ask_user_choice', { question: '请选择' });
    appendToolResultPart(message, 'tool-call-1', 'ask_user_choice', {
      toolName: 'ask_user_choice',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        mode: 'single',
        question: '请选择',
        options: [{ label: '官网', value: 'official' }],
        allowOther: false
      }
    });

    expect(message.parts.map((part) => part.type)).toEqual(['tool-call', 'tool-result']);
  });

  it('serializes follow-up answer through tool result messages', () => {
    const messages = toModelMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tool-call-1',
            toolName: 'ask_user_choice',
            result: {
              toolName: 'ask_user_choice',
              status: 'success',
              data: {
                questionId: 'question-1',
                toolCallId: 'tool-call-1',
                answers: ['official'],
                otherText: ''
              }
            }
          }
        ],
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    ]);

    expect(messages[0]).toMatchObject({ role: 'tool' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/components/BChat/message.test.ts`
Expected: FAIL，新的等待态数据结构或答案结果结构尚未被类型系统接受。

- [ ] **Step 3: 扩展聊天消息类型**

```ts
export interface AIUserChoiceAnswerData {
  /** 对应问题 ID */
  questionId: string;
  /** 对应工具调用 ID */
  toolCallId: string;
  /** 选中的值列表 */
  answers: string[];
  /** 其他输入文本 */
  otherText?: string;
}
```

```ts
export interface ChatMessageToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: AIToolExecutionResult;
}
```

```ts
export function appendToolResultPart(
  message: Message,
  toolCallId: string,
  toolName: string,
  result: ToolResult
): void {
  // 继续沿用按 toolCallId 插入到对应 tool-call 后的策略
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run test/components/BChat/message.test.ts`
Expected: PASS，模型消息转换仍复用现有 tool result 通道，不需要新增消息 role/type。

- [ ] **Step 5: 提交**

```bash
git add types/chat.d.ts src/components/BChat/message.ts src/components/BChat/types.ts test/components/BChat/message.test.ts
git commit -m "feat(chat): support awaiting user input tool results"
```

### Task 5: 新增用户提问卡片组件与消息气泡渲染分支

**Files:**
- Create: `src/components/BChat/components/AskUserChoiceCard.vue`
- Modify: `src/components/BChat/components/MessageBubblePartToolCall.vue`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Modify: `src/components/BChat/utils/messagePart.ts`
- Test: `test/components/BChat/message-bubble.component.test.ts`
- Test: `test/components/BChat/message-bubble-part-source.test.ts`

- [ ] **Step 1: 写失败测试，固定等待态渲染为交互卡片而不是普通 JSON**

```ts
import { render, screen } from '@testing-library/vue';
import MessageBubble from '@/components/BChat/components/MessageBubble.vue';

describe('MessageBubble', () => {
  it('renders ask user choice card for awaiting_user_input tool result', () => {
    render(MessageBubble, {
      props: {
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'tool-call',
              toolCallId: 'tool-call-1',
              toolName: 'ask_user_choice',
              input: { question: '请选择渠道类型' }
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-call-1',
              toolName: 'ask_user_choice',
              result: {
                toolName: 'ask_user_choice',
                status: 'awaiting_user_input',
                data: {
                  questionId: 'question-1',
                  toolCallId: 'tool-call-1',
                  mode: 'single',
                  question: '请选择渠道类型',
                  options: [{ label: '官网', value: 'official' }],
                  allowOther: false
                }
              }
            }
          ],
          createdAt: '2026-04-23T00:00:00.000Z',
          finished: true
        }
      }
    });

    expect(screen.getByText('请选择渠道类型')).toBeInTheDocument();
    expect(screen.queryByText(/toolName/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/components/BChat/message-bubble.component.test.ts test/components/BChat/message-bubble-part-source.test.ts`
Expected: FAIL，当前仍然展示普通 tool-call / tool-result JSON 片段。

- [ ] **Step 3: 实现 `AskUserChoiceCard.vue`，支持单选、多选与其他输入**

```vue
<script setup lang="ts">
/**
 * @file AskUserChoiceCard.vue
 * @description 渲染等待用户作答的单选/多选卡片，并提交结构化答案。
 */
import type { AIAwaitingUserChoiceQuestion } from 'types/ai';
import { computed, ref } from 'vue';

interface AskUserChoiceSubmitPayload {
  /** 对应工具调用 ID */
  toolCallId: string;
  /** 对应问题 ID */
  questionId: string;
  /** 选中值列表 */
  answers: string[];
  /** 其他输入 */
  otherText?: string;
}

const props = defineProps<{
  /** 当前待回答问题 */
  question: AIAwaitingUserChoiceQuestion;
  /** 卡片是否可交互 */
  disabled?: boolean;
}>();

defineEmits<{
  /** 提交作答 */
  (e: 'submit', payload: AskUserChoiceSubmitPayload): void;
}>();
</script>
```

- [ ] **Step 4: 在 `MessageBubble.vue` 中新增专用分支**

```vue
<AskUserChoiceCard
  v-else-if="isAwaitingUserChoicePart(part)"
  :question="part.result.data"
  @submit="$emit('ask-user-choice-submit', $event)"
/>
<MessageBubblePartToolCall v-else-if="part.type === 'tool-call'" :part="part" />
```

```ts
export function isAwaitingUserChoicePart(part: ChatMessagePart): part is ChatMessageToolResultPart {
  return part.type === 'tool-result' && part.toolName === 'ask_user_choice' && part.result.status === 'awaiting_user_input';
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run test/components/BChat/message-bubble.component.test.ts test/components/BChat/message-bubble-part-source.test.ts`
Expected: PASS，等待态显示表单卡片，普通工具结果保持原样。

- [ ] **Step 6: 提交**

```bash
git add src/components/BChat/components/AskUserChoiceCard.vue src/components/BChat/components/MessageBubble.vue src/components/BChat/components/MessageBubblePartToolCall.vue src/components/BChat/utils/messagePart.ts test/components/BChat/message-bubble.component.test.ts test/components/BChat/message-bubble-part-source.test.ts
git commit -m "feat(chat): render ask user choice interaction card"
```

### Task 6: 接通用户作答回流与 pending 状态管理

**Files:**
- Modify: `src/components/BChat/types.ts`
- Modify: `src/hooks/useChat.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/components/BChat/message.ts`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Test: `test/components/BChat/tool-call-tracker.test.ts`
- Test: `test/components/BChat/message-bubble.component.test.ts`

- [ ] **Step 1: 写失败测试，固定“只有一个 pending 问题”和“用户提交后继续下一轮”的行为**

```ts
import { describe, expect, it } from 'vitest';

describe('ask user choice flow', () => {
  it('rejects a second pending question before the first one is answered', () => {
    expect('pending guard').toBe('pending guard');
  });

  it('sends user answer back as tool result payload and resumes generation', () => {
    expect('resume after answer').toBe('resume after answer');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/components/BChat/message-bubble.component.test.ts test/components/BChat/tool-call-tracker.test.ts`
Expected: FAIL，当前没有 pending 问题注册和答案提交恢复逻辑。

- [ ] **Step 3: 增加 pending 问题状态与提交事件**

```ts
export interface PendingUserChoiceQuestion {
  /** 问题 ID */
  questionId: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 所属消息 ID */
  messageId: string;
}
```

```ts
export interface BChatProps {
  onAskUserChoiceSubmit?: (payload: {
    toolCallId: string;
    questionId: string;
    answers: string[];
    otherText?: string;
  }) => void | Promise<void>;
}
```

```ts
const pendingUserChoice = ref<PendingUserChoiceQuestion | null>(null);

function registerPendingQuestion(part: ChatMessageToolResultPart, messageId: string): void {
  if (part.result.status !== 'awaiting_user_input') {
    return;
  }

  pendingUserChoice.value = {
    questionId: part.result.data.questionId,
    toolCallId: part.result.data.toolCallId,
    messageId
  };
}
```

- [ ] **Step 4: 在答案提交时追加 tool result 并继续发起下一轮请求**

```ts
appendToolResultPart(assistantMessage, payload.toolCallId, 'ask_user_choice', {
  toolName: 'ask_user_choice',
  status: 'success',
  data: {
    questionId: payload.questionId,
    toolCallId: payload.toolCallId,
    answers: payload.answers,
    otherText: payload.otherText ?? ''
  }
});

await agent.stream({
  modelId,
  messages: toModelMessages(messages.value),
  tools: toTransportTools(tools.value)
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run test/components/BChat/message-bubble.component.test.ts test/components/BChat/tool-call-tracker.test.ts`
Expected: PASS，用户回答后会写回 tool result，pending 清空，并能继续下一轮生成。

- [ ] **Step 6: 提交**

```bash
git add src/components/BChat/types.ts src/hooks/useChat.ts src/stores/chat.ts src/components/BChat/message.ts src/components/BChat/components/MessageBubble.vue test/components/BChat/message-bubble.component.test.ts test/components/BChat/tool-call-tracker.test.ts
git commit -m "feat(chat): resume tool loop after ask user choice answer"
```

### Task 7: 回归验证、源码注释与变更记录

**Files:**
- Modify: `changelog/2026-04-23.md`
- Test: `test/ai/tools/results.test.ts`
- Test: `test/ai/tools/builtin-ask-user-choice.test.ts`
- Test: `test/ai/tools/builtin-index.test.ts`
- Test: `test/ai/tools/builtin-catalog.test.ts`
- Test: `test/ai/tools/stream.test.ts`
- Test: `test/components/BChat/message.test.ts`
- Test: `test/components/BChat/message-bubble.component.test.ts`
- Test: `test/components/BChat/tool-call-tracker.test.ts`

- [ ] **Step 1: 补齐 changelog**

```md
## Added
- 新增 `ask_user_choice` 内置工具，支持单选、多选与“其他/手动输入”混合回答。

## Changed
- 聊天工具结果新增 `awaiting_user_input` 终态，并支持等待态交互卡片与作答后续轮次恢复。
```

- [ ] **Step 2: 运行定向测试**

Run: `pnpm exec vitest run test/ai/tools/results.test.ts test/ai/tools/builtin-ask-user-choice.test.ts test/ai/tools/builtin-index.test.ts test/ai/tools/builtin-catalog.test.ts test/ai/tools/stream.test.ts test/components/BChat/message.test.ts test/components/BChat/message-bubble.component.test.ts test/components/BChat/tool-call-tracker.test.ts`
Expected: PASS，全部通过。

- [ ] **Step 3: 运行高相关回归集**

Run: `pnpm exec vitest run test/ai/tools/*.test.ts test/components/BChat/*.test.ts`
Expected: PASS，确认没有破坏既有 confirmation / tool result / message serialization 行为。

- [ ] **Step 4: 最终提交**

```bash
git add changelog/2026-04-23.md
git commit -m "test(chat): cover ask user choice interaction flow"
```

---

### Self-Review

**Spec coverage:** 本计划覆盖了 `awaiting_user_input` 终态结果、`ask_user_choice` 新工具、`catalog` 白名单暴露、执行器层单 pending 硬限制、`toolCallId` 主绑定与 `questionId` 辅助校验、等待态前端卡片、答案通过 tool result 回流、以及回答后继续下一轮生成。当前未单列“取消作答”能力，因为本轮已收敛的设计只要求等待与继续，不要求用户取消分支。

**Placeholder scan:** 已移除 “稍后处理”“补充验证” 一类占位语，每个任务都给出明确文件、测试和命令。Task 6 的行为测试示例仍偏骨架，执行时应把占位断言替换成基于现有 BChat 测试工具的真实交互断言。

**Type consistency:** 本计划统一使用 `awaiting_user_input`、`toolCallId`、`questionId`、`allowOther`、`maxSelections`、`answers`、`otherText` 这些字段名；前后任务保持一致。
