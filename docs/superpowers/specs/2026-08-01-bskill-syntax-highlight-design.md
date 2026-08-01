# BSkill 文件预览语法高亮

## 背景

`src/components/BSkill/index.vue` 当前以纯文本方式展示文件内容：

```vue
<pre v-else-if="fileState.status === 'success'" :class="bem('content')">
  <code>{{ fileState.content }}</code>
</pre>
```

无法区分关键字、字符串、注释等，可读性差。需要为代码类文件提供语法高亮。

## 目标

- 按**文件扩展名**自动推断高亮语言，调用方无需改动
- 复用项目已有的高亮基础设施，避免重复造轮子
- 大文件自动跳过高亮，保证预览流畅
- 未识别扩展名自然回退为纯文本

## 现状分析

项目已具备完整的高亮基础设施：

- **高亮器**：`src/components/BMessage/utils/codeHighlight.ts` 导出 `highlightMessageCode(rawLanguage, code, complete)`，返回 `CodeHighlightRenderNode[]` 树。内部已封装：
  - lowlight + common 语言包（35+ 常见语言）
  - 语言别名归一化（`LANGUAGE_ALIASES`，如 `ts`→`typescript`、`sh`→`shell`）
  - 100 条 LRU 缓存
  - 安全节点转换（过滤 `hljs-` 前缀类名，避免 `v-html`）
- **样式 mixin**：`src/assets/styles/markdown.less` 中定义了 `.code-highlight()` mixin，基于 `--code-*` CSS 变量为所有 `.hljs-*` 类名着色。
- **渲染节点类型**：`CodeHighlightRenderNode = CodeHighlightElementNode | CodeHighlightTextNode`，递归结构。

## 方案

### 复用决策

复用 `highlightMessageCode` 高亮器 + 新建递归渲染组件，与 BMessage 保持一致的"安全节点转换"路径，不使用 `v-html`。

### 数据流

```
selectedFilePath (含扩展名)
  → detectLanguage(filePath)                    // 扩展名 → 原始语言标签（如 "ts"）
  → fileState.content
  → 若 content.length > HIGHLIGHT_MAX_BYTES:    纯文本 <pre><code>（保持现状）
  → 否则: highlightMessageCode(language, content, true)
       → CodeHighlightRenderNode[]
       → <CodeHighlightNode> 递归渲染为 <span class="hljs-xxx">
```

### 文件清单

#### 1. 新建 `src/components/BSkill/utils/languageDetect.ts`

扩展名 → 原始语言标签映射 + 检测函数。

```typescript
const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx',
  '.vue': 'vue', '.py': 'py', '.rb': 'rb', '.rs': 'rs',
  '.sh': 'sh', '.bash': 'bash', '.zsh': 'sh',
  '.yml': 'yml', '.yaml': 'yaml', '.json': 'json',
  '.md': 'md', '.html': 'html', '.htm': 'htm',
  '.xml': 'xml', '.css': 'css', '.less': 'less',
  '.sql': 'sql', 'go': 'go', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp'
};

/** 根据文件路径推断高亮语言标签，未识别返回空字符串 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? '';
}
```

不重复 `LANGUAGE_ALIASES`（别名归一化由 `highlightMessageCode` 内部处理，传入原始标签即可）。

#### 2. 新建 `src/components/BSkill/components/CodeHighlightNode.vue`

递归渲染单个 `CodeHighlightRenderNode`。

```vue
<template>
  <span v-if="node.type === 'text'">{{ node.value }}</span>
  <span v-else :class="node.className">
    <CodeHighlightNode v-for="(child, i) in node.children" :key="i" :node="child" />
  </span>
</template>
```

#### 3. 修改 `src/components/BSkill/index.vue`

- 新增模块常量 `HIGHLIGHT_MAX_BYTES = 200 * 1024`
- 新增 `computed highlightedNodes`：当 `fileState.status === 'success'` 且内容未超阈值时，调用 `highlightMessageCode(detectLanguage(selectedFilePath), content, true)`
- 模板：`success` 分支根据是否超阈值，分别走纯文本 `<pre><code>` 或高亮渲染
  ```vue
  <pre v-else-if="fileState.status === 'success'" :class="bem('content')">
    <code v-if="shouldHighlightPlain">
      {{ fileState.content }}
    </code>
    <code v-else>
      <CodeHighlightNode v-for="(n, i) in highlightedNodes" :key="i" :node="n" />
    </code>
  </pre>
  ```
- 样式：`.b-skill__content` 内调用 `.code-highlight()` mixin

#### 4. 样式引入

在 `src/components/BSkill/index.vue` 的 `<style lang="less" scoped>` 中使用 Less 的 `@import (reference)` 引入 `src/assets/styles/markdown.less`，仅在 `.b-skill__content` 上调用 `.code-highlight()` mixin。`@import (reference)` 只导入 mixin 定义、不输出实际样式块，避免带入 `.markdown-body` 等副作用样式，也无需抽取独立文件。

## 边界处理

| 场景 | 行为 |
|------|------|
| 未识别扩展名 | `detectLanguage` 返回 `''` → `highlightMessageCode` 走 `!language` 分支返回纯文本节点 → 无色 `<span>` |
| 文件超过 200KB | 走纯文本 `<pre><code>` 分支，不高亮 |
| 高亮器抛错 | `highlightMessageCode` 内部 `try/catch` 已兜底，返回纯文本节点 |
| `copyContent` / `editFile` | 仍基于 `fileState.content` 原文，不受影响 |
| 重复切换同一文件 | `highlightMessageCode` 内部 LRU 缓存命中，无重复解析 |

## YAGNI（明确不做）

- 不加行号
- 不加语言切换 / 手动覆盖
- 不加折叠
- 不新增 `language` prop
- 不做异步高亮（阈值已规避大文件性能问题）

## 验证

- `pnpm lint` / `pnpm lint:style` / `pnpm exec tsc --noEmit` 全部通过
- 手动验证：预览 `.ts` / `.vue` / `.json` / `.md` / 未知扩展名 / 大文件，确认高亮、回退、性能符合预期
