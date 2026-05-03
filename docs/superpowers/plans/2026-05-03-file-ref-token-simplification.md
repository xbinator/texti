# file-ref Token 格式简化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `{{file-ref:...}}` token 格式简化为 `@fileName:行号`，同时通过引用索引块提供 documentId 映射，让模型能调用 `read_file` 工具。

**Architecture:** Token 生成层（useFileReference）输出新格式 `@fileName:行号`；解析层（chipResolver）同时支持新旧格式；消息处理层（messageHelper、fileReferenceContext）将 token 替换为引用索引块；渲染层（BubblePartText）支持新格式正则匹配。

**Tech Stack:** Vue 3, TypeScript, CodeMirror 6, Vitest

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 修改 | `src/components/BChatSidebar/hooks/useFileReference.ts` | 生成新格式 token |
| 修改 | `src/components/BChatSidebar/utils/chipResolver.ts` | 解析新格式 token，兼容旧格式 |
| 修改 | `src/components/BChatSidebar/utils/messageHelper.ts` | 转换新格式 token 为引用索引块 |
| 修改 | `src/components/BChatSidebar/utils/fileReferenceContext.ts` | 更新引用索引块格式 |
| 修改 | `src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue` | 渲染新格式 token |
| 修改 | `test/components/BChatSidebar/chipResolver.test.ts` | 更新 chipResolver 测试 |
| 修改 | `test/components/BChat/file-reference-context.test.ts` | 更新引用索引块测试 |
| 修改 | `test/components/BChat/message-bubble-part-text.component.test.ts` | 更新渲染测试 |

---

### Task 1: 修改 token 生成（useFileReference.ts）

**Files:**
- Modify: `src/components/BChatSidebar/hooks/useFileReference.ts:43,51`

- [ ] **Step 1: 修改 `onPasteFiles` 函数，生成新格式 token**

将第 43 行：
```typescript
      .map((file) => `{{file-ref:${encodeURIComponent(file.name)}|${file.name}|0|0}} `)
```
改为：
```typescript
      .map((file) => `@${file.name} `)
```

- [ ] **Step 2: 修改 `insertReference` 函数，生成新格式 token**

将第 51 行：
```typescript
    const token = `{{file-ref:${reference.documentId}|${reference.fileName}|${reference.startLine}|${reference.endLine}}} `;
```
改为：
```typescript
    const lineSuffix = reference.startLine > 0
      ? reference.startLine === reference.endLine
        ? `:${reference.startLine}`
        : `:${reference.startLine}-${reference.endLine}`
      : '';
    const token = `@${reference.fileName}${lineSuffix} `;
```

- [ ] **Step 3: 运行相关测试确认无破坏**

Run: `npx vitest run test/components/BChatSidebar/ --reporter=verbose`
Expected: 部分测试可能失败（chipResolver、BubblePartText 等），因为它们仍匹配旧格式。这是预期的，后续 Task 修复。

- [ ] **Step 4: Commit**

```bash
git add src/components/BChatSidebar/hooks/useFileReference.ts
git commit -m "feat(file-ref): generate new @fileName:line token format"
```

---

### Task 2: 修改 token 解析（chipResolver.ts）

**Files:**
- Modify: `src/components/BChatSidebar/utils/chipResolver.ts`

- [ ] **Step 1: 重写 chipResolver，支持新格式并兼容旧格式**

将 `chipResolver` 函数整体替换为：

