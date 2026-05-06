/**
 * @file useSelectionAssistant.ts
 * @description 选区工具统一编排层，管理选区工作流状态机、缓存、高亮同步与事件分发。
 *
 * eslint-disable no-use-before-define — 嵌套 function 声明享有作用域 hoisting，运行时不存在引用顺序问题
 * eslint-disable default-case — 状态机 switch 全覆盖所有 SelectionAssistantStatus 枚举值
 * eslint-disable no-lonely-if — else 内的 if 是对特定状态的二次判断，语义独立
 */
/* eslint-disable no-use-before-define, default-case, no-lonely-if */
import type {
  SelectionAssistantAdapter,
  SelectionAssistantCapabilities,
  SelectionAssistantPosition,
  SelectionAssistantRange
} from '../adapters/selectionAssistant';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { emitChatFileReferenceInsert } from '@/shared/chat/fileReference';

/**
 * 选区工具状态机状态枚举。
 */
export type SelectionAssistantStatus = 'idle' | 'toolbar-visible' | 'ai-input-visible' | 'ai-streaming' | 'reference-highlight';

/**
 * useSelectionAssistant 的配置选项。
 */
export interface UseSelectionAssistantOptions {
  /** adapter 的响应式 getter，允许延迟绑定或动态切换 */
  adapter: () => SelectionAssistantAdapter | null;
  /** 编辑器是否可编辑 */
  isEditable?: () => boolean;
}

/**
 * 选区工具统一编排 hook。
 * @param options - 配置选项
 * @returns 编排层对外暴露的状态与方法
 */
