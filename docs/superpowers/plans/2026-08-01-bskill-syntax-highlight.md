# BSkill 文件预览语法高亮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 BSkill 文件预览组件按扩展名自动添加语法高亮，复用项目已有的 lowlight 高亮器与 hljs 主题样式。

**Architecture:** 复用 `src/components/BMessage/utils/codeHighlight.ts` 的 `highlightMessageCode` 高亮器（已含 LRU 缓存、安全节点转换）。新增扩展名→语言标签推断工具；在 `BSkill/index.vue` 内用 `defineComponent + h` 定义局部递归渲染组件 `CodeHighlightNode`（与 BMessage 的 `CodeBlockNode.vue` 同一模式，保证 scoped 样式自动生效）；通过 `@import` 复用 `markdown.less` 的 `.code-highlight()` mixin 套色；超过 200KB 的文件跳过高亮。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript + lowlight（已有）+ Less mixin + Vitest

## Global Constraints

- 禁止使用 `any` 类型（AGENTS.md）
- 异步场景使用 `asyncTo(promise)` 归一化错误（AGENTS.md）；本计划无新增异步逻辑
- B 开头组件全局自动引入，无需手动 import；但 `CodeHighlightNode` 是局部组件，需局部定义
- 样式禁止用 `&__xxx` 拼接 BEM 子类名；`&` 可用于伪类/组合
- 所有函数、接口、复杂逻辑必须有 JSDoc 注释；文件头需 `@file` `@description`
- 提交前需通过 `pnpm lint` / `pnpm lint:style` / `pnpm exec tsc --noEmit`
- 测试位于 `test/` 目录，`include: ['test/**/*.test.ts']`，默认 environment 为 `node`
- 代码改动需记录到 `changelog/YYYY-MM-DD.md`

## 与 Spec 的两处细化

1. **`CodeHighlightNode` 改为局部组件**：spec 原计划新建独立 `CodeHighlightNode.vue`。经核查 `src/components/BMessage/components/CodeBlockNode.vue:64-85`，项目已有同名的局部递归组件（用 `defineComponent + h` 定义在父组件内）。采用同一模式可让父组件 `<style scoped>` 的 `.hljs-*` 选择器自动作用于递归渲染的 `<span>`（避免独立子组件导致的 scoped 隔离问题），且与项目惯例一致。不新建独立 `.vue` 文件。

2. **扩展名映射到规范语言名**：spec 原说"传入原始标签，依赖 `highlightMessageCode` 内部 `LANGUAGE_ALIASES` 归一化"。但 `LANGUAGE_ALIASES`（`src/components/BMessage/utils/codeHighlight.ts:68-87`）不完整（如缺 `cs`→`csharp`、`go`、`cpp` 等）。为稳健起见，`EXTENSION_LANGUAGE_MAP` 直接映射到 lowlight `common` 已注册的规范语言名（如 `.ts`→`'typescript'`、`.cs`→`'csharp'`），不依赖别名表。

---

### Task 1: 扩展名语言推断工具 languageDetect.ts

**Files:**
- Create: `src/components/BSkill/utils/languageDetect.ts`
- Test: `test/components/BSkill/languageDetect.test.ts`

**Interfaces:**
- Produces: `detectLanguage(filePath: string): string` —— 返回 lowlight `common` 规范语言名（如 `'typescript'`、`'xml'`、`'markdown'`），未识别返回空字符串

- [ ] **Step 1: 写失败测试**

创建 `test/components/BSkill/languageDetect.test.ts`：

```typescript
/**
 * @file languageDetect.test.ts
 * @description 验证 BSkill 文件扩展名到高亮语言名的推断。
 */
import { describe, expect, it } from 'vitest';
import { detectLanguage } from '@/components/BSkill/utils/languageDetect';

describe('detectLanguage', (): void => {
  it('maps common code extensions to canonical lowlight language names', (): void => {
    expect(detectLanguage('index.ts')).toBe('typescript');
    expect(detectLanguage('App.tsx')).toBe('typescript');
    expect(detectLanguage('main.js')).toBe('javascript');
    expect(detectLanguage('App.vue')).toBe('xml');
    expect(detectLanguage('config.json')).toBe('json');
    expect(detectLanguage('script.sh')).toBe('shell');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('style.css')).toBe('css');
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('Program.cs')).toBe('csharp');
    expect(detectLanguage('index.html')).toBe('xml');
  });

  it('is case-insensitive on extensions', (): void => {
    expect(detectLanguage('INDEX.TS')).toBe('typescript');
    expect(detectLanguage('App.VUE')).toBe('xml');
    expect(detectLanguage('Script.SH')).toBe('shell');
  });

  it('returns empty string for unknown extensions', (): void => {
    expect(detectLanguage('file.unknownext')).toBe('');
    expect(detectLanguage('data.dat')).toBe('');
  });

  it('returns empty string for paths without extension', (): void => {
    expect(detectLanguage('Makefile')).toBe('');
    expect(detectLanguage('path/to/noext')).toBe('');
  });

  it('handles paths with directories and only inspects the last extension', (): void => {
    expect(detectLanguage('src/components/BSkill/index.vue')).toBe('xml');
    expect(detectLanguage('/abs/path/to/file.py')).toBe('python');
    expect(detectLanguage('a/b.c/d.ts')).toBe('typescript');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/components/BSkill/languageDetect.test.ts`
