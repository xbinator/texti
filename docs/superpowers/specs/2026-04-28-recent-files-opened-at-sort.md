# 最近文件长期架构方案

## 背景

当前最近文件列表的顺序依赖 `addRecentFile` 的 `unshift`，本质是"最近加入存储"而非"最近打开"。两个问题：

1. 从欢迎页、搜索、菜单或系统入口重新打开已有文件时，列表顺序不更新
2. 排序规则分散在各入口的数组操作中，新增入口容易遗漏，形成隐性心智负担

不把问题视为一次排序修补，而是升级为"文件访问历史"能力的第一步。

---

## 目标

1. 用户侧：单一稳定规则——`最近文件 = 最近显式打开过的文件`
2. 开发侧：低心智负担——新增打开入口时不需要记忆额外的 `touch` 逻辑
3. 未来侧：`openedAt`、`modifiedAt`、`savedAt` 共享同一套数据模型，支撑最近编辑、固定文件、工作区等功能
4. 迁移侧：与旧数据兼容，平滑过渡

## 非目标

- 不引入完整事件日志系统
- 不实现云同步或多设备合并
- 标签页切换不算"再次打开"

---

## 设计原则

1. **最近文件是派生视图，不是数组副作用**——列表由元数据排序计算，不依赖 `unshift` 顺序
2. **打开文件是业务动作，不是路由动作**——`router.push()` 是结果，不是定义
3. **时间字段语义分离**——`openedAt`、`modifiedAt`、`savedAt` 各有边界，不能混用
4. **排序规则集中在一层**——存储在读写层归一化并排序，UI 只表达意图
5. **旧数据不阻塞新模型**——字段缺失不报错，按需自然补齐

---

## 1. 数据结构

### 1.1 文件主记录

以 `StoredFile` 为唯一载体，补齐时间元数据。存储层兼容所有字段的缺失状态，调用层在写入时必须补齐。

```typescript
/**
 * 文件主记录
 * 所有时间字段均为可选——旧数据缺失不报错，写入过程按规则补齐
 */
export interface StoredFile {
  id: string;
  path: string | null;
  content: string;
  savedContent?: string;
  name: string;
  ext: string;

  /** 本地记录首次创建时间（毫秒时间戳）。首次加入存储时写入 */
  createdAt?: number;
  /** 最近一次显式打开时间。从欢迎页/搜索/菜单/系统入口/原生选择器/拖拽打开时写入 */
  openedAt?: number;
  /** 最近一次内容变更时间。用户输入导致内容变化时写入 */
  modifiedAt?: number;
  /** 最近一次成功保存时间。写盘或明确刷新 baseline 时写入 */
  savedAt?: number;

  // --- 以下字段为未来扩展预留，当前不参与业务逻辑 ---
  /** 固定时间。存在时表示文件被固定，展示时分到"已固定"组 */
  pinnedAt?: number;
  /** 所属工作区 ID。用于派生"当前工作区最近文件"视图 */
  workspaceId?: string | null;
}
```

### 1.2 时间字段语义

| 字段 | 触发时机 | 使用场景 |
|---|---|---|
| `createdAt` | 首次加入存储 | 排查、恢复、未来分析 |
| `openedAt` | 显式打开文件 | **最近文件排序的唯一主键** |
| `modifiedAt` | 内容变更 | 未来"继续工作"视图 |
| `savedAt` | 保存成功 | 保存状态、同步判定 |

### 1.3 排序规则（存储层统一执行）

最近文件列表按以下优先级降序排列：

1. `openedAt`（主排序，缺失兜底 `0`）
2. `modifiedAt`（次排序，缺失兜底 `0`）
3. `createdAt`（三级排序，缺失兜底 `0`）
4. 原始顺序（最终稳定兜底）

```typescript
/**
 * 获取按打开时间排序的最近文件列表
 */
async function getAllRecentFiles(): Promise<StoredFile[]> {
  const files = await readRecentFiles();
  return files.sort((a, b) =>
    (b.openedAt ?? 0) - (a.openedAt ?? 0) ||
    (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) ||
    (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
}
```

这样旧数据（缺少 `openedAt`）仍有稳定退化顺序，不产生意外抖动。

### 1.4 未来扩展预留

