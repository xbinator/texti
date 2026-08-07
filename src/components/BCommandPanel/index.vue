<!--
  @file index.vue
  @description 统一命令面板，整合最近记录搜索、跳转语法与模型选择入口。
-->
<template>
  <BModal v-model:open="visible" :mask-closable="true" :width="560" :main-style="{ padding: '10px 0 0 10px' }" @close="closePanel">
    <div :class="bem()">
      <div ref="inputRef" :class="bem('toolbar')">
        <div :class="bem('search-shell')">
          <AInput v-model:value="keyword" :bordered="false" :class="bem('search-input')" placeholder="搜索最近历史记录..." @keydown="handleKeydown" />
          <span v-if="!keyword" :class="bem('search-hint')" aria-hidden="true">输入“?”即可查看可用命令</span>
        </div>
      </div>

      <BScrollbar max-height="420px" inset="vertical">
        <div v-if="hasItems" ref="listRef" :class="bem('list')">
          <template v-for="group in groups" :key="group.key">
            <div v-if="group.title" :class="bem('group-title')">{{ group.title }}</div>
            <button
              v-for="commandItem in group.items"
              :key="commandItem.key"
              :class="bem('item', { active: isKeyboardActive(commandItem), current: commandItem.active })"
              type="button"
              @click="handleSelectItemSafely(commandItem)"
            >
              <RenderItemIcon v-if="!commandItem.hideIcon" :item="commandItem" />

              <div :class="bem('item-main')">
                <span :class="bem('item-title')">{{ commandItem.title }}</span>
                <span v-if="commandItem.description" :class="bem('item-description', { unsaved: commandItem.descriptionClass === 'is-unsaved' })">
                  {{ commandItem.description }}
                </span>
              </div>

              <span v-if="commandItem.meta" :class="bem('item-meta')">{{ commandItem.meta }}</span>

              <div v-if="isRemovableItem(commandItem)" :class="bem('item-delete')" @click.stop="handleRemoveItemSafely(commandItem)">
                <BIcon icon="ic:round-close" :size="12" />
              </div>
            </button>
          </template>
        </div>

        <div v-else :class="bem('empty')">{{ emptyText }}</div>
      </BScrollbar>
    </div>
  </BModal>
</template>

