<!--
  @file index.vue
  @description Chat sidebar with conversation, prompt input, and model selection wiring.
-->
<template>
  <div class="b-chat-sidebar">
    <div class="b-chat-sidebar__header">
      <div class="b-chat-sidebar__title truncate">{{ currentSession?.title || '新会话' }}</div>
      <BButton square size="small" type="text" :disabled="chatStream.loading.value" @click="handleNewSession">
        <Icon icon="lucide:message-circle-plus" width="16" height="16" />
      </BButton>
      <SessionHistory
        ref="sessionHistoryRef"
        v-model:current-session="currentSession"
        :active-session-id="settingStore.chatSidebarActiveSessionId"
        :disabled="chatStream.loading.value"
        @switch-session="handleSwitchSession"
      />

      <div class="divider"></div>
      <BButton square size="small" type="text" @click="settingStore.setSidebarVisible(false)">
        <Icon icon="lucide:x" width="16" height="16" />
      </BButton>
    </div>
    <div class="b-chat-sidebar__container">
      <ConversationView
        ref="conversationRef"
        v-model:messages="messages"
        :loading="chatStream.loading.value"
        :on-load-history="handleLoadHistory"
        @edit="handleChatEdit"
        @regenerate="handleChatRegenerate"
        @confirmation-action="handleConfirmationAction"
        @user-choice-submit="handleChatUserChoiceSubmit"
      />

      <UsagePanel
        v-if="usagePanelOpen"
        :loading="usagePanelLoading"
        :usage="usagePanelUsage"
        :error="usagePanelError"
      />

      <div class="b-chat-sidebar__input">
        <div class="b-chat-sidebar__input-container">
          <BPromptEditor
            ref="promptEditorRef"
            v-model:value="inputValue"
            placeholder="输入消息..."
            :max-height="200"
            :chip-resolver="chipResolver"
            :on-paste-files="onPasteFiles"
            :slash-commands="chatSlashCommands"
            submit-on-enter
            @slash-command="handleSlashCommand"
            @submit="handleChatSubmit"
          />

          <InputToolbar
            ref="modelSelectorRef"
            :loading="chatStream.loading.value"
            :input-value="inputValue"
            :selected-model="selectedModel"
            @submit="handleChatSubmit"
            @abort="chatStream.abort"
            @model-change="handleModelChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileReferenceChip } from './types';
import type { AIUsage } from 'types/ai';
import type { ChatMessageConfirmationAction, ChatMessageFileReference, ChatSession } from 'types/chat';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { nanoid } from 'nanoid';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { getDefaultChatToolNames } from '@/ai/tools/policy';
import BButton from '@/components/BButton/index.vue';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';
import { chipResolver } from '@/components/BChatSidebar/utils/chipResolver';
import { create, userChoice } from '@/components/BChatSidebar/utils/messageHelper';
import { persistReferenceSnapshots } from '@/components/BChatSidebar/utils/referenceSnapshot';
import type { Message } from '@/components/BChatSidebar/utils/types';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import type { SlashCommandOption } from '@/components/BPromptEditor/types';
import { onChatFileReferenceInsert, type ChatFileReferenceInsertPayload } from '@/shared/chat/fileReference';
import { serviceModelsStorage } from '@/shared/storage';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';
import ConversationView from './components/ConversationView.vue';
import InputToolbar from './components/InputToolbar.vue';
import UsagePanel from './components/UsagePanel.vue';
import SessionHistory from './components/SessionHistory.vue';
import { useAutoName } from './hooks/useAutoName';
import { useChatHistory } from './hooks/useChatHistory';
import { useChatStream } from './hooks/useChatStream';
import { createChatConfirmationController } from './utils/confirmationController';

/**
 * 鏂囦欢绮樿创/鎷栨嫿鍥炶皟锛屽皢鏂囦欢鍒楄〃杞崲涓?file-ref token锛堟棤閫夊尯锛宻tartLine/endLine 鍧囦负 0锛夈€?
 */
