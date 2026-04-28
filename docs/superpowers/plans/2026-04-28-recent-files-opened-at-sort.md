# Recent Files (openedAt sort) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“最近文件”列表始终按“最近显式打开时间 openedAt”排序，并把所有打开入口收口到统一的 store action，避免各处手写 `unshift` 维护顺序。

**Architecture:** 为 `StoredFile` 增加时间元数据字段；在存储层集中归一化和排序；在 files store 中提供统一打开用例（open existing / open or create by path / create and open），并通过串行写队列规避并发读改写覆盖；UI 入口只表达意图，不再触碰最近文件排序细节。

**Tech Stack:** Vue 3, Pinia, TypeScript, localforage, Electron store bridge, Vitest.

---

## Scope

- In scope
  - 为 `StoredFile` 增加 `createdAt/openedAt/modifiedAt/savedAt`（以及预留 `pinnedAt/workspaceId`）字段，字段可选，兼容旧数据缺失。
  - 统一“最近文件”派生排序：`openedAt -> modifiedAt -> createdAt -> 稳定兜底`。
  - 新增存储层 `touchRecentFile(id)`，由存储层生成时间戳并更新 openedAt。
  - files store 新增 `openExistingFile/openOrCreateByPath/createAndOpen`，并让欢迎页/搜索/菜单/系统 recent/原生打开/拖拽入口全部改为调用它们。
  - 明确保存路径不更新 `openedAt`，只更新 `savedAt`（以及后续阶段可加 `modifiedAt`）。
  - 增加针对存储层和 store 的自动化测试覆盖关键场景。

- Out of scope
  - 完整事件日志系统、云同步、多设备合并。
  - 标签页切换算“再次打开”。

---

## Files To Touch (Map)

**Types / Storage**
- Modify: `g:\code\ai\tibis\src\shared\storage\files\types.ts` (extend `StoredFile`)
- Modify: `g:\code\ai\tibis\src\shared\storage\files\recent.ts` (sorting, touch, update merge rules, queue helper)

**Store**
- Modify: `g:\code\ai\tibis\src\stores\files.ts` (new actions, derive recentFiles from storage, stop local unshift maintenance)

**UI Entry Points**
- Modify: `g:\code\ai\tibis\src\hooks\useOpenFile.ts` (delegate to store actions)
- Modify: `g:\code\ai\tibis\src\layouts\default\hooks\useFileActive.ts` (delegate open/openRecent/new to store actions)
- Modify: `g:\code\ai\tibis\src\views\welcome\index.vue` (recent click/open, drop open)
- Modify: `g:\code\ai\tibis\src\components\BSearchRecent\index.vue` (select open should touch openedAt)
- Modify: `g:\code\ai\tibis\src\views\editor\hooks\useAutoSave.ts` (save path should update savedAt, not openedAt; avoid reorder)

**Tests**
- Create: `g:\code\ai\tibis\test\shared\storage\files\recent-opened-at-sort.test.ts`
- Create: `g:\code\ai\tibis\test\stores\files-opened-at-actions.test.ts`

**Changelog**
- Modify: `g:\code\ai\tibis\changelog\2026-04-28.md`

---

## Task 0: Prep (Safe Baseline)

**Files:**
- None

- [ ] **Step 0.1: Install deps**

Run:
```bash
pnpm install
```

Expected: dependencies installed with no errors.

- [ ] **Step 0.2: Run current tests (baseline)**

Run:
```bash
pnpm test
```

Expected: PASS (or record any existing failures before proceeding).

---

## Task 1: Extend StoredFile With Time Metadata

**Files:**
- Modify: `g:\code\ai\tibis\src\shared\storage\files\types.ts`
- Test: `g:\code\ai\tibis\test\shared\storage\files\recent-opened-at-sort.test.ts` (compile-time usage via runtime tests)

- [ ] **Step 1.1: Update `StoredFile` interface**

Edit `src/shared/storage/files/types.ts` to:

