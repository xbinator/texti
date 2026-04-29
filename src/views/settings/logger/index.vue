<!--
  @file index.vue
  @description 日志查看器主页面，使用时间轴卡片布局展示日志。
  首次加载在 onMounted 中触发初始日志拉取。
-->
<template>
  <div class="logger-view">
    <LogFilterBar />
    <div class="logger-view__content" @scroll="handleScroll">
      <div v-if="store.entries.length === 0 && !store.isLoading" class="log-empty">
        <AEmpty :image-style="{ height: '120px' }">
          <template #description>
            <div class="log-empty__text">暂无日志数据</div>
            <div class="log-empty__subtext">可能没有产生日志，或者被当前的过滤条件拦截</div>
          </template>
        </AEmpty>
      </div>

      <LogTimeline v-else :entries="store.entries" />

      <div v-if="store.isLoading" class="log-loading">
        <ASpin />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import LogFilterBar from './components/LogFilterBar.vue';
import LogTimeline from './components/LogTimeline.vue';
import { useLogViewerStore } from './stores/logViewer';

/** 日志查看器全局状态 */
const store = useLogViewerStore();

/**
 * 处理滚动事件，触底时加载更多。
 * @param event - 滚动事件对象。
 */
function handleScroll(event: Event): void {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  if (scrollHeight - scrollTop - clientHeight < 50) {
    store.loadMore();
  }
}

onMounted(() => {
  store.loadLogs(true);
});
</script>

<style scoped lang="less">
.logger-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}

.logger-view__content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 48px 0;

  &__text {
    margin-top: 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__subtext {
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
}

.log-loading {
  display: flex;
  justify-content: center;
  padding: 24px 0 12px;
}
</style>
