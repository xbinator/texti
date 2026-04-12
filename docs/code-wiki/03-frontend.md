# 03-前端（Vue）模块

## 入口与全局装配

- 入口：`src/main.ts`
  - 创建应用、安装 Pinia 与 Router、加载全局样式
- 根组件：`src/App.vue`
  - `ConfigProvider`（Ant Design Vue）
  - `RouterView`（页面容器）
  - `useSettingStore().init()` 初始化主题/标题等全局状态

## 路由

- 路由入口：`src/router/index.ts`
- 路由聚合：`src/router/routes/index.ts`
  - 使用 `import.meta.glob('./modules/*.ts', { eager: true })` 聚合模块路由
  - 当前主要模块：
    - `src/router/routes/modules/editor.ts`
    - `src/router/routes/modules/settings.ts`

## 状态管理（Pinia）

### setting store

- `src/stores/setting.ts`
- 职责：
  - 主题（dark/light）
  - 应用标题等 UI 级设置

### service-model store

- `src/stores/service-model.ts`
- 职责：
  - Service Model 配置的读取与保存委托给存储层（`serviceModelsStorage`）
  - 提供“可用配置”判断：provider 必须启用且存在 apiKey
  - 维护设置页折叠状态（local storage）

### tabs store

- `src/stores/tabs.ts`
- 职责：
  - 编辑器的 tab/文件打开状态（用于多文档工作流扩展）

## 页面模块

### 编辑器页面（Editor）

- 页面入口：`src/views/editor/index.vue`
- 组成：
  - `BEditor`：编辑器核心（富文本/源码切换、目录、搜索等）
  - 页面级 hooks：`src/views/editor/hooks/*`
    - `useAutoSave.ts`：自动保存
    - `useFileActive.ts`：文件激活/切换
    - `useEditActive.ts`：编辑状态管理
    - `useHelp.ts`：快捷键与帮助

### 设置页面（Settings）

#### Provider（服务商）设置

- 页面入口：`src/views/settings/provider/index.vue`
- 共享状态 hook：`src/views/settings/provider/hooks/useProviders.ts`
- 核心能力：
  - 加载 provider 列表（内置 + 自定义）
  - 保存 API Key/Base URL
  - 模型列表维护
  - 自定义 provider CRUD

#### Service Model（服务模型）设置

- 页面入口：`src/views/settings/service-model/index.vue`
- 能力：
  - 为某个“业务服务类型”（如写作/总结/翻译等）选择 provider+model+customPrompt
  - 写入 `serviceModelsStorage`

## 平台能力抽象（Electron/Web）

- `src/shared/platform/native/index.ts`
  - `native = hasElectronAPI() ? new ElectronNative() : new WebNative()`
- `src/shared/platform/native/electron.ts`：Electron 能力实现（通过 `getElectronAPI()` 调用 IPC）
- `src/shared/platform/native/web.ts`：Web fallback（input file / download 等）

## AI 调用（渲染进程）

- `src/hooks/useAgent.ts`
- 两个入口：
  - `agent.invoke(payload)`：非流式 invoke
  - `agent.stream(payload)`：流式 stream（订阅 chunk/complete/error）
- 关键依赖：
  - provider 配置来自 `providerStorage.getProvider(providerId)`
  - IPC 调用来自 `electronAPI.aiInvoke/aiStream`