上述定义已包含 `pinnedAt` 和 `workspaceId` 字段（当前仅作类型占位，不参与业务逻辑）。固定文件展示时先按是否固定分组，组内仍按 `openedAt` 排序，避免语义纠缠。

---

## 2. Store API

### 2.1 分层职责

| 层 | 职责 | 不负责 |
|---|---|---|
| `storage/recent.ts` | 读写文件集合、归一化时间字段、派生排序 | 定义"打开文件"的业务语义 |
| `stores/files.ts` | 统一处理打开/保存/元数据更新、暴露派生视图 | 渲染页面 |
| UI hooks / views | 触发用户意图、展示结果 | 决定时间字段更新规则 |

### 2.2 统一打开用例（推荐长期形态）

当前"打开文件"逻辑散落在 `useOpenFile.ts`、`useFileActive.ts` 等位置。长期方向是收敛为统一 store action，让调用方只需要表达意图：

```typescript
/**
 * 打开文件来源标记（当前仅作预留，不参与业务逻辑）
 */
type OpenSource = 'welcome' | 'search' | 'menu' | 'platform-recent' | 'native-open' | 'drop';

/**
 * 存储层：更新指定文件的 openedAt 并移至首位，返回更新后的文件
 * 时间戳在存储层内部生成，保证调用方不产生时间戳不一致
 */
async function touchRecentFile(id: string): Promise<StoredFile> {
  const files = await readRecentFiles();
  const index = files.findIndex((f) => f.id === id);
  if (index === -1) throw new Error('File not found');

  files[index].openedAt = Date.now();
  const [item] = files.splice(index, 1);
  files.unshift(item);

  await writeRecentFiles(files);
  return item; // splice 后 item 已正确指回被移动的对象
}

/**
 * store action：打开一个已存在的文件
 * 不自行生成时间戳、不手动操作数组——排序由存储层派生结果保证
 */
// 串行化写入，避免并发 read-modify-write 互相覆盖
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);     // 错误传播给调用方
  writeQueue = result.catch(() => {});    // 队列不因单次失败断链
  return result;
}

async function openExistingFile(id: string, source: OpenSource): Promise<void> {
  // 1. 串行写入，时间戳由存储层生成
  await enqueueWrite(() => touchRecentFile(id));

  // 2. 重新派生内存数组，彻底放弃 unshift 维护
  this.recentFiles = await getAllRecentFiles();

  // 3. 同步平台最近文件
  await this.syncPlatformRecentFiles();

  // 4. 跳转编辑器
  router.push({ name: 'editor', params: { id } });
}

/**
 * 通过文件路径打开或创建文件
 */
// 防止 check-then-act 竞态：正在处理中的路径集合
const inflightPaths = new Set<string>();

async function openOrCreateByPath(path: string, source: OpenSource): Promise<void> {
  if (inflightPaths.has(path)) return; // 忽略重复触发
  inflightPaths.add(path);
  try {
    const existing = await this.getFileByPath(path);
    if (existing) {
      await this.openExistingFile(existing.id, source);
      return;
    }
    // 创建并打开——新建分支同样走串行队列
    const file = await native.readFileByPath(path);
    const id = nanoid();
    const now = Date.now();
    await enqueueWrite(() => this.addFile({ ...file, id, createdAt: now, openedAt: now }));
    this.recentFiles = await getAllRecentFiles();
    await this.syncPlatformRecentFiles();
    router.push({ name: 'editor', params: { id } });
  } finally {
    inflightPaths.delete(path);
  }
}

/**
 * 创建全新文件并打开
 */
async function createAndOpen(file: StoredFile, source: 'new' | 'drop' | 'duplicate'): Promise<void> {
  const now = Date.now();
  await enqueueWrite(() => this.addFile({ ...file, createdAt: now, openedAt: now }));
  this.recentFiles = await getAllRecentFiles();
  await this.syncPlatformRecentFiles();
  router.push({ name: 'editor', params: { id: file.id } });
}
```

### 2.3 保存路径不更新 `openedAt`

自动保存和手动保存只能更新 `savedAt`，不能碰 `openedAt`：

```typescript
/**
 * 更新文件（保存路径）
 * 仅更新 savedContent 和 savedAt，不改变 openedAt
 */
async function updateFile(id: string, updates: Partial<StoredFile>): Promise<void> {
  // 合并时显式排除 openedAt，由 openExistingFile 统一管理
  const file = await recentFilesStorage.updateRecentFile(id, {
    ...updates,
    // 不传 openedAt，存储层会保留原有值
  });
  // ...
}
```