```ts
/**
 * @file types.ts
 * @description 文件存储数据结构定义（包含最近文件的时间元数据字段）。
 */

/**
 * 文件主记录
 * 所有时间字段均为可选：旧数据缺失不报错，写入过程按规则补齐。
 */
export interface StoredFile {
  /** 文件唯一标识 */
  id: string;
  /** 文件唯一路径，未保存文件为 null */
  path: string | null;
  /** 当前内容 */
  content: string;
  /** 最近一次与磁盘同步的内容（baseline） */
  savedContent?: string;
  /** 文件名 */
  name: string;
  /** 文件扩展名 */
  ext: string;

  /** 本地记录首次创建时间（毫秒时间戳）。首次加入存储时写入 */
  createdAt?: number;
  /** 最近一次显式打开时间。用于“最近文件”排序主键 */
  openedAt?: number;
  /** 最近一次内容变更时间。用户输入导致内容变化时写入 */
  modifiedAt?: number;
  /** 最近一次成功保存时间。写盘或刷新 baseline 时写入 */
  savedAt?: number;

  /** 固定时间（预留）。存在时表示文件被固定 */
  pinnedAt?: number;
  /** 工作区 ID（预留）。用于派生“当前工作区最近文件”视图 */
  workspaceId?: string | null;
}
```

- [ ] **Step 1.2: Typecheck sanity**

Run:
```bash
pnpm run build
```

Expected: build succeeds (or capture type errors to address in follow-up tasks).

- [ ] **Step 1.3: Commit**

```bash
git add src/shared/storage/files/types.ts
git commit -m "feat(files): add time metadata fields to StoredFile"
```

---

## Task 2: Storage Layer Sorting + Touch API + Safe Merge Rules

**Files:**
- Modify: `g:\code\ai\tibis\src\shared\storage\files\recent.ts`
- Test: `g:\code\ai\tibis\test\shared\storage\files\recent-opened-at-sort.test.ts`

### Design Notes (must match spec)

- Sorting is derived: `openedAt desc`, then `modifiedAt desc`, then `createdAt desc`, then stable fallback.
- Normalization for sorting uses `?? 0`, but must not accidentally overwrite existing `openedAt` during unrelated updates.
- Storage writes are whole-array read-modify-write; serialize writes to avoid concurrency overwrites.

- [ ] **Step 2.1: Add small pure helpers (easy to unit test)**

In `src/shared/storage/files/recent.ts` add:

```ts
/**
 * 将可能缺失的时间字段归一化为 number，供排序使用（不用于反写存储）。
 */
function normalizeTime(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 最近文件排序：openedAt -> modifiedAt -> createdAt（均为降序）。
 * 最后用原始顺序做稳定兜底。
 */
function sortRecentFiles(files: StoredFile[]): StoredFile[] {
  return files
    .map((file, index) => ({
      file,
      index,
      openedAt: normalizeTime(file.openedAt),
      modifiedAt: normalizeTime(file.modifiedAt),
      createdAt: normalizeTime(file.createdAt)
    }))
    .sort((a, b) => {
      return (
        b.openedAt - a.openedAt ||
        b.modifiedAt - a.modifiedAt ||
        b.createdAt - a.createdAt ||
        a.index - b.index
      );
    })
    .map((item) => item.file);
}
```

- [ ] **Step 2.2: Update `getAllRecentFiles()` to return sorted derived view**

Change the existing `getAllRecentFiles()` to:

- read stored array
- run existing `normalizeStoredFiles` (savedContent normalization) logic
- persist only when that normalization changed data
- return `sortRecentFiles(files)`

Implementation sketch:

```ts
const { files, changed } = normalizeStoredFiles(storedFiles);
if (changed) { /* persist */ }
return sortRecentFiles(files);
```

- [ ] **Step 2.3: Change `addRecentFile()` to stop being the semantic source of ordering**

Keep `filtered.unshift(normalizedFile)` as a write optimization, but ensure callers rely on `getAllRecentFiles()` ordering, not in-memory unshift.

Also ensure `createdAt/openedAt` are set when adding:
- If `file.createdAt` missing, set it.
- If `file.openedAt` missing, set it (because add is effectively “create/open”).

Example:

```ts
const now = Date.now();
const normalizedFile = normalizeStoredFile({
  ...file,
  createdAt: file.createdAt ?? now,
  openedAt: file.openedAt ?? now
});
```

- [ ] **Step 2.4: Add `touchRecentFile(id)` with serialized writes**

Add a module-scoped write queue:

