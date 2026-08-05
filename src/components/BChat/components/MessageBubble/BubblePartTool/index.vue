<!--
  @file BubblePartTool.vue
  @description 编排工具执行气泡，按工具类型选择活动状态、Shell、任务、问答、摘要或原始数据展示。
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
    <ToolActivity
      v-if="part.activity"
      :activity="part.activity"
      :activity-label="activityLabel"
      :activity-count="activityCount"
      :activity-message="activityMessage"
      :last-progress-text="lastProgressText"
      :show-idle-controls="showIdleControls"
      :control-pending="controlPending"
      @control="handleToolControl"
    />

    <!-- Shell 命令与当前屏幕共享终端区域，命令在前且不重复显示成功摘要 -->
    <ToolShellDisplay
      v-if="isShellCommand && shellDisplay"
      :command-content="shellCommandContent"
      :terminal-content="shellTerminalContent"
      :attention-text="shellAttentionText"
      :failure="summary?.variant === 'failure'"
    />

    <!-- todowrite 成功结果使用单层任务卡片，避免通用工具气泡和任务面板重复嵌套 -->
    <TodoList v-else-if="todoWriteTodos" :todos="todoWriteTodos" />

    <!-- 提问工具结果：以问答形式展示用户选择 -->
    <ToolQuestionResult v-else-if="isQuestionResult" :qa-items="qaItems" :other-text="questionOtherText" />

    <!-- 有摘要的工具结果：展示人可读的摘要信息 -->
    <ToolSummary v-else-if="summary" :summary="summary" :preview-value="previewValue" :is-shell-command="isShellCommand" />

    <!-- 无摘要的工具：展示代码格式的输入/输出内容 -->
    <BubblePartToolCode v-else-if="hasContent" :value="previewValue" />
  </BubblePart>
</template>

<script setup lang="ts">
import type { ToolResultSummary } from '../../../utils/toolResultSummary';
import type { ChatToolActivityState } from 'types/ai';
import type { AIUserChoiceAnswerData, AIUserChoiceQuestionAnswer, ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeControlToolInput } from 'types/chat-runtime';
import { computed, ref } from 'vue';
import { isPlainObject, isString } from 'lodash-es';
import type { QuestionItemInput, QuestionToolInput } from '@/ai/tools/builtin/QuestionTool';
import type { SubmitAction } from '@/components/BChat/utils/submitAction';
import { createToolControl } from '@/components/BChat/utils/submitAction';
import { useActiveChatContext } from '@/hooks/useChat/useChatContextRegistry';
import type { ToolContextPresentation } from '@/hooks/useChat/useChatContextRegistry';
import type { TodoItem } from '@/stores/chat/todo';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import { hasStructuredValueContent } from '../../../utils/messagePart';
import { getActionLabel } from '../../../utils/toolLabels';
import { getToolResultSummary } from '../../../utils/toolResultSummary';
import TodoList from '../../TodoList.vue';
import BubblePart from '../BubblePart/index.vue';
import BubblePartToolCode from '../BubblePartToolCode/index.vue';
import ToolActivity from './ToolActivity.vue';
import ToolQuestionResult from './ToolQuestionResult.vue';
import ToolShellDisplay from './ToolShellDisplay.vue';
import ToolSummary from './ToolSummary.vue';

defineOptions({ name: 'BubblePartTool' });

/** 工具调用部分的 props。 */
interface Props {
  /** 工具调用的消息片段数据。 */
  part: ChatMessageToolPart;
  /** 持有该工具调用的 Runtime ID。 */
  runtimeId?: string;
  /** 消息级统一提交函数。 */
  submitAction?: (action: SubmitAction) => Promise<void> | void;
}

/** 问答展示项：包含问题文本和用户选择的标签列表。 */
interface QaItem {
  /** 问题文本。 */
  question: string;
  /** 用户选择的选项标签列表。 */
  selectedLabels: string[];
}

const props = withDefaults(defineProps<Props>(), {
  runtimeId: undefined,
  submitAction: undefined
});

const [, bem] = createNamespace('', 'bubble-part-tool');
/** 当前页面注册的通用工具展示能力。 */
const activeChatTools = useActiveChatContext();
/** 当前卡片正在提交的单工具控制动作。 */
const controlPending = ref<ChatRuntimeControlToolInput['action'] | null>(null);

/** 工具状态与图标的映射。 */
const ICON_MAP = {
  inputting: 'lucide:loader-circle',
  executing: 'lucide:hammer',
  done: { success: 'lucide:check-circle-2', failure: 'lucide:circle-alert', cancelled: 'lucide:circle-x', awaiting_user_input: 'lucide:circle-help' }
} as const;

