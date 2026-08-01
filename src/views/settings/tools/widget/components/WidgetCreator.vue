<!--
  @file WidgetCreator.vue
  @description 小组件创建弹窗，闭环处理导入校验、目录安装、列表同步与编辑器打开。
-->
<template>
  <BModal v-model:open="visible" title="创建小组件" :width="480" @close="handleCancel">
    <AForm layout="vertical">
      <div class="widget-creator">
        <BUpload
          v-model:drag-over="isImportDragOver"
          accept=".zip,.json"
          draggable
          class="widget-creator__dropzone"
          :class="{ 'widget-creator__dropzone--active': isImportDragOver }"
          @change="handleImportFileSelected"
        >
          <div class="widget-creator__dropzone-icon">
            <BIcon icon="lucide:package-plus" :size="26" />
          </div>
          <div class="widget-creator__dropzone-title">拖拽文件到此处或点击添加</div>
          <div class="widget-creator__dropzone-badges">
            <span class="widget-creator__badge">.zip</span>
            <span class="widget-creator__badge">.json</span>
          </div>
        </BUpload>

        <AFormItem class="widget-creator__id" label="标识" required v-bind="validateInfos.id">
          <AInput v-model:value="dataItem.id" placeholder="例如 weather" @blur="handleIdBlur" />
        </AFormItem>

        <AFormItem class="widget-creator__name" label="名称" required v-bind="validateInfos.name">
          <AInput v-model:value="dataItem.name" placeholder="例如 天气" />
        </AFormItem>

        <AFormItem class="widget-creator__description" label="描述" v-bind="validateInfos.description">
          <ATextarea
            v-model:value="dataItem.description"
            :auto-size="{ minRows: 3, maxRows: 5 }"
            placeholder="描述这个小组件能做什么、适合什么场景，帮助 AI 判断何时展示"
          />
        </AFormItem>
      </div>
    </AForm>

    <template #footer>
      <BButton type="secondary" @click="handleCancel">取消</BButton>
      <BButton type="primary" :loading="creatingWidget" @click="handleConfirm">确定</BButton>
    </template>
  </BModal>
</template>

<script setup lang="ts">
import type { Rule } from 'ant-design-vue/es/form';
import { reactive, ref, shallowRef, watch } from 'vue';
import { Form, message } from 'ant-design-vue';
import { cloneDeep } from 'lodash-es';
import { importWidgetJsonFile, importWidgetZipFile, WidgetImportResult, WidgetImportResource } from '@/ai/widget/importer';
import type { WidgetDefinition } from '@/ai/widget/types';
import type { WidgetData } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetExecuteMethod, isDefaultWidgetExecuteMethod } from '@/components/BWidget/utils/widgetExecuteMethod';
import { useNavigate } from '@/hooks/useNavigate';
import { logger } from '@/shared/logger';
import { createDirectoryInstallLogger } from '@/shared/logger/directoryInstall';
import { native } from '@/shared/platform';
import { useWidgetStore } from '@/stores/ai/widget';
import { asyncTo } from '@/utils/asyncTo';
import { formatDirectoryInstallError, installDirectory, type DirectoryInstallFile } from '@/utils/file/directory';
import { path, PORTABLE_RESOURCE_ID_PATTERN } from '@/utils/file/path';
import { posix } from '@/utils/file/posix';

/**
 * 创建小组件表单数据。
 */
interface WidgetCreateFormData {
  /** 小组件标识。 */
  id: string;
  /** 小组件名称。 */
  name: string;
  /** 小组件描述。 */
  description: string;
}

/** 支持的小组件导入文件扩展名。 */
const WIDGET_IMPORT_FILE_EXTENSIONS = ['.zip', '.json'] as const;

/** 弹窗可见性。 */
const visible = defineModel<boolean>('open', { default: false });
const store = useWidgetStore();
const { openWidgetFile } = useNavigate();

/** 表单数据。 */
const dataItem = reactive<WidgetCreateFormData>({
  id: '',
  name: '',
  description: ''
});
/** 当前是否有导入文件拖拽悬停。 */
const isImportDragOver = ref(false);
/** 已导入的小组件数据。 */
const importedWidgetData = shallowRef<WidgetData | null>(null);
/** 已导入的小组件资源。 */
const importedWidgetResources = shallowRef<WidgetImportResource[]>([]);
/** 导入文件名推导出的小组件标识。 */
const importedWidgetSuggestedId = ref('');
/** 是否正在创建小组件，防止重复提交并发写入。 */
const creatingWidget = ref(false);

/**
 * 判断小组件标识是否已经存在。
 * @param id - 待检查的小组件标识
 * @returns 是否已存在
 */
function isExistingWidgetId(id: string): boolean {
  const normalizedId = id.trim().toLowerCase();

  return store.widgets.some((widget: WidgetDefinition): boolean => widget.id.toLowerCase() === normalizedId);
}

