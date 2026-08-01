<!--
  @file QuestionCard.vue
  @description 渲染 question 等待态工具结果，分步步骤条形式。
  多个问题时逐个展示，用户点击"下一步"逐步完成，最后一步为补充信息。
-->
<template>
  <div class="choice-card">
    <div class="choice-card__step">
      <div class="choice-card__header">
        <div class="choice-card__title">
          <span>{{ isSupplementaryStep ? '是否有更多的补充信息需要提供？（可选）' : currentItem.question }}</span>
        </div>
      </div>

      <!-- 补充信息输入 -->
      <input
        v-if="isSupplementaryStep"
        v-model="otherText"
        class="choice-card__other"
        type="text"
        placeholder="请输入补充信息..."
        :disabled="interactionDisabled"
      />

      <!-- 问题选项 -->
      <div v-else class="choice-card__options">
        <button
          v-for="option in currentItem.options"
          :key="option.value"
          class="choice-card__option-btn"
          :class="{ 'choice-card__option-btn--selected': currentSelectedValues.includes(option.value) }"
          :disabled="interactionDisabled || isCurrentOptionDisabled(option.value)"
          type="button"
          @click="handleButtonClick(option.value)"
        >
          <span class="choice-card__option-btn-label">{{ option.label }}</span>
          <span v-if="option.description" class="choice-card__option-desc">{{ option.description }}</span>
        </button>
      </div>

      <div class="choice-card__footer">
        <span v-if="totalSteps > 1" class="choice-card__indicator">{{ currentStep + 1 }} / {{ totalSteps }}</span>

        <div class="choice-card__footer-right">
          <BButton size="small" type="secondary" :disabled="interactionDisabled" @click="handleCancel">取消</BButton>
          <BButton v-if="currentStep > 0" size="small" type="secondary" :disabled="interactionDisabled" @click="handlePrev">上一步</BButton>
          <BButton v-if="isSupplementaryStep" size="small" :disabled="interactionDisabled" @click="handleSubmit">提交</BButton>
          <BButton v-else size="small" :disabled="!canSubmitCurrentQuestion || interactionDisabled" @click="handleNext">下一步</BButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file QuestionCard.vue
 * @description 渲染 question 等待态工具结果，分步步骤条形式。
 * 多个问题时逐个展示，用户点击"下一步"逐步完成，最后一步为补充信息。
 */
import type { AIAwaitingUserChoiceItem, AIAwaitingUserChoiceQuestion } from 'types/ai';
import { computed, ref, watch } from 'vue';
import { createUserChoice, type SubmitAction } from '../utils/submitAction';

const props = withDefaults(
  defineProps<{
    /** 等待用户回答的问题 */
    question: AIAwaitingUserChoiceQuestion;
    /** 会话已结束时禁用交互 */
    disabled?: boolean;
    /** 统一提交函数。 */
    submitAction?: (action: SubmitAction) => Promise<void> | void;
  }>(),
  {
    disabled: false,
    submitAction: undefined
  }
);

/** 每个问题的选中值列表，索引与 questionItems 一一对应 */
const selectedValuesByQuestion = ref<string[][]>([]);
/** 补充信息文本 */
const otherText = ref('');
/** 当前步骤：0 ~ questionItems.length-1 为问题步骤，questionItems.length 为补充信息步骤 */
const currentStep = ref(0);
/** 当前答案是否正在提交。 */
const submitting = ref(false);
/** 外部禁用或提交中都禁止继续操作。 */
const interactionDisabled = computed<boolean>(() => props.disabled || submitting.value);

/** 展开后的所有问题项（兼容单问题和多问题结构） */
const questionItems = computed<AIAwaitingUserChoiceItem[]>(() => props.question.questions ?? [props.question]);

/** 总步骤数：问题步骤数 + 补充信息步骤 */
const totalSteps = computed(() => questionItems.value.length + 1);

/** 是否处于补充信息步骤 */
const isSupplementaryStep = computed(() => currentStep.value >= questionItems.value.length);

/** 当前步骤对应的问题项 */
const currentItem = computed<AIAwaitingUserChoiceItem>(() => questionItems.value[currentStep.value]);

/** 当前步骤的选中值 */
const currentSelectedValues = computed<string[]>(() => selectedValuesByQuestion.value[currentStep.value] ?? []);

/** 当前问题是否已选择至少一个选项 */
const canSubmitCurrentQuestion = computed(() => currentSelectedValues.value.length > 0);

watch(
  questionItems,
  (items) => {
    selectedValuesByQuestion.value = items.map((_, index) => selectedValuesByQuestion.value[index] ?? []);
  },
  { immediate: true }
);

