/**
 * @file triggerPlugin.ts
 * @description 触发器视图插件，管理自动补全菜单的显示位置和状态
 */

import type { Extension } from '@codemirror/state';
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
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
 * @returns Extension 实例
 */
export function createTriggerPlugin(params: TriggerPluginParams): Extension {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate): void {
        const triggerState = update.state.field(triggerStateField, false);

        if (!triggerState) {
          params.triggerVisible.value = false;
          return;
        }

        const coords = update.view.coordsAtPos(triggerState.to);
        params.triggerPosition.value = coords ? { top: coords.bottom, left: coords.left } : { top: 0, left: 0 };
        params.triggerVisible.value = true;
        params.triggerActiveIndex.value = triggerState.activeIndex;
        params.triggerQuery.value = triggerState.query;
      }
    }
  );
}
