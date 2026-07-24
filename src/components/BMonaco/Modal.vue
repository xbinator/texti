<!--
  @file Modal.vue
  @description BMonaco 通用弹窗编辑器，提供文本编辑、默认值初始化与确认/取消动作。
-->
<template>
  <BModal v-model:open="open" :title="props.title" :width="props.width" @close="handleModalClose">
    <div class="b-monaco-modal">
      <div class="b-monaco-modal__host">
        <BMonaco
          ref="monacoRef"
          :editable="props.editable"
          :editor-state="props.editorState"
          :extra-libs="props.extraLibs"
          :language="props.language"
          :options="props.options"
          :value="editorText"
          @update:value="handleEditorInput"
        />
      </div>
      <p v-if="editorError" class="b-monaco-modal__error">
        {{ editorError }}
      </p>
      <slot name="after"></slot>
    </div>

    <template #footer>
      <slot name="footer" :cancel="handleEditorCancel" :confirm="handleEditorConfirm">
        <BButton type="secondary" @click="handleEditorCancel">取消</BButton>
        <BButton type="primary" @click="handleEditorConfirm">保存</BButton>
      </slot>
    </template>
  </BModal>
</template>

<script setup lang="ts">
import type { MonacoCompilerOptions, MonacoExtraLib } from './utils/createMonaco';
import { computed, nextTick, ref, watch } from 'vue';
import type { EditorState } from '@/components/BEditor/types';
import BMonaco from './index.vue';

/**
 * BMonaco 通用弹窗编辑器运行时选项。
 */
interface BMonacoModalOptions {
  /** 是否自动换行 */
  wordWrap?: boolean;
  /** 是否启用 Monaco 内置搜索 */
  search?: boolean;
  /** 是否启用 Monaco 粘性标题 */
  stickyScroll?: boolean;
  /** TypeScript/JavaScript 语言服务编译配置 */
  typescriptCompilerOptions?: MonacoCompilerOptions;
}

/**
 * BMonaco 通用弹窗编辑器模型值校验函数。
 */
type BMonacoModalValidator = (value: unknown) => string | undefined;

/**
 * BMonaco 通用弹窗编辑器入参。
 */
interface Props {
  /** 弹窗标题 */
  title?: string;
  /** 弹窗宽度 */
  width?: string | number;
  /** Monaco 语言标识 */
  language?: string;
  /** 是否允许编辑 */
  editable?: boolean;
  /** 当前编辑器状态 */
  editorState: EditorState;
  /** 编辑器运行时选项 */
  options?: BMonacoModalOptions;
  /** 额外类型声明 */
  extraLibs?: MonacoExtraLib[];
  /** value 为 undefined 时打开弹窗使用的默认值 */
  defaultValue?: unknown;
  /** 保存前的模型值校验函数，返回错误文案时阻止保存 */
  validate?: BMonacoModalValidator;
}

const props = withDefaults(defineProps<Props>(), {
  title: '编辑',
  width: 640,
  language: 'plaintext',
  editable: true,
  options: () => ({ wordWrap: false, search: true }),
  extraLibs: () => [],
  defaultValue: undefined,
  validate: undefined
});
const emit = defineEmits<{
  /** 默认值初始化或保存成功时触发 */
  change: [value: unknown];
  /** 点击保存时触发 */
  confirm: [value: unknown];
  /** 点击取消或弹窗关闭时触发 */
  cancel: [];
}>();

const open = defineModel<boolean>('open', { required: true });
const modelValue = defineModel<unknown>('value', { default: undefined });

/**
 * 将模型值转换为编辑器文本。
 * @param value - 模型值
 * @returns 编辑器文本
 */
function formatEditorValue(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2) ?? '';
}

/** Monaco 编辑器实例。 */
const monacoRef = ref<InstanceType<typeof BMonaco> | null>(null);
/** Monaco 编辑器文本草稿。 */
const editorText = ref(formatEditorValue(modelValue.value));
/** Monaco 编辑器校验错误。 */
const editorError = ref('');

