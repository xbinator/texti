import type { RichLoadState, RichLoadCancelReason, RichLoadCompletePayload, RichLoadPhase } from '../adapters/types';
import type { SearchScrollContext } from '../extensions/editorSearch';
import type { Transaction } from '@tiptap/pm/state';
import type { Ref, ComputedRef } from 'vue';
import { ref, watch, computed, onScopeDispose } from 'vue';
import { useEditor, type Editor } from '@tiptap/vue-3';
import { noop } from 'lodash-es';
import { normalizeEditorContent } from '../extensions/emptyContent';
import { handleRichSelectAllKeyboardEvent } from '../extensions/richSelectAll';
import { getPersistedMarkdown } from '../utils/editorMarkdown';
import { releaseRichParseEngine } from '../utils/richMarkdownParser';
import { useContent } from './useContent';
import { useExtensions } from './useExtensions';
import { useRichEditorLoad, EMPTY_PARAGRAPH_JSON } from './useRichEditorLoad';

/**
 * 大文档阈值（字符数）
 */
export const LARGE_DOCUMENT_THRESHOLD = 30_000;

interface UseRichEditorParams {
  bodyContent: Ref<string>;
  editable: Ref<boolean>;
  editorInstanceId: Ref<string>;
  onContentChange: () => void;
  onSearchMatchFocus?: (context: SearchScrollContext) => void;
}

interface UseRichEditorResult {
  editorInstance: ReturnType<typeof useEditor>;
  editorInstanceRef: Ref<Editor | undefined>;
  setContent: (text: string) => void;
  isLargeDocument: ComputedRef<boolean>;
  loadState: Readonly<Ref<RichLoadState>>;
  startLoad: (markdown: string, options?: { isReload?: boolean }) => Promise<void>;
  cancelLoad: (reason: RichLoadCancelReason) => void;
  retryLoad: () => Promise<void>;
  isLoadTransaction: (transaction: Transaction) => boolean;
  getLoadSource: () => string | null;
}

