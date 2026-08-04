<!--
  @file BubblePartTool.vue
  @description 展示工具执行状态、输入输出、Shell PTY 实时画面和结构化结果摘要。
-->
<template>
  <!-- 工具气泡容器：inputting 状态默认展开，其余状态默认折叠 -->
  <BubblePart type="tool" :has-content="hasContent" :default-collapsed="defaultCollapsed">
    <template #title>
      <!-- 状态图标：inputting 旋转、executing 扳手、done 成功/失败 -->
      <BIcon :icon="icon" :class="bem('icon', { spin: part.status === 'inputting' })" :size="14" />

      <!-- todowrite 任务进度 -->
      <div v-if="todoWriteTodos">{{ title }} {{ todoWriteCompletedCount }}/{{ todoWriteTodos.length }}</div>
      <!-- 工具名称（文件操作时显示路径，其余显示别名） -->
      <BTruncateText v-else :class="bem('name')" :text="title" />

      <!-- 执行失败状态标签 -->
      <span v-if="part.status === 'done' && part.result?.status === 'failure'" :class="bem('status', { failure: true })">失败</span>
    </template>

    <!-- 活动状态来自 Main 持久化快照，不以组件挂载时间或动画推断工具存活。 -->
    <div v-if="part.activity" :class="bem('activity', { [part.activity.state]: true })">
      <div :class="bem('activity-header')">
        <span :class="bem('activity-state')">{{ activityLabel }}</span>
        <span v-if="activityCount" :class="bem('activity-count')">{{ activityCount }}</span>
      </div>
      <div v-if="part.activity.progress?.phase" :class="bem('activity-phase')">{{ part.activity.progress.phase }}</div>
      <div v-if="activityMessage" :class="bem('activity-message')">{{ activityMessage }}</div>
      <div v-if="part.activity.state === 'running_idle' && lastProgressText" :class="bem('activity-time')">{{ lastProgressText }}</div>
      <div v-if="showIdleControls" :class="bem('activity-actions')">
        <BButton
          type="text"
          size="mini"
          :disabled="controlPending !== null"
          :loading="controlPending === 'continue_waiting'"
          @click="handleToolControl('continue_waiting')"
        >
          继续等待
        </BButton>
        <BButton type="text" size="mini" danger :disabled="controlPending !== null" :loading="controlPending === 'stop'" @click="handleToolControl('stop')">
          停止
        </BButton>
      </div>
    </div>

    <!-- Shell 命令与当前屏幕共享终端区域，命令在前且不重复显示成功摘要 -->
    <template v-if="isShellCommand && shellDisplay">
      <div :class="bem('shell-terminal')">
        <div v-if="shellCommandContent" :class="bem('shell-command')">
          <span aria-hidden="true">$</span>
          <span>{{ ` ${shellCommandContent}` }}</span>
        </div>
        <div v-if="shellTerminalContent" :class="bem('shell-output')">{{ shellTerminalContent }}</div>
      </div>
      <div v-if="shellAttentionText" :class="bem('shell-finished', { failure: summary?.variant === 'failure' })">{{ shellAttentionText }}</div>
    </template>

    <!-- todowrite 成功结果使用单层任务卡片，避免通用工具气泡和任务面板重复嵌套 -->
    <TodoList v-else-if="todoWriteTodos" :todos="todoWriteTodos" />

    <!-- 提问工具结果：以问答形式展示用户选择 -->
    <template v-else-if="isQuestionResult">
      <div :class="bem('result')">
        <div v-for="(item, index) in qaItems" :key="index" :class="bem('result-item')">
          <div :class="bem('result-label')">{{ item.question }}</div>
          <div :class="bem('result-tags')">
            <span v-for="label in item.selectedLabels" :key="label" :class="bem('result-tag')">{{ label }}</span>
          </div>
        </div>
        <!-- 用户填写的补充信息 -->
        <div :class="bem('result-item')">
          <div :class="bem('result-label')">是否有更多的补充信息需要提供？（可选）</div>
          <div :class="bem('result-tags')">
            <span :class="bem('result-tag')">{{ questionOtherText || '未填写' }}</span>
          </div>
        </div>
      </div>
    </template>
    <!-- 有摘要的工具结果：展示人可读的摘要信息 -->
    <template v-else-if="summary">
      <div :class="bem('summary', { [summary.variant ?? 'success']: true })">
        <div v-if="summary.text" :class="bem('summary-text', { shell: isShellCommand })">{{ summary.text }}</div>
        <div v-if="summary.tags?.length" :class="bem('summary-tags')">
          <template v-for="tag in summary.tags" :key="`${tag.label}-${tag.value}`">
            <div v-if="isOpenFileTag(tag)" :class="bem('summary-tag', { clickable: true })" :title="tag.path" @click="handleOpenFileTag(tag)">
              <span v-if="tag.label" :class="bem('summary-tag-label')">{{ tag.label }}：</span>
              <span :class="bem('summary-tag-value')">{{ tag.value }}</span>
            </div>
            <div v-else :class="bem('summary-tag')">
              <span v-if="tag.label" :class="bem('summary-tag-label')">{{ tag.label }}：</span>
              <span :class="bem('summary-tag-value')">{{ tag.value }}</span>
            </div>
          </template>
        </div>
        <!-- 成功时折叠的原始数据 -->
        <template v-if="summary.variant !== 'failure' && summary.variant !== 'cancelled'">
          <div :class="bem('summary-raw-toggle')" @click="rawExpanded = !rawExpanded">
            <BIcon :icon="rawExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'" :size="12" />
            <span>{{ rawExpanded ? '收起原始数据' : '查看原始数据' }}</span>
          </div>
          <BubblePartToolCode v-if="rawExpanded" :value="previewValue" />
        </template>
      </div>
    </template>
    <!-- 无摘要的工具：展示代码格式的输入/输出内容 -->
    <BubblePartToolCode v-else-if="hasContent" :value="previewValue" />
  </BubblePart>
