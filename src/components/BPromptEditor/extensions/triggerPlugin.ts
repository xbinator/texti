/**
 * @file triggerPlugin.ts
 * @description 触发器视图插件，管理自动补全菜单的显示位置和状态
 */

import { ViewPlugin, EditorView } from '@codemirror/view';
import { triggerStateField } from './triggerState';

/**
 * 触发器插件参数
 */
interface TriggerPluginParams {
  triggerVisible: { value: boolean };
  triggerPosition: { value: { top: number; left: number } };
  triggerActiveIndex: { value: number };
  triggerQuery: { value: string };
}

/**
 * 创建触发器插件
 * @description 用于同步触发器状态到外部视图，负责更新触发器菜单位置和可见性
 * @param params - 触发器插件参数，包含用于同步状态的响应式引用
 * @returns ViewPlugin 实例
 */
export function createTriggerPlugin(params: TriggerPluginParams): ViewPlugin {
  return ViewPlugin.fromClass(
    class {
      update(update: { state: { field: (field: unknown, present?: boolean) => unknown }; view: EditorView }) {
        const triggerState = update.state.field(triggerStateField, false);

        if (!triggerState) {
          params.triggerVisible.value = false;
          return;
        }

        const coords = update.view.coordsAtPos((triggerState as { to: number }).to);
        params.triggerPosition.value = coords
          ? { top: coords.bottom, left: coords.left }
          : { top: 0, left: 0 };
        params.triggerVisible.value = true;
        params.triggerActiveIndex.value = (triggerState as { activeIndex: number }).activeIndex;
        params.triggerQuery.value = (triggerState as { query: string }).query;
      }
    }
  );
}