```ts
let writeQueue: Promise<void> = Promise.resolve();

/**
 * 串行化存储写入，避免并发 read-modify-write 覆盖。
 */
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}
```

Implement:

```ts
async function touchRecentFile(id: string): Promise<StoredFile> {
  return enqueueWrite(async () => {
    const files = await recentFilesStorage.getAllRecentFiles();
    const index = files.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('File not found');

    const now = Date.now();
    const next = [...files];
    next[index] = { ...next[index], openedAt: now };

    // Move touched file to front as a write optimization.
    const [item] = next.splice(index, 1);
    next.unshift(item);

    // Persist without re-sorting here; read side always sorts.
    if (hasElectronAPI()) {
      await setElectronStoreValue(RECENT_FILES_KEY, next.slice(0, MAX_RECENT_FILES));
    } else {
      await localforage.setItem(RECENT_FILES_KEY, next.slice(0, MAX_RECENT_FILES));
    }

    return item;
  });
}
```

Notes:
- This uses `recentFilesStorage.getAllRecentFiles()` which sorts; that is OK, but if it becomes a perf concern later, add a private raw read method.
- Keep the error message stable for tests.

- [ ] **Step 2.5: Change `updateRecentFile` signature to accept partial updates**

Current signature is `updateRecentFile(id, file: StoredFile): Promise<void>`, which forces callers to pass possibly-normalized objects.

Change to:

```ts
async updateRecentFile(id: string, updates: Partial<StoredFile>): Promise<StoredFile> { ... }
```

Merge rule:
- `openedAt` is only overwritten if `updates.openedAt` is a finite number > 0.
- Otherwise keep existing `openedAt`.

Implementation sketch:

```ts
const nextOpenedAt =
  typeof updates.openedAt === 'number' && Number.isFinite(updates.openedAt) && updates.openedAt > 0
    ? updates.openedAt
    : files[index].openedAt;

files[index] = normalizeStoredFile({
  ...files[index],
  ...updates,
  openedAt: nextOpenedAt
});
```

Return the updated record so store can refresh in-memory state when useful.

- [ ] **Step 2.6: Add unit tests for sorting + merge rules**

Create `test/shared/storage/files/recent-opened-at-sort.test.ts`:

```ts
/**
 * @file recent-opened-at-sort.test.ts
 * @description 验证 recent files 存储层的 openedAt 排序、兜底规则与 openedAt 合并保护。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getItemMock = vi.fn();
const setItemMock = vi.fn();

vi.mock('localforage', () => ({
  default: {
    config: vi.fn(),
    getItem: getItemMock,
    setItem: setItemMock,
    clear: vi.fn()
  }
}));

vi.mock('@/shared/platform/electron-api', () => ({
  hasElectronAPI: () => false,
  getElectronAPI: () => ({})
}));

describe('recentFilesStorage sorting & merge rules', () => {
  beforeEach(() => {
    vi.resetModules();
    getItemMock.mockReset();
    setItemMock.mockReset();
    getItemMock.mockResolvedValue([]);
  });

  it('sorts by openedAt desc then modifiedAt desc then createdAt desc with stable fallback', async () => {
    const { recentFilesStorage } = await import('@/shared/storage/files/recent');

    getItemMock.mockResolvedValue([
      { id: 'a', path: '/a', name: 'a', ext: 'md', content: 'a', openedAt: 10, modifiedAt: 1, createdAt: 1 },
      { id: 'b', path: '/b', name: 'b', ext: 'md', content: 'b', openedAt: 10, modifiedAt: 2, createdAt: 1 },
      { id: 'c', path: '/c', name: 'c', ext: 'md', content: 'c', openedAt: 9, modifiedAt: 99, createdAt: 99 },
      { id: 'd', path: '/d', name: 'd', ext: 'md', content: 'd' }
    ]);

    const files = await recentFilesStorage.getAllRecentFiles();
    expect(files.map((f) => f.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('does not overwrite openedAt when updateRecentFile receives openedAt=0', async () => {
    const { recentFilesStorage } = await import('@/shared/storage/files/recent');

    getItemMock.mockResolvedValue([
      { id: 'a', path: '/a', name: 'a', ext: 'md', content: 'a', openedAt: 123 }
    ]);

    await recentFilesStorage.updateRecentFile('a', { openedAt: 0, savedAt: 456 });

    const saved = setItemMock.mock.calls[0]?.[1] as Array<{ id: string; openedAt?: number; savedAt?: number }>;
    expect(saved[0].openedAt).toBe(123);
    expect(saved[0].savedAt).toBe(456);
  });
});
```