</template>

<script setup lang="ts">
import type { ToolSummaryTag } from '../../../utils/toolResultSummary';
import type { ChatToolActivityState } from 'types/ai';
import type { AIUserChoiceAnswerData, AIUserChoiceQuestionAnswer, ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeControlToolInput } from 'types/chat-runtime';
import { computed, ref } from 'vue';
import { isPlainObject, isString } from 'lodash-es';
import type { QuestionItemInput, QuestionToolInput } from '@/ai/tools/builtin/QuestionTool';
import type { SubmitAction } from '@/components/BChat/utils/submitAction';
import { createToolControl } from '@/components/BChat/utils/submitAction';
import { useNavigate } from '@/hooks/useNavigate';
import type { TodoItem } from '@/stores/chat/todo';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import { hasStructuredValueContent } from '../../../utils/messagePart';
import { getActionLabel } from '../../../utils/toolLabels';
import { getToolResultSummary } from '../../../utils/toolResultSummary';
import TodoList from '../../TodoList.vue';
import BubblePart from '../BubblePart/index.vue';
import BubblePartToolCode from '../BubblePartToolCode/index.vue';

defineOptions({ name: 'BubblePartTool' });

/** 工具调用部分的 props */
interface Props {
  /** 工具调用的消息片段数据 */
  part: ChatMessageToolPart;
  /** 持有该工具调用的 Runtime ID。 */
  runtimeId?: string;
  /** 消息级统一提交函数。 */
  submitAction?: (action: SubmitAction) => Promise<void> | void;
}

const props = withDefaults(defineProps<Props>(), {
  runtimeId: undefined,
  submitAction: undefined
});

const [, bem] = createNamespace('', 'bubble-part-tool');

/** 文件导航能力 */
const { openFile } = useNavigate();

/** 原始数据展开状态 */
const rawExpanded = ref(false);
/** 当前卡片正在提交的单工具控制动作。 */
const controlPending = ref<ChatRuntimeControlToolInput['action'] | null>(null);

/** 工具状态与图标的映射：inputting 旋转加载、executing 扳手、done 成功/失败/取消/等待用户输入 */
const ICON_MAP = {
  inputting: 'lucide:loader-circle',
  executing: 'lucide:hammer',
  done: { success: 'lucide:check-circle-2', failure: 'lucide:circle-alert', cancelled: 'lucide:circle-x', awaiting_user_input: 'lucide:circle-help' }
} as const;

/** 提问类工具名称集合，用于判断是否展示问答结果视图 */
const QUESTION_TOOL_NAMES = new Set(['ask_user_choice', 'ask_user_question', 'question']);

