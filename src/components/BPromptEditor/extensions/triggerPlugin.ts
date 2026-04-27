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
  triggerPosition: { value: { top: number; left: number; bottom: number } };
  triggerActiveIndex: { value: number };
  triggerQuery: { value: string };
  hasVariables: { value: boolean };
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

        if (!triggerState || !params.hasVariables.value) {
          params.triggerVisible.value = false;
          return;
        }

        params.triggerVisible.value = true;
        params.triggerActiveIndex.value = triggerState.activeIndex;
        params.triggerQuery.value = triggerState.query;

        // coordsAtPos reads DOM layout - not allowed during update, defer
        requestAnimationFrame(() => {
          const coords = update.view.coordsAtPos(triggerState.to);
          if (coords) {
            // coordsAtPos returns viewport-relative coords, but when the scroller has
            // scrolled, we need to add scrollTop to get the correct absolute Y position
            // for the position:fixed menu which is teleported to body
            const { scrollDOM } = update.view;
            const top = coords.top + scrollDOM.scrollTop;
            const bottom = coords.bottom + scrollDOM.scrollTop;
            const { left } = coords;
            params.triggerPosition.value = { top, left, bottom };
          } else {
            params.triggerPosition.value = { top: 0, left: 0, bottom: 0 };
          }
        });
      }
    }
  );
}
