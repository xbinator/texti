# JavaScript 错误收集系统 — 实现计划

## 目标

实现全局 JavaScript 错误收集功能，将渲染进程、Preload 脚本和主进程的未捕获错误统一收集到日志系统。

---

## 任务拆分

### Phase 1: 渲染进程错误收集

#### 1.1 创建错误收集器模块

**文件**: `src/shared/logger/error-collector.ts`

```typescript
/**
 * @file error-collector.ts
 * @description 渲染进程全局错误收集器
 */

import { logger } from './index';
import type { LogScope } from './types';

/** 错误上报配置 */
interface CollectorConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 采样间隔（毫秒） */
  debounceMs: number;
  /** 单周期最大上报数 */
  maxReportsPerWindow: number;
}

/** 错误收集器状态 */
interface CollectorState {
  /** 当前窗口已上报数 */
  reportCount: number;
  /** 上次重置时间 */
  lastResetTime: number;
  /** 已上报错误哈希（简单去重） */
  recentHashes: Set<string>;
}

const config: CollectorConfig = {
  enabled: true,
  debounceMs: 10000,
  maxReportsPerWindow: 10,
};

const state: CollectorState = {
  reportCount: 0,
  lastResetTime: Date.now(),
  recentHashes: new Set(),
};

/**
 * 计算错误简单哈希用于去重
 * @param error - 错误对象
 * @returns 哈希字符串
 */
function hashError(error: Error): string {
  return `${error.name}:${error.message}`.slice(0, 100);
}

/**
 * 检查是否需要限流
 * @returns 是否允许上报
 */
function shouldReport(): boolean {
  const now = Date.now();
  if (now - state.lastResetTime > config.debounceMs) {
    state.reportCount = 0;
    state.lastResetTime = now;
    state.recentHashes.clear();
  }
  return state.reportCount < config.maxReportsPerWindow;
}

/**
 * 格式化错误为日志消息
 * @param error - 错误对象
 * @param context - 附加上下文
 * @returns 格式化后的消息
 */
function formatErrorMessage(error: Error, context?: Record<string, unknown>): string {
  const parts = [
    `Error: ${error.name}: ${error.message}`,
    `Stack: ${error.stack || 'N/A'}`,
  ];

  if (context && Object.keys(context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context)}`);
  }

  return parts.join('\n');
}

/**
 * 上报错误到日志系统
 * @param error - 错误对象
 * @param scope - 错误来源
 * @param context - 上下文
 */
async function reportError(
  error: Error,
  scope: LogScope = 'renderer',
  context?: Record<string, unknown>
): Promise<void> {
  if (!config.enabled) return;

  // 去重检查
  const hash = hashError(error);
  if (state.recentHashes.has(hash)) return;

  // 限流检查
  if (!shouldReport()) return;

  state.recentHashes.add(hash);
  state.reportCount++;

  const message = formatErrorMessage(error, context);
  await logger.error(`[${scope}] ${message}`);
}

/**
 * 初始化全局错误收集
 */
export function initErrorCollector(): void {
  // 1. 全局 JS 运行时错误
  window.onerror = (message, source, lineno, colno, error) => {
    const errorObj = error || new Error(String(message));
    const context = {
      source: source ? source.replace(/.*\//, '') : 'N/A',
      lineno,
      colno,
      type: 'window.onerror',
    };
    reportError(errorObj, 'renderer', context);
    return false;
  };

  // 2. 未处理的 Promise 错误
  window.onunhandledrejection = (event) => {
    const error = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));
    reportError(error, 'renderer', { type: 'unhandledrejection' });
  };
}

/**
 * 主动上报错误
 * @param error - 错误或错误消息
 * @param context - 上下文
 */
export function captureError(
  error: Error | string,
  context?: Record<string, unknown>
): void {
  const errorObj = error instanceof Error ? error : new Error(error);
  reportError(errorObj, 'renderer', context);
}
```

#### 1.2 创建 Vue 错误处理插件

**文件**: `src/plugins/error-handler.ts`

```typescript
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
      info,
    });

    // 继续输出到控制台
    console.error(err);
  };

  // 警告处理（仅在生产环境收集）
  if (import.meta.env.PROD) {
    app.config.warnHandler = (msg, instance) => {
      const componentName = getComponentName(instance);
      captureError(new Error(msg), {
        type: 'vue-warning',
        component: componentName,
      });
    };
  }
}
```

#### 1.3 更新 Vue 入口

**文件**: `src/main.ts`

```typescript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'virtual:uno.css';
import 'ant-design-vue/dist/reset.css';
import App from './App.vue';
import { setupPlugins } from './plugins';
import router from './router';
import { initErrorCollector } from './shared/logger/error-collector';
import { setupErrorHandler } from './plugins/error-handler';
import './assets/styles/index.less';