/**
 * 校验小组件标识不能与已安装小组件重复。
 * @param _rule - Ant Design Vue 表单规则对象
 * @param value - 待校验的小组件标识
 * @returns 校验完成信号
 */
function validateWidgetIdUnique(_rule: Rule, value: string): Promise<void> {
  if (value && isExistingWidgetId(value)) {
    return Promise.reject(new Error('小组件标识已存在，请更换'));
  }

  return Promise.resolve();
}

/**
 * 校验小组件标识可安全作为跨平台目录名。
 * @param _rule - Ant Design Vue 表单规则对象
 * @param value - 待校验的小组件标识
 * @returns 校验完成信号
 */
function validateWidgetIdSafe(_rule: Rule, value: string): Promise<void> {
  if (value && path.isWindowsReservedFileName(value)) {
    return Promise.reject(new Error('小组件标识不能使用 Windows 保留名称'));
  }

  return Promise.resolve();
}

/** 表单校验规则。 */
const rules = reactive<Record<string, Rule[]>>({
  id: [
    { required: true, message: '请输入小组件标识' },
    {
      pattern: PORTABLE_RESOURCE_ID_PATTERN,
      message: '标识只能包含英文、数字、下划线和短横线'
    },
    {
      validator: validateWidgetIdSafe
    },
    {
      validator: validateWidgetIdUnique
    }
  ],
  name: [{ required: true, message: '请输入小组件名称' }],
  description: []
});

const { resetFields, validate, validateInfos } = Form.useForm(dataItem, rules);

/**
 * 执行表单校验。
 * @returns 校验错误；校验通过时返回 undefined
 */
async function validateForm(): Promise<Error | undefined> {
  const [error] = await asyncTo(validate());
  return error;
}

/**
 * 规范化小组件标识。
 */
function handleIdBlur(): void {
  dataItem.id = dataItem.id.trim().toLowerCase();
}

/**
 * 清空文件导入态。
 */
function resetImportedWidgetFile(): void {
  importedWidgetData.value = null;
  importedWidgetResources.value = [];
  importedWidgetSuggestedId.value = '';
}

/**
 * 判断导入文件是否为指定扩展名。
 * @param file - 导入文件
 * @param extension - 文件扩展名
 * @returns 是否匹配扩展名
 */
function isWidgetImportFileExtension(file: File, extension: (typeof WIDGET_IMPORT_FILE_EXTENSIONS)[number]): boolean {
  return file.name.trim().toLowerCase().endsWith(extension);
}

/**
 * 判断导入建议标识是否应该自动写入表单。
 * @param suggestedId - 文件名推导出的标识
 * @returns 是否自动写入标识字段
 */
function shouldApplyImportedSuggestedId(suggestedId: string): boolean {
  return suggestedId !== 'widget';
}

/**
 * 读取小组件导入文件。
 * @param file - 导入文件
 * @returns 导入结果
 */
async function importWidgetFile(file: File): Promise<WidgetImportResult> {
  if (isWidgetImportFileExtension(file, '.zip')) {
    return importWidgetZipFile(file);
  }

  if (isWidgetImportFileExtension(file, '.json')) {
    return importWidgetJsonFile(file);
  }

  throw new Error('仅支持 .zip 或 .json 小组件文件');
}

/**
 * 应用导入结果到创建表单。
 * @param file - 导入文件
 * @returns 导入完成信号
 */
async function importWidgetFromFile(file: File): Promise<void> {
  const result = await importWidgetFile(file);

  importedWidgetData.value = result.data;
  importedWidgetResources.value = result.resources;
  importedWidgetSuggestedId.value = result.suggestedId;
  if (shouldApplyImportedSuggestedId(result.suggestedId)) {
    dataItem.id = result.suggestedId;
  }
  dataItem.name = result.data.name || result.suggestedId;
  dataItem.description = result.data.description;
}

/**
 * 处理小组件文件选择或拖拽添加。
 * @param files - 文件列表
 * @returns 处理完成信号
 */
async function handleImportFileSelected(files: FileList): Promise<void> {
  const file = files[0];

  if (!file) {
    return;
  }

  resetImportedWidgetFile();

  const [error] = await asyncTo(importWidgetFromFile(file));

  if (error) {
    message.error(error instanceof Error ? error.message : '导入小组件失败');
  }
}

/**
 * 创建确认提交时使用的导入小组件数据。
 * @returns 导入数据副本；未导入时返回 undefined
 */
function createImportedWidgetDataForConfirm(): WidgetData | undefined {
  if (!importedWidgetData.value) {
    return undefined;
  }

  const data = cloneDeep(importedWidgetData.value);

  if (isDefaultWidgetExecuteMethod(data.execute, importedWidgetSuggestedId.value)) {
    data.execute = createDefaultWidgetExecuteMethod(dataItem.id);
  }

  return data;
}

