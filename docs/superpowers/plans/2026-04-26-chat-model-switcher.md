# Chat Model Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 BChatSidebar 中添加模型切换功能，允许用户快速切换聊天使用的模型

**Architecture:** 新增 InputToolbar 和 ModelSelector 组件，使用 BSelect 和 BDropdown 实现模型选择下拉菜单，通过 serviceModelsStorage 持久化配置

**Tech Stack:** Vue 3, TypeScript, Pinia, Ant Design Vue, LocalForage

---

### Task 1: Create ModelSelector Component

**Files:**
- Create: `src/components/BChatSidebar/components/InputToolbar/ModelSelector.vue`

- [ ] **Step 1: Create ModelSelector.vue file with basic structure**

```vue
<template>
  <BDropdown v-model:open="open">
    <BButton square size="small" type="text">
      <BModelIcon v-if="currentProviderId" :provider="currentProviderId" :size="16" />
      <Icon v-else icon="lucide:bot" width="16" height="16" />
    </BButton>

    <template #overlay>
      <div class="model-selector">
        <BSelect
          v-model:value="internalModel"
          :options="modelOptions"
          placeholder="请选择模型"
          :show-arrow="false"
          :style="{ width: '280px' }"
          @change="handleModelChange"
        >
          <template #option="{ modelId, modelName, providerName }">
            <div class="flex items-center gap-6">
              <BModelIcon :model="modelId" :size="16" />
              <div class="flex-1 w-0 truncate">{{ modelName }}</div>
              <div class="fs-12">{{ providerName }}</div>
            </div>
          </template>
        </BSelect>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import type { AIProvider } from 'types/ai';
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BModelIcon from '@/components/BModelIcon/index.vue';
import BSelect from '@/components/BSelect/index.vue';
import { providerStorage, serviceModelsStorage } from '@/shared/storage';
import { dispatchServiceModelUpdated } from '@/shared/storage/service-models/events';

interface ModelOption {
  value: string;
  modelId: string;
  modelName: string;
  providerName: string;
}

interface Props {
  /** 当前选中的模型 (providerId:modelId) */
  model: string | undefined;
}

const props = withDefaults(defineProps<Props>(), {
  model: undefined
});

const emit = defineEmits<{
  (e: 'update:model', value: string): void;
}>();

const open = ref(false);
const providers = ref<AIProvider[]>([]);
const internalModel = ref<string>();

const currentProviderId = computed<string | undefined>(() => {
  if (!internalModel.value) return undefined;
  const match = internalModel.value.match(/^([^:]+):(.+)$/);
  return match?.[1];
});

const modelOptions = computed<ModelOption[]>(() => {
  return providers.value.flatMap((provider) => {
    if (!provider.isEnabled || !provider.models?.length) {
      return [];
    }

    return provider.models
      .filter((model) => model.isEnabled)
      .map((model) => ({
        value: `${provider.id}:${model.id}`,
        modelId: model.id,
        modelName: model.name,
        providerName: provider.name
      }));
  });
});

async function loadProviders(): Promise<void> {
  providers.value = await providerStorage.listProviders();
}

async function loadSavedConfig(): Promise<void> {
  const config = await serviceModelsStorage.getConfig('chat');
  internalModel.value = config?.providerId && config?.modelId
    ? `${config.providerId}:${config.modelId}`
    : undefined;
}

function handleModelChange(value: string): void {
  const [, providerId, modelId] = value.match(/^([^:]+):(.+)$/) ?? [];

  if (providerId && modelId) {
    serviceModelsStorage.saveConfig('chat', { providerId, modelId });
    dispatchServiceModelUpdated('chat');
  }

  emit('update:model', value);
  open.value = false;
}

watch(
  () => props.model,
  (value) => {
    internalModel.value = value;
  },
  { immediate: true }
);

onMounted(async () => {
  await Promise.all([loadProviders(), loadSavedConfig()]);
});
</script>

<style scoped lang="less">
.model-selector {
  padding: 4px;
  width: 280px;
}
</style>
```

- [ ] **Step 2: Run dev server to verify component loads**

Run: `npm run dev`
Expected: Server starts without errors, component file is recognized

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/components/InputToolbar/ModelSelector.vue
git commit -m "feat: 创建 ModelSelector 组件"
```

---

### Task 2: Create InputToolbar Component

**Files:**
- Create: `src/components/BChatSidebar/components/InputToolbar.vue`

- [ ] **Step 1: Create InputToolbar.vue file with basic structure**

```vue
<template>
  <div class="chat-input-toolbar">
    <ModelSelector :model="selectedModel" @update:model="handleModelChange" />
    <div class="action-buttons">
      <BButton v-if="loading" size="small" square icon="lucide:square" @click="$emit('abort')" />
      <BButton v-else size="small" square :disabled="!inputValue" icon="lucide:arrow-up" @click="$emit('submit')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import ModelSelector from './InputToolbar/ModelSelector.vue';
import BButton from '@/components/BButton/index.vue';