const onPasteFiles = (files: File[]): string => {
  return Array.from(files)
    .map((file) => `{{file-ref:${encodeURIComponent(file.name)}|${file.name}|0|0}} `)
    .join('');
};

/** 鑱婂ぉ鏁版嵁瀛樺偍 */
const chatStore = useChatStore();
/** 搴旂敤璁剧疆瀛樺偍 */
const settingStore = useSettingStore();

/** 鑱婂ぉ杈撳叆妗嗗唴瀹?*/
const inputValue = ref('');
/** 褰撳墠浼氳瘽淇℃伅 */
const currentSession = ref<ChatSession | undefined>(undefined);
/** 浼氳瘽鍔犺浇鐘舵€?*/
const loading = ref(false);
/** 鍘嗗彶娑堟伅鍔犺浇鐘舵€?*/
const historyLoading = ref(false);
/** 鏄惁杩樻湁鏇村鍘嗗彶娑堟伅鍙姞杞?*/
const hasMoreHistory = ref(false);
/** 杈撳叆妗嗙紪杈戝櫒寮曠敤 */
const promptEditorRef = ref<InstanceType<typeof BPromptEditor>>();
/** 模型选择器程序化打开入口。 */
const modelSelectorRef = ref<InstanceType<typeof InputToolbar>>();
/** 瀵硅瘽瑙嗗浘寮曠敤 */
const conversationRef = ref<InstanceType<typeof ConversationView>>();
/** 浼氳瘽鍘嗗彶缁勪欢寮曠敤 */
const sessionHistoryRef = ref<InstanceType<typeof SessionHistory>>();
/** 鑽夌鏂囦欢寮曠敤鍒楄〃 */
const draftReferences = ref<ChatMessageFileReference[]>([]);
/** 褰撳墠閫変腑鐨勬ā鍨?*/
const selectedModel = ref<string>();
/** 用量面板是否已展开。 */
const usagePanelOpen = ref(false);
/** 用量面板加载状态。 */
const usagePanelLoading = ref(false);
/** 持久化会话用量。 */
const usagePanelUsage = ref<AIUsage | undefined>(undefined);
/** 用量面板错误信息。 */
const usagePanelError = ref<string | undefined>(undefined);

/** 鑱婂ぉ鍘嗗彶鍔犺浇鐘舵€佸拰鏂规硶 */
const { getHistoryCursor, setLoadedMessages, fetchAllPriorHistory, messages } = useChatHistory();

/** 纭鎺у埗鍣紝绠＄悊宸ュ叿璋冪敤鐨勭敤鎴风‘璁ゆ祦绋?*/
const confirmationController = createChatConfirmationController({
  getMessages: () => messages.value
});

/**
 * 鑷姩鍛藉悕 Hook銆?
 * 鍦ㄩ杞?assistant 瀹屾垚鏃跺喕缁撳揩鐓э紝骞跺湪娴佸紡鐪熸鍋滅ǔ鍚庡紓姝ョ敓鎴愭爣棰樸€?
 */
const { captureSnapshot, scheduleAutoName } = useAutoName({
  getCurrentSession: () => currentSession.value,
  getFirstRoundContent: (message) => {
    // 棣栬疆濡傛灉浠嶅湪绛夊緟鐢ㄦ埛琛ュ厖杈撳叆锛屽垯涓嶅簲鎻愬墠瑙﹀彂鑷姩鍛藉悕銆?
    if (userChoice.findPending(messages.value)) {
      return null;
    }

    // 浠呭湪棣栬疆鎭板ソ褰㈡垚涓€闂竴绛旀椂鎵嶅弬涓庤嚜鍔ㄥ懡鍚嶃€?
    const userMessages = messages.value.filter((item) => item.role === 'user');
    const assistantMessages = messages.value.filter((item) => item.role === 'assistant');
    if (userMessages.length !== 1 || assistantMessages.length !== 1) return null;

    return {
      userMessage: userMessages[0].content,
      aiResponse: message.content
    };
  },
  onTitlePersisted: async () => {
    await sessionHistoryRef.value?.refreshSessions();
  }
});

