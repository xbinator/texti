<template>
  <div @click="openSelector">
    <slot></slot>

    <input ref="inputRef" type="file" :class="name" :accept="accept" :multiple="multiple" @change="handleFileChange" />
  </div>
</template>

<script setup lang="ts">
import type { BUploadProps as Props } from './types';
import { onUnmounted, ref, watch } from 'vue';
import { createNamespace } from '@/utils/namespace';

const [name] = createNamespace('upload');

const props = withDefaults(defineProps<Props>(), {
  accept: '',
  multiple: false
});

/** 控制文件选择器打开状态 */
const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  /** 文件选择成功时触发 */
  change: [files: FileList];
}>();

/** 文件输入框引用 */
const inputRef = ref<HTMLInputElement>();
/** 定时器 ID，防止多次触发 */
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * 验证文件类型是否符合 accept 属性
 * @param file - 待验证的文件
 * @returns 是否符合类型要求
 */
function validateFileType(file: File): boolean {
  if (!props.accept) return true;

  const acceptTypes = props.accept.split(',').map((type) => type.trim());
  const fileName = file.name.toLowerCase();

  return acceptTypes.some((type) => {
    // 扩展名匹配（如 .pdf）
    if (type.startsWith('.')) {
      return fileName.endsWith(type.toLowerCase());
    }

    // MIME 类型匹配（如 image/* 或 image/png）
    const [mimeType] = type.split('/');
    return mimeType === '*' || file.type.startsWith(mimeType) || file.type === type;
  });
}

/**
 * 清空文件输入框
 */
function clearInput(): void {
  if (inputRef.value) {
    inputRef.value.value = '';
  }
}

/**
 * 打开文件选择器
 */
function openSelector(): void {
  inputRef.value?.click();
}

/**
 * 处理文件选择变化
 */
function handleFileChange(): void {
  open.value = false;

  const files = inputRef.value?.files;
  if (!files || files.length === 0) return;

  // 验证所有文件类型
  for (let i = 0; i < files.length; i++) {
    if (!validateFileType(files[i])) {
      clearInput();
      return;
    }
  }

  // 根据是否多选返回不同结果
  emit('change', files);
  clearInput();
}

// 监听 open 状态变化
watch(
  () => open.value,
  (value) => {
    if (value) {
      // 清除之前的定时器
      if (timer) {
        clearTimeout(timer);
      }

      // 打开文件选择器
      openSelector();

      // 设置超时自动关闭，防止用户取消选择时状态卡住
      timer = setTimeout(() => {
        open.value = false;
      }, 300);
    }
  }
);

// 组件卸载时清理定时器
onUnmounted(() => {
  if (timer) {
    clearTimeout(timer);
  }
});

// 暴露方法供父组件调用
defineExpose({
  open: openSelector,
  clear: clearInput
});
</script>

<style scoped lang="less">
.b-upload {
  display: none;
}
</style>
