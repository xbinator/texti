/**
 * @file triggerState.ts
 * @description 触发器状态扩展，管理自动补全菜单的显示状态
 */

import type { Extension } from '@codemirror/state';
import { StateField, StateEffect, EditorState, Transaction } from '@codemirror/state';

/**
 * 设置触发器激活索引的效果
 */
export const setTriggerActiveIndex = StateEffect.define<number>();

/**
 * 关闭触发器菜单的效果
 */
export const closeTrigger = StateEffect.define<void>();

/**
 * 触发器状态接口
 */
export interface TriggerState {
  visible: boolean;
  from: number;
  to: number;
  query: string;
  activeIndex: number;
}

/**
 * 获取触发器上下文
 * @param state - 编辑器状态
 * @param pos - 光标位置
 * @returns 触发器上下文或 null
 */
function getTriggerContext(state: EditorState, pos: number): { from: number; to: number; query: string } | null {
  const windowStart = Math.max(0, pos - 100);
  // 取光标前最多 100 字符
  const text = state.sliceDoc(windowStart, pos);

  // 找最后一个 {{
  const open = text.lastIndexOf('{{');

  // 没有找到 {{
  if (open === -1) {
    return null;
  }

  const afterOpen = text.slice(open + 2);

  // 如果 afterOpen 包含 }} 或 {{ 或 /[{}\n]/ 则返回 null
  if (afterOpen.includes('}}') || afterOpen.includes('{{') || /[{}\n]/.test(afterOpen)) {
    return null;
  }

  return {
    from: windowStart + open,
    to: pos,
    query: afterOpen
  };
}

/**
 * 触发器状态字段
 */
export const triggerStateField: StateField<TriggerState | null> = StateField.define<TriggerState | null>({
  create(): TriggerState | null {
    return null;
  },

  update(state: TriggerState | null, tr: Transaction): TriggerState | null {
    // 处理外部 Effect，优先返回避免后续逻辑重置状态
    for (const effect of tr.effects) {
      if ((effect as StateEffect<unknown>).is(setTriggerActiveIndex) && state) {
        return { ...state, activeIndex: (effect as StateEffect<number>).value };
      }
      if ((effect as StateEffect<unknown>).is(closeTrigger)) {
        return null;
      }
    }

    // 文档和选区都未变化，直接返回原状态
    if (!tr.selection && !tr.docChanged) {
      return state;
    }

    // 使用 tr.selection 或回退到 state 当前选区
    const selection = tr.selection || tr.state.selection;

    // 非空选区不弹菜单
    if (!selection.main.empty) {
      return null;
    }

    const pos = selection.main.head;
    const context = getTriggerContext(tr.state, pos);

    // 无法获取触发上下文，关闭菜单
    if (!context) {
      return null;
    }

    return {
      visible: true,
      from: context.from,
      to: context.to,
      query: context.query,
      activeIndex: 0
    };
  }
});

/**
 * 创建触发器状态扩展
 * @returns 触发器状态字段扩展
 */
export function createTriggerStateExtension(): Extension {
  return triggerStateField;
}