let unregisterFileReferenceInsert: (() => void) | null = null;

/**
 * 鍔犺浇褰撳墠閫変腑鐨勬ā鍨嬮厤缃?
 */
async function loadSelectedModel(): Promise<void> {
  const config = await serviceModelsStorage.getConfig('chat');
  selectedModel.value = config?.providerId && config?.modelId ? `${config.providerId}:${config.modelId}` : undefined;
}

/**
 * 鑱婂ぉ宸ュ叿鍒楄〃
 * 鍒涘缓鍐呯疆宸ュ叿骞惰繃婊ゅ嚭榛樿鍏佽鐨勪綆椋庨櫓宸ュ叿锛岄伩鍏嶆毚闇叉浛鎹㈢被鎿嶄綔
 */
const tools = createBuiltinTools({
  confirm: confirmationController.createAdapter(),
  getPendingQuestion: () => {
    const pendingQuestion = userChoice.findPending(messages.value);
    if (!pendingQuestion) return null;

    return {
      questionId: pendingQuestion.questionId,
      toolCallId: pendingQuestion.toolCallId
    };
  }
}).filter((tool) => {
  // MVP 闃舵鑱婂ぉ渚ц竟鏍忓彧寮€鏀句綆椋庨櫓宸ュ叿锛岄伩鍏嶉粯璁ゆ毚闇叉浛鎹㈢被鎿嶄綔
  return getDefaultChatToolNames().includes(tool.definition.name);
});

/**
 * 澶勭悊鑱婂ぉ娴佷腑鐨勭‘璁ゅ崱鐗囨搷浣溿€?
 * @param confirmationId - 纭椤?ID
 * @param action - 鐢ㄦ埛鎿嶄綔
 */
async function handleConfirmationAction(confirmationId: string, action: ChatMessageConfirmationAction): Promise<void> {
  if (action === 'approve') {
    confirmationController.approveConfirmation(confirmationId);
  } else if (action === 'approve-session') {
    confirmationController.approveConfirmation(confirmationId, 'session');
  } else if (action === 'approve-always') {
    confirmationController.approveConfirmation(confirmationId, 'always');
  } else {
    confirmationController.cancelConfirmation(confirmationId);
  }
}

/**
 * 娑堟伅閲嶆柊鐢熸垚鍓嶇殑澶勭悊鍑芥暟
 * 1. 娓呯悊寰呭鐞嗙殑纭鐘舵€?
 * 2. 鍔犺浇褰撳墠鍙娑堟伅涔嬪墠鐨勬墍鏈夋寔涔呭寲鍘嗗彶
 * 3. 鍚堝苟鍘嗗彶娑堟伅鍜屾柊鐨勬秷鎭垪琛ㄥ苟鎸佷箙鍖?
 * @param nextMessages - 閲嶆柊鐢熸垚鍚庣殑娑堟伅鍒楄〃
 */
async function handleBeforeRegenerate(nextMessages: Message[]): Promise<void> {
  confirmationController.expirePendingConfirmation();
  const sessionId = settingStore.chatSidebarActiveSessionId;
  if (!sessionId) return;

  const historyMessages = await fetchAllPriorHistory(sessionId);
  await chatStore.setSessionMessages(sessionId, [...historyMessages, ...nextMessages]);
}

/**
 * 娑堟伅鍙戦€佸墠鐨勫鐞嗗嚱鏁?
 * 1. 娓呯悊寰呭鐞嗙殑纭鐘舵€?
 * 2. 濡傛灉娌℃湁婵€娲讳細璇濆垯鍒涘缓鏂颁細璇?
 * 3. 灏嗘秷鎭寔涔呭寲鍒板瓨鍌?
 * @param message - 寰呭彂閫佺殑娑堟伅
 */
