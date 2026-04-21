# 2026-04-21 Editor Global File Watch Design

## 背景

当前编辑器只监听激活中的页面文件。多个编辑器标签同时打开时，如果后台标签对应的文件被外部删除、移动或重命名，标签不会立即反馈，只有用户切回该标签时才可能发现。为了让后台标签也能及时显示文件状态，需要把 watcher 从页面级单文件监听升级为全局多文件监听。

## 目标

- 后台标签对应文件从原路径消失时，标签立即变为红色中划线。
- 不关闭标签，不清空编辑内容。
- 同一路径被多个标签引用时，所有关联标签都能同步更新状态。
- 第一阶段只处理文件消失事件，外部内容修改仍沿用当前激活标签的旧流程。
- 后续可扩展后台外部修改提示和重新定位文件能力。

## 非目标

- 第一阶段不自动识别文件移动后的新路径。
- 第一阶段不处理后台标签的外部内容变更冲突。
- 不引入多套内容冲突处理逻辑，后续统一复用现有 reconcile 流程。

## 状态结构

全局 watcher store 只维护两份映射，不单独维护 `pathRefCount`。

```ts
interface EditorFileWatchState {
  pathToFileIds: Map<string, Set<string>>;
  fileIdToPath: Map<string, string>;
}
```

引用数量由 `pathToFileIds.get(path)?.size ?? 0` 得出，避免第三份状态同步出错。

## Native API

Electron 主进程 watcher 从单文件 watcher 改为多文件 watcher：

```ts
watchFile(path: string): Promise<void>;
unwatchFile(path: string): Promise<void>;
unwatchAll(): Promise<void>;
```

- `watchFile(path)`：加入监听集合，同一路径重复调用应幂等。
- `unwatchFile(path)`：只移除指定路径 watcher。
- `unwatchAll()`：仅用于应用退出或 watcher store dispose，不用于普通标签切换。

不提供 `watchFiles(paths[])`，避免“批量替换”和“增量注册”两种语义混用。

## Store API

### register

`register` 必须是 async，调用方必须 await。

```ts
async function register(fileId: string, path: string): Promise<void> {
  const previousPath = fileIdToPath.get(fileId);

  if (previousPath && previousPath !== path) {
    await updatePath(fileId, path);
    return;
  }

  let fileIds = pathToFileIds.get(path);

  if (!fileIds) {
    await native.watchFile(path);
    fileIds = new Set<string>();
    pathToFileIds.set(path, fileIds);
  }

  fileIds.add(fileId);
  fileIdToPath.set(fileId, path);
}
```

这里使用局部变量 `fileIds`，不使用可选链隐藏不可能出现的空值。

### unregister

```ts
async function unregister(fileId: string): Promise<void> {
  const previousPath = fileIdToPath.get(fileId);
  if (!previousPath) return;

  const fileIds = pathToFileIds.get(previousPath);
  fileIds?.delete(fileId);
  fileIdToPath.delete(fileId);

  if (fileIds && fileIds.size === 0) {
    pathToFileIds.delete(previousPath);
    await native.unwatchFile(previousPath);
  }
}
```

如果同一路径仍有其他 `fileId`，不能取消该路径 watcher。

### updatePath

`updatePath` 需要尽量保持原子性。先确保新路径监听成功，再解绑旧路径，避免中间失败导致 `fileId` 既不在旧路径也不在新路径。

```ts
async function updatePath(fileId: string, nextPath: string): Promise<void> {
  const previousPath = fileIdToPath.get(fileId);
  if (previousPath === nextPath) return;

  let nextFileIds = pathToFileIds.get(nextPath);

  if (!nextFileIds) {
    await native.watchFile(nextPath);
    nextFileIds = new Set<string>();
    pathToFileIds.set(nextPath, nextFileIds);
  }

  if (previousPath) {
    const previousFileIds = pathToFileIds.get(previousPath);
    previousFileIds?.delete(fileId);

    if (previousFileIds && previousFileIds.size === 0) {
      pathToFileIds.delete(previousPath);

      try {
        await native.unwatchFile(previousPath);
      } catch (error) {
        console.error('Failed to unwatch previous file path:', error);
      }
    }
  }

  nextFileIds.add(fileId);
  fileIdToPath.set(fileId, nextPath);
}
```

`unwatchFile(previousPath)` 失败不阻塞新映射提交。旧 watcher 如果残留，只影响资源占用；后续 `unwatchAll()` 会在应用退出或 watcher store dispose 时统一清理。

## 事件处理

### 阶段一

阶段一只让全局 watcher 处理 `unlink`：

```ts
function handleNativeFileChanged(event: FileChangeEvent): void {
  if (event.type === 'change') {
    return;
  }

  if (event.type === 'unlink') {
    markPathMissing(event.filePath);
  }
}
```

`markPathMissing(path)`：

- 读取 `pathToFileIds.get(path)`。
- 对集合中的每个 `fileId` 调用 `tabsStore.markMissing(fileId)`。
- 不关闭标签，不清内容。

