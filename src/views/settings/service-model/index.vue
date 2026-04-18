<template>
  <div class="service-manager">
    <div class="manager-header">
      <h2 class="manager-title">模型服务</h2>
    </div>
    <div class="manager-content">
      <BScrollbar>
        <div class="flex flex-col items-center gap-20 mr-20 min-w-500">
          <ServiceConfig
            service-type="chat"
            title="智能对话助手"
            description="指定用于智能对话的模型"
            :options="CHAT_SERVICE_CONFIG_OPTIONS"
            :show-prompt="false"
          />

          <ServiceConfig
            service-type="polish"
            title="内容编辑助手"
            description="指定用于内容编辑的模型"
            :options="POLISH_SERVICE_CONFIG_OPTIONS"
            :default-prompt="POLISH_DEFAULT_PROMPT"
          />
        </div>
      </BScrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import BScrollbar from '@/components/BScrollbar/index.vue';
import ServiceConfig from './components/ServiceConfig.vue';
import { CHAT_SERVICE_CONFIG_OPTIONS, POLISH_DEFAULT_PROMPT, POLISH_SERVICE_CONFIG_OPTIONS } from './constants';
</script>

<style scoped lang="less">
.service-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.manager-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-primary);
}

.manager-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.manager-content {
  flex: 1;
  width: 100%;
  height: 0;
  padding: 20px 0 20px 20px;
}
</style>
