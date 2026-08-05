/**
 * @file widget-runtime-patch.test.ts
 * @description BWidget 运行态 patch 应用工具测试。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import type { WidgetRuntimeState } from '@/components/BWidget/utils/widgetRuntime';
import { applyWidgetRuntimePatchesToState } from '@/components/BWidget/utils/widgetRuntime/patch';

/**
 * 创建用于 patch 应用测试的运行态状态。
 * @returns 运行态状态
 */
function createRuntimeState(): WidgetRuntimeState {
  return {
    value: createDefaultWidgetData(),
    renderContext: {
      input: {},
      output: undefined,
      data: {
        weather: {
          city: '上海',
          temperature: 18
        },
        items: [
          {
            id: 'latte',
            name: '拿铁'
          }
        ],
        cache: {
          largeList: [1, 2, 3]
        }
      }
    }
  };
}

describe('widgetRuntime/patch', (): void => {
  it('applies nested set patches with structural sharing', (): void => {
    const state = createRuntimeState();
    const nextState = applyWidgetRuntimePatchesToState(state, [{ op: 'set', path: ['weather', 'temperature'], value: 28 }]);

    expect(nextState).not.toBe(state);
    expect(nextState.renderContext).not.toBe(state.renderContext);
    expect(nextState.renderContext.data).not.toBe(state.renderContext.data);
    expect(nextState.renderContext.data.weather).toEqual({
      city: '上海',
      temperature: 28
    });
    expect(nextState.renderContext.data.weather).not.toBe(state.renderContext.data.weather);
    expect(nextState.renderContext.data.items).toBe(state.renderContext.data.items);
    expect(nextState.renderContext.data.cache).toBe(state.renderContext.data.cache);
  });

  it('creates missing parent objects for set patches', (): void => {
    const state = createRuntimeState();
    const nextState = applyWidgetRuntimePatchesToState(state, [{ op: 'set', path: ['forecast', 'today', 'temperature'], value: 30 }]);

    expect(nextState.renderContext.data.forecast).toEqual({
      today: {
        temperature: 30
      }
    });
    expect(nextState.renderContext.data.weather).toBe(state.renderContext.data.weather);
  });

  it('applies array path patches without mutating unchanged siblings', (): void => {
    const state = createRuntimeState();
    const nextState = applyWidgetRuntimePatchesToState(state, [{ op: 'set', path: ['items', 0, 'name'], value: '燕麦拿铁' }]);
    const nextItems = nextState.renderContext.data.items;

    expect(Array.isArray(nextItems)).toBe(true);
    expect(nextItems).not.toBe(state.renderContext.data.items);
    expect(nextItems).toEqual([{ id: 'latte', name: '燕麦拿铁' }]);
    expect(nextState.renderContext.data.weather).toBe(state.renderContext.data.weather);
  });

  it('applies delete patches with structural sharing', (): void => {
    const state = createRuntimeState();
    const nextState = applyWidgetRuntimePatchesToState(state, [{ op: 'delete', path: ['weather', 'temperature'] }]);

    expect(nextState.renderContext.data.weather).toEqual({
      city: '上海'
    });
    expect(nextState.renderContext.data.weather).not.toBe(state.renderContext.data.weather);
    expect(nextState.renderContext.data.items).toBe(state.renderContext.data.items);
  });

  it('deletes array entries as null without shifting siblings', (): void => {
    const state = createRuntimeState();
    const stateWithTwoItems: WidgetRuntimeState = {
      ...state,
      renderContext: {
        ...state.renderContext,
        data: {
          ...state.renderContext.data,
          items: [
            { id: 'latte', name: '拿铁' },
            { id: 'mocha', name: '摩卡' }
          ]
        }
      }
    };
    const nextState = applyWidgetRuntimePatchesToState(stateWithTwoItems, [{ op: 'delete', path: ['items', 0] }]);
    const nextItems = nextState.renderContext.data.items;

    expect(Array.isArray(nextItems)).toBe(true);
    expect(nextItems).toHaveLength(2);
    expect((nextItems as unknown[])[0]).toBeNull();
    expect((nextItems as unknown[])[1]).toEqual({ id: 'mocha', name: '摩卡' });
  });
});
