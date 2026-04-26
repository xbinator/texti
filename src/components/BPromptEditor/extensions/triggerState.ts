/**
 * @file triggerState.ts
 * @description 触发器状态扩展，管理自动补全菜单的显示状态
 */

import { StateField, StateEffect, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

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
function getTriggerContext(
  state: EditorState,
  pos: number
): { from: number; to: number; query: string } | null {
  // 取光标前最多 100 字符
  const text = state.sliceDoc(Math.max(0, pos - 100), pos);

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
    from: open,
    to: pos,
    query: afterOpen,
  };
}

/**
 * 触发器状态字段
 */
export const triggerStateField: StateField<TriggerState | null> = StateField.define<TriggerState | null>({
  create(): TriggerState | null {
    return null;
  },

  update(state: TriggerState | null, tr: { effects: readonly { readonly effect: { uniq: unknown } }[]; selectionSet?: boolean; docChanged?: boolean; newState: EditorState }): TriggerState | null {
    // 先遍历 tr.effects 处理 setTriggerActiveIndex 和 closeTrigger
    for (const effect of tr.effects) {
      if (effect.effect === setTriggerActiveIndex) {
        if (state) {
          state.activeIndex = effect.value;
        }
      } else if (effect.effect === closeTrigger) {
        return null;
      }
    }

    // 如果选区未变化且文档未变化，直接返回原状态
    if (!tr.selectionSet && !tr.docChanged) {
      return state;
    }

    const { selection } = tr.newState;
    // 非空选区不弹菜单
    if (!selection.empty) {
      return null;
    }

    const pos = selection.main.head;
    const context = getTriggerContext(tr.newState, pos);

    // 无法获取触发上下文，返回 null
    if (!context) {
      return null;
    }

    return {
      visible: true,
      from: context.from,
      to: context.to,
      query: context.query,
      activeIndex: 0,
    };
  },
});

/**
 * 创建触发器状态扩展
 * @returns 触发器状态字段扩展
 */
export function createTriggerStateExtension(): Extension {
  return triggerStateField;
}