- [ ] **Step 2.7: Run tests**

Run:
```bash
pnpm test test/shared/storage/files/recent-opened-at-sort.test.ts
```

Expected: PASS.

- [ ] **Step 2.8: Commit**

```bash
git add src/shared/storage/files/recent.ts test/shared/storage/files/recent-opened-at-sort.test.ts
git commit -m "feat(files): derive recent file order from openedAt in storage"
```

---

## Task 3: Files Store Actions (Open Usecases + Derived Recent List)

**Files:**
- Modify: `g:\code\ai\tibis\src\stores\files.ts`
- Test: `g:\code\ai\tibis\test\stores\files-opened-at-actions.test.ts`

### Store invariants after this task

- `recentFiles` in memory is always assigned from `recentFilesStorage.getAllRecentFiles()` (derived sorting).
- The store no longer uses `unshift` to maintain recency semantics.
- Store provides three explicit “open usecases”:
  - open existing by id (touch openedAt)
  - open or create by disk path
  - create new unsaved file

- [ ] **Step 3.1: Add OpenSource type (optional but helpful for future)**

In `src/stores/files.ts`:

```ts
/**
 * 打开文件来源标记（当前仅作预留，不参与业务逻辑）。
 */
export type OpenSource =
  | 'welcome'
  | 'search'
  | 'menu'
  | 'platform-recent'
  | 'native-open'
  | 'drop'
  | 'new';
```

- [ ] **Step 3.2: Add serialized store write helper (reuse storage enqueue or keep local)**

Prefer to keep store-level queue for multi-step writes:

```ts
let writeQueue: Promise<void> = Promise.resolve();

/**
 * 串行化 store 写入动作，避免多个入口并发触发导致最近文件存储互相覆盖。
 */
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}
```

- [ ] **Step 3.3: Implement `openExistingFile(id, source)`**

Pseudo:

```ts
async openExistingFile(id: string, source: OpenSource): Promise<void> {
  await this.ensureLoaded();
  await enqueueWrite(() => recentFilesStorage.touchRecentFile(id));
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();
}
```

Note: routing should remain in UI layer (store should not import router). Return `StoredFile` or `void`; UI uses `id` to route.

- [ ] **Step 3.4: Implement `openOrCreateByPath(path, source)` with inflight guard**

Add module-scope:

```ts
const inflightPaths = new Set<string>();
```

Implementation outline:

```ts
async openOrCreateByPath(path: string, source: OpenSource): Promise<string | null> {
  if (inflightPaths.has(path)) return null;
  inflightPaths.add(path);
  try {
    await this.ensureLoaded();
    const existing = await this.getFileByPath(path);
    if (existing) {
      await this.openExistingFile(existing.id, source);
      return existing.id;
    }

    const file = await native.readFile(path);
    const now = Date.now();
    const created = {
      ...file,
      id: /* keep existing nanoid generator in callers OR pass id in */,
      path,
      createdAt: now,
      openedAt: now,
      savedAt: now,
      savedContent: file.content
    } satisfies StoredFile;

    await enqueueWrite(() => this.addFile(created));
    this.recentFiles = await recentFilesStorage.getAllRecentFiles();
    await this.syncPlatformRecentFiles();
    return created.id;
  } finally {
    inflightPaths.delete(path);
  }
}
```

Note: this requires a consistent id generator location. Choose one:
- Option A (recommended): keep id generation in UI hooks (existing `nanoid` usage) and pass id into store methods.
- Option B: introduce an internal `createId()` helper in store.

Pick one and keep it consistent across all entry points.

- [ ] **Step 3.5: Implement `createAndOpen(file, source)`**

This handles “new unsaved doc” and also “drop file content but no path”.

```ts
async createAndOpen(file: StoredFile, source: OpenSource): Promise<void> {
  const now = Date.now();
  await enqueueWrite(() => this.addFile({ ...file, createdAt: file.createdAt ?? now, openedAt: file.openedAt ?? now }));
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();
}
```