旧页面级 watcher 在阶段一只保留当前激活标签的 `change` 处理，必须禁用旧 watcher 的 `unlink` 分支。`unlink` 全部交给全局 watcher，避免重复弹窗和重复状态更新。

### 阶段二

阶段二再处理后台外部修改：

```ts
externalChangedById: Record<string, boolean>;
```

`externalChangedById` 用 boolean 是有意选择：只关心“磁盘版本已不同，需要处理”，连续多次修改合并为一个待处理状态。

- 当前激活标签收到 `change`：沿用现有 dirty 判断和刷新/确认流程。
- 后台标签收到 `change`：标记 `tabsStore.markExternalChanged(fileId)`，不弹窗。
- 用户切回该标签：复用 `reconcileStoredFileWithDisk()`，处理完成后清除 external changed 状态。

不写第二套冲突处理逻辑。

## 移动和重命名

由于当前监听是按文件路径监听，外部移动或重命名通常只稳定表现为旧路径 `unlink`。第一阶段统一按“文件已从原路径消失”处理，不区分删除、移动、重命名。

文案不要写死“文件已删除”，建议使用：

- “文件已从原路径消失”
- “重新定位文件...”

## 重新定位文件

missing 状态下提供“重新定位文件...”操作。流程必须先验证，后提交：

1. 用户选择候选新文件。
2. 调用 `native.readFile(nextPath)`。
3. 如果读取失败：
   - 保持 `fileState.path` 不变。
   - 保持 watcher 映射不变。
   - 保持 missing 状态。
   - 提示读取失败。
4. 如果读取成功：
   - 进入统一 reconcile 流程。
   - 只要 reconcile 流程走完，无论用户选择“使用磁盘内容”还是“保留本地草稿”，都算成功。
   - 只有用户主动取消重新定位，才保持 missing 不变。
5. reconcile 成功后提交：
   - 更新 `fileState.path/name/ext`。
   - `await watchStore.updatePath(fileId, nextPath)`。
   - `tabsStore.clearMissing(fileId)`。

不能先更新 watcher 再读文件，避免 watcher 指向新路径而 `fileState` 仍停留在旧路径。

## 保存 missing 文件

文件已从原路径消失后，用户按 `Ctrl+S`：

- 原路径不存在：直接写回原路径，恢复文件。
- 原路径又出现同名文件：先用应用内确认框询问是否覆盖。
- 写回原路径失败：打开保存对话框，默认使用 `*-recovered.md`，避免触发系统保存面板的同名替换确认。

## 生命周期

调用时机：

- editor 文件加载完成后：`await watchStore.register(fileId, path)`。
- 保存、另存为、重命名成功后：`await watchStore.updatePath(fileId, nextPath)`。
- 关闭标签或删除文件记录时：`await watchStore.unregister(fileId)`。
- watcher store dispose 或应用退出时：`await native.unwatchAll()`。

如果未来支持多窗口：

- 单个窗口关闭只能 unregister 该窗口拥有的 `fileId`。
- 不允许单个窗口关闭时直接 `unwatchAll()`。
- `unwatchAll()` 应绑定到 `before-quit` 或主进程整体退出生命周期。

## 分阶段落地

### 阶段一：后台文件消失即时标红

- Electron 支持多 watcher。
- renderer 新增全局 watcher store。
- 使用 `pathToFileIds` 和 `fileIdToPath`。
- 全局 watcher 只处理 `unlink`。
- 全局 watcher 对 `change` 显式 return。
- 旧 active watcher 只处理当前激活标签的 `change`，不处理 `unlink`。

### 阶段二：后台外部修改提示

- 新增 `externalChangedById`。
- 全局 watcher 开始处理 `change`。
- 后台标签标记 changed。
- 激活 changed 标签时复用 `reconcileStoredFileWithDisk()`。
- HeaderTabs 增加 changed 视觉提示。

### 阶段三：重新定位文件

- missing 状态下提供“重新定位文件...”。
- 选择新文件后按“读盘 -> reconcile -> fileState -> watcher -> clearMissing”提交。
- 取消或读取失败时保持 missing 不变。

## 测试建议

- 后台标签文件 `unlink` 后立即 `markMissing`。
- 同一路径多个标签时，`unlink` 会标记所有关联 `fileId`。
- 关闭一个标签不会取消仍被其他标签引用的路径 watcher。
- `updatePath` 在新路径 watch 失败时保留旧映射。
- `updatePath` 在旧路径 unwatch 失败时仍提交新映射。
- 阶段一全局 watcher 收到 `change` 会直接忽略。
- 旧 active watcher 不处理 `unlink`。
- 重新定位读取失败时不更新 watcher 和 `fileState.path`。
- 重新定位选择保留本地草稿时仍清除 missing 并更新路径。
- missing 文件 `Ctrl+S` 优先恢复原路径，恢复失败后使用 `*-recovered.md` 保存对话框默认名。