/** 提问类工具名称集合，用于判断是否展示问答结果视图。 */
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

/**
 * 解析提问工具的输入，统一为 QuestionItemInput 数组。
 * @param input - 提问工具的输入参数
 * @returns 标准化后的问题列表
 */
function resolveQaQuestions(input: QuestionToolInput): QuestionItemInput[] {
  if (input.questions?.length) return input.questions;
  if (input.question) return [{ question: input.question, mode: input.mode ?? 'single', options: input.options ?? [] }];
  return [];
}

/**
 * 将用户选择的 value 值解析为可读的 label 标签。
 * @param questions - 问题列表
 * @param questionText - 当前问题文本
 * @param values - 用户选择的 value 值数组
 * @returns 对应的 label 标签数组，找不到匹配时回退为原始 value
 */
function resolveQaLabels(questions: QuestionItemInput[], questionText: string, values: string[]): string[] {
  const matched = questions.find((question) => question.question === questionText);
  const options = matched?.options ?? [];
  if (options.length === 0) return values;
  return values.map((value) => options.find((option) => option.value === value)?.label ?? value);
}

/**
 * 判断未知值是否为可索引的普通对象。
 * @param value - 待校验值
 * @returns 值是普通对象时返回 true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

/**
 * 判断未知值是否为可展示的任务项。
 * @param value - 待校验值
 * @returns 值满足任务项结构时返回 true
 */
function isTodoItem(value: unknown): value is TodoItem {
  if (!isRecord(value)) return false;

  return (
    isString(value.content) &&
    isString(value.status) &&
    TODO_STATUSES.has(value.status as TodoItem['status']) &&
    isString(value.priority) &&
    TODO_PRIORITIES.has(value.priority as TodoItem['priority'])
  );
}

/**
 * 获取 inputting 状态下的预览值。
 * @param part - 工具消息片段
 * @returns 预览内容
 */
function getInputtingValue(part: ChatMessageToolPart): unknown {
  if (!part.input) return part.inputText ?? '';
  if (part.toolName === 'write_file' && isRecord(part.input) && part.input.content !== undefined) return part.input.content;
  return part.input ?? part.inputText;
}

/**
 * 判断工具结果状态是否有专用图标。
 * @param status - 工具结果状态
 * @returns 状态可映射到图标时返回 true
 */
function hasDoneIcon(status: string | undefined): status is keyof typeof ICON_MAP.done {
  return Boolean(status && status in ICON_MAP.done);
}

/**
 * 仅读取所有已注册页面都能一致解释的工具展示能力。
 * @param toolName - 页面工具名称
 * @returns 无歧义的展示能力
 */
function resolvePresentation(toolName: string): ToolContextPresentation | undefined {
  try {
    // 显式订阅 Registry 修订号，使页面注册和注销可立即更新历史消息展示。
    if (activeChatTools.revision.value < 0) return undefined;
    return activeChatTools.getPresentationByTool(toolName);
  } catch {
    return undefined;
  }
}

/** 根据工具执行状态计算显示的图标。 */
const icon = computed<string>(() => {
  const { status } = props.part;
  if (status === 'done') {
    const resultStatus = props.part.result?.status;
    return hasDoneIcon(resultStatus) ? ICON_MAP.done[resultStatus] : ICON_MAP.done.failure;
  }
  return ICON_MAP[status];
});

/** 非 inputting 状态默认折叠，inputting 时展开让用户看到实时输入。 */
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

/** 工具标题：文件操作显示文件路径，skill 显示技能名称，其余显示工具别名。 */
const title = computed<string>(() => {
  const { part } = props;
  const presentation = resolvePresentation(part.toolName);
  const alias = presentation?.label ?? getActionLabel(part.toolName).alias;

  if ((part.toolName === 'write_file' || part.toolName === 'edit_file') && isRecord(part.input)) {
    const { path } = part.input;
    if (typeof path === 'string') return path;
  }

  if (part.toolName === 'skill' && isRecord(part.input)) {
    const skillName = part.input.name;
    if (typeof skillName === 'string') return `${alias}：${skillName}`;
  }

  return alias;
});

/** 根据工具状态计算预览内容：inputting 取输入值、executing 取输入、done 取结果。 */
const previewValue = computed<unknown>(() => {
  const { part } = props;
  if (part.status === 'inputting') return getInputtingValue(part);
  if (part.status === 'executing') return part.input;
  return part.result;
});