/**
 * 将 Widget 配置与导入资源转换为通用目录安装文件。
 * @param widgetData - Widget 配置数据
 * @param resources - 导入资源
 * @returns widget.json 与资源文件列表
 */
function createWidgetInstallFiles(widgetData: WidgetData, resources: WidgetImportResource[]): DirectoryInstallFile[] {
  return [
    { kind: 'text', relativePath: 'widget.json', content: JSON.stringify(widgetData, null, 2) },
    ...resources.map(
      (resource: WidgetImportResource): DirectoryInstallFile => ({ kind: 'binary', relativePath: resource.relativePath, content: resource.content })
    )
  ];
}

/**
 * 取消创建小组件。
 */
function handleCancel(): void {
  if (creatingWidget.value) {
    return;
  }

  visible.value = false;
}

/**
 * 确认创建小组件。
 * @returns 创建确认完成信号
 */
async function handleConfirm(): Promise<void> {
  if (creatingWidget.value) {
    return;
  }

  creatingWidget.value = true;
  dataItem.id = dataItem.id.trim().toLowerCase();
  dataItem.name = dataItem.name.trim();
  dataItem.description = dataItem.description.trim();

  const error = await validateForm();

  if (error) {
    creatingWidget.value = false;
    return;
  }

  const widgetId = dataItem.id;
  const widgetName = dataItem.name;
  const installLogger = createDirectoryInstallLogger('widget', widgetId);

  try {
    await installLogger.start();
    const homeDir = await native.getHomeDir();
    const widgetDir = posix.join(homeDir, '.tibis', 'widgets', widgetId);
    const importedData = createImportedWidgetDataForConfirm();
    const widgetData: WidgetData = {
      ...(importedData ?? createDefaultWidgetData(widgetId)),
      name: widgetName,
      description: dataItem.description
    };
    const createdWidget: WidgetDefinition = {
      id: widgetId,
      name: widgetData.name,
      description: widgetData.description,
      data: widgetData,
      filePath: posix.join(widgetDir, 'widget.json'),
      dirPath: widgetDir,
      enabled: true,
      parsedAt: Date.now()
    };

    await installDirectory({
      api: native,
      targetDir: widgetDir,
      conflictStrategy: 'reject',
      files: createWidgetInstallFiles(widgetData, importedWidgetResources.value),
      onEvent: installLogger.onEvent
    });
    await installLogger.success();

    const [rescanError] = await asyncTo(store.rescan());
    if (rescanError) {
      await logger.warn(`[widget-install] rescan-failed resource=${widgetId} error=${formatDirectoryInstallError(rescanError)}`);
      message.warning(`小组件 "${widgetName}" 创建成功，但刷新列表失败，请稍后重试`);
    }
    store.upsertWidget(createdWidget);
    visible.value = false;

    const [openEditorError] = await asyncTo(openWidgetFile(createdWidget.id));
    if (openEditorError) {
      await logger.warn(`[widget-install] open-editor-failed resource=${widgetId} error=${formatDirectoryInstallError(openEditorError)}`);
      message.warning(`小组件 "${widgetName}" 创建成功，但打开编辑器失败`);
    } else if (!rescanError) {
      message.success(`小组件 "${widgetName}" 创建成功`);
    }
  } catch (installError: unknown) {
    await installLogger.failure(installError);
    message.error(`创建失败：${formatDirectoryInstallError(installError)}`);
  } finally {
    creatingWidget.value = false;
  }
}

watch(
  () => visible.value,
  (open: boolean): void => {
    if (open) {
      resetFields();
      resetImportedWidgetFile();
      isImportDragOver.value = false;
    }
  }
);
</script>

<style scoped lang="less">
.widget-creator {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.widget-creator__dropzone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 112px;
  margin-bottom: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-secondary);
  border: var(--surface-border-width) dashed var(--border-secondary);
  border-radius: var(--surface-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard);
}

.widget-creator__dropzone:hover,
.widget-creator__dropzone--active {
  color: var(--color-primary);
  background: var(--bg-hover);
  border-color: var(--color-primary);
}

.widget-creator__dropzone-icon {
  color: currentColor;
}

.widget-creator__dropzone-title {
  font-size: 13px;
  color: var(--text-secondary);
}

.widget-creator__dropzone:hover .widget-creator__dropzone-title,
.widget-creator__dropzone--active .widget-creator__dropzone-title {
  color: var(--color-primary);
}

.widget-creator__dropzone-badges {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.widget-creator__badge {
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-primary);
  background: var(--color-primary-bg, rgb(var(--color-primary-rgb) / 8%));
  border-radius: var(--control-radius);
}
</style>