- [ ] **Step 3.6: Remove local `unshift` maintenance in `addFile`**

Today `addFile` updates `this.recentFiles` by `unshift`. After this change:
- Persist via storage first
- Then set `this.recentFiles = await recentFilesStorage.getAllRecentFiles()`
- Keep the “loaded null” branch but also use derived list

- [ ] **Step 3.7: Add store tests**

Create `test/stores/files-opened-at-actions.test.ts`:

```ts
/**
 * @file files-opened-at-actions.test.ts
 * @description 验证 files store 的 open usecases 会更新 openedAt 并派生 recentFiles 顺序。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState: Array<{ id: string; openedAt?: number }> = [
  { id: 'a', openedAt: 1 },
  { id: 'b', openedAt: 2 }
];

vi.mock('@/shared/storage', () => ({
  recentFilesStorage: {
    getAllRecentFiles: vi.fn(async () => storageState.slice().sort((x, y) => (y.openedAt ?? 0) - (x.openedAt ?? 0))),
    touchRecentFile: vi.fn(async (id: string) => {
      const item = storageState.find((f) => f.id === id);
      if (!item) throw new Error('File not found');
      item.openedAt = (item.openedAt ?? 0) + 100;
      return { id };
    })
  }
}));

vi.mock('@/shared/platform', () => ({
  native: {
    syncPlatformRecentFiles: vi.fn()
  }
}));

describe('useFilesStore open actions', () => {
  beforeEach(() => {
    vi.resetModules();
    setActivePinia(createPinia());
  });

  it('openExistingFile touches openedAt and refreshes recentFiles from derived storage order', async () => {
    const { useFilesStore } = await import('@/stores/files');
    const store = useFilesStore();

    await store.ensureLoaded();
    const before = store.recentFiles?.map((f) => f.id);

    await store.openExistingFile('a', 'welcome');
    const after = store.recentFiles?.map((f) => f.id);

    expect(before).toEqual(['b', 'a']);
    expect(after?.[0]).toBe('a');
  });
});
```

Notes:
- This test intentionally mocks storage and native to keep it deterministic and fast.
- When implementing store actions, ensure exports align with mock paths (here mocks `@/shared/storage` and `@/shared/platform`).

- [ ] **Step 3.8: Run tests**

Run:
```bash
pnpm test test/stores/files-opened-at-actions.test.ts
```

Expected: PASS.

- [ ] **Step 3.9: Commit**

```bash
git add src/stores/files.ts test/stores/files-opened-at-actions.test.ts
git commit -m "feat(files): add unified open actions and derived recent list"
```

---

## Task 4: Rewrite All Open Entry Points To Use Store Actions

**Files:**
- Modify: `g:\code\ai\tibis\src\hooks\useOpenFile.ts`
- Modify: `g:\code\ai\tibis\src\layouts\default\hooks\useFileActive.ts`
- Modify: `g:\code\ai\tibis\src\views\welcome\index.vue`
- Modify: `g:\code\ai\tibis\src\components\BSearchRecent\index.vue`

### Entry points that must update openedAt

- Welcome recent click
- Search select
- Menu/shortcut open recent
- Menu/shortcut open native file
- Drag-drop open

- [ ] **Step 4.1: Update `useOpenFile` to delegate**

`openFileById(id)` should call `filesStore.openExistingFile(id, source)` before routing.
`openNativeFile()` should call `filesStore.openOrCreateByPath(file.path, 'native-open')`.

Ensure new signature carries `source`.

- [ ] **Step 4.2: Update `useFileActive` toolbar + emitter handlers**

Replace inline logic that does `native.openFile` + `addFile` + `router.push` with:
- open: `native.openFile` to get path, then `filesStore.openOrCreateByPath(path, 'menu')`, then route to returned id.
- openRecent: `filesStore.openExistingFile(id, 'platform-recent')`, then route.

Keep behavior: if file id not found, show search modal as today.

- [ ] **Step 4.3: Update welcome page**

In `welcome/index.vue`:
- `handleOpenRecentFile(id)` should call store open action (via hook or directly) so openedAt updates.
- Drop handler: if `filePath` exists, call `filesStore.openOrCreateByPath(filePath, 'drop')` and route; if no path, `createAndOpen` using current logic.