```typescript
/**
 * Chip 解析器，将 {{...}} 内部的 body 解析为渲染指令。
 * 新格式: file-ref:@fileName 或 file-ref:@fileName:startLine 或 file-ref:@fileName:startLine-endLine
 * 旧格式（4 字段）: file-ref:id|fileName|startLine|endLine
 * 旧格式（3 字段）: file-ref:id|fileName|line  — 兼容降级解析
 * 其他 → null（不渲染为 chip）。
 */
export const chipResolver: ChipResolver = (body) => {
  if (!body.startsWith('file-ref:')) {
    return null;
  }

  const stripped = body.slice('file-ref:'.length);
  if (!stripped) return null;

  // 新格式: @fileName 或 @fileName:startLine 或 @fileName:startLine-endLine
  if (stripped.startsWith('@')) {
    const newFormat = stripped.slice(1);
    const newMatch = /^([^\s:]+)(?::(\d+)(?:-(\d+))?)?$/.exec(newFormat);
    if (newMatch) {
      const fileName = newMatch[1];
      const rawStart = newMatch[2];
      const rawEnd = newMatch[3];
      const startLine = rawStart ? Number(rawStart) : 0;
      const endLine = rawEnd ? Number(rawEnd) : startLine;
      return { widget: new FileRefWidget(fileName, startLine, endLine) };
    }

    if (import.meta.env.DEV) {
      console.warn('[chipResolver] 无法解析新格式文件引用 token body:', body);
    }
    return { widget: new FileRefWidget(newFormat, 0, 0) };
  }

  // 旧格式（4 字段）: id|name|startLine|endLine
  const parts = stripped.split('|');
  const fileName = parts[1] || parts[0];

  if (parts.length >= 4) {
    const rawStart = parts[2] !== undefined && parts[2] !== '' ? Number(parts[2]) : NaN;
    const rawEnd = parts[3] !== undefined && parts[3] !== '' ? Number(parts[3]) : NaN;
    const startLine = Number.isNaN(rawStart) ? 0 : rawStart;
    const endLine = Number.isNaN(rawEnd) || rawEnd < startLine ? startLine : rawEnd;
    return { widget: new FileRefWidget(fileName, startLine, endLine) };
  }

  // 旧格式降级解析（3 字段）: id|name|line，line 为 "10" 或 "10-20"
  const raw = parts[2] || '';
  const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(raw);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : start;
    return { widget: new FileRefWidget(fileName, start, end) };
  }

  // 格式损坏：降级为仅显示文件名
  if (import.meta.env.DEV) {
    console.warn('[chipResolver] 无法解析文件引用 token body:', body);
  }
  return { widget: new FileRefWidget(fileName, 0, 0) };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BChatSidebar/utils/chipResolver.ts
git commit -m "feat(file-ref): chipResolver supports new @fileName:line format with backward compat"
```

---

### Task 3: 更新 chipResolver 测试

**Files:**
- Modify: `test/components/BChatSidebar/chipResolver.test.ts`

- [ ] **Step 1: 添加新格式测试用例**

在 `describe('chipResolver')` 内添加新格式 describe 块：

```typescript
  describe('新格式（@fileName:行号）', () => {
    test('范围引用：@fileName:startLine-endLine', () => {
      expectFileRefWidget(chipResolver('file-ref:@file.ts|5|15'), {
        fileName: 'file.ts',
        startLine: 5,
        endLine: 15
      });
    });

    test('单行引用：@fileName:startLine', () => {
      expectFileRefWidget(chipResolver('file-ref:@file.ts|10'), {
        fileName: 'file.ts',
        startLine: 10,
        endLine: 10
      });
    });

    test('无行号：@fileName', () => {
      expectFileRefWidget(chipResolver('file-ref:@file.ts'), {
        fileName: 'file.ts',
        startLine: 0,
        endLine: 0
      });
    });

    test('文件名含点号', () => {
      expectFileRefWidget(chipResolver('file-ref:@src/utils/helper.ts|3|8'), {
        fileName: 'src/utils/helper.ts',
        startLine: 3,
        endLine: 8
      });
    });
  });
```

- [ ] **Step 2: 运行 chipResolver 测试**

Run: `npx vitest run test/components/BChatSidebar/chipResolver.test.ts --reporter=verbose`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add test/components/BChatSidebar/chipResolver.test.ts
git commit -m "test(file-ref): add new @fileName:line format test cases for chipResolver"
```

---

### Task 4: 修改消息处理（messageHelper.ts）

**Files:**
- Modify: `src/components/BChatSidebar/utils/messageHelper.ts:66-76`

- [ ] **Step 1: 更新 `buildMessagePartsFromDraft` 函数，支持新格式 token 替换**

将 `buildMessagePartsFromDraft` 函数替换为：

```typescript
/**
 * 将草稿正文和活动引用解析为有序消息片段。
 * 支持新格式 @fileName:行号 和旧格式 {{file-ref:...}}。
 * @param content - 草稿正文
 * @returns 替换后的文本
 */
export function buildMessagePartsFromDraft(content: string) {
  // 新格式: @fileName:startLine-endLine 或 @fileName:startLine 或 @fileName
  const NEW_TOKEN_RE = /@([^\s:]+)(?::(\d+)(?:-(\d+))?)?/g;

  return content.replace(NEW_TOKEN_RE, (match, fileName: string, start?: string, end?: string) => {
    // 排除普通 @mention（如 @user）— 只替换有文件扩展名的
    if (!fileName.includes('.')) return match;

    const startLine = start ? Number(start) : 0;
    const endLine = end ? Number(end) : startLine;

    return `<USER_SELECT_FRAGMENT fileName="${fileName}" startLine="${startLine}" endLine="${endLine}"></USER_SELECT_FRAGMENT>`;
  });
}
```

- [ ] **Step 2: 运行 messageHelper 相关测试**

Run: `npx vitest run test/components/BChat/ --reporter=verbose`
Expected: 部分测试可能需要更新

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/utils/messageHelper.ts
git commit -m "feat(file-ref): messageHelper supports new @fileName:line token format"
```

