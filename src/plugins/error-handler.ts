/**
 * @file error-handler.ts
 * @description Vue 应用级错误处理插件
 */

import type { App } from 'vue';
import { captureError } from '@/shared/logger/error-collector';

/**
 * 获取组件名称
 * @param instance - Vue 组件实例
 * @returns 组件名
 */
function getComponentName(instance: unknown): string {
  if (!instance) return 'Anonymous';
  const vm = instance as { $options?: { name?: string } };
  return vm.$options?.name || 'AnonymousComponent';
}

/**
 * 安装 Vue 错误处理
 * @param app - Vue 应用实例
 */
export function setupErrorHandler(app: App): void {
  // 错误处理
  app.config.errorHandler = (err, instance, info) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const componentName = getComponentName(instance);

    captureError(error, {
      type: 'vue-error',
      component: componentName,
      info
    });

    // 继续输出到控制台
    console.error(err);
  };

  // 警告处理（仅在开发环境收集）
  if (import.meta.env.DEV) {
    app.config.warnHandler = (msg, instance) => {
      const componentName = getComponentName(instance);
      captureError(new Error(msg), {
        type: 'vue-warning',
        component: componentName
      });
    };
  }
}
