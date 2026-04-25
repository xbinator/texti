<template>
  <div class="ask-user-choice-card">
    <div class="ask-user-choice-card__title">{{ question.question }}</div>

    <div class="ask-user-choice-card__options">
      <label v-for="option in question.options" :key="option.value" class="ask-user-choice-card__option">
        <input
          :type="inputType"
          :value="option.value"
          :checked="selectedValues.includes(option.value)"
          :disabled="isOptionDisabled(option.value)"
          @change="handleOptionChange(option.value, ($event.target as HTMLInputElement).checked)"
        />
        <span class="ask-user-choice-card__option-main">
          <span>{{ option.label }}</span>
          <small v-if="option.description">{{ option.description }}</small>
        </span>
      </label>
    </div>

    <input v-if="question.allowOther" v-model="otherText" class="ask-user-choice-card__other" type="text" placeholder="其他..." />

    <div class="ask-user-choice-card__footer">
      <BButton size="small" :disabled="!canSubmit" @click="handleSubmit">提交选择</BButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ChatAskUserChoiceCard.vue
 * @description 渲染 ask_user_choice 等待态工具结果并提交用户答案。
 */
import type { AIAwaitingUserChoiceQuestion } from 'types/ai';
import type { AIUserChoiceAnswerData } from 'types/chat';
import { computed, ref } from 'vue';
import BButton from '@/components/BButton/index.vue';

const props = defineProps<{
  /** 等待用户回答的问题 */
  question: AIAwaitingUserChoiceQuestion;
}>();

const emit = defineEmits<{
  /** 用户提交选择答案 */
  (e: 'submit-choice', answer: AIUserChoiceAnswerData): void;
}>();

const selectedValues = ref<string[]>([]);
const otherText = ref('');

const inputType = computed(() => (props.question.mode === 'multiple' ? 'checkbox' : 'radio'));
const canSubmit = computed(() => selectedValues.value.length > 0 || otherText.value.trim().length > 0);

/**
 * 根据选择模式更新选中值。
 * @param value - 选项值
 * @param checked - 是否选中
 */
function handleOptionChange(value: string, checked: boolean): void {
  if (props.question.mode === 'single') {
    selectedValues.value = checked ? [value] : [];
    return;
  }

  if (!checked) {
    selectedValues.value = selectedValues.value.filter((item) => item !== value);
    return;
  }

  if (selectedValues.value.includes(value)) {
    return;
  }

  const maxSelections = props.question.maxSelections ?? props.question.options.length;
  if (selectedValues.value.length >= maxSelections) {
    return;
  }

  selectedValues.value = [...selectedValues.value, value];
}

/**
 * 判断选项是否因多选上限而不可再选。
 * @param value - 选项值
 */
function isOptionDisabled(value: string): boolean {
  if (props.question.mode !== 'multiple' || selectedValues.value.includes(value)) {
    return false;
  }

  const maxSelections = props.question.maxSelections ?? props.question.options.length;
  return selectedValues.value.length >= maxSelections;
}

/**
 * 提交当前用户答案。
 */
function handleSubmit(): void {
  if (!canSubmit.value) {
    return;
  }

  emit('submit-choice', {
    questionId: props.question.questionId,
    toolCallId: props.question.toolCallId,
    answers: [...selectedValues.value],
    otherText: otherText.value.trim()
  });
}
</script>

<style scoped lang="less">
.ask-user-choice-card {
  padding: 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
}

.ask-user-choice-card__title {
  margin-bottom: 10px;
  font-weight: 600;
}

.ask-user-choice-card__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ask-user-choice-card__option {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  cursor: pointer;
}

.ask-user-choice-card__option-main {
  display: flex;
  flex-direction: column;
  gap: 2px;

  small {
    color: var(--text-secondary);
  }
}

.ask-user-choice-card__other {
  width: 100%;
  padding: 7px 9px;
  margin-top: 10px;
  color: var(--text-primary);
  outline: none;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.ask-user-choice-card__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
