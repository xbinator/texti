# ConfirmationCard Custom Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `ConfirmationCard` 支持“模型给建议，用户也可自己输入答案”并复用现有 `user-choice-submit` 链路。

**Architecture:** 在确认卡片类型中补充可选的用户选择题数据，让 `ConfirmationCard.vue` 仅在存在该数据且允许自由输入时渲染输入区。组件提交时直接发出 `AIUserChoiceAnswerData`，`MessageBubble` 和 `ConversationView` 负责透传到现有 `submitUserChoice` 流程。

**Tech Stack:** Vue 3 `script setup`、TypeScript、Vue Test Utils、Vitest

---

### Task 1: 为确认卡自由输入补充失败测试

**Files:**
- Modify: `test/components/BChat/confirmation-card.component.test.ts`
- Modify: `test/components/BChat/message-bubble.component.test.ts`
- Test: `test/components/BChat/confirmation-card.component.test.ts`
- Test: `test/components/BChat/message-bubble.component.test.ts`

- [ ] **Step 1: 写确认卡提交自由输入的失败测试**

```ts
it('submits custom user input through user-choice-submit when confirmation supports other input', async () => {
  const wrapper = mountConfirmationCard(createConfirmationPart({
    userChoiceQuestion: {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      mode: 'single',
      question: '请选择或自己输入',
      options: [],
      allowOther: true
    }
  }));

  await wrapper.get('.confirm-card__custom-trigger').trigger('click');
  await wrapper.get('.confirm-card__custom-input').setValue('我自己来写');
  await wrapper.get('.confirm-card__custom-submit').trigger('click');

  expect(wrapper.emitted('user-choice-submit')).toEqual([
    [{ questionId: 'question-1', toolCallId: 'tool-call-1', answers: [], otherText: '我自己来写' }]
  ]);
});
```

- [ ] **Step 2: 写 MessageBubble 透传自由输入的失败测试**

```ts
it('re-emits user-choice-submit from the embedded confirmation card', async () => {
  const wrapper = mountMessageBubble(createMessageWithConfirmation());

  await wrapper.get('.confirm-card__custom-trigger').trigger('click');
  await wrapper.get('.confirm-card__custom-input').setValue('自定义答案');
  await wrapper.get('.confirm-card__custom-submit').trigger('click');

  expect(wrapper.emitted('user-choice-submit')).toEqual([
    [{ questionId: 'question-1', toolCallId: 'tool-call-1', answers: [], otherText: '自定义答案' }]
  ]);
});
```

- [ ] **Step 3: 运行失败测试确认 RED**

Run: `pnpm vitest run test/components/BChat/confirmation-card.component.test.ts test/components/BChat/message-bubble.component.test.ts`

Expected: FAIL，提示 `ConfirmationCard` 尚未发出 `user-choice-submit` 或找不到新增输入节点。

### Task 2: 实现确认卡自由输入与类型扩展

**Files:**
- Modify: `types/chat.d.ts`
- Modify: `src/components/BChatSidebar/components/ConfirmationCard.vue`
- Modify: `src/components/BChatSidebar/components/MessageBubble.vue`
- Test: `test/components/BChat/confirmation-card.component.test.ts`
- Test: `test/components/BChat/message-bubble.component.test.ts`

- [ ] **Step 1: 扩展确认卡片类型**

```ts
import type { AIAwaitingUserChoiceQuestion, AIToolExecutionResult, AIUsage } from './ai';

export interface ChatMessageConfirmationPart {
  // ...
  userChoiceQuestion?: AIAwaitingUserChoiceQuestion;
}
```

- [ ] **Step 2: 在 ConfirmationCard 中实现最小输入交互**

```ts
const showCustomInput = ref(false);
const customInput = ref('');
const canSubmitCustomInput = computed(() => props.part.confirmationStatus === 'pending'
  && props.part.userChoiceQuestion?.allowOther === true
  && customInput.value.trim().length > 0);

function handleSubmitCustomInput(): void {
  if (!props.part.userChoiceQuestion || !canSubmitCustomInput.value) return;
  emit('user-choice-submit', {
    questionId: props.part.userChoiceQuestion.questionId,
    toolCallId: props.part.userChoiceQuestion.toolCallId,
    answers: [],
    otherText: customInput.value.trim()
  });
}
```

- [ ] **Step 3: 在 MessageBubble 中透传新事件**

```vue
<ConfirmationCard
  v-else-if="item.type === 'confirmation'"
  :part="item"
  @confirmation-action="$emit('confirmation-action', $event.confirmationId, $event.action)"
  @user-choice-submit="$emit('user-choice-submit', $event)"
/>
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `pnpm vitest run test/components/BChat/confirmation-card.component.test.ts test/components/BChat/message-bubble.component.test.ts`

Expected: PASS

### Task 3: 回归、源码断言与变更记录

**Files:**
- Modify: `test/components/BChat/message-bubble-confirmation-source.test.ts`
- Modify: `changelog/2026-05-04.md`

- [ ] **Step 1: 更新源码断言测试**

```ts
expect(source).toContain('@user-choice-submit="$emit(\'user-choice-submit\', $event)"');
```

- [ ] **Step 2: 新增 changelog 记录**

```md
# 2026-05-04

## Changed
- 为 ConfirmationCard 增加自定义输入入口，并复用现有 user-choice-submit 提交流程。
```

- [ ] **Step 3: 运行最终回归**

Run: `pnpm vitest run test/components/BChat/confirmation-card.component.test.ts test/components/BChat/message-bubble.component.test.ts test/components/BChat/message-bubble-confirmation-source.test.ts`

Expected: PASS
