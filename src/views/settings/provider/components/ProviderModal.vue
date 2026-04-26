<template>
  <BModal v-model:open="visible" :width="560" :title="isEditMode ? '编辑服务商' : '新建服务商'">
    <AForm layout="vertical">
      <div class="dataItem-section">
        <div class="section-title">基本信息</div>
        <AFormItem label="服务商 ID" required v-bind="validateInfos.id">
          <AInput v-model:value="dataItem.id" :disabled="isEditMode" placeholder="例如: my-provider" @blur="handleProviderIdBlur" />
        </AFormItem>

        <AFormItem label="服务商名称" required v-bind="validateInfos.name">
          <AInput v-model:value="dataItem.name" placeholder="请输入服务商名称" />
        </AFormItem>

        <AFormItem label="服务商 Logo">
          <AInput v-model:value="dataItem.logo" placeholder="请输入 Logo 图片 URL" />
        </AFormItem>
      </div>

      <div class="dataItem-section">
        <div class="section-title">配置信息</div>
        <AFormItem label="请求格式" required v-bind="validateInfos.type">
          <BSelect v-model:value="dataItem.type" :label="selectedFormatLabel" :options="providerFormatOptions" placeholder="请选择请求格式">
            <template #option="{ value, label }">
              <div class="format-option">
                <BModelIcon :provider="value" :size="12" />
                <span>{{ label }}</span>
              </div>
            </template>
          </BSelect>
        </AFormItem>

        <AFormItem label="代理地址">
          <AInput v-model:value="dataItem.baseUrl" placeholder="例如: https://api.example.com/v1" />
        </AFormItem>

        <AFormItem label="API Key">
          <AInputPassword v-model:value="dataItem.apiKey" placeholder="请输入 API Key" />
        </AFormItem>
      </div>
    </AForm>

    <template #footer>
      <!--  -->
      <BButton type="secondary" @click="handleCancel">取消</BButton>
      <BButton :loading="saving" @click="handleSubmit">保存</BButton>
    </template>
  </BModal>
</template>

<script setup lang="ts">
import type { Rule } from 'ant-design-vue/es/form';
import type { AIProvider, AIProviderType } from 'types/ai';
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { message, Form } from 'ant-design-vue';
import { useProviderStore } from '@/stores/provider';
import { asyncTo } from '@/utils/asyncTo';
import { providerFormatOptions } from '../../constants';

interface CustomProviderForm {
  id: string;
  name: string;
  logo: string;
  type: AIProviderType;
  baseUrl: string;
  apiKey: string;
}

const props = withDefaults(defineProps<{ provider?: AIProvider | null }>(), { provider: null });

const emit = defineEmits<{ success: [provider: AIProvider] }>();

const visible = defineModel<boolean>('open', { default: false });

const router = useRouter();
const providerStore = useProviderStore();
const providers = computed(() => providerStore.providers);

const saving = ref<boolean>(false);

const dataItem = reactive<CustomProviderForm>({ id: '', name: '', logo: '', type: 'openai', apiKey: '', baseUrl: '' });

const isEditMode = computed(() => Boolean(props.provider));

const providerMap = computed<Record<string, AIProvider>>(() => {
  return Object.fromEntries(providers.value.map((provider) => [provider.id, provider]));
});

const rules = reactive<Record<string, Rule[]>>({
  id: [
    { required: true, message: '请输入服务商 ID' },
    {
      pattern: /^[a-z0-9][a-z0-9-_]*$/,
      message: '服务商 ID 仅支持小写字母、数字、中划线和下划线'
    },
    {
      validator: (_rule: Rule, value: string) => {
        if (!isEditMode.value && providerMap.value[value]) {
          // eslint-disable-next-line prefer-promise-reject-errors
          return Promise.reject('服务商 ID 已存在，请更换');
        }
        return Promise.resolve();
      }
    }
  ],
  name: [{ required: true, message: '请输入服务商名称' }],
  type: [{ required: true, message: '请选择请求格式' }]
});

const { resetFields, validate, validateInfos } = Form.useForm(dataItem, rules);

const onValidate = () => asyncTo(validate());

const selectedFormatLabel = computed(() => {
  const option = providerFormatOptions.find((opt) => opt.value === dataItem.type);
  return option?.label || '';
});

function handleProviderIdBlur(): void {
  dataItem.id = dataItem.id.trim().toLowerCase();
}

function handleCancel(): void {
  visible.value = false;
}

async function handleSubmit(): Promise<void> {
  const [valid] = await onValidate();
  if (valid) return;

  const id = isEditMode.value ? props.provider!.id : dataItem.id.trim().toLowerCase();

  saving.value = true;

  const provider = await providerStore.saveCustomProvider({
    id,
    name: dataItem.name.trim(),
    description: '自定义服务商',
    logo: dataItem.logo.trim(),
    type: dataItem.type,
    baseUrl: dataItem.baseUrl.trim(),
    apiKey: dataItem.apiKey.trim()
  });

  if (!provider) {
    message.error(isEditMode.value ? '编辑服务商失败' : '创建服务商失败');
    return;
  }

  visible.value = false;
  message.success(isEditMode.value ? '服务商已更新' : '服务商已创建');
  emit('success', provider);
  await router.push(`/settings/provider/${provider.id}`);

  saving.value = false;
}

watch(
  () => visible.value,
  (open) => {
    if (open) {
      if (props.provider) {
        Object.assign(dataItem, {
          id: props.provider.id,
          name: props.provider.name,
          logo: props.provider.logo || '',
          type: props.provider.type,
          baseUrl: props.provider.baseUrl || '',
          apiKey: props.provider.apiKey || ''
        });
      } else {
        resetFields();
      }
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
  font-weight: 600;
  color: var(--text-secondary);
}

.format-option {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