/** 判断是否有可展示的内容，done 状态始终有内容，其余状态需检查结构化值。 */
const hasContent = computed<boolean>(() => {
  if (props.part.status === 'done') return true;
  if (props.part.activity) return true;
  return hasStructuredValueContent(previewValue.value);
});

/** 判断是否为提问工具且有结果，用于切换问答结果视图。 */
const isQuestionResult = computed<boolean>(
  () =>
    props.part.status === 'done' &&
    (props.part.result?.status === 'success' || props.part.result?.status === 'cancelled' || props.part.result?.status === 'awaiting_user_input') &&
    QUESTION_TOOL_NAMES.has(props.part.toolName)
);

/** 获取 todowrite 成功调用写入的完整任务快照。 */
const todoWriteTodos = computed<TodoItem[] | null>(() => {
  const { part } = props;

  if (part.toolName !== 'todowrite' || part.status !== 'done' || part.result?.status !== 'success' || !isRecord(part.input)) return null;

  if (!Array.isArray(part.input.todos) || !part.input.todos.every(isTodoItem)) return null;

  return part.input.todos;
});

/** todowrite 任务中已完成的数量，仅在存在任务快照时返回有效值。 */
const todoWriteCompletedCount = computed<number | null>(() => {
  const todos = todoWriteTodos.value;
  if (!todos) return null;
  return todos.filter((todo) => todo.status === 'completed').length;
});

/** 工具执行完成时的人可读摘要，支持成功/失败/取消状态。 */
const summary = computed<ToolResultSummary | null>(() => {
  if (props.part.status !== 'done' || !props.part.result) return null;
  const presentation = resolvePresentation(props.part.toolName);
  if (props.part.result.status === 'success' && presentation?.summarize) {
    try {
      return { text: presentation.summarize(props.part.result) };
    } catch {
      return getToolResultSummary(props.part.toolName, props.part.result);
    }
  }
  return getToolResultSummary(props.part.toolName, props.part.result);
});

/** 是否为终端命令执行，用于特殊样式。 */
const isShellCommand = computed<boolean>(() => props.part.toolName === 'run_shell_command');

/** Shell 成功结果中的结构化运行数据。 */
const shellResultData = computed<Record<string, unknown> | null>(() => {
  if (props.part.result?.status === 'success' && isRecord(props.part.result.data)) {
    return props.part.result.data;
  }
  if (props.part.result?.status === 'failure' && isRecord(props.part.result.error.details)) {
    return props.part.result.error.details;
  }
  return null;
});

/** Shell 命令输入；优先使用工具输入，持久化输入缺失时回退结果 metadata。 */
const shellCommandContent = computed<string>(() => {
  if (isRecord(props.part.input)) {
    const inputCommand = props.part.input.command;
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

/** 解析提问工具的问答结果，将 value 映射为可读的 label。 */
const qaItems = computed<QaItem[]>(() => {
  if (!isQuestionResult.value) return [];
  const input = props.part.input as QuestionToolInput;
  const questions = resolveQaQuestions(input);

  if (props.part.result?.status === 'cancelled' || props.part.result?.status === 'awaiting_user_input') {
    return questions.map((question) => ({ question: question.question, selectedLabels: ['未回答'] }));
  }

  const answer = props.part.result!.data as AIUserChoiceAnswerData;
  const answers = answer.questionAnswers ?? [];

  if (answers.length > 0) {
    return answers.map((qa: AIUserChoiceQuestionAnswer) => ({
      question: qa.question,
      selectedLabels: [...resolveQaLabels(questions, qa.question, qa.answers), ...(qa.text ? [qa.text] : [])]
    }));
  }

  const firstQuestion = questions[0];
  if (!firstQuestion) return [];
  return [{ question: firstQuestion.question, selectedLabels: resolveQaLabels(questions, firstQuestion.question, answer.answers) }];
});

/** 提问工具中用户填写的补充信息文本，取消/等待状态下不展示。 */
const questionOtherText = computed<string | undefined>(() => {
  if (!isQuestionResult.value || props.part.result?.status === 'cancelled' || props.part.result?.status === 'awaiting_user_input') return undefined;
  return (props.part.result!.data as AIUserChoiceAnswerData).otherText;
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
  await asyncTo(Promise.resolve(props.submitAction(createToolControl({ runtimeId: props.runtimeId, toolCallId: props.part.toolCallId, action }))));
  controlPending.value = null;
}
</script>

<style scoped lang="less">
.bubble-part-tool__icon {
  flex-shrink: 0;
}

.bubble-part-tool__icon--spin {
  animation: bubble-part-tool-spin 1.2s linear infinite;
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
</style>