---

### Task 5: 更新引用索引块格式（fileReferenceContext.ts）

**Files:**
- Modify: `src/components/BChatSidebar/utils/fileReferenceContext.ts`

- [ ] **Step 1: 更新 `formatReferenceLine` 函数，使用 `[documentId]` 格式**

将 `formatReferenceLine` 替换为：

```typescript
/**
 * 将单个文件引用片段格式化为模型侧索引文本。
 * @param reference - 文件引用片段
 * @returns 单行索引文本
 */
function formatReferenceLine(reference: ChatMessageFileReferencePart): string {
  const pathLabel = reference.path || reference.fileName;
  const unsavedLabel = reference.path ? '' : ' (unsaved)';
  const lineLabel =
    reference.startLine > 0
      ? reference.endLine > reference.startLine
        ? `lines ${reference.startLine}-${reference.endLine}`
        : `line ${reference.startLine}`
      : '';

  const linePart = lineLabel ? ` (${lineLabel})` : '';
  return `- [${reference.documentId}] ${pathLabel}${unsavedLabel}${linePart}`;
}
```

- [ ] **Step 2: 更新 `buildReferenceIndexBlock` 函数，使用新格式**

将 `buildReferenceIndexBlock` 替换为：

```typescript
/**
 * 构建模型侧文件引用索引块。
 * @param references - 文件引用片段列表
 * @returns 引用索引文本；无引用时返回空字符串
 */
function buildReferenceIndexBlock(references: ChatMessageFileReferencePart[]): string {
  if (!references.length) {
    return '';
  }

  return [
    'File References:',
    ...references.map(formatReferenceLine),
    '',
    'Use read_file with documentId to read file content.'
  ].join('\n');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/utils/fileReferenceContext.ts
git commit -m "feat(file-ref): update reference index block with [documentId] format"
```

---

### Task 6: 更新引用索引块测试

**Files:**
- Modify: `test/components/BChat/file-reference-context.test.ts`

- [ ] **Step 1: 更新测试断言以匹配新格式**

将测试中的旧格式断言替换为新格式：

- `'Available file references for this message:'` → `'File References:'`
- `'doc-1: draft.md (lines 12-14)'` → `'[doc-1] docs/draft.md (lines 12-14)'`
- `'doc-1: foo.ts (lines 3-5)'` → `'[doc-1] foo.ts (lines 3-5)'`
- `'doc-2: bar.ts (lines 10-20)'` → `'[doc-2] bar.ts (lines 10-20)'`
- `'(unsaved document)'` → `'(unsaved)'`
- `'no explicit line range'` → 不再出现行号标签（无行号时 linePart 为空）
- `'lines 5'` → `'line 5'`（单行格式变更）

具体修改：

1. `'doc-1: draft.md (lines 12-14)'` → `'[doc-1] docs/draft.md (lines 12-14)'`
2. `'doc-1: draft.md (unsaved document)'` → `'[doc-1] draft.md (unsaved)'`
3. `'doc-1: foo.ts (lines 3-5)'` → `'[doc-1] foo.ts (lines 3-5)'`
4. `'doc-2: bar.ts (lines 10-20)'` → `'[doc-2] bar.ts (lines 10-20)'`
5. `'lines 5'` → `'line 5'`
6. `'no explicit line range'` → `'[doc-1] docs/draft.md'`（无行号时无括号部分）
7. `'Available file references for this message:'` → `'File References:'`
8. `'File contents are not included yet.'` → `'Use read_file with documentId to read file content.'`
9. `'Prefer reading a small window first.'` → 移除此断言

- [ ] **Step 2: 运行引用索引块测试**

