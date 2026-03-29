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

### 类型定义要求
- 所有函数参数必须有明确的类型注解
- 所有函数返回值必须有明确的类型注解
- 接口和类型定义必须使用 `interface` 或 `type` 关键字

## 代码清理规范

### 保留未使用的导入
- ✅ **保留**: 可能会在运行时动态导入的模块
- ✅ **保留**: Tauri 相关的 API 导入（用于条件加载）
- ✅ **保留**: 类型定义的导入

**示例**:
```typescript
// ✅ 保留 - 动态导入
const { open } = await import('@tauri-apps/plugin-dialog')

// ✅ 保留 - 类型定义
import type { DefineComponent } from 'vue'

// ✅ 保留 - Tauri API（条件加载）
import { isTauri } from './platform'
```

### 代码清理原则
- 只删除确认完全不会被使用的代码
- 对于条件性使用的代码，需要检查所有执行路径
- 动态导入的模块不要删除导入语句

## 文件组织规范

## 代码质量要求

### ESLint 和 TypeScript
- 所有代码必须通过 ESLint 检查
- 所有代码必须通过 TypeScript 类型检查
- 使用 `strict` 模式

### 代码风格
- 使用一致的缩进和格式
- 使用有意义的变量和函数命名
- 添加必要的注释说明复杂逻辑

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