export function useSelectionAssistant(options: UseSelectionAssistantOptions) {
  // ---- 核心状态 ----
  const status = ref<SelectionAssistantStatus>('idle');
  const cachedSelectionRange = ref<SelectionAssistantRange | null>(null);
  const toolbarPosition = ref<SelectionAssistantPosition | null>(null);
  const panelPosition = ref<SelectionAssistantPosition | null>(null);
  const stickyHighlightRange = ref<SelectionAssistantRange | null>(null);
  const capabilities = ref<SelectionAssistantCapabilities>({ actions: {} });
  const awaitingSelectionSyncAfterFocus = ref(false);
  const pointerSelectionActive = ref(false);

  // ---- 派生状态 ----
  /** 工具栏是否可见 */
  const toolbarVisible = computed(() => status.value === 'toolbar-visible' && !pointerSelectionActive.value);

  /** AI 输入面板是否可见（含流式生成中） */
  const aiInputVisible = computed<boolean>(() => status.value === 'ai-input-visible' || status.value === 'ai-streaming');

  /** AI 按钮是否可用（按用户要求，仅由能力声明决定显示） */
  const isAIActionAvailable = computed(() => capabilities.value.actions?.ai === true);

  /** 引用按钮是否可用 */
  const isReferenceActionAvailable = computed(() => capabilities.value.actions?.reference === true);

  // ---- 事件绑定 ----
  let cleanupAdapterEvents: (() => void) | undefined;

  /**
   * 绑定 adapter 的选区事件并开始监听。
   */
  function bindAdapterEvents(): void {
    cleanupAdapterEvents?.();
    const adapter = options.adapter();
    if (!adapter) {
      return;
    }

    capabilities.value = adapter.getCapabilities();

    cleanupAdapterEvents = adapter.bindSelectionEvents({
      onSelectionChange() {
        handleSelectionChange();
      },
      onFocus() {
        handleFocus();
      },
      onBlur() {
        handleBlur();
      },
      onPointerSelectionStart() {
        handlePointerSelectionStart();
      },
      onPointerSelectionEnd() {
        handlePointerSelectionEnd();
      },
      onPointerDownInsideEditor() {
        handlePointerDownInsideEditor();
      },
      onPointerDownOutsideEditor() {
        // 点击编辑器外部不立即清理粘性高亮
        // 粘性高亮在重新聚焦编辑器时由 handleFocus 收敛
      },
      onEscape() {
        clearAll();
      }
    });
  }

  // ---- 状态迁移 ----
  /**
   * 执行状态迁移。
   * @param newStatus - 目标状态
   */
  function transitionTo(newStatus: SelectionAssistantStatus): void {
    status.value = newStatus;
  }

  /**
   * 处理选区变化：同步缓存、高亮、定位与状态。
   */
  function handleSelectionChange(): void {
    const adapter = options.adapter();
    if (!adapter) {
      return;
    }

    // 不可编辑时仅允许 reference-highlight 继续保留高亮，不处理其他交互
    const editable = options.isEditable ? options.isEditable() : true;
    if (!editable) {
      return;
    }

    const selection = adapter.getSelection();

    // 无有效选区 → 按当前状态决定下一步
    if (!selection) {
      if (awaitingSelectionSyncAfterFocus.value) {
        awaitingSelectionSyncAfterFocus.value = false;
        clearStickyHighlight();
        transitionTo('idle');
        cachedSelectionRange.value = null;
        toolbarPosition.value = null;
        panelPosition.value = null;
        return;
      }

      if (status.value === 'reference-highlight') {
        // 粘性高亮状态不主动清理，等待内部重新聚焦收敛
        return;
      }
      clearAll();
      return;
    }

    // 更新缓存
    cachedSelectionRange.value = { ...selection };

    if (pointerSelectionActive.value) {
      adapter.showSelectionHighlight(selection);
      return;
    }

    if (awaitingSelectionSyncAfterFocus.value) {
      awaitingSelectionSyncAfterFocus.value = false;
      clearStickyHighlight();
      transitionTo('toolbar-visible');
      recomputeToolbarPosition();
      adapter.showSelectionHighlight(selection);
      return;
    }

    // 根据当前状态决定下一步
    switch (status.value) {
      case 'idle':
      case 'reference-highlight':
        // 新选区出现：清除粘性高亮，进入工具栏显示
        if (status.value === 'reference-highlight') {
          clearStickyHighlight();
        }
        transitionTo('toolbar-visible');
        recomputeToolbarPosition();
        adapter.showSelectionHighlight(selection);
        break;
      case 'toolbar-visible':
        recomputeToolbarPosition();
        adapter.showSelectionHighlight(selection);
        break;
      case 'ai-input-visible':
      case 'ai-streaming':
        // AI 面板打开期间，选区变化不关闭面板，但更新高亮和面板位置
        adapter.showSelectionHighlight(selection);
        recomputePanelPosition();
        break;
    }
  }

  /**
   * 处理编辑器获得焦点。
   */
  function handleFocus(): void {
    // 粘性高亮在下一次真实选区同步时收敛，避免 focus 时机过早读取到旧选区。
    if (status.value === 'reference-highlight') {
      awaitingSelectionSyncAfterFocus.value = true;
    }
  }

  /**
   * 处理编辑器失去焦点（blur）。
   * 只做高亮同步，不直接改变 UI 状态。
   * 工具栏隐藏/恢复由各 adapter host 自行处理（如 rich 的 BubbleMenu blur 恢复）。
   */
  function handleBlur(): void {
    // 预留：未来可用于统一关闭非粘性工具栏
  }

  /**
   * 处理 source 模式拖拽选区开始。
   * 拖拽过程中保留高亮同步，但隐藏工具栏，避免 toolbar 在 selection 尚未完成时持续显示。
   */
  function handlePointerSelectionStart(): void {
    pointerSelectionActive.value = true;
    transitionTo('idle');
    toolbarPosition.value = null;
  }

  /**
   * 处理 source 模式拖拽选区结束。
   * 此时以最终真实选区为准决定是否显示 toolbar。
   */
  function handlePointerSelectionEnd(): void {
    pointerSelectionActive.value = false;
    handleSelectionChange();
  }

  /**
   * 处理编辑器内部 pointerdown。
   * source 模式开始新一轮拖选时，先撤掉上一轮持久高亮，
   * 避免旧高亮残留到下一次 mouseup/selectionChange 才清除。
   */
  function handlePointerDownInsideEditor(): void {
    const adapter = options.adapter();
    if (!adapter) {
      return;
    }

    switch (status.value) {
      case 'reference-highlight':
        clearStickyHighlight();
        transitionTo('idle');
        cachedSelectionRange.value = null;
        toolbarPosition.value = null;
        panelPosition.value = null;
        break;
      case 'toolbar-visible':
        adapter.clearSelectionHighlight();
        transitionTo('idle');
        cachedSelectionRange.value = null;
        toolbarPosition.value = null;
        break;
      case 'ai-input-visible':
      case 'ai-streaming':
        // AI 面板保持打开，但先撤掉旧高亮，等待新的 selectionChange 同步新范围。
        adapter.clearSelectionHighlight();
        break;
      case 'idle':
        break;
    }
  }

  // ---- 动作 ----

  /**
   * 点击"AI 助手"按钮，打开 AI 输入面板。
   */
  function openAIInput(): void {
    const range = cachedSelectionRange.value;
    if (!range) {
      return;
    }

    const adapter = options.adapter();
    if (!adapter) {
      return;
    }

    // 清理原生选中态，让视觉层退回到高亮实现
    adapter.clearNativeSelection?.();
    adapter.showSelectionHighlight(range);
    recomputePanelPosition();
    transitionTo('ai-input-visible');
  }

  /**
   * 关闭 AI 输入面板，回到 idle。
   */
  function closeAIInput(): void {
    const adapter = options.adapter();
    adapter?.clearSelectionHighlight();
    transitionTo('idle');
    cachedSelectionRange.value = null;
    panelPosition.value = null;
    toolbarPosition.value = null;
  }

  /**
   * AI 流式生成完成后应用内容。
   * @param content - AI 生成的内容
   */
  async function applyAIResult(content: string): Promise<void> {
    const range = cachedSelectionRange.value;
    const adapter = options.adapter();
    if (!range || !adapter) {
      return;
    }

    // 校验 range 是否仍然有效
    if (adapter.isRangeStillValid && !adapter.isRangeStillValid(range)) {
      transitionTo('ai-input-visible');
      return;
    }

    try {
      await adapter.applyGeneratedContent(range, content);
      // 应用成功后清理高亮，回到 idle
      adapter.clearSelectionHighlight();
      transitionTo('idle');
      cachedSelectionRange.value = null;
      panelPosition.value = null;
      toolbarPosition.value = null;
    } catch (error) {
      transitionTo('ai-input-visible');
    }
  }

  /**
   * AI 流式生成完成后取消（保留输入状态）。
   */
  function cancelAIStreaming(): void {
    if (status.value === 'ai-streaming') {
      transitionTo('ai-input-visible');
    }
  }

  /**
   * 设置 AI 流式生成状态。
   * @param streaming - 是否正在流式生成
   */
  function setStreaming(streaming: boolean): void {
    if (streaming) {
      // 只有在 ai-input-visible 状态下才能进入流式
      if (status.value === 'ai-input-visible') {
        transitionTo('ai-streaming');
      }
    } else {
      // 流式结束但未应用 → 回到输入态
      if (status.value === 'ai-streaming') {
        transitionTo('ai-input-visible');
      }
    }
  }

  /**
   * 点击"插入对话"按钮，发送文件引用并进入粘性高亮状态。
   */
  function insertReference(): void {
    const range = cachedSelectionRange.value;
    const adapter = options.adapter();
    if (!range || !adapter) {
      return;
    }

    // 构造文件引用载荷并发送
    const payload = adapter.buildSelectionReference(range);
    if (payload) {
      emitChatFileReferenceInsert(payload);
    }

    // 保留视觉高亮，进入粘性高亮状态
    adapter.showSelectionHighlight(range);
    stickyHighlightRange.value = { ...range };
    transitionTo('reference-highlight');

    // 收起工具栏
    toolbarPosition.value = null;
  }

  // ---- 定位重算 ----
  /**
   * 重新计算工具栏浮层位置。
   */
  function recomputeToolbarPosition(): void {
    const adapter = options.adapter();
    const range = cachedSelectionRange.value;
    if (!adapter || !range) {
      toolbarPosition.value = null;
      return;
    }
    toolbarPosition.value = adapter.getToolbarPosition(range);
  }

  /**
   * 重新计算 AI 面板浮层位置。
   */
  function recomputePanelPosition(): void {
    const adapter = options.adapter();
    const range = cachedSelectionRange.value;
    if (!adapter || !range) {
      panelPosition.value = null;
      return;
    }
    panelPosition.value = adapter.getPanelPosition(range);
  }

  /**
   * 重新计算所有浮层位置（用于滚动/窗口尺寸变化时的回调）。
   */
  function recomputeAllPositions(): void {
    recomputeToolbarPosition();
    recomputePanelPosition();
  }

  // ---- 清理 ----
  /**
   * 仅清理粘性高亮（保留其他状态）。
   */
  function clearStickyHighlight(): void {
    const adapter = options.adapter();
    adapter?.clearSelectionHighlight();
    stickyHighlightRange.value = null;
  }

  /**
   * 清理所有选区工具状态。
   */
  function clearAll(): void {
    const adapter = options.adapter();
    adapter?.clearSelectionHighlight();
    status.value = 'idle';
    cachedSelectionRange.value = null;
    toolbarPosition.value = null;
    panelPosition.value = null;
    stickyHighlightRange.value = null;
    awaitingSelectionSyncAfterFocus.value = false;
    pointerSelectionActive.value = false;
  }

  // ---- 生命周期 ----
  // 监听 adapter 变化，支持运行时切换 adapter（如切换编辑模式）
  watch(
    () => options.adapter(),
    (newAdapter, oldAdapter) => {
      if (oldAdapter !== newAdapter) {
        oldAdapter?.dispose?.();
        clearAll();
        bindAdapterEvents();
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    cleanupAdapterEvents?.();
    options.adapter()?.dispose?.();
  });

  return {
    // 状态
    status,
    toolbarVisible,
    aiInputVisible,
    cachedSelectionRange,
    toolbarPosition,
    panelPosition,
    isAIActionAvailable,
    isReferenceActionAvailable,
    // 动作
    openAIInput,
    closeAIInput,
    applyAIResult,
    cancelAIStreaming,
    setStreaming,
    insertReference,
    recomputeAllPositions
  };
}
