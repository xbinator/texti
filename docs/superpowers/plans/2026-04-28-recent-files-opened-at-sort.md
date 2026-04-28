# Recent Files openedAt Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace insertion-order-based recent files with explicit `openedAt` timestamp sorting, and unify all file-open entry points through store actions.

**Architecture:** Add optional timestamp fields to `StoredFile`. Storage layer sorts by `openedAt` on read. Store layer provides three unified open actions (`openExistingFile`, `openOrCreateFromDialog`, `createAndOpen`). All open entry points delegate to these actions. Save paths do not touch `openedAt`.

**Tech Stack:** TypeScript, Pinia, localforage, Electron store API

---

### Task 1: Add timestamp fields to StoredFile

**Files:**
- Modify: `src/shared/storage/files/types.ts`

- [ ] **Step 1: Add optional timestamp and reserved fields**

```typescript
export interface StoredFile {
  // 文件唯一值
  id: string;
  // 文件唯一路径
  path: string | null;
  // 文件内容
  content: string;
  // 最近一次与磁盘同步的内容
  savedContent?: string;
  // 文件名
  name: string;
  // 文件扩展名
  ext: string;

  /** 本地记录首次创建时间（毫秒时间戳） */
  createdAt?: number;
  /** 最近一次显式打开时间 */
  openedAt?: number;
  /** 最近一次内容变更时间 */
  modifiedAt?: number;
  /** 最近一次成功保存时间 */
  savedAt?: number;
  /** 固定时间（预留） */
  pinnedAt?: number;
  /** 所属工作区 ID（预留） */
  workspaceId?: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/storage/files/types.ts
git commit -m "feat(StoredFile): add timestamp and reserved fields for file metadata"
```

---

### Task 2: Add sorting and touchRecentFile to storage layer

**Files:**
- Modify: `src/shared/storage/files/recent.ts`

- [ ] **Step 1: Add sort comparator and touchRecentFile, update addRecentFile to not rely on position**

Replace the `addRecentFile` method and `getAllRecentFiles` method, and add `touchRecentFile`:

```typescript
// After normalizeStoredFiles function, before recentFilesStorage object

function sortByOpenedAt(files: StoredFile[]): StoredFile[] {
  return files.sort((a, b) =>
    (b.openedAt ?? 0) - (a.openedAt ?? 0) ||
    (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) ||
    (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
}
```

Replace `addRecentFile`:

```typescript
async addRecentFile(file: StoredFile): Promise<void> {
  const files = await this.getAllRecentFiles();
  const normalizedFile = normalizeStoredFile(file);

  const filtered = files.filter((item) => item.id !== normalizedFile.id);
  filtered.push(normalizedFile);

  const nextFiles = filtered.slice(0, MAX_RECENT_FILES);
  if (hasElectronAPI()) {
    await setElectronStoreValue(RECENT_FILES_KEY, nextFiles);
    return;
  }

  await localforage.setItem(RECENT_FILES_KEY, nextFiles);
},
```

Replace `getAllRecentFiles` (add sorting at the end of each branch):

```typescript
async getAllRecentFiles(): Promise<StoredFile[]> {
  if (hasElectronAPI()) {
    await ensureElectronLocalMigration();
    const storedFiles = (await getElectronStoreValue<StoredFile[]>(RECENT_FILES_KEY)) || [];
    const { files, changed } = normalizeStoredFiles(storedFiles);

    if (changed) {
      await setElectronStoreValue(RECENT_FILES_KEY, files);
    }

    return sortByOpenedAt(files);
  }

  const storedFiles = (await localforage.getItem<StoredFile[]>(RECENT_FILES_KEY)) || [];
  const { files, changed } = normalizeStoredFiles(storedFiles);

  if (changed) {
    await localforage.setItem(RECENT_FILES_KEY, files);
  }

  return sortByOpenedAt(files);
},
```

Add `touchRecentFile` after `getRecentFile`:

