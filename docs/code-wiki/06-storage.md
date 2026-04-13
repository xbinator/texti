# 06-存储与数据库

## 存储分层

Texti 的本地数据分两类：

- Electron 环境（桌面应用）：SQLite + electron-store（加密）
- 非 Electron 环境（浏览器 fallback）：localforage / localStorage

渲染进程的存储层代码统一放在 `src/shared/storage/`，并尽量“依赖 `hasElectronAPI()` 决定走哪条路径”，以保证同一份业务逻辑可运行在 Web 与 Electron。

## BaseStorage（localStorage 封装）

- `src/shared/storage/base/BaseStorage.ts`
- 目标：为 localStorage 类存储提供统一能力：
  - 过期时间（expires）
  - once（读取后删除）
  - merge（对象合并/自定义 merge）
  - 编解码（`manipulator.ts`：serialize/escape/base64 等）

这层更多承担“UI 设置类”的轻量状态（例如折叠状态、临时偏好等）。

## SQLite（主进程）

- 初始化与 schema：`electron/main/modules/database/service.mts`
- DB 文件位置：`app.getPath('userData')/tibis.db`
- 表结构：
  - `provider_settings`：内置 provider 的启用状态与配置覆盖（api_key/base_url/models_json）
  - `custom_providers`：自定义 provider（包含 name/type/logo/models_json 等）
  - `service_models`：某 service_type 对应的 provider_id/model_id/custom_prompt

## Provider 存储（渲染进程）

- 入口：`src/shared/storage/providers/sqlite.ts`
- 对外接口：`providerStorage`
  - `listProviders()`
  - `getProvider(id)`
  - `updateProvider(id, patch)`
  - `toggleProvider(id, enabled)`
  - `createOrUpdateCustomProvider(payload)`
  - `deleteCustomProvider(id)`

关键实现点：

- 内置 provider 来自 `DEFAULT_PROVIDERS`（`src/shared/storage/providers/defaults.ts`）
- 内置 provider 的持久化采用“覆盖层”模式：只存 patch（`provider_settings`），读取时 `mergeProvider(base, stored)` 合并
- 自定义 provider 全量存入 `custom_providers` 表，并标记 `isCustom: true`
- `models_json` 用 JSON 序列化存储（parse/stringify 时 `cloneDeep` 防止外部引用污染）

## Service Model 存储（渲染进程）

- 入口：`src/shared/storage/service-models/sqlite.ts`
- 对外接口：`serviceModelsStorage`
  - `getAllConfigs()`
  - `getConfig(serviceType)`
  - `saveConfig(serviceType, config)`
  - `removeConfig(serviceType)`

关键实现点：

- legacy 迁移：旧版本把 configs 存在 localforage（key：`service_model_configs`）
- Electron 可用时，会在第一次读取时执行一次迁移：
  - 若数据库已有数据：直接清理 legacy
  - 若数据库为空：把 legacy 逐条 upsert 到 `service_models` 后清理 legacy

## 加密存储（主进程）

主进程用 `electron-store` + `safeStorage` 做“加密 key 的持久化与数据加密”：

- `electron/main/modules/store/service.mts`
  - 生成/加载加密 key：`tibis-key.bin`（在 `userData` 下）
  - store 文件：`tibis-secure-store.json`
  - 通过 IPC 暴露 get/set/delete 给渲染进程

## 最近文件与文件存储

- `src/shared/storage/files/*`
  - `recent.ts` 维护最近文件列表
  - Electron 环境：读写走 IPC file/dialog 模块
  - Web 环境：以浏览器能力做降级（下载/选择文件）
