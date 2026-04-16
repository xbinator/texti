import { onMounted, onUnmounted } from 'vue';
import { native } from '@/shared/platform';
import { useSettingStore } from '@/stores/setting';
import { emitter } from '@/utils/emitter';

export function useMenuAction() {
  const settingStore = useSettingStore();

  let unregisterMenuAction: (() => void) | undefined;

  function handleMenuAction(action: string) {
    switch (action) {
      case 'file:new':
        emitter.emit('file:new');
        break;
      case 'file:open':
        emitter.emit('file:open');
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
        settingStore.toggleSourceMode();
        break;
      case 'view:toggleOutline':
        settingStore.toggleOutline();
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

      case 'help:shortcuts':
        emitter.emit('help:shortcuts');
        break;

      default:
        break;
    }
  }

  onMounted(() => {
    settingStore.init();

    if (native.onMenuAction) {
      unregisterMenuAction = native.onMenuAction((action: string) => {
        handleMenuAction(action);
      });
    }
  });

  onUnmounted(() => {
    if (unregisterMenuAction) {
      unregisterMenuAction();
    }
  });
}