```typescript
async touchRecentFile(id: string): Promise<StoredFile> {
  const files = await this.getAllRecentFiles();
  const index = files.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('File not found');

  files[index].openedAt = Date.now();

  if (hasElectronAPI()) {
    await setElectronStoreValue(RECENT_FILES_KEY, files);
  } else {
    await localforage.setItem(RECENT_FILES_KEY, files);
  }

  return files[index];
},
```

Update `updateRecentFile` to protect `openedAt` from unintentional overwrite:

```typescript
async updateRecentFile(id: string, file: StoredFile): Promise<void> {
  const files = await this.getAllRecentFiles();
  const index = files.findIndex((item) => item.id === id);
  if (index !== -1) {
    const normalized = normalizeStoredFile(file);
    // 只在调用方显式传入非零 openedAt 时更新，否则保留原值（保存路径不更新 openedAt）
    files[index] = {
      ...normalized,
      openedAt: (normalized.openedAt && normalized.openedAt > 0)
        ? normalized.openedAt
        : files[index].openedAt,
    };

    if (hasElectronAPI()) {
      await setElectronStoreValue(RECENT_FILES_KEY, files);
      return;
    }

    await localforage.setItem(RECENT_FILES_KEY, files);
  }
},
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/storage/files/recent.ts
git commit -m "feat(recent): add openedAt-based sorting and touchRecentFile to storage layer"
```

---

### Task 3: Add unified open actions to files store

**Files:**
- Modify: `src/stores/files.ts`

- [ ] **Step 1: Add openExistingFile, openOrCreateFromDialog, createAndOpen actions**

Add these actions to the store. Import `nanoid` at top:

```typescript
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);
```

Add actions after `syncPlatformRecentFiles`:

```typescript
/**
 * 打开一个已存在的文件：更新 openedAt、刷新列表、同步平台、跳转编辑器
 */
async openExistingFile(id: string) {
  await recentFilesStorage.touchRecentFile(id);
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();

  const router = useRouter();
  router.push({ name: 'editor', params: { id } });
},

/**
 * 通过原生对话框返回的文件数据打开或创建文件
 * 调用方负责先调用 native.openFile() 获取文件数据
 */
async openOrCreateFromDialog(file: { path: string; content: string; name: string; ext: string }) {
  const existing = await this.getFileByPath(file.path);
  if (existing) {
    await this.openExistingFile(existing.id);
    return;
  }

  const id = nanoid();
  const now = Date.now();
  await recentFilesStorage.addRecentFile({ ...file, id, createdAt: now, openedAt: now, savedContent: file.content });
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();

  const router = useRouter();
  router.push({ name: 'editor', params: { id } });
},

/**
 * 创建全新文件并打开（用于复制、新建等场景）
 */
async createAndOpen(file: StoredFile) {
  const now = Date.now();
  await recentFilesStorage.addRecentFile({ ...file, createdAt: now, openedAt: now });
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();

  const router = useRouter();
  router.push({ name: 'editor', params: { id: file.id } });
},
```

Also update `addFile` to not manually manipulate array position (reload from storage instead):

```typescript
async addFile(file: StoredFile) {
  await recentFilesStorage.addRecentFile(file);
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();
},
```

Update `updateFile` to reload from storage:

```typescript
async updateFile(id: string, file: StoredFile) {
  await recentFilesStorage.updateRecentFile(id, file);
  this.recentFiles = await recentFilesStorage.getAllRecentFiles();
  await this.syncPlatformRecentFiles();
},
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/files.ts
git commit -m "feat(filesStore): add unified open actions with openedAt tracking"
```

---

### Task 4: Refactor file open hooks to use store actions

**Files:**
- Modify: `src/hooks/useOpenFile.ts`
- Modify: `src/layouts/default/hooks/useFileActive.ts`
- Modify: `src/views/editor/hooks/useSession.ts`

- [ ] **Step 1: Refactor useOpenFile.ts**

