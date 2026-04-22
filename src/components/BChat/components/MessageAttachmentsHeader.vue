<template>
  <div :class="bem('header')">
    <div v-if="imageFiles.length" :class="bem('images')">
      <img v-for="file in imageFiles" :key="file.id" :src="file.url || file.path" :alt="file.name" :class="bem('image')" />
    </div>
    <div v-if="otherFiles.length" :class="bem('files')">
      <div v-for="file in otherFiles" :key="file.id" :class="bem('file')">
        <Icon icon="lucide:file" width="14" height="14" />
        <span :class="bem('file-name')">{{ file.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file MessageAttachmentsHeader.vue
 * @description 聊天气泡附件头部组件，负责展示图片和其他附件列表。
 */
import type { ChatMessageFile } from 'types/chat';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'MessageAttachmentsHeader' });

const props = defineProps<{
  /** 附件列表 */
  files: ChatMessageFile[];
}>();

const [, bem] = createNamespace('message-bubble');

/** 图片附件列表 */
const imageFiles = computed(() => props.files.filter((file) => file.type === 'image' && (file.url || file.path)));
/** 非图片附件列表 */
const otherFiles = computed(() => props.files.filter((file) => file.type !== 'image' || (!file.url && !file.path)));
</script>
