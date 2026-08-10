/**
 * @file index.ts
 * @description 注册系统菜单 action 回调，并分发到应用事件和设置 store。
 */
import { onMounted, onUnmounted } from 'vue';
import { native } from '@/shared/platform';
import { useEditorPreferencesStore } from '@/stores/editor/preferences';
import { useSettingStore } from '@/stores/ui/setting';
import { emitter } from '@/utils/emitter';

/**
 * 注册系统菜单行为监听。
 */
export function useMenuAction(): void {
  const editorPreferencesStore = useEditorPreferencesStore();
  const settingStore = useSettingStore();

  let unregisterMenuAction: (() => void) | undefined;

  /**
   * 处理系统菜单 action。
   * @param action - 菜单 action 标识
   */
  function handleMenuAction(action: string): void {
    if (action.startsWith('file:openRecent:')) {
      emitter.emit('file:openRecent', action.slice('file:openRecent:'.length));
      return;
    }

    switch (action) {
      case 'file:new':
        emitter.emit('file:new');
        break;
      case 'file:open':
        emitter.emit('file:open');
        break;
      case 'file:recent':
        emitter.emit('file:recent');
        break;
      case 'file:duplicate':
        emitter.emit('file:duplicate');
        break;
      case 'file:save':
        emitter.emit('file:save');
        break;
      case 'file:saveAs':
        emitter.emit('file:saveAs');
        break;
      case 'file:rename':
        emitter.emit('file:rename');
        break;
      case 'tab:close':
        emitter.emit('tab:close');
        break;

      case 'edit:undo':
        emitter.emit('edit:undo');
        break;
      case 'edit:redo':
        emitter.emit('edit:redo');
        break;
      case 'edit:copy-plain-text':
        emitter.emit('edit:copyPlainText');
        break;
      case 'edit:copy-markdown':
        emitter.emit('edit:copyMarkdown');
        break;
      case 'edit:copy-html':
        emitter.emit('edit:copyHtml');
        break;

      case 'view:toggleSource':
        editorPreferencesStore.setViewMode(editorPreferencesStore.viewMode === 'source' ? 'rich' : 'source');
        break;
      case 'view:toggleOutline':
        editorPreferencesStore.setShowOutline(!editorPreferencesStore.showOutline);
        break;
      case 'theme:light':
        settingStore.setTheme('light');
        break;
      case 'theme:dark':
        settingStore.setTheme('dark');
        break;
      case 'theme:system':
        settingStore.setTheme('system');
        break;
      case 'view:pageWidth:default':
        editorPreferencesStore.setPageWidth('default');
        break;
      case 'view:pageWidth:wide':
        editorPreferencesStore.setPageWidth('wide');
        break;
      case 'view:pageWidth:full':
        editorPreferencesStore.setPageWidth('full');
        break;

      case 'help:shortcuts':
        emitter.emit('help:shortcuts');
        break;
      case 'help:checkUpdate':
        emitter.emit('help:checkUpdate');
        break;

      default:
        break;
    }
  }

  onMounted(() => {
    settingStore.init();
    editorPreferencesStore.syncNativeMenuState();

    if (native.onMenuAction) {
      unregisterMenuAction = native.onMenuAction((action: string) => {
        handleMenuAction(action);
      });
    }
  });

  onUnmounted(() => {
    settingStore.disposeTheme();
    if (unregisterMenuAction) {
      unregisterMenuAction();
    }
  });
}
