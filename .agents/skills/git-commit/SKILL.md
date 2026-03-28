---
name: git-commit
description: "智能 Git 提交助手。自动分析代码变更，按功能模块分类提交，生成规范的中文提交信息。支持 Conventional Commits 规范，自动识别变更类型（feat/fix/refactor/style/docs/test/chore），按功能模块分组提交，避免单次提交过多不相关变更。触发词：git commit、提交代码、commit、代码提交、分批提交"
license: MIT
allowed-tools: Bash
---

# Git Commit - 智能提交助手

智能分析代码变更，按功能模块分类提交，生成规范的中文提交信息。遵循 Conventional Commits 规范，确保每次提交原子化、有意义。

## 重要说明

⚠️ **所有 commit 信息必须使用中文编写**

- 提交描述使用中文
- 提交正文使用中文
- 只有 type 和 scope 保持英文

## When to Apply

This Skill should be used when the task involves **Git commit operations, code change analysis, or organizing commits by functionality**.

### Must Use

- 用户请求提交代码（git commit、提交代码等）
- 需要分析当前代码变更并分类提交
- 需要生成规范的提交信息
- 需要将大量变更按功能模块分批提交
- 需要修改或优化已有的提交历史

### Recommended

- 代码审查前需要整理提交历史
- 功能开发完成后需要规范化提交
- 多个功能同时开发需要分离提交
- 需要生成 CHANGELOG 相关的提交信息

### Skip

- 纯粹查看 git 状态或日志
- 不涉及提交操作的 git 命令
- 已经明确知道如何提交的情况

**Decision criteria**: If the task involves **creating, modifying, or organizing git commits**, this Skill should be used.

## Conventional Commit Format

```
<type>[optional scope]: <中文描述>

[可选正文]

[可选脚注]
```

## Commit Types

| Type | 说明 | 中文示例 |
|------|------|----------|
| `feat` | 新功能 | feat: 添加用户登录页面 |
| `fix` | Bug 修复 | fix: 修复登录验证错误 |
| `refactor` | 代码重构（不改变功能） | refactor: 提取验证逻辑 |
| `style` | 代码格式（不影响逻辑） | style: 格式化代码 |
| `docs` | 文档变更 | docs: 更新安装文档 |
| `test` | 测试相关 | test: 添加认证模块单元测试 |
| `chore` | 构建/工具/依赖 | chore: 更新依赖版本 |
| `perf` | 性能优化 | perf: 优化数据库查询 |
| `ci` | CI/CD 配置 | ci: 添加 GitHub Actions 工作流 |
| `revert` | 回滚提交 | revert: 回滚用户功能 |

## Breaking Changes

```bash
# 类型后加感叹号
feat!: 移除废弃的 API 接口

# BREAKING CHANGE 脚注
feat: 允许配置继承其他配置

BREAKING CHANGE: `extends` 键的行为已更改
```

## Workflow

### 1. Analyze Diff

```bash
# 如果有已暂存的文件，使用暂存区差异
git diff --staged

# 如果没有暂存，使用工作区差异
git diff

# 同时检查状态
git status --porcelain
```

**分析要点**：
- 变更文件数量和类型
- 变更所属功能模块
- 变更类型（新增/修改/删除）
- 是否有相关联的变更

### 2. Stage Files (if needed)

如果需要分组提交：

```bash
# 暂存特定文件
git add path/to/file1 path/to/file2

# 按模式暂存
git add *.test.*
git add src/components/*

# 交互式暂存
git add -p
```

**安全检查**：
- ❌ 永远不要提交密钥文件（.env, credentials.json, private keys）
- ❌ 检查是否包含敏感信息

### 3. Generate Commit Message

分析 diff 确定：

- **Type**: 这是什么类型的变更？
- **Scope**: 影响哪个模块/区域？
- **Description**: 一句话总结变更内容（现在时、祈使语气、<72 字符）

**中文描述规则**：
- 使用现在时："添加" 而非 "添加了"
- 使用祈使语气："修复错误" 而非 "修复了错误"
- 简洁明了，不超过 50 个汉字

### 4. Execute Commit

```bash
# 单行提交
git commit -m "<type>[scope]: <中文描述>"

# 多行提交（带正文/脚注）
git commit -m "$(cat <<'EOF'
<type>[scope]: <中文描述>

<可选正文>

<可选脚注>
EOF
)"
```

## Decision Tree

```
开始
  │
  ├─ 是否有变更？
  │   ├─ 否 → 提示"没有需要提交的变更"
  │   └─ 是 → 继续
  │
  ├─ 变更文件数量？
  │   ├─ 1-3 个文件 → 单次提交
  │   └─ 4+ 个文件 → 分析是否需要分批提交
  │
  ├─ 变更是否属于同一功能？
  │   ├─ 是 → 单次提交
  │   └─ 否 → 按功能模块分批提交
  │
  ├─ 确定提交类型
  │   ├─ 新增功能 → feat
  │   ├─ 修复 Bug → fix
  │   ├─ 代码重构 → refactor
  │   ├─ 格式调整 → style
  │   ├─ 文档变更 → docs
  │   ├─ 测试相关 → test
  │   └─ 构建/工具 → chore
  │
  └─ 生成中文提交信息并提交
```

