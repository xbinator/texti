<template>
  <BModal v-model:open="visible" :width="560" :title="isEditMode ? '编辑 AI 模型' : '创建 AI 模型'">
    <!-- 基础配置 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">基础配置</span>
      </div>
      <AForm layout="vertical">
        <div class="form-grid">
          <AFormItem label="模型 ID" required v-bind="validateInfos.id">
            <AInput v-model:value="dataItem.id" :disabled="isEditMode" placeholder="例如: gpt-4o" />
          </AFormItem>
          <AFormItem label="模型名称" required v-bind="validateInfos.name">
            <AInput v-model:value="dataItem.name" placeholder="请输入模型名称" />
          </AFormItem>
          <AFormItem label="模型类型" v-bind="validateInfos.type">
            <BSelect v-model:value="dataItem.type" :options="modelTypeOptions" placeholder="请选择模型类型" />
          </AFormItem>
          <AFormItem label="最大上下文窗口" v-bind="validateInfos.contextWindow" tooltip="设置模型支持的最大 Token 数">
            <BSelect v-model:value="dataItem.contextWindow" :options="contextWindowOptions" placeholder="请选择最大上下文窗口大小" />
          </AFormItem>
        </div>
      </AForm>
    </div>

    <!-- 能力配置 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">能力配置</span>
      </div>
      <div class="capability-grid">
        <div v-for="cap in capabilities" :key="cap.field" class="capability-item">
          <div class="capability-info">
            <div class="capability-name">{{ cap.label }}</div>
            <div class="capability-desc">{{ cap.desc }}</div>
          </div>
          <ASwitch v-model:checked="(dataItem as any)[cap.field]" size="small" />
        </div>
      </div>
      <p class="capability-tip">以上能力配置仅开启对应功能入口，实际效果取决于模型本身，请自行测试可用性</p>
    </div>

    <template #footer>
      <BButton type="secondary" @click="handleCancel">取消</BButton>
      <BButton :loading="saving" @click="handleSubmit">保存</BButton>
    </template>
  </BModal>
</template>

<script setup lang="ts">
import type { Rule } from 'ant-design-vue/es/form';
import type { AIProviderModel } from 'types/ai';
import { computed, reactive, ref, watch } from 'vue';
import { message, Form } from 'ant-design-vue';
import { asyncTo } from '@/utils/asyncTo';
import { useProviders } from '../hooks/useProviders';

interface Props {
  model?: AIProviderModel | null;
  providerId?: string;
  models?: AIProviderModel[];
}

const props = withDefaults(defineProps<Props>(), {
  model: null,
  providerId: undefined,
  models: () => []
});

const emit = defineEmits<{ success: [model: AIProviderModel] }>();

const visible = defineModel<boolean>('open', { default: false });

const saving = ref<boolean>(false);
const { saveProviderModels } = useProviders();

const modelTypeOptions = [
  { label: '对话模型', value: 'chat' },
  { label: '图片模型', value: 'image' },
  { label: '视频模型', value: 'video' },
  { label: '多模态模型', value: 'multimodal' }
];

const contextWindowSteps = [0, 4000, 8000, 16000, 32000, 64000, 200000, 1000000, 2000000];

function formatContextWindow(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(0)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return `${value}`;
}

const contextWindowOptions = contextWindowSteps.map((step) => ({
  value: step,
  label: formatContextWindow(step)
}));

const capabilities = [
  { field: 'supportsTools', label: '技能使用', desc: '支持调用外部技能' },
  { field: 'supportsVision', label: '视觉识别', desc: '支持图片内容理解' },
  { field: 'supportsDeepThought', label: '深度思考', desc: '支持链式推理能力' },
  { field: 'supportsWebSearch', label: '联网搜索', desc: '内置搜索引擎支持' },
  { field: 'supportsImageGeneration', label: '图片生成', desc: '支持图像内容生成' },
  { field: 'supportsVideoRecognition', label: '视频识别', desc: '支持视频内容理解' }
];