<script setup lang="tsx">
import type { CommandPanelActionItem, CommandPanelGroup, CommandPanelItem, CommandPanelJumpItem, CommandPanelSource, CommandPanelSourceId } from './types';
import type { VNodeChild } from 'vue';
import { computed, h, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import BIcon from '@/components/BIcon/index.vue';
import BModal from '@/components/BModal/index.vue';
import BModelIcon from '@/components/BModel/Icon.vue';
import BRecentIcon from '@/components/BRecent/Icon.vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { useNavigate } from '@/hooks/useNavigate';
import { useRecentRecord } from '@/hooks/useRecentRecord';
import { createChatPath } from '@/router/routes/helpers/chatRouteTab';
import { native } from '@/shared/platform';
import { useProviderStore } from '@/stores/ai/provider';
import type { SelectedModel } from '@/stores/ai/serviceModel';
import { useServiceModelStore } from '@/stores/ai/serviceModel';
import { useChatSessionStore } from '@/stores/chat/session';
import { useCommandPanelStore } from '@/stores/ui/commandPanel';
import { useRecentStore } from '@/stores/workspace/recent';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import { createChatSource } from './sources/chat';
import { createHintSource } from './sources/hint';
import { createJumpSource } from './sources/jump';
import { createModelSource } from './sources/model';
import { createRecentSource } from './sources/recent';
import { parseCommandPanelQuery } from './utils/query';

/** 命令面板 BEM 命名空间。 */
const [, bem] = createNamespace('command-panel');

/**
 * 搜索输入框聚焦选项。
 */
interface FocusInputOptions {
  /** 是否选中输入框全部内容。 */
  select?: boolean;
  /** 是否将光标移动到文本末尾。 */
  moveToEnd?: boolean;
}

/** 最近记录 store。 */
const recentStore = useRecentStore();
/** Provider store。 */
const providerStore = useProviderStore();
/** 服务模型 store。 */
const serviceModelStore = useServiceModelStore();
/** 文件与 WebView 打开能力。 */
const { openFileByPath, openWebview } = useNavigate();
/** 最近记录打开与删除能力。 */
const { openRecentRecord, removeRecentRecord } = useRecentRecord();
/** 路由跳转能力。 */
const router = useRouter();
/** 聊天会话 store。 */
const chatSessionStore = useChatSessionStore();
/** 全局命令面板 Store。 */
const commandPanelStore = useCommandPanelStore();
/** 全局命令面板响应式状态。 */
const { visible, scope, keyword } = storeToRefs(commandPanelStore);

/** 搜索框容器引用。 */
const inputRef = ref<HTMLElement | null>(null);
/** 列表容器引用。 */
const listRef = ref<HTMLElement | null>(null);
/** 当前结果分组。 */
const groups = ref<CommandPanelGroup[]>([]);
/** 当前键盘高亮扁平索引。 */
const activeIndex = ref<number>(-1);
/** 是否已有用户键盘高亮。 */
const hasKeyboardActiveIndex = ref<boolean>(false);
/** 搜索请求 token，用于丢弃过期异步结果。 */
const searchToken = ref<number>(0);

/**
 * 渲染结果项图标。
 * @param props - 图标渲染属性
 * @returns 图标 vnode
 */
function RenderItemIcon(props: { item: CommandPanelItem }): VNodeChild {
  const iconClass = bem('item-icon') as string;
  const customIcon = props.item.renderIcon?.({ className: iconClass, size: 16 });

  if (customIcon) {
    return customIcon;
  }

  return h(BIcon, { class: iconClass, icon: 'lucide:circle', size: 16 });
}

/** 跳转命令 source。 */
const jumpSource = createJumpSource();
/** 最近记录 source。 */
const recentSource = createRecentSource({
  getRecords: () => recentStore.recentRecords ?? [],
  ensureLoaded: () => recentStore.ensureLoaded(),
  openRecent: openRecentRecord,
  openFileByPath,
  openWebview,
  removeRecent: removeRecentRecord,
  getPathStatus: native.getPathStatus,
  renderRecentIcon: (item, context) =>
    h(BRecentIcon, { record: item.record, fileName: item.fileName, icon: item.icon, class: context.className, size: context.size })
});
/** 模型 source。 */
const modelSource = createModelSource({
  loadProviders: () => providerStore.loadProviders(),
  loadChatModel: () => serviceModelStore.loadChatModel(),
  setChatModel: async (model: SelectedModel): Promise<void> => {
    const handled = await commandPanelStore.changeContextModel(model);
    if (!handled) await serviceModelStore.setChatModel(model);
  },
  getAvailableModels: () => providerStore.availableModels,
  getCurrentModel: (): SelectedModel | undefined => commandPanelStore.getContextModel() ?? serviceModelStore.chatModel,
  renderModelIcon: (model, context) => h(BModelIcon, { provider: model.providerId, model: model.modelId, class: context.className, size: context.size })
});
/** 聊天历史 source。 */
const chatSource = createChatSource({
  ensureLoaded: () => chatSessionStore.ensureSessions(),
  getSessions: () => chatSessionStore.sessions,
  openSession: async (sessionId: string): Promise<void> => {
    await router.push(createChatPath(sessionId));
  },
  renderSessionIcon: (_session, context) => h(BIcon, { class: context.className, icon: 'lucide:message-circle', size: context.size })
});
/** 命令提示 source，输入 ? 时展示可用前缀。 */
const hintSource = createHintSource();
/** source 映射表。 */
const sources: Record<CommandPanelSourceId, CommandPanelSource> = {
  jump: jumpSource,
  model: modelSource,
  recent: recentSource,
  chat: chatSource,
  hint: hintSource
};

/** 当前输入路由。 */
const currentRoute = computed(() => parseCommandPanelQuery(scope.value, keyword.value));

/** 扁平结果项。 */
const flatItems = computed<CommandPanelItem[]>(() => groups.value.flatMap((group) => group.items));

/** 当前是否有可展示项。 */
const hasItems = computed<boolean>(() => flatItems.value.length > 0);

/** 当前空状态文案。 */
const emptyText = computed<string>(() => {
  const textMap: Record<CommandPanelSourceId, string> = {
    jump: '没有匹配的跳转命令',
    model: '未找到匹配的模型',
    recent: '没有匹配的最近记录',
    chat: '没有匹配的聊天会话',
    hint: '没有可用命令'
  };

  return textMap[currentRoute.value.sourceId];
});

/**
 * 判断是否为跳转项。
 * @param item - 结果项
 * @returns 是否为跳转项
 */
function isJumpItem(item: CommandPanelItem): item is CommandPanelJumpItem {
  return item.kind === 'jump';
}

/**
 * 判断是否为普通动作项。
 * @param item - 结果项
 * @returns 是否为普通动作项
 */
function isActionItem(item: CommandPanelItem): item is CommandPanelActionItem {
  return item.kind !== 'jump';
}

/**
 * 判断是否为可删除项。
 * @param item - 结果项
 * @returns 是否可删除
 */
function isRemovableItem(item: CommandPanelItem): item is CommandPanelActionItem {
  return isActionItem(item) && Boolean(item.removable && item.onRemove);
}

/**
 * 判断结果项是否为当前键盘高亮项。
 * @param item - 结果项
 * @returns 是否键盘高亮
 */
function isKeyboardActive(item: CommandPanelItem): boolean {
  return flatItems.value[activeIndex.value]?.key === item.key;
}

/**
 * 聚焦搜索输入框。
 * @param options - 聚焦行为选项
 */
function focusInput(options: FocusInputOptions = { select: true }): void {
  nextTick(() => {
    const input = inputRef.value?.querySelector('input');
    if (!input) return;

    input.focus();
    if (options.moveToEnd) {
      const position = input.value.length;
      input.setSelectionRange(position, position);
      return;
    }

    if (options.select !== false) {
      input.select();
    }
  });
}

/**
 * 将当前键盘高亮项滚动到可视区域。
 */
function scrollActiveItemIntoView(): void {
  nextTick(() => {
    const item = listRef.value?.querySelectorAll<HTMLElement>('.b-command-panel__item')[activeIndex.value];
    item?.scrollIntoView({ block: 'center' });
  });
}

/**
 * 根据搜索结果同步高亮索引。
 */
function syncActiveIndex(): void {
  const items = flatItems.value;
  if (!items.length) {
    activeIndex.value = -1;
    return;
  }

  if (hasKeyboardActiveIndex.value) {
    activeIndex.value = activeIndex.value >= 0 ? Math.min(activeIndex.value, items.length - 1) : -1;
    return;
  }

  activeIndex.value = items.findIndex((item) => item.active);
}

/**
 * 重置命令面板组件内部运行时状态。
 */
function resetRuntimeState(): void {
  groups.value = [];
  activeIndex.value = -1;
  hasKeyboardActiveIndex.value = false;
}

/**
 * 刷新当前 source 的搜索结果。
 */
async function refreshResults(): Promise<void> {
  if (!visible.value) return;

  const token = searchToken.value + 1;
  searchToken.value = token;
  const route = currentRoute.value;
  const source = sources[route.sourceId];

  const [error] = await asyncTo(
    (async (): Promise<void> => {
      await source.load();
      const nextGroups = await source.search(route.keyword);
      if (token !== searchToken.value) return;

      groups.value = nextGroups;
      syncActiveIndex();
    })()
  );

  if (error) {
    if (token !== searchToken.value) return;

    groups.value = [];
    syncActiveIndex();
  }
}

/**
 * 安全触发搜索刷新并记录异常。
 */
function refreshResultsSafely(): void {
  asyncTo(refreshResults());
}

/**
 * 关闭命令面板。
 */
function closePanel(): void {
  if (!visible.value) return;

  searchToken.value += 1;
  resetRuntimeState();
  commandPanelStore.close();
}

/**
 * 选择结果项。
 * @param item - 结果项
 */
async function handleSelectItem(item: CommandPanelItem): Promise<void> {
  if (isJumpItem(item)) {
    commandPanelStore.setKeyword(`${item.routeInput} `);
    hasKeyboardActiveIndex.value = false;
    focusInput({ moveToEnd: true, select: false });
    return;
  }

  await item.onSelect();
  if (item.closeOnSelect !== false) {
    closePanel();
  }
}

/**
 * 安全选择结果项，避免模板事件直接暴露异步错误。
 * @param item - 结果项
 */
function handleSelectItemSafely(item: CommandPanelItem): void {
  asyncTo(handleSelectItem(item));
}

/**
 * 删除结果项。
 * @param item - 结果项
 */
async function handleRemoveItem(item: CommandPanelItem): Promise<void> {
  if (!isRemovableItem(item)) return;

  await item.onRemove?.();
  await refreshResults();
}

/**
 * 安全删除结果项，避免模板事件直接暴露异步错误。
 * @param item - 结果项
 */
function handleRemoveItemSafely(item: CommandPanelItem): void {
  asyncTo(handleRemoveItem(item));
}

/**
 * 移动键盘高亮位置。
 * @param direction - 移动方向
 */
function moveActiveIndex(direction: 1 | -1): void {
  const total = flatItems.value.length;
  if (!total) {
    activeIndex.value = -1;
    return;
  }

  if (activeIndex.value === -1) {
    activeIndex.value = direction === 1 ? 0 : total - 1;
  } else if (direction === 1) {
    activeIndex.value = activeIndex.value >= total - 1 ? 0 : activeIndex.value + 1;
  } else {
    activeIndex.value = activeIndex.value <= 0 ? total - 1 : activeIndex.value - 1;
  }

  hasKeyboardActiveIndex.value = true;
  scrollActiveItemIntoView();
}

/**
 * 处理输入框键盘事件。
 * @param event - 键盘事件
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    const item = activeIndex.value >= 0 ? flatItems.value[activeIndex.value] : flatItems.value[0];
    if (item) {
      handleSelectItemSafely(item);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePanel();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActiveIndex(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActiveIndex(-1);
  }
}

watch(keyword, () => {
  if (!visible.value) return;

  hasKeyboardActiveIndex.value = false;
  refreshResultsSafely();
});

watch([visible, scope], ([nextVisible]): void => {
  if (!nextVisible) {
    searchToken.value += 1;
    resetRuntimeState();
    return;
  }

  resetRuntimeState();
  focusInput();
  refreshResultsSafely();
});
</script>

<style scoped lang="less">
.b-command-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.b-command-panel__toolbar {
  display: flex;
  align-items: center;
  padding-right: 10px;
}

.b-command-panel__search-shell {
  display: flex;
  flex: 1;
  gap: var(--input-gap);
  align-items: center;
  min-width: 0;
  min-height: 36px;
  padding: var(--input-padding-block) var(--input-padding-inline);
  color: var(--text-primary);
  background: var(--input-bg);
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  box-shadow: var(--input-shadow);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    background var(--motion-duration-base) var(--motion-easing-standard);

  &:focus-within {
    border-color: var(--input-focus-border);
    box-shadow: var(--input-active-shadow);
  }

  & :deep(.ant-input) {
    min-height: 0;
    padding: 0;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-primary);
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  & :deep(.ant-input::placeholder) {
    color: var(--input-placeholder-color);
    opacity: 1;
  }
}

.b-command-panel__search-input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
}

.b-command-panel__search-hint {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  user-select: none;
}

.b-command-panel__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
  padding-bottom: 10px;
}

.b-command-panel__group-title {
  padding: 6px 8px 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.b-command-panel__item {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-height: 32px;
  padding: 6px 8px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    background: var(--bg-hover);
  }
}

.b-command-panel__item--active {
  background: var(--bg-hover);
}

.b-command-panel__item--current {
  background: var(--bg-active, var(--bg-hover));
}

.b-command-panel__item-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.b-command-panel__item-main {
  display: flex;
  flex: 1;
  flex-direction: row;
  align-items: center;
  min-width: 0;
}

.b-command-panel__item-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--text-primary);
  white-space: nowrap;
}

.b-command-panel__item-description {
  flex: 1;
  min-width: 0;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.b-command-panel__item-description--unsaved {
  color: var(--color-orange);
}

.b-command-panel__item-meta {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.b-command-panel__item-delete {
  display: none;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-active);
  }
}

.b-command-panel__item:hover .b-command-panel__item-delete {
  display: flex;
}

.b-command-panel__empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  padding: 48px 0;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