### 2.4 存储层 `updateRecentFile` 合并规则

```typescript
/**
 * 更新存储中的文件记录
 * 关键规则：openedAt 由打开路径统一管理，保存路径不覆盖
 * 防御逻辑：忽略值为 0 的 openedAt（可能来自归一化结果的回传）
 */
async function updateRecentFile(id: string, updates: Partial<StoredFile>): Promise<StoredFile> {
  const files = await readRecentFiles();
  const index = files.findIndex((f) => f.id === id);
  if (index === -1) throw new Error('File not found');

  files[index] = {
    ...files[index],
    ...updates,
    // 只在调用方显式传入非零值时更新，否则保留原值
    openedAt: (updates.openedAt && updates.openedAt > 0)
      ? updates.openedAt
      : files[index].openedAt,
  };

  await writeRecentFiles(files);
  return files[index];
}
```

### 2.5 调用方视角

各入口不再需要手动 touch：

```typescript
// 欢迎页点击最近文件
function handleRecentClick(id: string) {
  filesStore.openExistingFile(id, 'welcome');
}

// 搜索框选中
function handleSearchSelect(file: StoredFile) {
  filesStore.openExistingFile(file.id, 'search');
}

// 菜单/快捷键打开
emitter.on('file:open', async () => {
  const file = await native.openFile();
  if (file.path) filesStore.openOrCreateByPath(file.path, 'native-open');
});

// 系统最近文件入口
emitter.on('file:openRecent', (id: string) => {
  filesStore.openExistingFile(id, 'platform-recent');
});

// 拖拽打开
function handleDrop(path: string) {
  filesStore.openOrCreateByPath(path, 'drop');
}
```

---

## 3. 迁移细节

### 3.1 旧数据兼容规则

旧数据中所有时间字段都可能缺失。读取时兜底策略：

| 字段 | 缺失时的行为 |
|---|---|
| `createdAt` | 排序中按 `0` 处理。首次被 `addFile` 写入时补为当前时间 |
| `openedAt` | 排序中按 `0` 处理，自然排到末尾。文件下次被显式打开时补为当前时间 |
| `modifiedAt` | 排序中按 `0` 处理。文件下次被编辑时补为当前时间 |
| `savedAt` | 排序中按 `0` 处理。文件下次被保存时补为当前时间 |

### 3.2 不依赖批量迁移

不写一次性全库迁移脚本，采用"按需归一化"：

1. 读取时类型上允许字段缺失，逻辑上以 `?? 0` 兜底
2. 写入时（`addFile`、`openExistingFile`、`updateRecentFile`）补全能确定的字段
3. 文件下次被操作时自然获得正确时间戳

优势：零停机、零风险、旧数据渐进升级。

### 3.3 排序真相来源

**数组位置不是事实，时间字段才是事实。** 存储层 `touchRecentFile` 中的 `unshift` 是写入优化（减少下次读取的排序开销），不作为排序语义的来源。store 层在每次写入后从 `getAllRecentFiles` 重新派生内存数组，不自行维护数组顺序。

### 3.4 存储层归一化

在 `getAllRecentFiles` 中统一执行：

```typescript
async function getAllRecentFiles(): Promise<StoredFile[]> {
  const files = await readRecentFiles();

  // 归一化：确保时间字段至少为有效数值
  const normalized = files.map((f) => ({
    ...f,
    openedAt: f.openedAt ?? 0,
    modifiedAt: f.modifiedAt ?? 0,
    createdAt: f.createdAt ?? 0,
  }));

  // 派生排序
  return normalized.sort((a, b) =>
    b.openedAt - a.openedAt ||
    b.modifiedAt - a.modifiedAt ||
    b.createdAt - a.createdAt
  );
}
```

归一化结果仅用于排序和返回，不反写存储（避免未实际变化的数据被标记为"已修改"）。如果调用方将归一化后的对象（`openedAt: 0`）传回 `updateRecentFile`，合并规则会忽略值 `≤0` 的 `openedAt`，不会覆盖有效数据。

---

## 4. 测试清单

### 4.1 核心行为测试