/** 活动状态的人可读文案。 */
const ACTIVITY_LABELS: Record<ChatToolActivityState, string> = {
  starting: '执行中',
  executing: '执行中',
  running_idle: '仍在运行',
  waiting_user: '等待用户',
  waiting_external: '等待外部条件',
  stopping: '正在停止',
  interrupted: '已中断'
};

/** 合法的任务状态，用于保护性解析持久化的工具输入。 */
const TODO_STATUSES = new Set<TodoItem['status']>(['pending', 'in_progress', 'completed', 'cancelled']);

/** 合法的任务优先级，用于保护性解析持久化的工具输入。 */
const TODO_PRIORITIES = new Set<TodoItem['priority']>(['high', 'medium', 'low']);

// ─── 提问工具结果解析 ─────────────────────────────────────────────────

/** 问答展示项：包含问题文本和用户选择的标签列表 */
interface QaItem {
  /** 问题文本 */
  question: string;
  /** 用户选择的选项标签列表 */
  selectedLabels: string[];
}

/**
 * 解析提问工具的输入，统一为 QuestionItemInput 数组
 * 兼容单问题（question）和多问题（questions）两种输入格式
 * @param input - 提问工具的输入参数
 * @returns 标准化后的问题列表
 */
function resolveQaQuestions(input: QuestionToolInput): QuestionItemInput[] {
  if (input.questions?.length) return input.questions;
  if (input.question) return [{ question: input.question, mode: input.mode ?? 'single', options: input.options ?? [] }];
  return [];
}

/**
 * 将用户选择的 value 值解析为可读的 label 标签
 * @param questions - 问题列表（包含 options 定义）
 * @param questionText - 当前问题文本
 * @param values - 用户选择的 value 值数组
 * @returns 对应的 label 标签数组，找不到匹配时回退为原始 value
 */
function resolveQaLabels(questions: QuestionItemInput[], questionText: string, values: string[]): string[] {
  const matched = questions.find((q) => q.question === questionText);
  const options = matched?.options ?? [];
  if (options.length === 0) return values;
  return values.map((v) => options.find((o) => o.value === v)?.label ?? v);
}

/**
 * 判断摘要标签是否可打开文件。
 * @param tag - 摘要标签
 * @returns 标签可打开文件时返回 true
 */
function isOpenFileTag(tag: ToolSummaryTag): boolean {
  return tag.action === 'openFile' && typeof tag.path === 'string' && tag.path.length > 0;
}

/**
 * 打开摘要标签关联的文件。
 * @param tag - 摘要标签
 */
async function handleOpenFileTag(tag: ToolSummaryTag): Promise<void> {
  if (!isOpenFileTag(tag)) return;

  await openFile({ filePath: tag.path });
}

/**
 * 判断未知值是否为可展示的任务项。
 * @param value - 待校验值
 * @returns 值满足任务项结构时返回 true
 */
function isTodoItem(value: unknown): value is TodoItem {
  if (!isPlainObject(value)) return false;

  const item = value as Record<string, unknown>;
  return (
    isString(item.content) &&
    isString(item.status) &&
    TODO_STATUSES.has(item.status as TodoItem['status']) &&
    isString(item.priority) &&
    TODO_PRIORITIES.has(item.priority as TodoItem['priority'])
  );
}

// ─── 组件逻辑 ────────────────────────────────────────────────────────

/** 根据工具执行状态计算显示的图标 */
const icon = computed(() => {
  const { status } = props.part;
  if (status === 'done') {
    return ICON_MAP.done[(props.part.result?.status as keyof typeof ICON_MAP.done) ?? 'failure'];
  }
  return ICON_MAP[status];
});

/** 非 inputting 状态默认折叠，inputting 时展开让用户看到实时输入 */
const defaultCollapsed = computed<boolean>(() => props.part.status !== 'inputting' && !(props.part.status === 'executing' && props.part.activity));

/** 当前活动状态文案。 */
const activityLabel = computed<string>(() => (props.part.activity ? ACTIVITY_LABELS[props.part.activity.state] : ''));

/** 当前进度数量文案。 */
const activityCount = computed<string>(() => {
  const progress = props.part.activity?.progress;
  if (progress?.completed === undefined) return '';
  return progress.total === undefined ? `${progress.completed}` : `${progress.completed} / ${progress.total}`;
});