const dataItem = reactive<AIProviderModel>({
  id: '',
  name: '',
  type: 'chat',
  isEnabled: true,
  contextWindow: 0,
  supportsTools: false,
  supportsVision: false,
  supportsDeepThought: false,
  supportsWebSearch: false,
  supportsImageGeneration: false,
  supportsVideoRecognition: false
});

const isEditMode = computed(() => Boolean(props.model));

const rules = reactive<Record<string, Rule[]>>({
  id: [{ required: true, message: '请输入模型 ID' }],
  name: [{ required: true, message: '请输入模型名称' }],
  type: [{ required: true, message: '请选择模型类型' }]
});

const { resetFields, validate, validateInfos } = Form.useForm(dataItem, rules);

const onValidate = () => asyncTo(validate());

function handleCancel(): void {
  visible.value = false;
}

async function createModel(model: AIProviderModel): Promise<{ success: boolean; message?: string }> {
  if (!props.providerId) {
    return { success: false, message: '服务商不存在' };
  }
  const exists = props.models.some((item: AIProviderModel) => item.id === model.id);
  if (exists) {
    return { success: false, message: '模型 ID 已存在，请更换' };
  }
  const nextModels = [...props.models, { ...model }];
  const savedProvider = await saveProviderModels(props.providerId, nextModels);
  if (!savedProvider) {
    return { success: false, message: '创建模型失败' };
  }
  return { success: true, message: '模型已创建' };
}

async function updateModel(model: AIProviderModel): Promise<{ success: boolean; message?: string }> {
  if (!props.providerId) {
    return { success: false, message: '服务商不存在' };
  }
  const nextModels = props.models.map((item: AIProviderModel) => (item.id === model.id ? { ...item, ...model } : item));

  const savedProvider = await saveProviderModels(props.providerId, nextModels);
  if (!savedProvider) {
    return { success: false, message: '更新模型失败' };
  }
  return { success: true, message: '模型已更新' };
}

async function handleSubmit(): Promise<void> {
  const [valid] = await onValidate();
  if (valid) return;

  const id = isEditMode.value ? props.model!.id : dataItem.id.trim();
  saving.value = true;

  const {
    name,
    type,
    isEnabled = true,
    contextWindow,
    supportsTools,
    supportsVision,
    supportsDeepThought,
    supportsWebSearch,
    supportsImageGeneration,
    supportsVideoRecognition
  } = dataItem;

  const model: AIProviderModel = {
    id,
    name,
    type,
    isEnabled,
    contextWindow,
    supportsTools,
    supportsVision,
    supportsDeepThought,
    supportsWebSearch,
    supportsImageGeneration,
    supportsVideoRecognition
  };

  const result = isEditMode.value ? await updateModel(model) : await createModel(model);
  saving.value = false;

  if (!result.success) {
    message.error(result.message || (isEditMode.value ? '更新模型失败' : '创建模型失败'));
    return;
  }

  visible.value = false;
  message.success(result.message || (isEditMode.value ? '模型已更新' : '模型已创建'));
  emit('success', model);
}

watch(
  () => visible.value,
  (open) => {
    if (!open) return;
    if (props.model) {
      Object.assign(dataItem, {
        id: props.model.id,
        name: props.model.name,
        type: props.model.type || 'chat',
        contextWindow: props.model.contextWindow ?? 0,
        supportsTools: props.model.supportsTools ?? false,
        supportsVision: props.model.supportsVision ?? false,
        supportsDeepThought: props.model.supportsDeepThought ?? false,
        supportsWebSearch: props.model.supportsWebSearch ?? false,
        supportsImageGeneration: props.model.supportsImageGeneration ?? false,
        supportsVideoRecognition: props.model.supportsVideoRecognition ?? false
      });
    } else {
      resetFields();
    }
  }
);
</script>

<style scoped lang="less">
.section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}

.section-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;

  :deep(.ant-form-item) {
    margin-bottom: 14px;
  }
}

.capability-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.capability-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: var(--bg-secondary);
  border: 0.5px solid var(--border-secondary);
  border-radius: 4px;
}

.capability-info {
  flex: 1;
  min-width: 0;
  margin-right: 8px;
}

.capability-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.capability-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}

.capability-tip {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}
</style>