## Common Patterns

### Pattern 1: Single Feature Commit

**场景**：开发一个新功能，涉及多个文件但属于同一功能

**示例**：
```bash
# 文件变更
src/api/user.ts        # 新增用户 API
src/types/user.ts      # 新增用户类型
src/views/UserPage.vue # 新增用户页面

# 提交
git add src/types/user.ts src/api/user.ts src/views/UserPage.vue
git commit -m "feat(user): 添加用户管理页面"
```

### Pattern 2: Multiple Feature Commits

**场景**：同时开发了多个功能

**示例**：
```bash
# 文件变更
src/api/auth.ts        # 认证功能
src/api/user.ts        # 用户功能
src/views/Login.vue    # 登录页面
src/views/UserPage.vue # 用户页面

# 分批提交
# 第一批：认证功能
git add src/api/auth.ts src/views/Login.vue
git commit -m "feat(auth): 添加登录功能"

# 第二批：用户功能
git add src/api/user.ts src/views/UserPage.vue
git commit -m "feat(user): 添加用户管理页面"
```

### Pattern 3: Feature + Refactor

**场景**：开发新功能时顺便重构了相关代码

**示例**：
```bash
# 文件变更
src/api/user.ts        # 新增 API（功能）
src/utils/helper.ts    # 重构工具函数（重构）

# 分批提交
# 第一批：重构
git add src/utils/helper.ts
git commit -m "refactor: 提取通用验证逻辑"

# 第二批：新功能
git add src/api/user.ts
git commit -m "feat(user): 添加用户资料 API"
```

### Pattern 4: Feature + Style

**场景**：开发新功能时调整了代码格式

**示例**：
```bash
# 文件变更
src/views/UserPage.vue # 新增页面（功能）
src/views/Login.vue    # 格式调整（样式）

# 分批提交
# 第一批：样式调整
git add src/views/Login.vue
git commit -m "style: 格式化登录页面代码"

# 第二批：新功能
git add src/views/UserPage.vue
git commit -m "feat(user): 添加用户管理页面"
```

### Pattern 5: Dependency Updates

**场景**：更新依赖并适配代码

**示例**：
```bash
# 文件变更
package.json           # 更新依赖
src/api/request.ts     # 适配新版本 API

# 分批提交
# 第一批：依赖更新
git add package.json package-lock.json
git commit -m "chore: 更新 axios 到 v1.0.0"

# 第二批：代码适配
git add src/api/request.ts
git commit -m "refactor(api): 适配 axios v1.0.0 API 变更"
```

### Pattern 6: With Body and Footer

**场景**：需要详细说明变更原因

**示例**：
```bash
git commit -m "$(cat <<'EOF'
fix(api): 解决用户服务超时问题

将用户资料 API 的超时时间从 5 秒增加到 10 秒，
以处理慢速网络连接的情况。

Closes #234
EOF
)"
```

## Best Practices

### DO ✅

1. **原子化提交**
   - 每次提交只包含一个逻辑变更
   - 提交后代码应该能正常运行
   - 提交应该可以独立回滚

2. **清晰的中文提交信息**
   - 准确描述变更内容
   - 说明变更原因（在 body 中）
   - 关联相关 Issue

3. **合理的提交顺序**
   - 基础设施变更优先
   - 依赖项更新优先
   - 功能实现按依赖顺序

4. **适当的提交粒度**
   - 避免过大提交（100+ 行变更）
   - 避免过小提交（单个空格修改）
   - 以功能单元为标准

### DON'T ❌

1. **避免混合提交**
   - ❌ 一次提交包含新功能和 Bug 修复
   - ❌ 一次提交包含多个不相关功能
   - ❌ 一次提交包含功能和样式调整

2. **避免模糊提交**
   - ❌ "修复 bug"
   - ❌ "更新代码"
   - ❌ "WIP"
   - ❌ "."

3. **避免破坏性提交**
   - ❌ 提交后代码无法编译
   - ❌ 提交后测试无法通过
   - ❌ 提交包含敏感信息

4. **避免过度拆分**
   - ❌ 同一功能的多个文件分开提交
   - ❌ 一个函数的修改拆成多次提交

## Git Safety Protocol

### 安全规则

- ❌ **永远不要** 更新 git 配置
- ❌ **永远不要** 在没有明确请求的情况下运行破坏性命令（--force, hard reset）
- ❌ **永远不要** 跳过钩子（--no-verify），除非用户明确要求
- ❌ **永远不要** 强制推送到 main/master 分支
- ❌ **永远不要** 提交密钥、凭证等敏感信息