async function handleBeforeSend(message: Message): Promise<void> {
  confirmationController.expirePendingConfirmation();
  await persistReferenceSnapshots(message);

  if (!settingStore.chatSidebarActiveSessionId) {
    const session = await chatStore.createSession('assistant', { title: message.content });

    settingStore.setChatSidebarActiveSessionId(session.id);
  }

  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
}

/**
 * 娑堟伅瀹屾垚鍚庣殑澶勭悊鍑芥暟
 * 灏?AI 鍥炲鐨勬秷鎭寔涔呭寲鍒板瓨鍌?
 * @param message - 瀹屾垚鐨勬秷鎭?
 */
async function handleComplete(message: Message): Promise<void> {
  const sessionId = settingStore.chatSidebarActiveSessionId;
  const snapshot = captureSnapshot(message, sessionId);

  await chatStore.addSessionMessage(sessionId, message);
  if (sessionId) {
    await refreshUsagePanel(sessionId);
  }
  if (!snapshot) return;

  // eslint-disable-next-line no-use-before-define
  scheduleAutoName(snapshot, () => chatStream.loading.value);
}

/**
 * 鑱婂ぉ娴佸紡澶勭悊 hook
 */
const chatStream = useChatStream({
  messages,
  tools,
  getToolContext: editorToolContextRegistry.getCurrentContext,
  onBeforeRegenerate: handleBeforeRegenerate,
  onComplete: handleComplete,
  onConfirmationAction: handleConfirmationAction
});

/**
 * 鑾峰彇鍐呭涓椿璺冪殑鑽夌鏂囦欢寮曠敤
 * @param content - 杈撳叆鍐呭
 * @returns 娲昏穬鐨勫紩鐢ㄥ垪琛?
 */
function getActiveDraftReferences(content: string) {
  const references = draftReferences.value.filter((reference) => content.includes(reference.token));

  return references.length ? references : undefined;
}

async function handleChatSubmit(): Promise<void> {
  const content = inputValue.value.trim();
  if (!content) return;

  const config = await chatStream.resolveServiceConfig();
  if (!config) return;

  const references = getActiveDraftReferences(content);
  const message = create.userMessage(content, references);

  await handleBeforeSend(message);
  messages.value.push(message);
  conversationRef.value?.scrollToBottom({ behavior: 'auto' });
  promptEditorRef.value?.focus();
  inputValue.value = '';
  draftReferences.value = [];

  await chatStream.streamMessages(messages.value, config);
}

function handleChatEdit(message: Message): void {
  inputValue.value = message.content;
  draftReferences.value = [...(message.references ?? [])];
}

async function handleChatRegenerate(message: Message): Promise<void> {
  await chatStream.regenerate(message);
}

async function handleChatUserChoiceSubmit(answer: import('types/chat').AIUserChoiceAnswerData): Promise<void> {
  await chatStream.submitUserChoice(answer);
}

function handleFocusInput(): void {
  promptEditorRef.value?.focus();
}

function handleCaptureInputCursor(): void {
  promptEditorRef.value?.saveCursorPosition();
}

/**
 * 灏?startLine/endLine 杞崲涓?ChatMessageFileReference.line 瀛楃涓叉牸寮忋€?
 * @param startLine - 璧峰琛屽彿
 * @param endLine - 缁撴潫琛屽彿
 */
