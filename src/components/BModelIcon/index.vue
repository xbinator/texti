<template>
  <div class="model-icon" :style="containerStyle">
    <img v-if="iconUrl" :src="iconUrl" :alt="alt" :style="imgStyle" @error="handleError" />
    <span v-else class="fallback-icon">{{ fallbackText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSettingStore } from '@/stores/setting';

type IconTheme = 'light' | 'dark';

interface Props {
  // 模型提供方
  provider?: string;
  // 模型名称
  model?: string;
  // 图标大小
  size?: number;
  // 图标替代文本
  alt?: string;
}

const props = withDefaults(defineProps<Props>(), {
  provider: undefined,
  model: undefined,
  size: 24,
  alt: ''
});

const settingStore = useSettingStore();

const providerIcons: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google-color',
  deepseek: 'deepseek-color',
  moonshot: 'moonshot',
  zhipu: 'zhipu-color',
  alibaba: 'alibaba-color',
  baidu: 'baidu-color',
  bytedance: 'bytedance-color',
  minimax: 'minimax-color',
  baichuan: 'baichuan-color',
  xiaomi: 'xiaomimimo',
  microsoft: 'microsoft-color',
  aws: 'aws-color',
  meta: 'meta-color',
  mistral: 'mistral-color',
  cohere: 'cohere-color',
  stability: 'stability-color',
  midjourney: 'midjourney',
  siliconflow: 'siliconcloud-color',
  hunyuan: 'hunyuan-color',
  longcat: 'longcat-color',
  tencentcloud: 'tencentcloud-color'
};

const modelIcons: Record<string, string> = {
  gpt: 'openai',
  glm: 'zai',
  claude: 'claude-color',
  chatglm: 'chatglm-color',
  kimi: 'kimi',
  qwen: 'qwen-color',
  doubao: 'doubao',
  mimo: 'xiaomimimo',
  minimax: 'minimax-color',
  longcat: 'longcat-color',
  hunyuan: 'hunyuan-color',
  deepseek: 'deepseek-color'
};

const iconId = computed(() => {
  if (props.provider) {
    return providerIcons[props.provider] || props.provider;
  }

  if (props.model) {
    const model = (props.model?.match(/^[a-zA-Z]+/i) || [])[0]?.toLocaleLowerCase();

    const matchedEntry = Object.entries(modelIcons).find(([key]) => model?.includes(key));

    if (matchedEntry) {
      const [, value] = matchedEntry;

      return modelIcons[value] || value;
    }
  }
  return 'model';
});

const theme = computed((): IconTheme => settingStore.resolvedTheme);

const iconUrl = computed(() => {
  try {
    return new URL(`./icons/${theme.value}/${iconId.value}.png`, import.meta.url).href;
  } catch {
    return '';
  }
});

const containerStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`
}));

const imgStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  objectFit: 'contain' as const
}));

const fallbackText = computed(() => {
  const name = props.provider || props.model || '';
  return name.charAt(0).toUpperCase();
});

function handleError(): void {
  console.warn(`Failed to load icon: ${iconId.value}`);
}
</script>

<style scoped lang="less">
.model-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.fallback-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 0.8em;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: 4px;
}
</style>
