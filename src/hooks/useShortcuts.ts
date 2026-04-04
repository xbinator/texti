import { useMagicKeys, whenever, useEventListener } from '@vueuse/core';
import { isMac } from '@/utils/is';

interface ShortcutOptions {
  /** 快捷键组合 */
  key: string;
  /** 回调函数 */
  handler: () => void;
  /** 是否启用 */
  enabled?: boolean;
  /** 是否阻止默认行为 */
  preventDefault?: boolean;
}

export function useShortcuts() {
  const keys = useMagicKeys();
  const stopFns: (() => void)[] = [];

  /**
   * 格式化快捷键为键名
   * @param shortcut 快捷键字符串，如 'Ctrl+S'
   * @returns 格式化后的键名，如 'ctrl_s'
   */
  function getKeyName(shortcut: string): string {
    return shortcut.replace(/\+/g, '_').replace(/\s+/g, '').toLowerCase();
  }

  /**
   * 注册单个快捷键
   * @param options 快捷键选项
   * @returns 取消注册的函数
   */
  function registerShortcut(options: ShortcutOptions): () => void {
    const { key, handler, enabled = true, preventDefault = true } = options;

    if (!enabled) {
      return () => undefined;
    }

    const keyCombo = getKeyName(key);
    const stopFn = whenever(keys[keyCombo], handler);
    stopFns.push(stopFn);

    // 处理默认行为
    if (preventDefault) {
      const stopPreventDefault = useEventListener(
        'keydown',
        (e) => {
          const shortcut = key.toLowerCase();
          const ctrl = e.ctrlKey || e.metaKey;
          const shift = e.shiftKey;
          const alt = e.altKey;

          const hasCtrl = shortcut.includes('ctrl') || shortcut.includes('meta');
          const hasShift = shortcut.includes('shift');
          const hasAlt = shortcut.includes('alt');

          const keyPart = shortcut.split('+').pop()?.trim();

          if (ctrl === hasCtrl && shift === hasShift && alt === hasAlt && e.key.toLowerCase() === keyPart) {
            e.preventDefault();
          }
        },
        { capture: true }
      );
      stopFns.push(stopPreventDefault);
    }

    // 处理 macOS 上的 Command 键
    if (isMac() && key.toLowerCase().includes('ctrl')) {
      const macKey = key.replace(/ctrl/gi, 'meta');
      const macKeyCombo = getKeyName(macKey);
      const stopFnMac = whenever(keys[macKeyCombo], handler);
      stopFns.push(stopFnMac);
    }

    return () => {
      stopFn();
    };
  }

  /**
   * 注册多个快捷键
   * @param shortcuts 快捷键选项数组
   * @returns 取消所有注册的函数
   */
  function registerShortcuts(shortcuts: ShortcutOptions[]): () => void {
    const stopFunctions = shortcuts.map(registerShortcut);
    return () => {
      stopFunctions.forEach((stop) => stop());
    };
  }

  /**
   * 清理所有注册的快捷键
   */
  function cleanup() {
    stopFns.forEach((stop) => stop());
    stopFns.length = 0;
  }

  return {
    registerShortcut,
    registerShortcuts,
    cleanup
  };
}
