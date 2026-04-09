<template>
  <div class="service-manager">
    <div class="manager-header">
      <h2 class="manager-title">模型服务</h2>
    </div>
    <div class="manager-content">
      <BScrollbar>
        <div class="flex flex-col items-center">
          <ServiceConfig
            service-type="polish"
            title="内容编辑助手"
            description="根据用户输入的文本内容，自动编辑并返回编辑后的文本。"
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
import { POLISH_DEFAULT_PROMPT, POLISH_SERVICE_CONFIG_OPTIONS } from './constants';
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
