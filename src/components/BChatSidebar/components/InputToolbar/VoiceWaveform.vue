<!--
  @file VoiceWaveform.vue
  @description 渲染语音录制过程中的基础波形占位视图。
-->
<template>
  <div class="voice-waveform" data-testid="voice-waveform">
    <div class="voice-waveform__side voice-waveform__side--left">
      <span
        v-for="(sample, index) in leftSamples"
        :key="`left-${index}`"
        class="voice-waveform__bar"
        :style="{ height: `${resolveBarHeight(sample, leftSamples.length - index)}px`, transitionDelay: `${index * 15}ms` }"
      ></span>
    </div>
    <span class="voice-waveform__bar voice-waveform__bar--center" :style="{ height: `${resolveBarHeight(centerSample)}px` }"></span>
    <div class="voice-waveform__side voice-waveform__side--right">
      <span
        v-for="(sample, index) in rightSamples"
        :key="`right-${index}`"
        class="voice-waveform__bar"
        :style="{ height: `${resolveBarHeight(sample, index + 1)}px`, transitionDelay: `${index * 15}ms` }"
      ></span>
    </div>

    <div class="voice-waveform__hint">
      请说，我再听
      <span class="voice-waveform__dots">
        <span class="voice-waveform__dot">.</span>
        <span class="voice-waveform__dot">.</span>
        <span class="voice-waveform__dot">.</span>
        <span class="voice-waveform__dot">.</span>
        <span class="voice-waveform__dot">.</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * 波形组件属性。
 */
interface Props {
  /** 波形采样数组。 */
  samples: number[];
}

const props = defineProps<Props>();

/**
 * 计算居中的主柱高度源值（使用最大值）。
 */
const centerSample = computed<number>(() => {
  if (props.samples.length === 0) return 1;
  return Math.max(...props.samples);
});

/**
 * 计算左侧波形柱，按照从中心向外扩散的顺序排列，带距离衰减。
 */
const leftSamples = computed<number[]>(() => {
  const values: number[] = [];

  props.samples.forEach((sample, index) => {
    if (index === 0 || index % 2 === 1) {
      return;
    }

    values.unshift(sample);
  });

  return values;
});

/**
 * 计算右侧波形柱，按照从中心向外扩散的顺序排列，带距离衰减。
 */
const rightSamples = computed<number[]>(() => {
  return props.samples.filter((_sample, index) => index % 2 === 1);
});

/**
 * 归一化柱状高度，带距离衰减效果。
 * @param sample - 原始采样值
 * @param distance - 距离中心的距离（0为最近）
 * @returns 渲染高度
 */
function resolveBarHeight(sample: number, distance = 0): number {
  const normalized = Math.max(sample, 1);
  const attenuation = Math.max(0.6, 1 - distance * 0.08);
  const scaled = normalized * 3 * attenuation;
  return Math.max(4, Math.min(scaled, 24));
}
</script>

<style scoped lang="less">
.voice-waveform {
  display: flex;
  gap: 3px;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  height: 24px;
}

.voice-waveform__side {
  display: flex;
  gap: 3px;
  align-items: center;
}

.voice-waveform__side--left {
  justify-content: flex-end;
}

.voice-waveform__bar {
  width: 2px;
  min-height: 4px;
  background: var(--color-primary);
  border-radius: 999px;
  transform-origin: center;
  transition: height 0.1s ease-out;
}

.voice-waveform__bar--center {
  width: 2px;
}

.voice-waveform__hint {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.voice-waveform__dots {
  display: inline-flex;
}

.voice-waveform__dot {
  opacity: 0;
  animation: voice-waveform-dot-marquee 1.5s infinite;
}

.voice-waveform__dot:nth-child(1) {
  animation-delay: 0s;
}

.voice-waveform__dot:nth-child(2) {
  animation-delay: 0.15s;
}

.voice-waveform__dot:nth-child(3) {
  animation-delay: 0.3s;
}

.voice-waveform__dot:nth-child(4) {
  animation-delay: 0.45s;
}

.voice-waveform__dot:nth-child(5) {
  animation-delay: 0.6s;
}

@keyframes voice-waveform-dot-marquee {
  0%,
  20% {
    opacity: 0;
  }

  50% {
    opacity: 1;
  }

  80%,
  100% {
    opacity: 0.3;
  }
}
</style>
