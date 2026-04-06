<template>
  <div class="model-section">
    <div class="section-header">
      <h3 class="section-title">模型列表</h3>
      <div class="section-actions">
        <Input v-model:value="searchText" placeholder="搜索模型" class="search-input" />
        <Button type="default" @click="$emit('refresh')">
          <template #icon>
            <Icon icon="lucide:refresh-cw" />
          </template>
          获取模型列表
        </Button>
      </div>
    </div>

    <div class="model-categories">
      <Button
        v-for="category in categories"
        :key="category.key"
        :type="activeCategory === category.key ? 'primary' : 'default'"
        class="category-btn"
        @click="activeCategory = category.key"
      >
        {{ category.label }}
      </Button>
    </div>

    <div class="model-grid">
      <div v-for="model in filteredModels" :key="model.id" class="model-item">
        <div class="model-info">
          <h4 class="model-name">{{ model.name }}</h4>
          <p class="model-id">{{ model.id }}</p>
          <div class="model-tags">
            <span v-for="tag in model.tags" :key="tag" class="model-tag">{{ tag }}</span>
          </div>
        </div>
        <div class="model-actions">
          <ASwitch :checked="model.isEnabled" size="small" @change="(checked) => $emit('toggle', model.id, checked as boolean)" />
        </div>
      </div>
    </div>

    <div v-if="filteredModels.length === 0" class="empty-models">
      <Icon icon="lucide:box" class="empty-icon" />
      <p>未找到模型</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { Button, Input } from 'ant-design-vue';

interface Model {
  id: string;
  name: string;
  tags: string[];
  isEnabled: boolean;
}

interface Category {
  key: string;
  label: string;
}

interface Props {
  models: Model[];
  categories?: Category[];
}

const props = withDefaults(defineProps<Props>(), {
  categories: () => [
    { key: 'all', label: '全部' },
    { key: 'chat', label: '对话' },
    { key: 'image', label: '图片' },
    { key: 'video', label: '视频' }
  ]
});

defineEmits<{
  (e: 'refresh'): void;
  (e: 'toggle', modelId: string, enabled: boolean): void;
}>();

const searchText = ref('');
const activeCategory = ref('all');

const filteredModels = computed(() => {
  let result = props.models;

  if (searchText.value) {
    const search = searchText.value.toLowerCase();
    result = result.filter(
      (model) => model.name.toLowerCase().includes(search) || model.id.toLowerCase().includes(search)
    );
  }

  return result;
});
</script>

<style scoped lang="less">
.model-section {
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: 10px;
}

.section-header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.section-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-input {
  width: 200px;
}

.model-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}

.category-btn {
  flex-shrink: 0;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-primary-border);
    box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
  }
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-name {
  margin: 0 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.model-id {
  margin: 0 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-tag {
  padding: 2px 6px;
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
}

.empty-models {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-tertiary);
}

.empty-icon {
  margin-bottom: 8px;
  font-size: 32px;
  opacity: 0.5;
}
</style>
