<template>
  <span v-if="type === 'dot'" class="b-bubble-loading__dot">
    <i class="b-bubble-loading__dot-item"></i>
    <i class="b-bubble-loading__dot-item"></i>
    <i class="b-bubble-loading__dot-item"></i>
  </span>

  <span v-else-if="type === 'circle'" class="b-bubble-loading__spinner">
    <svg class="b-bubble-loading__circular" viewBox="25 25 50 50">
      <circle cx="50" cy="50" r="20" fill="none"></circle>
    </svg>
  </span>
</template>

<script setup lang="ts">
interface Props {
  type: 'dot' | 'circle';
}

withDefaults(defineProps<Props>(), { type: 'dot' });
</script>

<style scoped lang="less">
.b-bubble-loading {
  &__dot {
    display: flex;
    column-gap: 8px;
    align-items: center;
    height: 100%;
    min-height: 46px;
    padding: 10px 20px;

    &-item {
      width: 4px;
      height: 4px;
      background-color: var(--color-primary);
      border-radius: 100%;
      animation-name: b-bubble-loading-move;
      animation-duration: 2s;
      animation-timing-function: linear;
      animation-iteration-count: infinite;

      &:nth-child(1) {
        animation-delay: 0s;
      }

      &:nth-child(2) {
        animation-delay: 0.2s;
      }

      &:nth-child(3) {
        animation-delay: 0.4s;
      }
    }
  }

  &__spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    vertical-align: middle;
    color: var(--color-primary);
    animation: b-bubble-rotate 2s linear infinite;
  }

  &__circular {
    display: block;
    width: 100%;
    height: 100%;

    circle {
      stroke: currentColor;
      stroke-width: 3;
      stroke-linecap: round;
      animation: b-bubble-circular 1.5s ease-in-out infinite;
    }
  }
}

@keyframes b-bubble-loading-move {
  0% {
    transform: translateY(0);
  }

  10% {
    transform: translateY(4px);
  }

  20% {
    transform: translateY(0);
  }

  30% {
    transform: translateY(-4px);
  }

  40% {
    transform: translateY(0);
  }
}

@keyframes b-bubble-rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes b-bubble-circular {
  0% {
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
  }

  50% {
    stroke-dasharray: 90, 150;
    stroke-dashoffset: -40;
  }

  100% {
    stroke-dasharray: 90, 150;
    stroke-dashoffset: -120;
  }
}
</style>
