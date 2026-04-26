# 项目代码规范

## TypeScript 类型规范

### 禁止使用 `any` 类型
- ❌ **禁止**: 使用 `any` 类型
- ✅ **推荐**: 使用具体类型或 `unknown` 类型

**错误示例**:
```typescript
const data: any = fetchData()
const window = (window as any).__TAURI__
```

**正确示例**:
```typescript
interface WindowWithTauri extends Window {
  __TAURI__?: unknown
}
const window = (window as WindowWithTauri).__TAURI__

// 或使用类型断言
const data = fetchData() as DataType
```

### 组件 Ref 类型定义
使用 `InstanceType<typeof ComponentName>` 获取组件实例类型，而非手动定义接口：

**错误示例**:
```typescript
const conversationRef = ref<{ scrollToBottom: (options?: { behavior?: 'smooth' | 'auto' }) => void } | null>(null);
```

**正确示例**:
```typescript
const conversationRef = ref<InstanceType<typeof ConversationView>>();
```

### 类型定义要求
- 所有函数参数必须有明确的类型注解
- 所有函数返回值必须有明确的类型注解
- 接口和类型定义必须使用 `interface` 或 `type` 关键字

## 代码清理规范

### 保留未使用的导入
- ✅ **保留**: 可能会在运行时动态导入的模块
- ✅ **保留**: 类型定义的导入

**示例**:
```typescript
// ✅ 保留 - 动态导入
const { open } = await import('@tauri-apps/plugin-dialog')

// ✅ 保留 - 类型定义
import type { DefineComponent } from 'vue'
```

### 代码清理原则
- 只删除确认完全不会被使用的代码
- 对于条件性使用的代码，需要检查所有执行路径
- 动态导入的模块不要删除导入语句

## 文件组织规范

### 组件引入规范
- **B 开头的组件**已通过 `unplugin-vue-components` 全局自动引入，无需手动 import
- 手动引入场景：类型定义、动态导入、编辑器内置组件

### 示例
```typescript
// ✅ 无需手动引入（已全局注册）
import { BButton, BModal } from '@/components'

// ✅ 需要手动引入的场景
import type { BButtonProps } from '@/components' // 类型定义
const { open } = await import('@/components/BModal') // 动态导入
```

## 注释规范

### 基本要求
- **所有代码必须有注释**，不允许出现无注释的函数、类、接口或复杂逻辑块
- 注释必须准确描述代码的意图，而不是简单重复代码本身
- 注释需要随代码同步更新，禁止出现过时或误导性注释

### 文件头注释
每个文件顶部必须包含文件说明注释：

```typescript
/**
 * @file 文件名
 * @description 文件功能描述
 */
```

### 函数 / 方法注释
所有函数和方法必须使用 JSDoc 格式注释：

```typescript
/**
 * 获取用户信息
 * @param userId - 用户 ID
 * @returns 用户信息对象，不存在时返回 null
 */
async function getUserInfo(userId: string): Promise<UserInfo | null> {
  // ...
}
```

### 接口 / 类型注释
所有接口和类型定义必须添加说明：

```typescript
/**
 * 用户信息
 */
interface UserInfo {
  /** 用户唯一标识 */
  id: string
  /** 用户名 */
  name: string
  /** 注册时间（时间戳） */
  createdAt: number
}
```

### 复杂逻辑注释
对于复杂的业务逻辑，必须在关键步骤添加行内注释：

```typescript
async function syncData() {
  // 1. 从本地缓存读取上次同步时间
  const lastSyncTime = await getLastSyncTime()

  // 2. 拉取服务端增量数据
  const delta = await fetchDelta(lastSyncTime)

  // 3. 合并数据，以服务端为准（本地修改会被覆盖）
  const merged = mergeData(localData, delta)

  // 4. 写入本地数据库并更新同步时间
  await saveLocal(merged)
  await updateLastSyncTime(Date.now())
}
```

### 临时代码 / 待办注释
- 使用 `// TODO:` 标记待完成的功能
- 使用 `// FIXME:` 标记已知问题需要修复
- 使用 `// HACK:` 标记临时方案，需说明原因和后续处理计划

```typescript
// TODO: 后续支持批量操作
// FIXME: 当列表为空时会触发越界错误
// HACK: 临时绕过接口限制，等后端修复后移除
```

### 禁止事项
- ❌ 禁止无意义注释，如 `// 定义变量 i`
- ❌ 禁止注释掉的废弃代码长期存在，应直接删除
- ❌ 禁止用注释代替清晰的命名，命名本身应具有可读性

## 代码质量要求

### ESLint 和 TypeScript
- 所有代码必须通过 ESLint 检查
- 所有代码必须通过 TypeScript 类型检查
- 使用 `strict` 模式

### 代码风格
- 使用一致的缩进和格式
- 使用有意义的变量和函数命名
- **所有函数、接口、复杂逻辑必须添加注释**，具体格式见[注释规范](#注释规范)

## Changelog 日志规范

### 改动记录要求
- 每次代码改动必须记录到 changelog 日志中
- 记录内容包括：改动类型、改动描述

### 日志文件格式
- 日志文件按日期命名：`YYYY-MM-DD.md`
- 放置在 `changelog/` 目录下

### 日志内容格式
```markdown
# YYYY-MM-DD

## Added
- [新功能或新特性描述]

## Changed
- [修改内容描述]

## Removed
- [删除内容描述]

## Features
- [特性描述]
```

### 生成规范
- 每次提交代码前，检查是否存在当天的 changelog 文件
- 如果不存在，生成新的 changelog 文件
- 如果存在，在对应改动类型下添加记录
