<template>
  <div class="error-page">
    <div class="error-container">
      <div class="error-code">404</div>
      <div class="error-title">抱歉，您访问的页面不存在</div>
      <div class="error-desc">请检查您输入的地址是否正确，或者点击下方按钮返回。</div>
      <div class="error-actions">
        <BButton type="primary" @click="handleBack">返回欢迎页</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import BButton from '@/components/BButton/index.vue';

const router = useRouter();

function handleBack() {
  router.push('/welcome');
}
</script>

<style lang="less" scoped>
.error-page {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: var(--bg-primary);
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.error-code {
  margin-bottom: 24px;
  font-size: 120px;
  font-weight: 700;
  line-height: 1;
  color: var(--color-primary);
}

.error-title {
  margin-bottom: 16px;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.error-desc {
  margin-bottom: 32px;
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