`openFile` and `openFileById` delegate to `openExistingFile`. `openNativeFile` calls the dialog then delegates to `openOrCreateFromDialog`.

```typescript
import { native } from '@/shared/platform';
import type { StoredFile } from '@/shared/storage/files/types';
import { useFilesStore } from '@/stores/files';

export function useOpenFile() {
  const filesStore = useFilesStore();

  async function openFile(file: StoredFile): Promise<void> {
    await filesStore.openExistingFile(file.id);
  }

  async function openFileById(id: string): Promise<void> {
    await filesStore.openExistingFile(id);
  }

  async function openNativeFile(): Promise<void> {
    const file = await native.openFile();
    if (!file.path) return;

    await filesStore.openOrCreateFromDialog(file);
  }

  return { openFile, openFileById, openNativeFile };
}
```

- [ ] **Step 2: Refactor useFileActive.ts**

Replace inline open logic in `toolbarFileOptions` and `file:open` handler with store actions:

```typescript
import { computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { useToolbarShortcuts } from '@/components/BToolbar/hooks/useToolbarShortcuts';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { native } from '@/shared/platform';
import { isElectron } from '@/shared/platform/env';
import { useFilesStore } from '@/stores/files';
import { emitter } from '@/utils/emitter';
import { EditorShortcuts } from '../../../constants/shortcuts';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

interface UseFileActiveOptions {
  visible: { searchRecent: boolean };
}

export function useFileActive(visible: UseFileActiveOptions['visible']) {
  const router = useRouter();
  const filesStore = useFilesStore();
  const { register: registerShortcuts } = useToolbarShortcuts();

  const toolbarFileOptions = computed<ToolbarOptions>(() => [
    {
      value: 'new',
      label: '新建',
      shortcut: EditorShortcuts.FILE_NEW,
      onClick: () => {
        router.push({ name: 'editor', params: { id: nanoid() } });
      }
    },
    { type: 'divider' },
    {
      value: 'open',
      label: '打开',
      shortcut: EditorShortcuts.FILE_OPEN,
      onClick: async () => {
        const file = await native.openFile();
        if (!file.path) return;
        await filesStore.openOrCreateFromDialog(file);
      }
    },
    {
      value: 'recent',
      label: '打开最近的文件',
      shortcut: EditorShortcuts.FILE_RECENT,
      onClick: () => {
        visible.searchRecent = true;
      }
    },
    { type: 'divider' },
    {
      value: 'duplicate',
      label: '复制为新文件',
      shortcut: EditorShortcuts.FILE_DUPLICATE,
      onClick: () => {
        emitter.emit('file:duplicate');
      }
    },
    {
      value: 'save',
      label: '保存',
      shortcut: EditorShortcuts.FILE_SAVE,
      enableShortcut: !isElectron(),
      onClick: () => {
        emitter.emit('file:save');
      }
    },
    {
      value: 'saveAs',
      label: '另存为',
      shortcut: EditorShortcuts.FILE_SAVE_AS,
      onClick: () => {
        emitter.emit('file:saveAs');
      }
    },
    { type: 'divider' },
    {
      value: 'rename',
      label: '重命名',
      shortcut: EditorShortcuts.FILE_RENAME,
      onClick: () => {
        emitter.emit('file:rename');
      }
    }
  ]);

  const cleanup = registerShortcuts(toolbarFileOptions.value);

  const unregisterNew = emitter.on('file:new', () => {
    router.push({ name: 'editor', params: { id: nanoid() } });
  });

  const unregisterOpen = emitter.on('file:open', async () => {
    const file = await native.openFile();
    if (!file.path) return;
    await filesStore.openOrCreateFromDialog(file);
  });

  const unregisterRecent = emitter.on('file:recent', () => {
    visible.searchRecent = true;
  });

  const unregisterOpenRecent = emitter.on('file:openRecent', async (payload: unknown) => {
    const id = typeof payload === 'string' ? payload : '';
    if (!id) return;

    const file = await filesStore.getFileById(id);
    if (!file) {
      visible.searchRecent = true;
      return;
    }

    await filesStore.openExistingFile(file.id);
  });

  onUnmounted(() => {
    cleanup();
    unregisterNew();
    unregisterOpen();
    unregisterRecent();
    unregisterOpenRecent();
  });

  return { toolbarFileOptions };
}
```

