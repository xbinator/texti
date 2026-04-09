<template>
  <BModal v-model:open="visible" :width="560" :title="isEditMode ? '编辑 AI 模型' : '创建 AI 模型'">
    <BScrollbar max-height="60vh" inset>
      <AForm layout="vertical">
        <div class="dataItem-section">
          <AFormItem label="模型 ID" required v-bind="validateInfos.id">
            <AInput v-model:value="dataItem.id" :disabled="isEditMode" placeholder="例如: gpt-4o" />
          </AFormItem>

          <AFormItem label="模型名称" required v-bind="validateInfos.name">
            <AInput v-model:value="dataItem.name" placeholder="请输入模型名称" />
          </AFormItem>

          <AFormItem label="模型类型" v-bind="validateInfos.type">
            <BSelect v-model:value="dataItem.type" :options="modelTypeOptions" placeholder="请选择模型类型" />
          </AFormItem>
        </div>
      </AForm>
    </BScrollbar>

    <template #footer>
      <BButton type="secondary" @click="handleCancel">取消</BButton>
      <BButton :loading="saving" @click="handleSubmit">保存</BButton>
    </template>
  </BModal>
</template>

<script setup lang="ts">
import type { ModelSubmitResult } from '../types';
import type { Rule } from 'ant-design-vue/es/form';
import { computed, reactive, ref, watch } from 'vue';
import { message, Form } from 'ant-design-vue';
import type { ProviderModel } from '@/shared/storage/providers/types';
import { asyncTo } from '@/utils/asyncTo';
import { useProviders } from '../hooks/useProviders';

interface Props {
  model?: ProviderModel | null;
  providerId?: string;
  models?: ProviderModel[];
}

const props = withDefaults(defineProps<Props>(), {
  model: null,
  providerId: undefined,
  models: () => []
});

const emit = defineEmits<{ success: [model: ProviderModel] }>();

const visible = defineModel<boolean>('open', { default: false });

const saving = ref<boolean>(false);
const { saveProviderModels } = useProviders();

const modelTypeOptions = [
  { label: '对话模型', value: 'chat' },
  { label: '图片模型', value: 'image' },
  { label: '视频模型', value: 'video' },
  { label: '多模态模型', value: 'multimodal' }
];

const dataItem = reactive<ProviderModel>({ id: '', name: '', type: 'chat', isEnabled: true });

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

async function createModel(model: ProviderModel): Promise<ModelSubmitResult> {
  if (!props.providerId) {
    return { success: false, message: '服务商不存在' };
  }

  const exists = props.models.some((item: ProviderModel) => item.id === model.id);

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

async function updateModel(model: ProviderModel): Promise<ModelSubmitResult> {
  if (!props.providerId) {
    return { success: false, message: '服务商不存在' };
  }

  const nextModels = props.models.map((item: ProviderModel) => (item.id === model.id ? { ...item, ...model } : item));
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

  const model: ProviderModel = { id, name: dataItem.name.trim(), type: dataItem.type, isEnabled: props.model?.isEnabled ?? true };

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
      Object.assign(dataItem, { id: props.model.id, name: props.model.name, type: props.model.type || 'chat' });
    } else {
      resetFields();
    }
  }
);
</script>

<style scoped lang="less">
.dataItem-section {
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
}

.section-title {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.option-description {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-tertiary);
}

.form-scroll-container {
  max-height: 60vh;
  overflow-y: auto;
}

.context-window-slider {
  display: flex;
  gap: 16px;
  align-items: center;
  width: 100%;

  :deep(.ant-slider) {
    flex: 1;
    margin: 0;
  }
}

.context-window-input {
  flex-shrink: 0;
  width: 120px;
}
</style>