watch(
  (): readonly [string, string] => [props.question.questionId, props.question.toolCallId],
  (): void => {
    submitting.value = false;
  }
);

/**
 * 提交一次用户选择并在失败后恢复可操作状态。
 * @param action - 用户选择提交动作
 */
async function submitChoice(action: SubmitAction): Promise<void> {
  if (interactionDisabled.value || !props.submitAction) return;
  submitting.value = true;
  try {
    await props.submitAction(action);
  } catch (error: unknown) {
    submitting.value = false;
    throw error;
  }
}

/**
 * 获取指定问题当前选中的值。
 * @param questionIndex - 问题下标
 * @returns 当前问题的选中值列表
 */
function getSelectedValues(questionIndex: number): string[] {
  return selectedValuesByQuestion.value[questionIndex] ?? [];
}

/**
 * 按钮点击处理：单选模式下点击切换，多选模式下 toggle 选中/取消。
 * @param value - 选项值
 */
function handleButtonClick(value: string): void {
  const item = currentItem.value;
  if (!item) {
    return;
  }

  const questionIndex = currentStep.value;
  const currentValues = getSelectedValues(questionIndex);

  if (item.mode === 'single') {
    // 单选：点击已选中的不做任何操作
    if (currentValues.includes(value)) {
      return;
    }
    selectedValuesByQuestion.value[questionIndex] = [value];
    return;
  }

  // 多选：toggle 选中/取消
  if (currentValues.includes(value)) {
    selectedValuesByQuestion.value[questionIndex] = currentValues.filter((selectedValue) => selectedValue !== value);
    return;
  }

  const maxSelections = item.maxSelections ?? item.options.length;
  if (currentValues.length >= maxSelections) {
    return;
  }

  selectedValuesByQuestion.value[questionIndex] = [...currentValues, value];
}

/**
 * 判断当前步骤中选项是否因多选上限而不可再选。
 * @param value - 选项值
 */
function isCurrentOptionDisabled(value: string): boolean {
  const item = currentItem.value;
  const currentValues = currentSelectedValues.value;
  if (!item || item.mode !== 'multiple' || currentValues.includes(value)) {
    return false;
  }

  const maxSelections = item.maxSelections ?? item.options.length;
  return currentValues.length >= maxSelections;
}

/**
 * 进入下一步：如果当前是最后一个问题，则进入补充信息步骤。
 */
function handleNext(): void {
  if (!canSubmitCurrentQuestion.value) {
    return;
  }
  currentStep.value = Math.min(currentStep.value + 1, questionItems.value.length);
}

/**
 * 返回上一步：从补充信息步骤回到最后一个问题，或从当前问题回到上一个问题。
 */
function handlePrev(): void {
  currentStep.value = Math.max(currentStep.value - 1, 0);
}

/**
 * 取消操作：提交空答案。
 */
async function handleCancel(): Promise<void> {
  await submitChoice(
    createUserChoice({
      questionId: props.question.questionId,
      toolCallId: props.question.toolCallId,
      answers: [],
      questionAnswers: [],
      otherText: ''
    })
  );
}

/**
 * 提交当前用户答案。
 */
async function handleSubmit(): Promise<void> {
  const questionAnswers = questionItems.value.map((item, index) => ({
    question: item.question,
    answers: [...getSelectedValues(index)]
  }));

  await submitChoice(
    createUserChoice({
      questionId: props.question.questionId,
      toolCallId: props.question.toolCallId,
      answers: questionAnswers[0]?.answers ?? [],
      questionAnswers,
      otherText: otherText.value.trim()
    })
  );
}
</script>

<style scoped lang="less">
.choice-card {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.choice-card__step {
  margin-top: 0;
}

.choice-card__header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.choice-card__title {
  flex: 1;
  width: 0;
  font-weight: 500;
}

.choice-card__indicator {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.choice-card__options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choice-card__option-btn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
  box-shadow: var(--interaction-raised-shadow);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard), transform var(--motion-duration-fast) var(--motion-easing-press);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &:active:not(:disabled) {
    box-shadow: var(--interaction-pressed-shadow);
    transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));
  }

  &--selected {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
  }
}

.choice-card__option-btn-label {
  font-weight: 500;
  color: var(--text-primary);
}

.choice-card__option-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.choice-card__other {
  width: 100%;
  padding: 7px 9px;
  margin-top: 10px;
  color: var(--text-primary);
  outline: none;
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
}

.choice-card__footer {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.choice-card__footer-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