const app = createApp(App);
const pinia = createPinia();

setupPlugins();

// 初始化错误处理
setupErrorHandler(app);

app.use(pinia);
app.use(router);

// 初始化全局错误收集（在挂载后执行，确保 Vue 已准备好）
initErrorCollector();

app.mount('#app');
```

---

### Phase 2: Preload 脚本错误收集

**文件**: `electron/preload/index.mts`

在 `writeScopedLog` 函数后添加：

```typescript
/**
 * 格式化 Preload 层错误
 * @param error - 错误对象
 * @param context - 上下文
 * @returns 格式化消息
 */
function formatPreloadError(error: Error, context?: Record<string, unknown>): string {
  let message = `Error: ${error.name}: ${error.message}\nStack: ${error.stack || 'N/A'}`;
  if (context) {
    message += `\nContext: ${JSON.stringify(context)}`;
  }
  return message;
}

/**
 * 初始化 Preload 层错误收集
 */
function initPreloadErrorCollector(): void {
  window.onerror = (message, source, lineno, colno, error) => {
    const errorObj = error || new Error(String(message));
    const context = {
      source: source ? source.replace(/.*\//, '') : 'N/A',
      lineno,
      colno,
      type: 'preload.onerror',
    };
    writeScopedLog('preload', 'ERROR', formatPreloadError(errorObj, context));
    return false;
  };

  window.onunhandledrejection = (event) => {
    const error = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));
    writeScopedLog('preload', 'ERROR', formatPreloadError(error, { type: 'unhandledrejection' }));
  };
}
```

在 `contextBridge.exposeInMainWorld` 调用**之前**调用：

```typescript
// 初始化 Preload 错误收集
initPreloadErrorCollector();

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

---

### Phase 3: 主进程错误收集增强

**文件**: `electron/main/modules/logger/service.mts`

在文件末尾添加：

```typescript
// ============================================================
// 主进程错误收集增强
// ============================================================

import { LogLevel } from './types.mjs';

/**
 * 格式化主进程错误
 * @param error - 错误对象
 * @param context - 上下文
 * @returns 格式化消息
 */
function formatMainError(error: Error, context?: Record<string, unknown>): string {
  let message = `Error: ${error.name}: ${error.message}\nStack: ${error.stack || 'N/A'}`;
  if (context) {
    message += `\nContext: ${JSON.stringify(context)}`;
  }
  return message;
}

/**
 * 初始化主进程错误收集
 * 补充 electron-log 未覆盖的 Promise 和 Warning
 */
export function initMainErrorCollector(): void {
  // 未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    writeLog({
      level: LogLevel.ERROR,
      scope: 'main',
      message: formatMainError(error, { type: 'unhandledRejection' }),
    });
  });

  // Node.js 警告
  process.on('warning', (warning) => {
    writeLog({
      level: LogLevel.WARN,
      scope: 'main',
      message: formatMainError(warning, {
        type: 'warning',
        code: warning.code,
        detail: warning.detail,
      }),
    });
  });
}
```

**文件**: `electron/main/index.mts`

在 `initLogger()` 调用后添加：

```typescript
import { initMainErrorCollector } from './modules/logger/service.mjs';

// 初始化日志系统
initLogger();

// 初始化主进程错误收集
initMainErrorCollector();
```

---

## 验证清单

### 功能验证

- [ ] 渲染进程 JS 错误被收集（`window.onerror`）
- [ ] 渲染进程 Promise 错误被收集（`onunhandledrejection`）
- [ ] Vue 组件渲染错误被收集（`errorHandler`）
- [ ] Preload 脚本错误被收集
- [ ] 主进程 Promise 错误被收集
- [ ] 主进程 Warning 被收集
- [ ] 错误日志可在设置页查看

### 边界验证

- [ ] 高频错误被限流（10秒内不超过10条）
- [ ] 重复错误被去重（5分钟内不重复上报）
- [ ] 错误收集器自身错误不影响应用
- [ ] 非 Electron 环境正常运行

---

## 参考文档

- [设计文档](../specs/2026-04-29-js-error-collection-design.md)
- [日志系统设计](../specs/2026-04-29-logger-system-design.md)
