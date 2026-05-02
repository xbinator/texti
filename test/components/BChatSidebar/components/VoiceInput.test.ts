/* @vitest-environment jsdom */
/**
 * @file VoiceInput.test.ts
 * @description 验证语音输入组件的开始、停止与完成事件转发行为。
 */
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 录音状态引用。
 */
const recorderStatus = ref<'idle' | 'recording' | 'stopping'>('idle');

/**
 * 最终文本引用。
 */
const finalText = ref('第一段');

/**
 * 开始录音桩。
 */
const startMock = vi.fn(async () => {
  recorderStatus.value = 'recording';
});

/**
 * 停止录音桩。
 */
const stopMock = vi.fn(async () => {
  recorderStatus.value = 'idle';
});

/**
 * 录音 hook 模拟。
 */
vi.mock('@/components/BChatSidebar/hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    status: recorderStatus,
    waveformSamples: ref([0, 2, 1]),
    start: startMock,
    stop: stopMock
  })
}));

/**
 * 会话 hook 模拟。
 */
vi.mock('@/components/BChatSidebar/hooks/useVoiceTranscriptionSession', () => ({
  useVoiceTranscriptionSession: () => ({
    finalText,
    resetSession: vi.fn(),
    completeSession: vi.fn(async () => ({ text: finalText.value }))
  })
}));

describe('VoiceInput', () => {
  beforeEach(() => {
    recorderStatus.value = 'idle';
    finalText.value = '第一段';
    startMock.mockClear();
    stopMock.mockClear();
  });

  it('emits complete with the final transcript after stopping a recording session', async () => {
    const { default: VoiceInput } = await import('@/components/BChatSidebar/components/InputToolbar/VoiceInput.vue');
    const wrapper = mount(VoiceInput, {
      props: {
        disabled: false
      },
      global: {
        stubs: {
          BButton: {
            props: ['disabled'],
            emits: ['click'],
            template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
          }
        }
      }
    });

    await wrapper.get('[data-testid="voice-start"]').trigger('click');
    await wrapper.get('[data-testid="voice-stop"]').trigger('click');

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('complete')?.[0]?.[0].text).toBe('第一段');
  });
});