- [ ] **Step 3: Refactor useSession.ts onDuplicate**

Replace inline `addFile` + `router.push` with `createAndOpen`:

```typescript
async function onDuplicate() {
  const nextId = nanoid();
  const nextName = fileState.value.name ? `${fileState.value.name}-副本` : '';

  await filesStore.createAndOpen({
    ...fileState.value,
    id: nextId,
    name: nextName,
    path: null,
    savedContent: fileState.value.content
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOpenFile.ts src/layouts/default/hooks/useFileActive.ts src/views/editor/hooks/useSession.ts
git commit -m "refactor: unify file open paths through store actions"
```

---

### Task 5: Protect openedAt in save paths

**Files:**
- Modify: `src/views/editor/hooks/useFileState.ts`

- [ ] **Step 1: Ensure toStoredFile does not accidentally transmit openedAt from EditorFile**

`EditorFile` (from `../types`) extends the platform `File` type which has no `openedAt`. But `toStoredFile()` spreads `fileState.value` which is an `EditorFile`. After Task 1, `StoredFile` has optional `openedAt` — but `EditorFile` doesn't have it, so the spread won't include it. The existing `updateRecentFile` protection (from Task 2) also guards against this. No code change needed in `useFileState.ts` for the save path — the storage layer protection is sufficient.

However, `persistCurrentFile` calls `filesStore.updateFile` which now reloads from storage after write. That's fine — the reload gives us the correctly-sorted list without the save touching `openedAt`.

- [ ] **Step 2: Verify no other code paths accidentally set openedAt**

Search for all `addFile` and `updateFile` call sites to confirm none pass `openedAt` unexpectedly. The only places that should set `openedAt` are `openExistingFile`, `openOrCreateByPath`, and `createAndOpen` (all in the store).

- [ ] **Step 3: Commit (if any changes needed, otherwise skip)**

This task is verification-only. No commit needed unless issues found.

---

### Task 6: Update BSearchRecent to use store open action

**Files:**
- Modify: `src/components/BSearchRecent/index.vue`

- [ ] **Step 1: Replace openFile call with filesStore.openExistingFile**

Update the `handleSelect` function:

```typescript
async function handleSelect(file: StoredFile): Promise<void> {
  handleClose();
  await filesStore.openExistingFile(file.id);
  emit('select', file);
}
```

Remove the `useOpenFile` import (line 44) since it's no longer needed:

Remove:
```typescript
import { useOpenFile } from '@/hooks/useOpenFile';
```

And remove the local destructure (line 62):
```typescript
const { openFile } = useOpenFile();
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BSearchRecent/index.vue
git commit -m "refactor(BSearchRecent): use filesStore.openExistingFile for file selection"
```

---

### Verification Checklist

After all tasks are complete, verify:

- [ ] Welcome page: clicking a recent file updates its `openedAt` and moves it to top
- [ ] Search (BSearchRecent): selecting a file updates its `openedAt` and moves it to top
- [ ] Menu/Shortcut open (file:open): opening an existing file updates its position
- [ ] System recent files (file:openRecent): opening updates position
- [ ] Native file picker: opening existing file updates position
- [ ] New file creation: appears at top with correct timestamps
- [ ] Auto-save: does NOT change file position
- [ ] Manual save (Ctrl+S): does NOT change file position
- [ ] Tab switching: does NOT trigger any timestamp update
- [ ] Old data (no timestamp fields): loads without errors, sorts to bottom
- [ ] Duplicate file: new copy appears at top
