<!--
  @file index.vue
  @description BDrawer 抽屉组件，基于 ant-design-vue Drawer 二次封装。
    默认从右侧滑出，关闭按钮位于 header 右上角；
    默认渲染到布局注入的 `.b-layout__content` 容器中（不遮挡 header 与右侧 ChatSider）。
-->
<template>
  <Teleport :to="teleportTarget" :disabled="teleportDisabled">
    <ADrawer
      v-model:open="visible"
      :class="name"
      :placement="placement"
      :width="drawerWidth"
      :height="drawerHeight"
      :mask="mask"
      :mask-closable="maskClosable"
      :root-class-name="bem('root') as string"
      :keyboard="keyboard"
      :get-container="false"
      :z-index="zIndex"
      :footer="null"
      :closable="false"
      :after-close="afterClose"
      @cancel="handleClose"
    >
      <div v-if="title || $slots.title" :class="bem('header')">
        <slot name="title">{{ title }}</slot>

        <div v-if="closable" :class="bem('closable')" @click="handleClose">
          <BIcon icon="lucide:x" />
        </div>
      </div>

      <div :class="[bem('body'), mainClass]" :style="mainStyle">
        <slot></slot>
      </div>

      <div v-if="$slots.footer" :class="bem('footer')">
        <slot name="footer"></slot>
      </div>
    </ADrawer>
  </Teleport>
</template>

<script setup lang="ts">
import type { BDrawerProps as Props } from './types';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { addCssUnit } from '@/utils/css';
import { createNamespace } from '@/utils/namespace';
import { DEFAULT_DRAWER_CONTAINER } from './types';

/**
 * Teleport 可接收的安全目标类型。
 */
type BDrawerTeleportTarget = string | HTMLElement;

defineOptions({ name: 'BDrawer' });

const props = withDefaults(defineProps<Props>(), {
  open: false,
  title: '',
  width: 378,
  height: 378,
  placement: 'right',
  closable: true,
  mask: true,
  maskClosable: true,
  keyboard: true,
  getContainer: undefined,
  mainClass: '',
  mainStyle: undefined,
  close: undefined,
  afterClose: undefined,
  zIndex: 1000
});

const emit = defineEmits(['update:open', 'close']);

const [name, bem] = createNamespace('drawer');

const visible = defineModel<boolean>('open');

/** Teleport 实际目标，默认先落到 body，避免布局容器刷新期缺失时报错。 */
const teleportTarget = ref<BDrawerTeleportTarget>('body');

/** 是否禁用 Teleport（getContainer 为 false 时不搬运，渲染在当前 DOM 位置）。 */
const teleportDisabled = computed<boolean>(() => props.getContainer === false);

/** 宽度（left/right 生效），统一追加 CSS 单位 */
const drawerWidth = computed(() => addCssUnit(props.width));
/** 高度（top/bottom 生效），统一追加 CSS 单位 */
const drawerHeight = computed(() => addCssUnit(props.height));

/**
 * 获取当前期望的 Teleport 选择器。
 * @returns Teleport 目标选择器
 */
function getTeleportSelector(): string {
  return props.getContainer || DEFAULT_DRAWER_CONTAINER;
}

/**
 * 解析 Teleport 目标：目标不存在时安全降级到 body，避免 Vue Teleport 在刷新期收到缺失选择器。
 */
function resolveTeleportTarget(): void {
  if (props.getContainer === false || typeof document === 'undefined') {
    teleportTarget.value = 'body';
    return;
  }

  const target = document.querySelector(getTeleportSelector());
  teleportTarget.value = target instanceof HTMLElement ? target : 'body';
}

/**
 * 等待布局 DOM 更新后重新解析 Teleport 目标。
 * @returns DOM 更新等待任务
 */
async function refreshTeleportTarget(): Promise<void> {
  await nextTick();
  resolveTeleportTarget();
}

/**
 * 安排一次 Teleport 目标刷新，避免在生命周期钩子里留下未处理 Promise。
 */
function scheduleTeleportTargetRefresh(): void {
  refreshTeleportTarget().catch((error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[BDrawer] Teleport 目标刷新失败: ${message}`);
  });
}

onMounted(scheduleTeleportTargetRefresh);

watch([() => props.getContainer, visible], (): void => {
  scheduleTeleportTargetRefresh();
});

/**
 * 触发关闭：依次执行 close 回调、emit close 事件，最后同步 visible 状态。
 */
function handleClose(): void {
  emit('close');
  props.close?.();
  visible.value = false;
}
</script>

<style lang="less">
.b-drawer {
  .ant-drawer-content-wrapper {
    box-shadow: -6px 0 16px rgb(0 0 0 / 8%);
  }

  .ant-drawer-content {
    padding: 0;
  }

  .ant-drawer-body {
    display: flex;
    flex-direction: column;
    padding: 0;
  }
}

.b-drawer__root {
  overflow: hidden;
  border-radius: var(--overlay-radius);
}

.b-drawer__header {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 40px;
  padding-left: 12px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-secondary);
}

.b-drawer__closable {
  position: absolute;
  top: 50%;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  font-size: 18px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--control-radius);
  transform: translateY(-50%);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.b-drawer__body {
  padding: 12px;
  overflow: auto;
}

.b-drawer__footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--border-secondary);
}
</style>