/** 当前活动状态的补充说明。 */
const activityMessage = computed<string>(() => {
  const { activity } = props.part;
  if (!activity) return '';
  if (activity.state === 'waiting_user') return activity.userPrompt ?? '';
  if (activity.state === 'waiting_external') return activity.externalWait?.reason ?? '';
  return activity.progress?.message ?? '';
});

/** 最后实质进展的相对时间。 */
const lastProgressText = computed<string>(() => {
  const lastProgressAt = props.part.activity?.lastProgressAt;
  if (!lastProgressAt) return '';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - lastProgressAt) / 1_000));
  if (elapsedSeconds < 60) return `${elapsedSeconds} 秒前有进展`;
  return `${Math.floor(elapsedSeconds / 60)} 分钟前有进展`;
});

/** 仅空闲运行中的在途工具展示继续等待与停止。 */
const showIdleControls = computed<boolean>(
  () => props.part.status === 'executing' && props.part.activity?.state === 'running_idle' && Boolean(props.runtimeId && props.submitAction)
);

/**
 * 提交精确到当前 Runtime/toolCall 的控制动作。
 * @param action - 继续等待或停止
 */
async function handleToolControl(action: ChatRuntimeControlToolInput['action']): Promise<void> {
  if (!props.runtimeId || !props.submitAction || controlPending.value) return;
  controlPending.value = action;
  await asyncTo(
    Promise.resolve(
      props.submitAction(
        createToolControl({
          runtimeId: props.runtimeId,
          toolCallId: props.part.toolCallId,
          action
        })
      )
    )
  );
  controlPending.value = null;
}

/** 工具标题：文件操作显示文件路径，skill 显示技能名称，其余显示工具别名 */
const title = computed(() => {
  const { part } = props;
  const { alias } = getActionLabel(part.toolName);

  if (part.toolName === 'write_file' || part.toolName === 'edit_file') {
    const path = (part.input as Record<string, unknown>)?.path;

    if (typeof path === 'string') return path;
  }

  if (part.toolName === 'skill') {
    const skillName = (part.input as Record<string, unknown>)?.name;

    if (typeof skillName === 'string') return `${alias}：${skillName}`;
  }

  return alias;
});

/**
 * 获取 inputting 状态下的预览值
 * write_file 工具优先展示 content 字段，其余工具展示完整 input 或 inputText
 * @param part - 工具消息片段
 * @returns 预览内容
 */
function getInputtingValue(part: ChatMessageToolPart) {
  if (!part.input) return part.inputText ?? '';
  const { content } = part.input as { content: string };
  if (part.toolName === 'write_file' && typeof content !== 'undefined') return content;
  return part.input ?? part.inputText;
}

/** 根据工具状态计算预览内容：inputting 取输入值、executing 取输入、done 取结果 */
const previewValue = computed(() => {
  const { part } = props;
  if (part.status === 'inputting') return getInputtingValue(part);
  if (part.status === 'executing') return part.input;
  return part.result;
});

/** 判断是否有可展示的内容，done 状态始终有内容，其余状态需检查结构化值 */
const hasContent = computed(() => {
  if (props.part.status === 'done') return true;
  if (props.part.activity) return true;
  return hasStructuredValueContent(previewValue.value);
});

/** 判断是否为提问工具且有结果（成功/取消/等待用户输入），用于切换问答结果视图 */
const isQuestionResult = computed(
  () =>
    props.part.status === 'done' &&
    (props.part.result?.status === 'success' || props.part.result?.status === 'cancelled' || props.part.result?.status === 'awaiting_user_input') &&
    QUESTION_TOOL_NAMES.has(props.part.toolName)
);

/**
 * 获取 todowrite 成功调用写入的完整任务快照。
 * 非 todowrite、失败结果或输入结构异常时返回 null，并回退到通用摘要视图。
 */
const todoWriteTodos = computed<TodoItem[] | null>(() => {
  const { part } = props;

  if (part.toolName !== 'todowrite' || part.status !== 'done' || part.result?.status !== 'success' || !isPlainObject(part.input)) return null;

  const input = part.input as Record<string, unknown>;
  if (!Array.isArray(input.todos) || !input.todos.every(isTodoItem)) return null;

  return input.todos;
});

/** todowrite 任务中已完成的数量，仅在存在任务快照时返回有效值 */
const todoWriteCompletedCount = computed<number | null>(() => {
  const todos = todoWriteTodos.value;
  if (!todos) return null;
  return todos.filter((t) => t.status === 'completed').length;
});