Run: `npx vitest run test/components/BChat/file-reference-context.test.ts --reporter=verbose`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add test/components/BChat/file-reference-context.test.ts
git commit -m "test(file-ref): update reference index block tests for new format"
```

---

### Task 7: 修改渲染逻辑（BubblePartText.vue）

**Files:**
- Modify: `src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue:86,100-125`

- [ ] **Step 1: 更新 token 正则匹配，支持新格式**

将第 86 行：
```typescript
const FILE_REFERENCE_TOKEN_PATTERN = /\{\{file-ref:([A-Za-z0-9_-]+)(?:\|[^}]*)?\}\}/g;
```
改为：
```typescript
const FILE_REFERENCE_TOKEN_PATTERN = /@([^\s:]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?/g;
```

- [ ] **Step 2: 更新 segments computed 中的 token 匹配逻辑**

将 `segments` computed 中 `props.part.text.replace(FILE_REFERENCE_TOKEN_PATTERN, ...)` 回调替换为：

```typescript
  props.part.text.replace(FILE_REFERENCE_TOKEN_PATTERN, (match: string, fileName: string, start?: string, end?: string, offset?: number) => {
    if (offset !== undefined && offset > lastIndex) {
      parts.push({ type: 'text', text: props.part.text.slice(lastIndex, offset) });
    }

    const startLine = start ? Number(start) : 0;
    const endLine = end ? Number(end) : startLine;
    const lineLabel = startLine > 0
      ? startLine === endLine
        ? `${startLine}`
        : `${startLine}-${endLine}`
      : '';
    const label = lineLabel ? `${fileName}:${lineLabel}` : fileName;

    const reference = referenceMap.value.get(match);
    if (reference) {
      parts.push({ type: 'file-reference', label: `${reference.fileName}:${reference.line}` });
    } else {
      parts.push({ type: 'file-reference', label });
    }

    lastIndex = offset !== undefined ? offset + match.length : lastIndex;
    return match;
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue
git commit -m "feat(file-ref): BubblePartText supports new @fileName:line token format"
```

---

### Task 8: 更新 BubblePartText 测试

**Files:**
- Modify: `test/components/BChat/message-bubble-part-text.component.test.ts`

- [ ] **Step 1: 更新测试用例中的 token 格式和断言**

1. 将 `createReference` 中的 `token` 字段改为新格式：
   - `token: '{{file-ref:ref_123}}'` → `token: '@demo.ts:12-14'`

2. 更新测试文本中的 token：
   - `'请查看 {{file-ref:ref_123}} 的实现'` → `'请查看 @demo.ts:12-14 的实现'`
   - `'请查看 {{file-ref:ref_missing}} 的实现'` → `'请查看 @missing.ts:5 的实现'`

3. 更新 fallback 测试断言：
   - `expect(wrapper.text()).toContain('{{file-ref:ref_missing}}')` → `expect(wrapper.text()).toContain('@missing.ts:5')`

4. 更新 assistant 文本测试：
   - `'请查看 {{file-ref:ref_123}}'` → `'请查看 @demo.ts:12-14'`
   - `expect(message.text()).toContain('{{file-ref:ref_123}}')` → `expect(message.text()).toContain('@demo.ts:12-14')`

- [ ] **Step 2: 运行 BubblePartText 测试**

Run: `npx vitest run test/components/BChat/message-bubble-part-text.component.test.ts --reporter=verbose`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add test/components/BChat/message-bubble-part-text.component.test.ts
git commit -m "test(file-ref): update BubblePartText tests for new token format"
```

---

### Task 9: 全量测试验证

**Files:**
- 无新文件修改

- [ ] **Step 1: 运行全量相关测试**

Run: `npx vitest run test/components/BChatSidebar/ test/components/BChat/ --reporter=verbose`
Expected: 所有测试通过

- [ ] **Step 2: 运行 ESLint 检查**

Run: `npx eslint src/components/BChatSidebar/hooks/useFileReference.ts src/components/BChatSidebar/utils/chipResolver.ts src/components/BChatSidebar/utils/messageHelper.ts src/components/BChatSidebar/utils/fileReferenceContext.ts src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue`
Expected: 无错误

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "fix(file-ref): address test and lint issues from token format migration"
```

---

### Task 10: 更新 changelog

**Files:**
- Modify: `changelog/2026-05-03.md`

- [ ] **Step 1: 添加 changelog 条目**

在 `changelog/2026-05-03.md` 的 `## Changed` 部分添加：

```markdown
- file-ref token 格式从 `{{file-ref:id|name|start|end}}` 简化为 `@fileName:行号`，引用索引块提供 `[documentId]` 映射
```

- [ ] **Step 2: Commit**

```bash
git add changelog/2026-05-03.md
git commit -m "changelog: record file-ref token format simplification"
```
