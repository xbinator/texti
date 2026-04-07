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

const LOBE_ICONS_CDN = 'https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png';

interface Props {
  provider?: string;
  model?: string;
  size?: number;
  alt?: string;
}

const props = withDefaults(defineProps<Props>(), {
  provider: undefined,
  model: undefined,
  size: 24,
  alt: ''
});

const settingStore = useSettingStore();

const providerIconMap: Record<string, string> = {
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
  perplexity: 'perplexity-color',
  stability: 'stability-color',
  midjourney: 'midjourney-color',
  siliconflow: 'siliconcloud-color',
  custom: 'model'
};

const modelProviderMap: Record<string, string> = {
  'gpt-4': 'openai',
  'gpt-4o': 'openai',
  'gpt-4-turbo': 'openai',
  'gpt-3.5-turbo': 'openai',
  o1: 'openai',
  'o1-mini': 'openai',
  'o1-preview': 'openai',
  'claude-3-opus': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-haiku': 'anthropic',
  'claude-3.5-sonnet': 'anthropic',
  'claude-3.5-haiku': 'anthropic',
  'gemini-pro': 'google',
  'gemini-1.5-pro': 'google',
  'gemini-1.5-flash': 'google',
  'gemini-2.0-flash': 'google',
  'deepseek-chat': 'deepseek',
  'deepseek-coder': 'deepseek',
  'moonshot-v1': 'moonshot',
  'glm-4': 'zhipu',
  qwen: 'alibaba',
  'qwen-max': 'alibaba',
  'qwen-turbo': 'alibaba',
  ernie: 'baidu',
  doubao: 'byteDance',
  abab: 'minimax',
  baichuan: 'baichuan'
};

const iconId = computed(() => {
  if (props.provider) {
    return providerIconMap[props.provider] || props.provider;
  }
  if (props.model) {
    const modelLower = props.model.toLowerCase();
    const matchedEntry = Object.entries(modelProviderMap).find(([key]) => modelLower.includes(key.toLowerCase()));
    if (matchedEntry) {
      const [, value] = matchedEntry;
      return providerIconMap[value] || value;
    }
  }
  return 'model';
});

const theme = computed((): IconTheme => settingStore.resolvedTheme);

const iconUrl = computed(() => {
  return `${LOBE_ICONS_CDN}/${theme.value}/${iconId.value}.png`;
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
  console.warn(`Failed to load icon: ${iconUrl.value}`);
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