function formatLineRange(startLine: number, endLine: number): string {
  if (startLine <= 0) {
    return '';
  }

  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function handleChatInsertFileReference(reference: FileReferenceChip): void {
  const token = `{{file-ref:${reference.referenceId}|${reference.fileName}|${reference.startLine}|${reference.endLine}}} `;
  draftReferences.value = [
    ...draftReferences.value.filter((item) => item.id !== reference.referenceId),
    {
      id: reference.referenceId,
      token,
      documentId: reference.documentId,
      fileName: reference.fileName,
      line: formatLineRange(reference.startLine, reference.endLine),
      path: reference.filePath,
      snapshotId: ''
    }
  ];
  promptEditorRef.value?.insertTextAtCursor(token);
}

async function handleFileReferenceInsert(reference: ChatFileReferenceInsertPayload): Promise<void> {
  const toolContext = editorToolContextRegistry.getCurrentContext();
  const enrichedReference: FileReferenceChip = {
    referenceId: nanoid(),
    documentId: toolContext?.document.id || reference.filePath || reference.fileName,
    filePath: reference.filePath ?? toolContext?.document.path ?? null,
    fileName: reference.fileName,
    startLine: reference.startLine,
    endLine: reference.endLine
  };

  // 鍏堥攣瀹氳亰澶╄緭鍏ユ鏈€杩戜竴娆℃湁鏁堟彃鍏ヤ綅缃紝鍐嶅鐞嗕晶杈规爮鑱氱劍涓庡紩鐢ㄦ彃鍏ャ€?
  handleCaptureInputCursor();
  settingStore.setSidebarVisible(true);

  await nextTick();
  handleChatInsertFileReference(enrichedReference);
  handleFocusInput();
}

function handleModelChange(value: string): void {
  selectedModel.value = value;
}

/**
 * 处理斜杠命令。
 * 支持 /model、/usage、/new 和 /clear。
 * @param command - 斜杠命令项
 */
function handleSlashCommand(command: SlashCommandOption): void {
  if (command.id === 'model') {
    modelSelectorRef.value?.open();
    return;
  }

  if (command.id === 'usage') {
    void handleUsagePanelOpen();
    return;
  }

  if (command.id === 'new') {
    void handleNewSession();
    return;
  }

  if (command.id === 'clear') {
    handleClearDraft();
  }
}

/**
 * Reset the usage panel state so a later command can reload fresh data.
 */
function resetUsagePanel(): void {
  usagePanelOpen.value = false;
  usagePanelLoading.value = false;
  usagePanelUsage.value = undefined;
  usagePanelError.value = undefined;
}

/**
 * Clear the current draft input and file references without affecting the conversation.
 */
function handleClearDraft(): void {
  inputValue.value = '';
  draftReferences.value = [];
  promptEditorRef.value?.focus();
}

/**
 * Open the usage panel immediately and read the persisted session usage.
 */
async function handleUsagePanelOpen(): Promise<void> {
  const sessionId = settingStore.chatSidebarActiveSessionId ?? currentSession.value?.id;
  usagePanelOpen.value = true;
  usagePanelError.value = undefined;
  usagePanelUsage.value = undefined;

  if (!sessionId) {
    usagePanelLoading.value = false;
    return;
  }

  usagePanelLoading.value = true;

  await refreshUsagePanel(sessionId);
}

/**
 * Reload the visible usage totals for the active session while keeping panel state stable.
 * @param sessionId - Session whose persisted usage should be displayed.
 */
async function refreshUsagePanel(sessionId: string): Promise<void> {
  const activeSessionId = settingStore.chatSidebarActiveSessionId ?? currentSession.value?.id;
  if (!usagePanelOpen.value || activeSessionId !== sessionId) {
    return;
  }

  try {
    const usage = await chatStore.getSessionUsage(sessionId);
    if ((settingStore.chatSidebarActiveSessionId ?? currentSession.value?.id) !== sessionId) {
      return;
    }

    usagePanelUsage.value = usage;
  } catch (error: unknown) {
    if ((settingStore.chatSidebarActiveSessionId ?? currentSession.value?.id) !== sessionId) {
      return;
    }

    usagePanelError.value = error instanceof Error ? error.message : '加载会话用量失败';
  } finally {
    if ((settingStore.chatSidebarActiveSessionId ?? currentSession.value?.id) === sessionId) {
      usagePanelLoading.value = false;
    }
  }
}

/**
 * 鍒涘缓鏂颁細璇?
 * 1. 妫€鏌ユ槸鍚︽鍦ㄨ緭鍑猴紝鏄垯涓柇
 * 2. 娓呯悊纭鎺у埗鍣ㄧ姸鎬?
 * 3. 閲嶇疆浼氳瘽鐩稿叧鐘舵€?
 * 4. 鑷姩鑱氱劍杈撳叆妗?
 */
async function handleNewSession(): Promise<void> {
  if (chatStream.loading.value) return;

  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(null);
  currentSession.value = undefined;
  resetUsagePanel();
  messages.value = [];
  hasMoreHistory.value = false;
  historyLoading.value = false;
  // 鏂颁細璇濆垱寤哄悗鑷姩鑱氱劍杈撳叆妗嗭紝鎻愬崌鐢ㄦ埛浣撻獙
  await nextTick();
  promptEditorRef.value?.focus();
}

/**
 * 鍒囨崲浼氳瘽
 * 1. 妫€鏌ユ槸鍚︽鍦ㄨ緭鍑烘垨鍔犺浇涓紝鏄垯涓柇
 * 2. 娓呯悊纭鎺у埗鍣ㄧ姸鎬?
 * 3. 鏇存柊婵€娲讳細璇?ID
 * 4. 鍔犺浇鏂颁細璇濈殑娑堟伅鍒楄〃
 * @param sessionId - 鐩爣浼氳瘽 ID
 */
async function handleSwitchSession(sessionId: string): Promise<void> {
  if (chatStream.loading.value) return;
  if (loading.value) return;

  loading.value = true;
  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(sessionId);
  resetUsagePanel();
  hasMoreHistory.value = false;

  try {
    setLoadedMessages(await chatStore.getSessionMessages(sessionId));
  } finally {
    loading.value = false;
  }
}

/**
 * 鍔犺浇褰撳墠浼氳瘽涓洿鏃╃殑涓€娈靛巻鍙叉秷鎭€?
 */
async function handleLoadHistory(): Promise<void> {
  if (historyLoading.value || !hasMoreHistory.value) return;

  const sessionId = settingStore.chatSidebarActiveSessionId;
  const cursor = getHistoryCursor();
  if (!sessionId || !cursor) return;

  historyLoading.value = true;

  try {
    const historyMessages = await chatStore.getSessionMessages(sessionId, cursor);
    hasMoreHistory.value = historyMessages.length > 0;
    if (!historyMessages.length) return;

    messages.value = [...historyMessages, ...messages.value];
  } finally {
    historyLoading.value = false;
  }
}

onMounted(async () => {
  loadSelectedModel();
  if (settingStore.chatSidebarActiveSessionId) {
    setLoadedMessages(await chatStore.getSessionMessages(settingStore.chatSidebarActiveSessionId));
  }

  unregisterFileReferenceInsert = onChatFileReferenceInsert((reference) => {
    handleFileReferenceInsert(reference);
  });
});

/** 缁勪欢鍗歌浇鏃舵竻鐞嗙‘璁ゆ帶鍒跺櫒 */
onUnmounted(() => {
  unregisterFileReferenceInsert?.();
  unregisterFileReferenceInsert = null;
  confirmationController.dispose();
});
</script>

<style>
.b-chat-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  margin-right: 6px;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}

.b-chat-sidebar__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.b-chat-sidebar__title {
  flex: 1;
  width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.divider {
  width: 1px;
  height: 16px;
  background-color: var(--border-secondary);
}

.b-chat-sidebar__container {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 0;
}

.b-chat-sidebar__input {
  padding: 12px;
  border-top: 1px solid var(--border-primary);
}

.b-chat-sidebar__input-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
  padding: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-primary);
  border-radius: 6px;

}

.b-chat-sidebar__input-container .b-prompt-editor {
  flex: 1;
  min-width: 0;
  padding: 0;
  background-color: transparent;
  border: none;
  border-radius: 0;
}

.b-chat-sidebar__input-container .b-prompt-editor:focus-within {
  box-shadow: none;
}
</style>