- [ ] **Step 4.4: Update `BSearchRecent` select behavior**

`handleSelect(file)` should call `filesStore.openExistingFile(file.id, 'search')` before routing (or use updated `useOpenFile.openFile` that performs touch).

- [ ] **Step 4.5: Manual smoke checklist**

Run `pnpm run dev` and verify:
- open from welcome recent: item moves to top
- open from search: item moves to top
- open from menu open: existing item moves to top; new item appears at top
- open from system recent menu action: item moves to top
- tab switching does not reorder recent list

- [ ] **Step 4.6: Commit**

```bash
git add src/hooks/useOpenFile.ts src/layouts/default/hooks/useFileActive.ts src/views/welcome/index.vue src/components/BSearchRecent/index.vue
git commit -m "refactor(files): route all open entry points through store actions"
```

---

## Task 5: Save Path Must Not Update openedAt (savedAt only)

**Files:**
- Modify: `g:\code\ai\tibis\src\views\editor\hooks\useAutoSave.ts`
- Modify (maybe): `g:\code\ai\tibis\src\stores\files.ts` and/or `src/shared/storage/files/recent.ts`

- [ ] **Step 5.1: Ensure `updateFile` uses partial update and does not touch openedAt**

When saving (auto save path), update should:
- write `content` and potentially `savedContent`
- set `savedAt = Date.now()`
- avoid passing `openedAt` (or pass `undefined`) to storage

This likely requires changing `filesStore.updateFile(id, file)` signature to accept `updates: Partial<StoredFile>` and call `recentFilesStorage.updateRecentFile(id, updates)`.

- [ ] **Step 5.2: Update auto save hook to call the new update API**

In `useAutoSave.ts`, replace:
- `filesStore.updateFile(id, fileState.value)`
with something like:

```ts
await filesStore.updateFile(id, { content, modifiedAt: Date.now() /* optional stage 2 */, savedAt: Date.now() });
```

Keep stage-1 minimum: `savedAt` only; add `modifiedAt` in a separate task if desired.

- [ ] **Step 5.3: Add/extend test (optional but recommended)**

Extend `recent-opened-at-sort.test.ts` or add a store test that verifies:
- calling update with `savedAt` does not change order when openedAt unchanged

- [ ] **Step 5.4: Commit**

```bash
git add src/views/editor/hooks/useAutoSave.ts src/stores/files.ts src/shared/storage/files/recent.ts test/shared/storage/files/recent-opened-at-sort.test.ts
git commit -m "fix(files): saving updates savedAt without changing openedAt ordering"
```

---

## Task 6: Lint / Test / Typecheck Gates

**Files:**
- None (verification only)

- [ ] **Step 6.1: Run unit tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6.2: Run lints**

```bash
pnpm run lint
pnpm run lint:style
```

Expected: PASS (no new lint errors).

- [ ] **Step 6.3: Build**

```bash
pnpm run build
```

Expected: PASS.

---

## Task 7: Changelog

**Files:**
- Modify: `g:\code\ai\tibis\changelog\2026-04-28.md`

- [ ] **Step 7.1: Append change log entry**

Add entries (pick sections that exist in file):
- Changed: “最近文件排序改为由 openedAt 派生，打开入口统一收口到 store action”
- Added: “StoredFile 时间元数据字段 openedAt/createdAt/modifiedAt/savedAt（兼容旧数据）”

- [ ] **Step 7.2: Commit**

```bash
git add changelog/2026-04-28.md
git commit -m "docs(changelog): record recent files openedAt sort work"
```

---

## Spec Coverage Checklist (Self-Review)

- [x] `openedAt` 成为最近文件排序唯一主键（并提供 modifiedAt/createdAt 兜底）
- [x] 排序规则集中在存储层（UI 不再做 `unshift` 语义维护）
- [x] 旧数据兼容（字段缺失按 `0` 兜底，不批量迁移）
- [x] 提供 `touchRecentFile` 并由存储层生成时间戳
- [x] 新增 store open usecases 并收口各入口
- [x] 保存路径不更新 openedAt（通过 update 合并保护 + 调用方不传 openedAt）