/** 工具执行完成时的人可读摘要，支持成功/失败/取消状态，无匹配时返回 null 降级到代码视图 */
const summary = computed(() => {
  if (props.part.status !== 'done' || !props.part.result) return null;
  return getToolResultSummary(props.part.toolName, props.part.result);
});

/** 是否为终端命令执行，用于特殊样式（等宽字体 + 背景色） */
const isShellCommand = computed(() => props.part.toolName === 'run_shell_command');

/** Shell 成功结果中的结构化运行数据。 */
const shellResultData = computed<Record<string, unknown> | null>(() => {
  if (props.part.result?.status === 'success' && isPlainObject(props.part.result.data)) {
    return props.part.result.data as Record<string, unknown>;
  }
  if (props.part.result?.status === 'failure' && isPlainObject(props.part.result.error.details)) {
    return props.part.result.error.details as Record<string, unknown>;
  }
  return null;
});

/** Shell 命令输入；优先使用工具输入，持久化输入缺失时回退结果 metadata。 */
const shellCommandContent = computed<string>(() => {
  if (isPlainObject(props.part.input)) {
    const inputCommand = (props.part.input as Record<string, unknown>).command;
    if (typeof inputCommand === 'string' && inputCommand.length > 0) return inputCommand;
  }

  const resultCommand = shellResultData.value?.command;
  return typeof resultCommand === 'string' ? resultCommand : '';
});

/** Shell 当前屏幕；实时状态不存在时回退最终 terminalOutput。 */
const shellTerminalContent = computed<string>(() => {
  if (props.part.shellRunState?.terminalContent) return props.part.shellRunState.terminalContent;
  const terminalOutput = shellResultData.value?.terminalOutput;
  if (typeof terminalOutput === 'string') return terminalOutput;
  const stdout = shellResultData.value?.stdout;
  const stderr = shellResultData.value?.stderr;
  return [stdout, stderr].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');
});

/** Shell 仅在失败或取消时展示需要用户关注的弱提示。 */
const shellAttentionText = computed<string>(() => {
  const shellSummary = summary.value;
  if (!shellSummary?.text || (shellSummary.variant !== 'failure' && shellSummary.variant !== 'cancelled')) return '';
  return shellSummary.text;
});

/** Shell 存在命令或输出时使用专用终端展示。 */
const shellDisplay = computed<boolean>(() => shellCommandContent.value.length > 0 || shellTerminalContent.value.length > 0);

/**
 * 解析提问工具的问答结果，将 value 映射为可读的 label。
 * 兼容多问题（questionAnswers）和单问题（answers）两种返回格式。
 * 取消/等待状态下无用户答案，从 input 中提取问题并显示"未回答"。
 */
const qaItems = computed<QaItem[]>(() => {
  if (!isQuestionResult.value) return [];
  const input = props.part.input as QuestionToolInput;
  const questions = resolveQaQuestions(input);

  // 取消或等待用户输入状态：无用户答案，展示问题列表并标记为未回答
  if (props.part.result?.status === 'cancelled' || props.part.result?.status === 'awaiting_user_input') {
    return questions.map((q) => ({ question: q.question, selectedLabels: ['未回答'] }));
  }

  const answer = props.part.result!.data as AIUserChoiceAnswerData;
  const answers = answer.questionAnswers ?? [];
  // 多问题模式：逐条映射 questionAnswers；输入框模式直接展示文本答案
  if (answers.length > 0) {
    return answers.map((qa: AIUserChoiceQuestionAnswer) => ({
      question: qa.question,
      selectedLabels: [...resolveQaLabels(questions, qa.question, qa.answers), ...(qa.text ? [qa.text] : [])]
    }));
  }
  // 单问题模式：使用第一个问题 + 顶层 answers
  const firstQuestion = questions[0];
  if (!firstQuestion) return [];
  return [{ question: firstQuestion.question, selectedLabels: resolveQaLabels(questions, firstQuestion.question, answer.answers) }];
});

/** 提问工具中用户填写的补充信息文本，取消/等待状态下不展示 */
const questionOtherText = computed(() => {
  if (!isQuestionResult.value || props.part.result?.status === 'cancelled' || props.part.result?.status === 'awaiting_user_input') return undefined;
  return (props.part.result!.data as AIUserChoiceAnswerData).otherText;
});
</script>

