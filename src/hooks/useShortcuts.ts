import { useMagicKeys, whenever, useEventListener } from '@vueuse/core';
import { isMac } from '@/shared/platform/env';

interface ShortcutOptions {
  /** 快捷键组合，如 'Ctrl+S'、'Ctrl+Shift+Z' */
  key: string;
  /** 触发回调 */
  handler: () => void;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 是否阻止默认行为，默认 true */
  preventDefault?: boolean;
}

/** 解析快捷键字符串为修饰键 + 主键结构 */
interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** 主键，小写，如 's'、'z' */
  key: string;
}

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut
    .toLowerCase()
    .split('+')
    .map((s) => s.trim());
  return {
    ctrl: parts.includes('ctrl') || parts.includes('meta'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: parts[parts.length - 1]
  };
}

/** 将快捷键字符串转为 useMagicKeys 所需的 key，处理 Mac 的 Ctrl → Meta 映射 */
function resolveKeyCombos(shortcut: string): string[] {
  const normalized = shortcut.replace(/\+/g, '_').replace(/\s+/g, '').toLowerCase();
  const combos = [normalized];

  if (isMac() && /ctrl/i.test(shortcut)) {
    combos.push(normalized.replace(/ctrl/g, 'meta'));
  }

  return combos;
}

export function useShortcuts() {
  const keys = useMagicKeys();

  /** 所有已注册快捷键的 preventDefault 规则，由单一 keydown 监听统一处理 */
  const preventRules: ParsedShortcut[] = [];

  // 单一全局 keydown 监听，统一处理所有 preventDefault
  useEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      // 修饰键自身触发的 keydown 直接跳过
      if (['control', 'shift', 'alt', 'meta'].includes(e.key.toLowerCase())) return;

      for (let i = 0; i < preventRules.length; i++) {
        const rule = preventRules[i];

        const ctrlMatch = isMac() ? e.metaKey === rule.ctrl : e.ctrlKey === rule.ctrl;

        if (ctrlMatch && e.shiftKey === rule.shift && e.altKey === rule.alt && e.key.toLowerCase() === rule.key) {
          e.preventDefault();
          break;
        }
      }
    },
    { capture: true }
  );

  /** 内部注册快捷键，返回清理函数 */
  function register(options: ShortcutOptions): () => void {
    const { key, handler, enabled = true, preventDefault = true } = options;

    if (!enabled) return () => undefined;

    // 注册 magic key 监听（自动处理 Mac Ctrl → Meta）
    const stopFns = resolveKeyCombos(key).map((combo) => whenever(keys[combo], handler));

    // 添加 preventDefault 规则（Mac 下同时匹配 meta）
    let parsedRule: ParsedShortcut | null = null;
    if (preventDefault) {
      parsedRule = parseShortcut(key);
      preventRules.push(parsedRule);
    }

    return () => {
      stopFns.forEach((stop) => stop());
      if (parsedRule) {
        const idx = preventRules.indexOf(parsedRule);
        if (idx !== -1) preventRules.splice(idx, 1);
      }
    };
  }

  /** 批量注册快捷键，返回统一清理函数 */
  function registerShortcuts(shortcuts: ShortcutOptions[]): () => void {
    const stopFns = shortcuts.map(register);
    return () => stopFns.forEach((stop) => stop());
  }

  return {
    registerShortcut: register,
    registerShortcuts
  };
}