interface Props {
  /** 是否正在加载 */
  loading: boolean;
  /** 输入框内容 */
  inputValue: string;
  /** 当前选中的模型 (providerId:modelId) */
  selectedModel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  selectedModel: undefined
});

defineEmits<{
  (e: 'submit'): void;
  (e: 'abort'): void;
  (e: 'model-change', value: string): void;
}>();

function handleModelChange(value: string): void {
  emit('model-change', value);
}
</script>

<style scoped lang="less">
.chat-input-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
```

- [ ] **Step 2: Run dev server to verify component loads**

Run: `npm run dev`
Expected: Server starts without errors, component file is recognized

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/components/InputToolbar.vue
git commit -m "feat: 创建 InputToolbar 组件"
```

---

### Task 3: Update BChatSidebar to Use InputToolbar

**Files:**
- Modify: `src/components/BChatSidebar/index.vue:27-46`

- [ ] **Step 1: Add selectedModel state to BChatSidebar**

Add after line 95:

```typescript
/** 当前选中的模型 */
const selectedModel = ref<string>();
```

- [ ] **Step 2: Add loadSelectedModel function**

Add after line 113:

```typescript
/**
 * 加载当前选中的模型配置
 */
async function loadSelectedModel(): Promise<void> {
  const config = await chatStore.serviceModelStore.getServiceConfig('chat');
  selectedModel.value = config?.providerId && config?.modelId
    ? `${config.providerId}:${config.modelId}`
    : undefined;
}
```

- [ ] **Step 3: Add handleModelChange function**

Add after line 395:

```typescript
function handleModelChange(value: string): void {
  selectedModel.value = value;
}
```

- [ ] **Step 4: Import InputToolbar component**

Add to imports around line 68:

```typescript
import InputToolbar from './components/InputToolbar.vue';
```

- [ ] **Step 5: Add serviceModelStore**

Add after line 78:

```typescript
/** 服务模型存储 */
const serviceModelStore = useServiceModelStore();
```

- [ ] **Step 6: Replace chat-panel__input section**

Replace lines 27-46 with:

```vue
<div class="chat-panel__input">
  <div class="chat-panel__input-container">
    <BPromptEditor
      ref="promptEditorRef"
      v-model:value="inputValue"
      placeholder="输入消息..."
      :max-height="200"
      variant="borderless"
      submit-on-enter
      @submit="handleChatSubmit"
    />

    <InputToolbar
      :loading="chatStream.loading.value"
      :input-value="inputValue"
      :selected-model="selectedModel"
      @submit="handleChatSubmit"
      @abort="chatStream.abort"
      @model-change="handleModelChange"
    />
  </div>
</div>
```

- [ ] **Step 7: Remove old chat-panel__input-buttons styles**

Remove lines 559-564 (`.chat-panel__input-buttons` section)

- [ ] **Step 8: Add loadSelectedModel to onMounted**

Modify line 509 to:

```typescript
onMounted(() => {
  loadSessions();
  loadSelectedModel();
  unregisterFileReferenceInsert = onChatFileReferenceInsert((reference) => {
    handleFileReferenceInsert(reference);
  });
});
```

- [ ] **Step 9: Add useServiceModelStore import**

Add to imports around line 66:

```typescript
import { useServiceModelStore } from '@/stores/service-model';
```

- [ ] **Step 10: Run dev server and verify the changes**

Run: `npm run dev`
Expected: Server starts, InputToolbar displays in the sidebar, model selector dropdown works

- [ ] **Step 11: Commit**

```bash
git add src/components/BChatSidebar/index.vue
git commit -m "feat: BChatSidebar 使用新的 InputToolbar 组件"
```

---

### Task 4: Update chat-panel__input-container Styles

**Files:**
- Modify: `src/components/BChatSidebar/index.vue:564-579`

- [ ] **Step 1: Update chat-panel__input-container styles**

Replace lines 564-579 with:

```less
.chat-panel__input-container {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-primary);
  border-radius: 6px;

  :deep(.b-prompt-editor) {
    flex: 1;
    min-width: 0;
    background-color: transparent;
    border: none;
    border-radius: 0;
  }
}
```

- [ ] **Step 2: Verify styles look correct**

Run: `npm run dev`
Expected: InputToolbar and PromptEditor align properly in the container

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/index.vue
git commit -m "style: 更新输入框容器样式以适配 InputToolbar"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] ModelSelector component created with props, emits, and storage integration
- [x] InputToolbar component created containing ModelSelector and ActionButtons
- [x] BChatSidebar updated to use InputToolbar
- [x] Model value format (providerId:modelId) implemented
- [x] Storage APIs used (providerStorage.listProviders, serviceModelsStorage.getConfig, serviceModelsStorage.saveConfig)
- [x] Styling matches the spec

### Placeholder Scan
- No TBD, TODO, or "implement later" found
- All code blocks contain complete implementations
- All file paths are exact

### Type Consistency
- Props interface names match across tasks
- Emit event names are consistent
- Model value format (providerId:modelId) is consistent throughout

### Scope Check
- Plan covers all requirements from the spec
- Tasks are independent and can be completed in order
- No unrelated changes included
