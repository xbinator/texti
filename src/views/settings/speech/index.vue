<!--
  @file index.vue
  @description 语音组件设置页，负责展示当前运行时状态并提供安装、重装和删除入口。
-->
<template>
  <div class="speech-settings">
    <div class="speech-settings__header">
      <div class="speech-settings__title">语音组件</div>
    </div>

    <div class="speech-settings__body">
      <div class="speech-settings__overview">
        <div class="speech-settings__overview-icon">
          <Icon icon="lucide:mic-2" />
        </div>

        <div class="speech-settings__overview-content">
          <div class="speech-settings__overview-title">本地语音组件</div>
          <div class="speech-settings__overview-desc">用于本地语音转写、模型运行和音频处理</div>
        </div>

        <div class="speech-settings__status-badge" :class="`speech-settings__status-badge--${status?.state ?? 'unknown'}`">
          <span class="speech-settings__status-dot" :class="`speech-settings__status-dot--${status?.state ?? 'unknown'}`"></span>
          {{ statusLabel }}
        </div>
      </div>

      <div class="speech-settings__list">
        <div class="speech-settings__section">
          <div class="speech-settings__section-title">
            <span>运行环境</span>
          </div>

          <div class="speech-settings__item">
            <div class="speech-settings__item-main">
              <Icon icon="lucide:activity" class="speech-settings__item-icon" />
              <div>
                <div class="speech-settings__label">状态</div>
                <div class="speech-settings__hint">当前语音运行时检测结果</div>
              </div>
            </div>

            <div class="speech-settings__value">
              <span class="speech-settings__status-dot" :class="`speech-settings__status-dot--${status?.state ?? 'unknown'}`"></span>
              {{ statusLabel }}
            </div>
          </div>

          <div class="speech-settings__item">
            <div class="speech-settings__item-main">
              <Icon icon="lucide:monitor" class="speech-settings__item-icon" />
              <div>
                <div class="speech-settings__label">平台</div>
                <div class="speech-settings__hint">当前系统平台</div>
              </div>
            </div>

            <div class="speech-settings__value">{{ status?.platform ?? '-' }}</div>
          </div>

          <div class="speech-settings__item">
            <div class="speech-settings__item-main">
              <Icon icon="lucide:binary" class="speech-settings__item-icon" />
              <div>
                <div class="speech-settings__label">架构</div>
                <div class="speech-settings__hint">运行时 CPU 架构</div>
              </div>
            </div>

            <div class="speech-settings__value">{{ status?.arch ?? '-' }}</div>
          </div>
        </div>

        <div class="speech-settings__section">
          <div class="speech-settings__section-title">
            <span>模型信息</span>
          </div>

          <div class="speech-settings__item">
            <div class="speech-settings__item-main">
              <Icon icon="lucide:brain" class="speech-settings__item-icon" />
              <div>
                <div class="speech-settings__label">模型</div>
                <div class="speech-settings__hint">当前使用的语音识别模型</div>
              </div>
            </div>

            <div class="speech-settings__value">{{ status?.modelName ?? '-' }}</div>
          </div>

          <div class="speech-settings__item">
            <div class="speech-settings__item-main">
              <Icon icon="lucide:tag" class="speech-settings__item-icon" />
              <div>
                <div class="speech-settings__label">版本</div>
                <div class="speech-settings__hint">本地运行时版本</div>
              </div>
            </div>

            <div class="speech-settings__value">{{ status?.version ?? '-' }}</div>
          </div>

          <div class="speech-settings__item speech-settings__item--path">
            <div class="speech-settings__item-main">
              <Icon icon="lucide:folder" class="speech-settings__item-icon" />
              <div>
                <div class="speech-settings__label">安装目录</div>
                <div class="speech-settings__hint">语音组件本地存储路径</div>
              </div>
            </div>

            <div class="speech-settings__value speech-settings__value--path">
              {{ status?.installDir ?? '-' }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="progressText" class="speech-settings__progress">
        {{ progressText }}
      </div>

      <div v-if="status?.errorMessage" class="speech-settings__error">
        {{ status.errorMessage }}
      </div>

      <div class="speech-settings__actions">
        <BButton v-if="status?.state === 'ready'" :disabled="installing" @click="handleInstall">重装</BButton>
        <BButton v-else :disabled="installing" @click="handleInstall">{{ installing ? '安装中...' : '下载' }}</BButton>
        <BButton v-if="status?.state === 'ready'" type="secondary" :disabled="installing" @click="handleRemove">删除</BButton>
        <BButton type="secondary" :disabled="installing" @click="refreshStatus">刷新</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ElectronSpeechInstallProgress, ElectronSpeechRuntimeStatus } from 'types/electron-api';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import BButton from '@/components/BButton/index.vue';
import { getElectronAPI, hasElectronAPI } from '@/shared/platform/electron-api';
import { Modal } from '@/utils/modal';

/**
 * 当前语音运行时状态。
 */
const status = ref<ElectronSpeechRuntimeStatus | null>(null);

/**
 * 当前是否正在安装。
 */
const installing = ref<boolean>(false);

/**
 * 当前安装进度。
 */
const progress = ref<ElectronSpeechInstallProgress | null>(null);

/**
 * 安装进度解绑函数。
 */
