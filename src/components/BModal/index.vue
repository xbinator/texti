<template>
  <Modal
    v-model:open="visible"
    :class="name"
    :footer="null"
    :closable="false"
    :width="modalWidth"
    :centered="centered"
    :keyboard="keyboard"
    :after-close="afterClose"
    :mask-closable="maskClosable"
    @cancel="handleClosable"
  >
    <div v-if="title || $slots.title" :class="bem('header')">
      <slot name="title">{{ title }}</slot>

      <div v-if="closable" :class="bem('closable')" @click="handleClosable">
        <Icon icon="lucide:x" />
      </div>
    </div>

    <div :class="[bem('body'), mainClass]" :style="mainStyle">
      <slot></slot>
    </div>

    <div v-if="$slots.footer" :class="bem('footer')">
      <slot name="footer"></slot>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { Modal } from 'ant-design-vue';
import { addCssUnit } from '@/utils/css';

export interface Props {
  open?: boolean;
  title?: string;
  width?: string | number;
  closable?: boolean;
  mainClass?: string;
  mainStyle?: CSSProperties | string;
  centered?: boolean;
  maskClosable?: boolean;
  close?: () => void;
  afterClose?: () => void;
  keyboard?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  title: '',
  width: 500,
  closable: true,
  mainClass: '',
  maskClosable: false,
  mainStyle: undefined,
  centered: true,
  close: undefined,
  afterClose: undefined,
  keyboard: true
});

const emit = defineEmits(['update:open', 'close']);

const name = 'b-modal';

function bem(modifier: string): string {
  return `${name}__${modifier}`;
}

const visible = defineModel<boolean>('open');

const modalWidth = computed(() => addCssUnit(props.width));

function handleClosable(): void {
  emit('close');
  props.close?.();
  visible.value = false;
}
</script>

<style lang="less">
.b-modal {
  .ant-modal-content {
    padding: 0;
  }
}

.b-modal__header {
  position: relative;
  padding: 16px 24px 0;
  font-size: 16px;
  font-weight: 500;
}

.b-modal__closable {
  position: absolute;
  top: 16px;
  right: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  font-size: 18px;
  color: var(--modal-text);
  cursor: pointer;
  border-radius: 6px;

  &:hover {
    background-color: var(--modal-header-bg);
  }
}

.b-modal__body {
  padding: 16px 24px;
}

.b-modal__footer {
  padding: 10px 24px 16px;
  text-align: right;

  .ant-btn + .ant-btn {
    margin-left: 12px;
  }
}
</style>