/** 当前值是否按 JSON 数据模型处理。 */
const useJsonModel = computed<boolean>(() => props.language === 'json' && typeof modelValue.value !== 'string');

/**
 * value 缺失时用默认值初始化编辑文本。
 * @returns 当前应展示的模型值
 */
function applyDefaultValue(): unknown {
  if (props.defaultValue === undefined || modelValue.value !== undefined) {
    return modelValue.value;
  }

  modelValue.value = props.defaultValue;
  emit('change', props.defaultValue);

  return props.defaultValue;
}

/**
 * 重置编辑器文本草稿。
 */
function resetEditorText(): void {
  editorText.value = formatEditorValue(applyDefaultValue());
  editorError.value = '';
}

/**
 * 解析当前编辑器文本为模型值。
 * @returns 解析后的模型值
 */
function parseEditorText(): unknown {
  if (!useJsonModel.value) {
    return editorText.value;
  }

  try {
    return JSON.parse(editorText.value) as unknown;
  } catch (_error: unknown) {
    throw new Error('INVALID_JSON');
  }
}

/**
 * 校验解析后的模型值。
 * @param value - 待校验模型值
 * @returns 错误文案；空字符串表示校验通过
 */
function validateEditorValue(value: unknown): string {
  return props.validate?.(value) ?? '';
}

/**
 * 聚焦 Monaco 编辑器。
 */
function focusMonacoEditor(): void {
  monacoRef.value?.focusEditor();
}

/**
 * 打开弹窗后的初始化动作。
 * @returns 异步完成信号
 */
async function prepareOpenedEditor(): Promise<void> {
  resetEditorText();

  await nextTick();
  focusMonacoEditor();
}

/**
 * 更新编辑器文本草稿。
 * @param value - 最新编辑器文本
 */
function handleEditorInput(value: string): void {
  editorText.value = value;
  editorError.value = '';
}

/**
 * 取消编辑并关闭弹窗。
 */
function handleEditorCancel(): void {
  emit('cancel');
  open.value = false;
}

/**
 * 转发弹窗内置关闭动作。
 */
function handleModalClose(): void {
  emit('cancel');
}

/**
 * 确认当前编辑内容。
 */
function handleEditorConfirm(): void {
  try {
    const nextValue = parseEditorText();
    const validationMessage = validateEditorValue(nextValue);

    if (validationMessage) {
      editorError.value = validationMessage;
      return;
    }

    modelValue.value = nextValue;
    emit('change', nextValue);
    emit('confirm', nextValue);
    open.value = false;
  } catch (_error: unknown) {
    editorError.value = 'JSON 必须是合法格式';
  }
}

watch(
  open,
  (isOpen: boolean): void => {
    if (!isOpen) return;

    prepareOpenedEditor().catch((): void => {
      // 聚焦失败不影响保存流程，这里收敛异步异常。
    });
  },
  { immediate: true }
);

watch(
  () => modelValue.value,
  (value: unknown): void => {
    if (!open.value) return;

    editorText.value = formatEditorValue(value);
  }
);
</script>

<style lang="less" scoped>
.b-monaco-modal {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.b-monaco-modal__host {
  position: relative;
  min-height: 320px;
  padding: 1px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 6px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.b-monaco-modal__host:hover {
  border-color: var(--border-hover);
}

.b-monaco-modal__host:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 2px var(--input-focus-shadow);
}

.b-monaco-modal__host :deep(.b-editor-monaco),
.b-monaco-modal__host :deep(.b-editor-monaco__host) {
  min-height: 320px;
}

.b-monaco-modal__host :deep(.monaco-editor),
.b-monaco-modal__host :deep(.monaco-editor-background) {
  background: var(--input-bg);
}

.b-monaco-modal__host :deep(.monaco-editor .margin),
.b-monaco-modal__host :deep(.monaco-editor .monaco-editor-background) {
  background: var(--input-bg);
}

.b-monaco-modal__host :deep(.monaco-editor .view-lines) {
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace);
}

.b-monaco-modal__error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger, #ef4444);
}
</style>
