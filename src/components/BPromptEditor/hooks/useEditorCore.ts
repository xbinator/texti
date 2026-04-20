import type { Ref } from 'vue';
import { nextTick, ref, watch } from 'vue';
import { useEditorSelection } from './useEditorSelection';
import { isPromptEditorEffectivelyEmpty, useVariableEncoder } from './useVariableEncoder';

export interface EditorCoreOptions {
  variables: Ref<{ label: string; value: string }[]>;
  emitChange: (value: string) => void;
}

/**
 * 受控更新前的选区快照。
 */
interface SelectionSnapshot {
  /** 起始容器在编辑器中的路径 */
  path: number[];
  /** 起始容器内偏移 */
  offset: number;
}

/**
 * 编辑器历史快照。
 */
interface EditorHistorySnapshot {
  /** 当前文本内容 */
  content: string;
  /** 当前光标位置 */
  selection: SelectionSnapshot | null;
}

export function useEditorCore(editorRef: Ref<HTMLDivElement | undefined>, modelValue: Ref<string>, options: EditorCoreOptions) {
  const { variables, emitChange } = options;

  const selectionHook = useEditorSelection(editorRef);

  const { encodeVariables, decodeVariables } = useVariableEncoder({
    getVariableLabel: (value: string) => variables.value.find((v) => v.value === value)?.label
  });

  const isInternalUpdate = ref(false);
  const isApplyingHistory = ref(false);
  const editorIsEmpty = ref(true);
  const historyStack = ref<EditorHistorySnapshot[]>([]);
  const historyIndex = ref(-1);

  /**
   * 将 DOM 节点转换为相对编辑器根节点的路径，便于重渲染后恢复光标。
   * @param root - 编辑器根节点
   * @param targetNode - 需要记录路径的节点
   * @returns 节点路径，无法定位时返回 null
   */
  function buildNodePath(root: Node, targetNode: Node): number[] | null {
    const path: number[] = [];
    let currentNode: Node | null = targetNode;

    while (currentNode && currentNode !== root) {
      const { parentNode } = currentNode as Element;
      if (!parentNode) {
        return null;
      }

      const childIndex = Array.from(parentNode.childNodes).indexOf(currentNode as ChildNode);
      if (childIndex < 0) {
        return null;
      }

      path.unshift(childIndex);
      currentNode = parentNode;
    }

    return currentNode === root ? path : null;
  }

  /**
   * 按路径解析重渲染后的节点。
   * @param root - 编辑器根节点
   * @param path - 节点路径
   * @returns 解析得到的节点
   */
  function resolveNodePath(root: Node, path: number[]): Node | null {
    let currentNode: Node | null = root;

    for (const childIndex of path) {
      currentNode = currentNode?.childNodes[childIndex] ?? null;
      if (!currentNode) {
        return null;
      }
    }

    return currentNode;
  }

  /**
   * 记录当前光标位置，支持编辑器重绘后恢复。
   * @returns 选区快照
   */
  function captureSelectionSnapshot(): SelectionSnapshot | null {
    if (!editorRef.value) {
      return null;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !editorRef.value.contains(range.startContainer)) {
      return null;
    }

    const path = buildNodePath(editorRef.value, range.startContainer);
    if (!path) {
      return null;
    }

    return {
      path,
      offset: range.startOffset
    };
  }

  /**
   * 根据快照恢复光标位置，失败时回退到编辑器末尾。
   * @param snapshot - 先前记录的选区快照
   */
  function restoreSelectionSnapshot(snapshot: SelectionSnapshot | null): void {
    if (!editorRef.value) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const restoredRange = document.createRange();
    const targetNode = snapshot ? resolveNodePath(editorRef.value, snapshot.path) : null;

    if (targetNode) {
      const maxOffset = targetNode.nodeType === Node.TEXT_NODE ? targetNode.textContent?.length ?? 0 : targetNode.childNodes.length;
      const targetOffset = Math.min(snapshot?.offset ?? 0, maxOffset);
      restoredRange.setStart(targetNode, targetOffset);
    } else {
      restoredRange.selectNodeContents(editorRef.value);
      restoredRange.collapse(false);
    }

    restoredRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(restoredRange);
    editorRef.value.focus();
  }

  /**
   * 获取编辑器当前解码后的文本内容。
   * @returns 解码后的编辑器内容
   */
  function getEditorContent(): string {
    if (!editorRef.value) return '';
    return decodeVariables(editorRef.value.innerHTML);
  }

  /**
   * 同步编辑器空态标记，确保 contenteditable 清空后仍能显示 placeholder。
   * @param decodedContent - 可选的解码文本，避免重复解析
   */
  function syncEmptyState(decodedContent?: string): void {
    if (!editorRef.value) {
      return;
    }

    const resolvedContent = decodedContent ?? getEditorContent();
    editorIsEmpty.value = isPromptEditorEffectivelyEmpty(resolvedContent);
    editorRef.value.dataset.empty = editorIsEmpty.value ? 'true' : 'false';
  }

  /**
   * 将外部文本内容编码后写入编辑器 DOM。
   * @param content - 文本内容
   */
  function updateEditorContent(content: string): void {
    if (!editorRef.value) return;
    const encoded = encodeVariables(content);
    if (editorRef.value.innerHTML !== encoded) {
      editorRef.value.innerHTML = encoded;
    }
    syncEmptyState(content);
  }

  /**
   * 将当前编辑器状态写入历史栈，供撤销/重做使用。
   * @param content - 可选的当前文本内容
   * @param selection - 可选的选区快照
   */
  function recordHistorySnapshot(content?: string, selection?: SelectionSnapshot | null): void {
    const resolvedContent = content ?? getEditorContent();
    const resolvedSelection = selection ?? captureSelectionSnapshot();
    const currentSnapshot = historyStack.value[historyIndex.value];

    if (currentSnapshot?.content === resolvedContent) {
      historyStack.value[historyIndex.value] = {
        content: resolvedContent,
        selection: resolvedSelection
      };
      return;
    }

    const nextHistory = historyStack.value.slice(0, historyIndex.value + 1);
    nextHistory.push({
      content: resolvedContent,
      selection: resolvedSelection
    });

    historyStack.value = nextHistory;
    historyIndex.value = nextHistory.length - 1;
  }

  /**
   * 应用历史快照并同步到外部 model。
   * @param snapshot - 需要恢复的历史快照
   */
  function applyHistorySnapshot(snapshot: EditorHistorySnapshot): void {
    if (!editorRef.value) {
      return;
    }

    isApplyingHistory.value = true;
    updateEditorContent(snapshot.content);

    isInternalUpdate.value = true;
    modelValue.value = snapshot.content;
    emitChange(snapshot.content);
    isInternalUpdate.value = false;

    nextTick(() => {
      restoreSelectionSnapshot(snapshot.selection);
      isApplyingHistory.value = false;
    });
  }

  /**
   * 执行撤销操作。
   */
  function undoHistory(): void {
    if (historyIndex.value <= 0) {
      return;
    }

    historyIndex.value -= 1;
    const targetSnapshot = historyStack.value[historyIndex.value];
    if (targetSnapshot) {
      applyHistorySnapshot(targetSnapshot);
    }
  }

  /**
   * 执行重做操作。
   */
  function redoHistory(): void {
    if (historyIndex.value >= historyStack.value.length - 1) {
      return;
    }

    historyIndex.value += 1;
    const targetSnapshot = historyStack.value[historyIndex.value];
    if (targetSnapshot) {
      applyHistorySnapshot(targetSnapshot);
    }
  }

  function updateModelValue(): void {
    if (!editorRef.value) return;
    const decoded = getEditorContent();
    isInternalUpdate.value = true;
    modelValue.value = decoded;
    emitChange(decoded);
    isInternalUpdate.value = false;
    syncEmptyState(decoded);

    if (!isApplyingHistory.value) {
      recordHistorySnapshot(decoded);
    }
  }

  const unwatchModelValue = watch(modelValue, (newValue) => {
    if (isInternalUpdate.value) return;

    if (!editorRef.value) return;

    const currentValue = getEditorContent();
    if (currentValue === (newValue || '')) return;

    const hadFocus = document.activeElement === editorRef.value;

    const selectionSnapshot = hadFocus ? captureSelectionSnapshot() : null;

    updateEditorContent(newValue || '');

    nextTick(() => {
      if (!editorRef.value) return;

      if (hadFocus) {
        restoreSelectionSnapshot(selectionSnapshot);
      }

      if (!isApplyingHistory.value) {
        recordHistorySnapshot(newValue || '', selectionSnapshot);
      }
    });
  });

  const unwatchEditorRef = watch(editorRef, (newEditor) => {
    if (newEditor) {
      if (modelValue.value) {
        updateEditorContent(modelValue.value);
      } else {
        syncEmptyState('');
      }
    }
  });

  function initializeEditor(): void {
    if (!editorRef.value) {
      return;
    }

    if (modelValue.value) {
      updateEditorContent(modelValue.value);
    } else {
      syncEmptyState('');
    }

    recordHistorySnapshot(modelValue.value || '');
  }

  function cleanup(): void {
    unwatchModelValue();
    unwatchEditorRef();
  }

  return {
    selectionHook,
    encodeVariables,
    decodeVariables,
    updateEditorContent,
    getEditorContent,
    updateModelValue,
    initializeEditor,
    cleanup,
    editorIsEmpty,
    undoHistory,
    redoHistory
  };
}
