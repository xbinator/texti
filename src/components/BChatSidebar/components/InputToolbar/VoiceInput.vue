<!--
  @file VoiceInput.vue
  @description 语音输入组件，负责录音开关、波形展示与完成事件转发。
-->
<template>
  <div class="voice-input">
    <BButton v-if="isIdle" tooltip="语言输入" data-testid="voice-start" size="small" type="text" square :disabled="disabled" @click="handleStart">
      <Icon icon="lucide:mic" width="16" height="16" />
    </BButton>
    <BButton v-else tooltip="停止语言输入" data-testid="voice-stop" size="small" type="outline" square :disabled="disabled" @click="handleStop">
      <div class="voice-stop-icon"></div>
    </BButton>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import { getElectronAPI, hasElectronAPI } from '@/shared/platform/electron-api';
import { Modal } from '@/utils/modal';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useVoiceSession } from '../../hooks/useVoiceSession';

/**
 * 语音输入属性。
 */
interface Props {
  /** 是否禁用交互。 */
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  disabled: false
});

const emit = defineEmits<{
  (e: 'start'): void;
  (e: 'complete', payload: { text: string }): void;
}>();

/**
 * 录音状态与控制器。
 */
const nextSeparator = ref<'' | '\n'>('');
const nextSegmentIndex = ref<number>(0);
const installingRuntime = ref<boolean>(false);
const unbindInstallProgress = ref<(() => void) | null>(null);

/**
 * 转写会话控制器。
 */
const session = useVoiceSession();

/**
 * 处理录音器自动产出的单段音频。
 * @param segment - 当前音频段
 */
async function handleRecorderSegment(segment: { buffer: ArrayBuffer; mimeType: string }): Promise<void> {
  const currentSeparator = nextSeparator.value;
  nextSeparator.value = '';
  nextSegmentIndex.value += 1;

  await session.enqueueSegment({
    id: `segment-${nextSegmentIndex.value}`,
    separator: currentSeparator,
    buffer: segment.buffer,
    mimeType: segment.mimeType
  });
}

/**
 * 录音状态与控制器。
 */
const recorder = useVoiceRecorder({
  onSegment: handleRecorderSegment
});

/**
 * 当前是否处于空闲状态。
 */
const isIdle = computed<boolean>(() => recorder.status.value === 'idle');

/**
 * 当前是否正在录音。
 */
const isRecording = computed<boolean>(() => recorder.status.value === 'recording');

/**
 * 暴露给父组件的状态和方法。
 */
defineExpose({
  isRecording,
  waveformSamples: recorder.waveformSamples
});

/**
 * 卸载安装进度监听。
 */
function disposeInstallProgressListener(): void {
  unbindInstallProgress.value?.();
  unbindInstallProgress.value = null;
}

/**
 * 确保语音运行时已准备就绪。
 * @returns 是否可以继续录音
 */
async function ensureSpeechRuntimeReady(): Promise<boolean> {
  if (!hasElectronAPI()) {
    return true;
  }

  const electronAPI = getElectronAPI();
  const status = await electronAPI.getSpeechRuntimeStatus();
  if (status.state === 'ready') {
    return true;
  }

  const [cancelled] = await Modal.confirm('语音组件未安装', '首次使用语音输入需要下载语音组件，是否立即下载？', {
    confirmText: '下载'
  });
  if (cancelled) {
    return false;
  }

  installingRuntime.value = true;
  disposeInstallProgressListener();
  unbindInstallProgress.value = electronAPI.onSpeechInstallProgress((progress) => {
    message.loading({
      content: `正在安装语音组件：${progress.message}`,
      key: 'speech-runtime-install',
      duration: 0
    });
  });

  try {
    const installedStatus = await electronAPI.installSpeechRuntime();
    if (installedStatus.state !== 'ready') {
      throw new Error(installedStatus.errorMessage || '语音组件安装失败');
    }

    message.success({ content: '语音组件安装完成', key: 'speech-runtime-install' });
    return true;
  } catch (error) {
    message.error({
      content: error instanceof Error ? error.message : '语音组件安装失败',
      key: 'speech-runtime-install'
    });
    return false;
  } finally {
    installingRuntime.value = false;
    disposeInstallProgressListener();
  }
}

/**
 * 启动录音。
 */
async function handleStart(): Promise<void> {
  const ready = await ensureSpeechRuntimeReady();
  if (!ready) {
    return;
  }

  nextSeparator.value = '';
  nextSegmentIndex.value = 0;
  session.resetSession();
  await recorder.start();
  emit('start');
}

/**
 * 停止录音并把最终文本抛给父层。
 */
async function handleStop(): Promise<void> {
  await recorder.stop();
  const payload = await session.completeSession();
  emit('complete', payload);
}

onUnmounted(() => {
  disposeInstallProgressListener();
});
</script>

<style scoped lang="less">
.voice-input {
  display: flex;
  gap: 6px;
  align-items: center;
}

.voice-stop-icon {
  width: 11px;
  height: 11px;
  background-color: var(--color-primary);
  border-radius: 2px;
}
</style>