<style scoped lang="less">
.bubble-part-tool__icon {
  flex-shrink: 0;

  &--spin {
    animation: bubble-part-tool-spin 1.2s linear infinite;
  }
}

@keyframes bubble-part-tool-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.bubble-part-tool__name {
  flex: 1;
  width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bubble-part-tool__status--failure {
  margin-left: 8px;
  color: var(--color-error);
}

.bubble-part-tool__activity {
  padding: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--color-fill-tertiary, rgb(0 0 0 / 3%));
  border-radius: 4px;
}

.bubble-part-tool__activity--running_idle,
.bubble-part-tool__activity--waiting_user,
.bubble-part-tool__activity--waiting_external {
  background: var(--color-warning-bg, rgb(250 173 20 / 8%));
}

.bubble-part-tool__activity--stopping,
.bubble-part-tool__activity--interrupted {
  background: var(--color-error-bg, rgb(255 0 0 / 8%));
}

.bubble-part-tool__activity-header {
  display: flex;
  gap: 8px;
  align-items: center;
}

.bubble-part-tool__activity-state {
  font-weight: 500;
  color: var(--text-primary);
}

.bubble-part-tool__activity-count,
.bubble-part-tool__activity-time {
  color: var(--text-tertiary);
}

.bubble-part-tool__activity-phase {
  margin-top: 4px;
  font-family: Monaco, 'SF Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--text-tertiary);
}

.bubble-part-tool__activity-message {
  margin-top: 2px;
  white-space: pre-wrap;
}

.bubble-part-tool__activity-time {
  margin-top: 2px;
  font-size: 11px;
}

.bubble-part-tool__activity-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.bubble-part-tool__result {
  font-size: 12px;
  line-height: 1.6;
}

.bubble-part-tool__result-item + .bubble-part-tool__result-item {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px dashed var(--border-primary);
}

.bubble-part-tool__result-label {
  font-weight: 500;
  color: var(--text-primary);
}

.bubble-part-tool__result-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.bubble-part-tool__result-tag {
  padding: 1px 6px;
  color: var(--color-primary);
  background: var(--color-primary-bg, rgb(22 119 255 / 8%));
  border-radius: 4px;
}

.bubble-part-tool__summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.6;

  &--failure {
    .bubble-part-tool__summary-text {
      color: var(--color-error);
    }

    .bubble-part-tool__summary-tag {
      background: var(--color-error-bg, rgb(255 0 0 / 8%));
    }

    .bubble-part-tool__summary-tag-value {
      color: var(--color-error);
    }
  }

  &--cancelled {
    .bubble-part-tool__summary-text {
      color: var(--text-tertiary);
    }
  }
}

.bubble-part-tool__summary-text {
  color: var(--text-primary);
  white-space: pre-wrap;

  &--shell {
    padding: 4px 8px;
    font-family: Monaco, 'SF Mono', Consolas, monospace;
    font-size: 11px;
    background: var(--color-fill-tertiary, rgb(0 0 0 / 6%));
    border-radius: 4px;
  }
}

.bubble-part-tool__summary-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.bubble-part-tool__shell-terminal {
  max-height: 280px;
  padding: 6px 8px;
  overflow: auto;
  font-family: Monaco, 'SF Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  background: var(--color-fill-tertiary, rgb(0 0 0 / 3%));
  border-radius: 4px;
}

.bubble-part-tool__shell-output {
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.bubble-part-tool__shell-command + .bubble-part-tool__shell-output {
  margin-top: 4px;
}

.bubble-part-tool__shell-finished {
  padding: 0 2px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.bubble-part-tool__shell-finished--failure {
  color: var(--color-error);
}

.bubble-part-tool__summary-tag {
  max-width: 100%;
  padding: 1px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  background: var(--color-primary-bg);
  border: 0;
  border-radius: 4px;
}

.bubble-part-tool__summary-tag--clickable {
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--color-primary-bg-hover, rgb(22 119 255 / 14%));
  }

  &:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: 1px;
  }
}

.bubble-part-tool__summary-tag-label {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.bubble-part-tool__summary-tag-value {
  color: var(--color-primary);
}

.bubble-part-tool__summary-raw-toggle {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;

  &:hover {
    color: var(--text-secondary);
  }
}
</style>