export function useRichEditor({ bodyContent, editable, editorInstanceId, onContentChange, onSearchMatchFocus }: UseRichEditorParams): UseRichEditorResult {
  const { editorExtensions, resetHeadingIndex, resetSourceLineTracker, assignHeadingIds, setHeadingIndex } = useExtensions(editorInstanceId, {
    onSearchMatchFocus
  });
  const editorInstanceRef = ref<Editor>();

  onScopeDispose((): void => releaseRichParseEngine(editorInstanceId.value));

  const isLargeDocument = computed(() => (bodyContent.value?.length ?? 0) > LARGE_DOCUMENT_THRESHOLD);

  // 延迟绑定的快照记录函数（避免循环依赖）
  let onLoadCompleteWrapper: (rawMarkdown: string) => void = noop;

  // Step 1: 创建加载状态机（先于 content bridge）
  const { loadState, startLoad, cancelLoad, retryLoad, isLoadTransaction, getLoadSource } = useRichEditorLoad({
    getEditor: () => editorInstanceRef.value,
    getEditorInstanceId: () => editorInstanceId.value,
    onLoadComplete: (payload: RichLoadCompletePayload) => {
      const editor = editorInstanceRef.value;
      if (!editor) return;
      // 解析阶段已分配正确 heading ID，直接同步运行时 headingIndex 避免全文档遍历
      setHeadingIndex(payload.stats.headingCount);
      onLoadCompleteWrapper(payload.rawMarkdown);
      // 加载完成后 ediable 可直接恢复为 props.editable（此时 phase === 'ready'）
      editor.setEditable(editable.value);
    },
    onLoadFailed: () => {
      // 不修改持久化内容
    }
  });

  // 综合 editable + 加载状态的有效可编辑判断
  const effectiveEditable = computed<boolean>(() => editable.value && (!isLargeDocument.value || loadState.value.phase === 'ready'));

  const exposedLoadState = computed<RichLoadState>(() => {
    if (isLargeDocument.value) {
      return loadState.value;
    }

    return {
      phase: 'ready',
      isReload: false,
      progress: 1
    };
  });

  // Step 2: 创建 content bridge（传入加载守卫）
  const { setEditorContent, onPaste, onEditorUpdate, isEquivalentToImportedContent, rememberImportedContent, onLoadComplete } = useContent({
    assignHeadingIds,
    editable: effectiveEditable,
    editorContent: bodyContent,
    getEditorInstance: () => editorInstanceRef.value,
    resetHeadingIndex,
    resetSourceLineTracker,
    onContentChange,
    isLoadTransaction,
    loadPhase: (() => (isLargeDocument.value ? loadState.value.phase : 'ready') as RichLoadPhase) as () => RichLoadPhase
  });

  // 回填延迟绑定的快照记录函数
  onLoadCompleteWrapper = onLoadComplete;

  // Step 3: 创建 Tiptap editor（大文档用空占位初始化）
  const initContent = isLargeDocument.value ? EMPTY_PARAGRAPH_JSON : normalizeEditorContent(bodyContent.value ?? '');

  const initContentType = isLargeDocument.value ? undefined : ((bodyContent.value ? 'markdown' : undefined) as 'markdown' | undefined);

  const initEditable = isLargeDocument.value ? false : editable.value;

  const editorInstance = useEditor({
    content: initContent,
    extensions: editorExtensions,
    editable: initEditable,
    contentType: initContentType,
    editorProps: {
      handleDrop: () => true,
      attributes: { spellcheck: 'false', draggable: 'false' },
      handlePaste: onPaste,
      handleKeyDown: (_, event) => {
        const canEdit = effectiveEditable.value;

        const key = event.key.toLowerCase();
        const isTab = key === 'tab';
        const isSelectAll = (event.ctrlKey || event.metaKey) && key === 'a' && !event.shiftKey && !event.altKey;
        const isUndo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
        const isRedo = (event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey));

        if (isSelectAll) {
          const instance = editorInstanceRef.value;
          if (!instance) return false;
          if (!canEdit) return true;
          if (handleRichSelectAllKeyboardEvent(instance, event)) return true;
        }

        if (isTab && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const instance = editorInstanceRef.value;
          if (!instance || !canEdit) return true;
          if (instance.isActive('table') || instance.isActive('listItem')) return false;

          event.preventDefault();
          if (event.shiftKey) {
            const { from, empty } = instance.state.selection;
            if (!empty || from <= 2) return true;
            const before = instance.state.doc.textBetween(from - 2, from, '\0', '\0');
            if (before === '  ') instance.commands.deleteRange({ from: from - 2, to: from });
            return true;
          }
          instance.commands.insertContent(instance.isActive('codeBlock') ? '\t' : '  ');
          return true;
        }

        if (isUndo || isRedo) {
          if (!canEdit) {
            event.preventDefault();
            return true;
          }

          return false;
        }
        return false;
      },
      handleDOMEvents: {
        dragstart: (_view, event) => {
          event.preventDefault();
          return true;
        },
        drop: (_view, event) => {
          event.preventDefault();
          return true;
        }
      }
    },
    onUpdate: (payload) => {
      onEditorUpdate(payload);
    }
  });

  watch(
    editorInstance,
    (instance) => {
      editorInstanceRef.value = instance;
      if (instance) {
        if (isLargeDocument.value) {
          const content = bodyContent.value;
          if (content) {
            startLoad(content);
          }
        } else {
          rememberImportedContent(bodyContent.value ?? '');
        }
      }
    },
    { immediate: true }
  );

  watch(bodyContent, (content) => {
    const instance = editorInstanceRef.value;
    if (!instance) return;

    if (isLargeDocument.value) {
      const { phase } = loadState.value;

      if (phase === 'loading') {
        const source = getLoadSource();
        if (content !== source && content) {
          cancelLoad('external-change');
          startLoad(content, { isReload: true });
        }
      } else if (phase === 'ready') {
        const currentContent = getPersistedMarkdown(instance);
        if (!isEquivalentToImportedContent(content, currentContent) && currentContent !== content) {
          startLoad(content ?? '', { isReload: true });
        }
      } else if (phase === 'failed') {
        if (content && (content?.length ?? 0) > LARGE_DOCUMENT_THRESHOLD) {
          startLoad(content, { isReload: true });
        }
      }
    } else {
      const currentContent = getPersistedMarkdown(instance);
      if (isEquivalentToImportedContent(content, currentContent)) return;
      if (currentContent === content) return;
      setEditorContent(content ?? '', false);
    }
  });

  function setContent(text: string): void {
    setEditorContent(text, false);
  }

  return {
    editorInstance,
    editorInstanceRef,
    setContent,
    isLargeDocument,
    loadState: exposedLoadState,
    startLoad,
    cancelLoad,
    retryLoad,
    isLoadTransaction,
    getLoadSource
  };
}