Expected: FAIL，提示 `Failed to resolve import "@/components/BSkill/utils/languageDetect"`

- [ ] **Step 3: 写最小实现**

创建 `src/components/BSkill/utils/languageDetect.ts`：

```typescript
/**
 * @file languageDetect.ts
 * @description BSkill 文件扩展名到 lowlight 规范语言名的推断。
 */

/**
 * 扩展名（小写含点）到 lowlight common 已注册规范语言名的映射。
 * 直接映射到规范名，避免依赖 BMessage codeHighlight 内部别名表的完整性。
 */
const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.vue': 'xml',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.css': 'css',
  '.less': 'less',
  '.scss': 'scss',
  '.sql': 'sql',
  '.php': 'php',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.lua': 'lua',
  '.r': 'r',
  '.diff': 'diff',
  '.patch': 'diff',
  '.ini': 'ini',
  '.conf': 'ini',
  '.graphql': 'graphql',
  '.wasm': 'wasm'
};

/**
 * 根据文件路径推断 high亮语言名。
 * 仅取最后一个 `.` 之后的扩展名，未识别或无扩展名返回空字符串。
 * @param filePath - 文件路径（可能含目录）
 * @returns lowlight 规范语言名（如 `'typescript'`），未识别返回 `''`
 */
export function detectLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? '';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run test/components/BSkill/languageDetect.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 6: 提交**

```bash
git add src/components/BSkill/utils/languageDetect.ts test/components/BSkill/languageDetect.test.ts
git commit -m "feat(bskill): add language detect util for syntax highlight"
```

---

### Task 2: index.vue 集成语法高亮

**Files:**
- Modify: `src/components/BSkill/index.vue`

**Interfaces:**
- Consumes: `detectLanguage` from Task 1；`highlightMessageCode`、`CodeHighlightRenderNode` from `@/components/BMessage/utils/codeHighlight`；`.code-highlight()` mixin from `@/assets/styles/markdown.less`
- Produces: BSkill `success` 状态下按扩展名高亮展示文件内容；超 200KB 走纯文本

- [ ] **Step 1: 在 `<script setup>` 顶部补充 import 与类型**

打开 `src/components/BSkill/index.vue`，在现有 import 区块（第 44-53 行附近）补充。注意 `import type` 与值导入分组：

```typescript
import type { CodeHighlightRenderNode } from '@/components/BMessage/utils/codeHighlight';
import type { VNodeChild } from 'vue';
import { computed, defineComponent, h, ref, watch } from 'vue';
import { highlightMessageCode } from '@/components/BMessage/utils/codeHighlight';
import { detectLanguage } from './utils/languageDetect';
```

说明：
- 把原 `import { computed, ref, watch } from 'vue';` 替换为含 `defineComponent, h` 的版本
- `VNodeChild` 用于局部组件 setup 返回类型

- [ ] **Step 2: 定义局部递归组件 CodeHighlightNode**

在 `// ─── State ───` 区块之前（约第 70 行 `// ─── Types ───` 之后）插入局部组件定义。模式参考 `src/components/BMessage/components/CodeBlockNode.vue:64-85`：

```typescript
// ─── Local components ────────────────────────────────────────────────────────

/**
 * 递归渲染单个 CodeHighlightRenderNode 为带 hljs 类名的 <span>。
 * 定义为局部组件，使父组件 scoped 样式的 .hljs-* 选择器能自动作用于递归节点。
 */
const CodeHighlightNode = defineComponent({
  name: 'CodeHighlightNode',
  props: {
    node: {
      type: Object as PropType<CodeHighlightRenderNode>,
      required: true
    }
  },
  setup(componentProps): () => VNodeChild {
    return (): VNodeChild => {
      if (componentProps.node.type === 'text') {
        return componentProps.node.value;
      }

      return h(
        'span',
        { class: componentProps.node.className || undefined },
        componentProps.node.children.map(
          (child: CodeHighlightRenderNode): VNodeChild => h(CodeHighlightNode, { node: child })
        )
      );
    };
  }
});
```

同时在 import 区补充 `PropType`：

```typescript
import type { PropType } from 'vue';
```

- [ ] **Step 3: 新增高亮阈值常量与 computed**

在 `// ─── Derived ───` 区块内（约第 84 行后）补充：

```typescript
/** 超过此字符数的文件跳过语法高亮，避免 lowlight 同步解析大文件造成卡顿。 */
const HIGHLIGHT_MAX_CHARS = 200 * 1024;

/** 当前选中文件推断出的高亮语言名（未识别为空字符串）。 */
const highlightLanguage = computed<string>(() => detectLanguage(selectedFilePath.value));

/** 是否跳过语法高亮（非成功状态或大文件）。 */
const shouldSkipHighlight = computed<boolean>(() => {
  if (fileState.value.status !== 'success') return true;
  return fileState.value.content.length > HIGHLIGHT_MAX_CHARS;
});

/** 高亮渲染节点树；跳过时返回空数组。 */
const highlightedNodes = computed<CodeHighlightRenderNode[]>(() => {
  if (shouldSkipHighlight.value || fileState.value.status !== 'success') return [];
  return highlightMessageCode(highlightLanguage.value, fileState.value.content, true);
});
```