const disposeProgressListener = ref<(() => void) | null>(null);

/**
 * 语音状态显示文案。
 */
const statusLabel = computed<string>(() => {
  switch (status.value?.state) {
    case 'ready':
      return '已安装';
    case 'installing':
      return '安装中';
    case 'failed':
      return '安装失败';
    case 'missing':
      return '未安装';
    default:
      return '未检测';
  }
});

/**
 * 当前进度文案。
 */
const progressText = computed<string>(() => {
  if (!progress.value) {
    return '';
  }

  return `${progress.value.message}（${progress.value.current}/${progress.value.total}）`;
});

/**
 * 解绑进度监听。
 */
function teardownProgressListener(): void {
  disposeProgressListener.value?.();
  disposeProgressListener.value = null;
}

/**
 * 刷新当前语音运行时状态。
 */
async function refreshStatus(): Promise<void> {
  if (!hasElectronAPI()) {
    status.value = {
      state: 'failed',
      platform: 'darwin',
      arch: 'arm64',
      errorMessage: 'Electron API is not available'
    };
    return;
  }

  status.value = await getElectronAPI().getSpeechRuntimeStatus();
}

/**
 * 安装或重装语音运行时。
 */
async function handleInstall(): Promise<void> {
  if (!hasElectronAPI()) {
    message.error('当前环境不支持安装语音组件');
    return;
  }

  installing.value = true;
  progress.value = null;
  teardownProgressListener();

  disposeProgressListener.value = getElectronAPI().onSpeechInstallProgress((nextProgress) => {
    progress.value = nextProgress;
  });

  try {
    status.value = {
      ...(status.value ?? { platform: 'darwin', arch: 'arm64' }),
      state: 'installing'
    } as ElectronSpeechRuntimeStatus;

    status.value = await getElectronAPI().installSpeechRuntime();
    message.success('语音组件已安装');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '语音组件安装失败');
  } finally {
    installing.value = false;
    teardownProgressListener();
  }
}

/**
 * 删除已安装语音运行时。
 */
async function handleRemove(): Promise<void> {
  if (!hasElectronAPI()) {
    message.error('当前环境不支持删除语音组件');
    return;
  }

  const [cancelled] = await Modal.delete('确定要删除当前语音组件吗？');
  if (cancelled) {
    return;
  }

  status.value = await getElectronAPI().removeSpeechRuntime();
  progress.value = null;
  message.success('语音组件已删除');
}

onMounted(() => {
  refreshStatus();
});

onUnmounted(() => {
  teardownProgressListener();
});
</script>

<style scoped lang="less">
.speech-settings {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: var(--bg-primary);
  border-radius: 8px;
}

.speech-settings__header {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-primary);
}

.speech-settings__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.speech-settings__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 820px;
  padding: 20px;
  margin: 0 auto;
}

.speech-settings__overview {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 18px;
  border: 1px solid var(--color-primary-border);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}

.speech-settings__overview-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  font-size: 20px;
  color: var(--color-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--color-primary-border);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.speech-settings__overview-content {
  flex: 1;
  min-width: 0;
}

.speech-settings__overview-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.speech-settings__overview-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.speech-settings__status-badge {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-primary);
  border-radius: 999px;

  &--ready {
    color: var(--color-success);
    background: var(--color-success-bg);
    border-color: var(--color-success);
  }

  &--installing {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    border-color: var(--color-primary-border);
  }

  &--failed {
    color: var(--color-error);
    background: var(--color-error-bg);
    border-color: var(--color-error);
  }

  &--missing {
    color: var(--color-warning);
    background: var(--color-warning-bg);
    border-color: var(--color-warning-border);
  }
}

.speech-settings__list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.speech-settings__section {
  overflow: hidden;
  background: var(--bg-elevated);
  border: 1px solid var(--border-primary);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}

.speech-settings__section-title {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 44px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-primary);
}

.speech-settings__item {
  display: flex;
  gap: 16px;
  align-items: center;
  min-height: 64px;
  padding: 12px 16px;
  transition: background 0.2s ease, border-color 0.2s ease;

  & + & {
    border-top: 1px solid var(--border-tertiary);
  }

  &:hover {
    background: var(--bg-hover);
  }
}

.speech-settings__item--path {
  align-items: flex-start;
}

.speech-settings__item-main {
  display: flex;
  flex: 1;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.speech-settings__item-icon {
  display: flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
}

.speech-settings__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.speech-settings__hint {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-secondary);
}

.speech-settings__value {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  max-width: 50%;
  font-size: 13px;
  color: var(--text-primary);
  text-align: right;
}

.speech-settings__value--path {
  flex-shrink: 1;
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-all;
}

.speech-settings__status-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  background: var(--text-tertiary);
  border-radius: 50%;

  &--ready {
    background: var(--color-success);
  }

  &--installing {
    background: var(--color-primary);
    animation: speech-settings-pulse 1.5s ease-in-out infinite;
  }

  &--failed {
    background: var(--color-error);
  }

  &--missing {
    background: var(--color-warning);
  }
}

@keyframes speech-settings-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

.speech-settings__progress {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  border-radius: 10px;
}

.speech-settings__error {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 10px;
}

.speech-settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: flex-end;
  width: 100%;
  padding-top: 4px;
}
</style>