| 场景 | 预期 |
|---|---|
| 从欢迎页点击已有文件 | 该文件 `openedAt` 更新为当前时间，排到列表第一位 |
| 从搜索框选中已有文件 | 同上 |
| 通过 `file:open` 菜单/快捷键打开已有文件 | 同上 |
| 通过 `file:openRecent` 系统入口打开已有文件 | 同上 |
| 通过原生文件选择器打开已有文件 | 同上 |
| 拖拽到窗口打开已有路径文件 | 同上 |
| 打开全新文件（新建/拖入新路径） | 创建记录，`createdAt` 和 `openedAt` 均为当前时间，排第一位 |
| 编辑文件内容后自动保存触发 | `savedAt` 更新，`openedAt` 不变，排序不变 |
| 手动保存（Ctrl+S）触发 | `savedAt` 更新，`openedAt` 不变，排序不变 |
| 在编辑器中切换标签页 | 不触发任何时间字段更新 |
| 连续快速打开多个已有文件 | 最后打开的文件排第一，所有文件记录完整 |
| 冷启动加载无时间字段的旧数据 | 旧文件排在列表末尾，不报错，不崩溃 |

### 4.2 回归测试

| 场景 | 预期 |
|---|---|
| 旧数据文件被打开后 | `openedAt` 自动补齐，下次冷启动排序正确 |
| 旧数据文件被保存后 | `savedAt` 自动补齐，`openedAt` 不受影响 |
| Electron 和 Web 两端行为 | 存储读写逻辑一致，仅底层 API 不同 |
| 平台最近文件（Dock/Taskbar 菜单） | 同步内容不受 `openedAt` 影响，仅 `id/name/path` |

### 4.3 边界与异常

| 场景 | 预期 |
|---|---|
| `openedAt` 为 `0` 的旧数据 | 按规则排在末尾 |
| 同时 `openedAt` 相同的两个文件 | 按 `modifiedAt`、`createdAt`、原始顺序稳定排序 |
| 存储写入失败（如磁盘满） | 不丢失已有数据，UI 排序保持上次成功状态（需配合 `enqueueWrite` 的错误隔离实现） |
| 快速连续调用同一 `openExistingFile(id)` | 幂等，`openedAt` 更新为最后一次调用的时间 |
| `openOrCreateByPath` 同路径快速触发两次 | 第二次调用被 `inflightPaths` 忽略，只创建一条记录 |
| `enqueueWrite` 内写入失败 | 调用方收到错误，队列继续处理后续任务，不卡死 |

---

## 实施路径

### 阶段 1：建立最小闭环（本期）

1. `StoredFile` 增加 `createdAt`、`openedAt`、`modifiedAt`、`savedAt` 可选字段（`pinnedAt`、`workspaceId` 预留）
2. `getAllRecentFiles` 增加多级排序逻辑，同时兼容旧数据
3. `updateRecentFile` 增加 `openedAt` 保留逻辑（同时忽略值 ≤0 的防御回传）
4. 存储层新增 `touchRecentFile(id)`——内部生成时间戳、重排数组、写回存储
5. `stores/files.ts` 新增 `openExistingFile`、`openOrCreateByPath`、`createAndOpen` 三个 action
6. store 层加泛型串行写队列 `enqueueWrite<T>`——错误传播给调用方、队列不因单次失败断链
7. `openOrCreateByPath` 和 `createAndOpen` 的新建分支统一走写队列
8. 所有外部打开入口改为调用统一 action
9. 确认自动/手动保存路径不会误更新 `openedAt`

### 阶段 2：补齐行为语义

1. 内容变更时更新 `modifiedAt`
2. 显式保存成功时更新 `savedAt`
3. 平台最近文件同步改为依赖统一派生结果
4. 围绕 usecase 写自动化测试

### 阶段 3：面向未来扩展

1. 增加 `pinnedAt` 支持固定文件
2. 增加 `workspaceId` 支持项目内最近文件
3. 基于 `modifiedAt` 提供"继续工作"视图

---

## 风险

1. **初期设计成本高于直接修补**——需要先定义语义和边界再动手
2. **必须一次性完成调用收口**——只加字段但不统一 usecase 会出现半成品状态
3. **整表读写仍存在并发窗口**——`localforage` / Electron store 是单 key 整体写回。阶段 1 通过 `enqueueWrite` 串行化写入缓解，后续若需更强一致性可考虑细粒度 key 拆分