- [ ] **Step 4: 修改模板，替换第 31 行的 `<pre><code>`**

将原第 31 行：

```vue
          <pre v-else-if="fileState.status === 'success'" :class="bem('content')"><code>{{ fileState.content }}</code></pre>
```

替换为：

```vue
          <pre v-else-if="fileState.status === 'success'" :class="bem('content')"><code v-if="shouldSkipHighlight">{{ fileState.content }}</code><code v-else><CodeHighlightNode v-for="(node, index) in highlightedNodes" :key="index" :node="node" /></code></pre>
```

- [ ] **Step 5: 修改 `<style scoped lang="less">`，引入 mixin 并套色**

在 `<style scoped lang="less">` 顶部（第 177 行 `</script>` 之后）补充 `@import`：

```less
<style scoped lang="less">
@import url('@/assets/styles/markdown.less');

.b-skill {
```

然后在 `.b-skill__content` 规则块内（约第 241 行）末尾调用 mixin：

```less
.b-skill__content {
  flex: 1;
  min-height: 0;
  padding: 12px;
  margin: 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  // 复用 markdown.less 的 hljs 主题色（基于 --code-* CSS 变量）
  .code-highlight();
}
```

- [ ] **Step 6: 运行 lint + stylelint + 类型检查**

Run: `pnpm lint`
Expected: 无错误（自动修复后）

Run: `pnpm lint:style`
Expected: 无错误

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: 手动验证**

启动开发环境（如已有运行则刷新）：

Run: `pnpm dev`

在 BSkill 预览界面依次验证：
- `.ts` / `.vue` / `.json` / `.md` 文件：关键字、字符串、注释应有着色
- 未知扩展名文件（如 `.dat`）：纯文本无色，无报错
- 大文件（>200KB）：纯文本展示，无卡顿
- 切换文件：高亮正确更新，无残留
- 复制按钮：仍复制原文

- [ ] **Step 8: 提交**

```bash
git add src/components/BSkill/index.vue
git commit -m "feat(bskill): render file preview with syntax highlight"
```

---

### Task 3: Changelog 与最终验证

**Files:**
- Create or Modify: `changelog/2026-08-01.md`

- [ ] **Step 1: 记录 changelog**

检查 `changelog/2026-08-01.md` 是否存在；不存在则创建，追加：

```markdown
# 2026-08-01

## Added
- BSkill 文件预览支持按扩展名自动语法高亮（复用 lowlight + BMessage 高亮器）
- 新增 `src/components/BSkill/utils/languageDetect.ts` 扩展名语言推断工具

## Changed
- `src/components/BSkill/index.vue` 成功状态分支按阈值切换高亮/纯文本渲染；引入 `.code-highlight()` mixin 套色
```

- [ ] **Step 2: 全量检查**

Run: `pnpm lint && pnpm lint:style && pnpm exec tsc --noEmit`
Expected: 全部通过

Run: `pnpm exec vitest run test/components/BSkill/languageDetect.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add changelog/2026-08-01.md
git commit -m "docs(bskill): record syntax highlight changelog"
```

---

## Self-Review

**1. Spec coverage：**
- 按扩展名自动推断 → Task 1 ✓
- 复用 `highlightMessageCode` → Task 2 Step 3 ✓
- 大文件跳过（200KB）→ Task 2 Step 3 `HIGHLIGHT_MAX_CHARS` ✓
- 复用 `.code-highlight()` mixin → Task 2 Step 5 ✓
- 未识别扩展名回退 → `detectLanguage` 返回 `''`，`highlightMessageCode` 内部 `!language` 分支返回纯文本节点 ✓
- `copyContent` / `editFile` 不受影响 → 仍基于 `fileState.content` ✓
- lint/style/tsc 验证 → Task 2 Step 6、Task 3 Step 2 ✓

**2. Placeholder scan：** 无 TBD/TODO；每个步骤含完整代码与命令。

**3. Type consistency：**
- `detectLanguage(filePath: string): string` —— Task 1 定义，Task 2 Step 3 消费，签名一致 ✓
- `CodeHighlightRenderNode` —— 来自 `@/components/BMessage/utils/codeHighlight`，Task 2 局部组件 props 类型一致 ✓
- `highlightedNodes: ComputedRef<CodeHighlightRenderNode[]>` —— Step 3 定义，Step 4 模板消费 ✓
- `shouldSkipHighlight: ComputedRef<boolean>` —— Step 3 定义，Step 4 模板消费 ✓
- 局部组件 `CodeHighlightNode` —— Step 2 定义，Step 4 模板使用 ✓

**4. 与 spec 的偏差已在"与 Spec 的两处细化"说明，均为实现稳健性优化，不违背 spec 意图。**