### 提交失败处理

如果提交因钩子失败：
1. 修复问题
2. 创建新的提交（不要使用 --amend）
3. 确保每次提交都是独立的

## Scope Examples

常用 scope 参考：

| Scope | 说明 | 示例文件 |
|-------|------|----------|
| `api` | API 接口 | `src/api/**`, `src/services/**` |
| `auth` | 认证授权 | `src/auth/**`, `src/middleware/auth.*` |
| `ui` | UI 组件 | `src/components/**` |
| `views` | 页面视图 | `src/views/**`, `src/pages/**` |
| `utils` | 工具函数 | `src/utils/**`, `src/helpers/**` |
| `types` | 类型定义 | `src/types/**`, `*.d.ts` |
| `config` | 配置文件 | `*.config.js`, `*.config.ts` |
| `deps` | 依赖管理 | `package.json`, `requirements.txt` |
| `build` | 构建相关 | `webpack.*`, `vite.*`, `rollup.*` |
| `ci` | CI/CD | `.github/**`, `.gitlab-ci.yml` |
| `docs` | 文档 | `README.md`, `docs/**` |

## Special Cases

### Case 1: Merge Conflict Resolution

```bash
# 解决冲突后
git add <resolved-files>
git commit -m "chore: 解决与主分支的合并冲突"
```

### Case 2: Revert Commit

```bash
# 回滚最近一次提交
git revert HEAD

# 回滚指定提交
git revert <commit-hash>
```

### Case 3: Amend Last Commit

```bash
# 修改最后一次提交（未 push）
git add <forgotten-files>
git commit --amend --no-edit

# 修改提交信息
git commit --amend -m "新的提交信息"
```

### Case 4: Split Last Commit

```bash
# 撤销最后一次提交，保留变更
git reset --soft HEAD~1

# 重新分批提交
git add <files-for-commit-1>
git commit -m "第一次提交"

git add <files-for-commit-2>
git commit -m "第二次提交"
```

### Case 5: Interactive Rebase

```bash
# 交互式变基最近 3 次提交
git rebase -i HEAD~3

# 在编辑器中可以：
# - squash: 合并多个提交
# - reword: 修改提交信息
# - edit: 修改提交内容
# - drop: 删除提交
```

## Integration with Workflow

### With Branching Strategy

```bash
# 功能分支
git checkout -b feature/user-auth
# ... 开发 ...
git commit -m "feat(auth): 添加 OAuth2 登录"

# 修复分支
git checkout -b fix/login-timeout
# ... 修复 ...
git commit -m "fix(auth): 解决超时问题"
```

### With Code Review

```bash
# 提交前检查
npm run lint
npm run test
npm run build

# 确认无误后提交
git add .
git commit -m "feat: 添加新功能"
```

### With Changelog

```bash
# 自动生成 CHANGELOG
# 遵循 Conventional Commits 可以使用工具自动生成

# 安装工具
npm install -g conventional-changelog-cli

# 生成 CHANGELOG
conventional-changelog -p angular -i CHANGELOG.md -s
```

## Quick Reference Card

```bash
# 查看状态
git status

# 查看差异
git diff
git diff --staged

# 添加文件
git add <file>
git add .
git add -p

# 提交（中文）
git commit -m "type(scope): 中文描述"
git commit -m "type(scope): 中文描述" -m "中文正文"

# 查看历史
git log --oneline
git log --graph --oneline

# 修改提交
git commit --amend
git rebase -i HEAD~n

# 回滚
git revert <commit>
git reset --soft HEAD~1
```

## Example Workflow

假设当前有以下变更：

```
Changes not staged for commit:
  modified:   package.json
  modified:   src/api/auth.ts
  modified:   src/api/user.ts
  new file:   src/types/auth.ts
  new file:   src/views/Login.vue
  modified:   src/views/UserPage.vue
  modified:   .prettierrc
```

**分析**：
1. `package.json` - 依赖更新
2. `.prettierrc` - 配置变更
3. `src/types/auth.ts` + `src/api/auth.ts` + `src/views/Login.vue` - 认证功能
4. `src/api/user.ts` + `src/views/UserPage.vue` - 用户功能

**分批提交**：

```bash
# 第一批：配置和依赖
git add package.json package-lock.json .prettierrc
git commit -m "chore: 更新依赖和 prettier 配置"

# 第二批：认证功能
git add src/types/auth.ts src/api/auth.ts src/views/Login.vue
git commit -m "feat(auth): 添加支持 OAuth2 的登录页面"

# 第三批：用户功能
git add src/api/user.ts src/views/UserPage.vue
git commit -m "feat(user): 添加用户资料页面"
```

**结果**：3 个清晰的原子提交，每个提交都有明确的目的和范围，提交信息使用中文描述。
