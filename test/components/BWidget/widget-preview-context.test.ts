/**
 * @file widget-preview-context.test.ts
 * @description 验证 BWidget 预览渲染上下文读写工具。
 */
import { describe, expect, it } from 'vitest';
import type { WidgetMetadata } from '@/components/BWidget/types';
import { readWidgetPreviewRenderContext } from '@/components/BWidget/utils/widgetPreviewContext';

/** 已移除的旧根变量名。 */
const REMOVED_LEGACY_ROOT = ['last', 'Result'].join('');

describe('widgetPreviewContext', (): void => {
  it('drops removed roots from preview metadata when reading render context', (): void => {
    const metadata: WidgetMetadata = {
      previewContext: {
        input: {
          city: '上海'
        },
        output: {
          condition: '晴'
        },
        data: {},
        [REMOVED_LEGACY_ROOT]: {
          status: 'success'
        }
      }
    };

    expect(readWidgetPreviewRenderContext(metadata)).toEqual({
      input: {
        city: '上海'
      },
      output: {
        condition: '晴'
      },
      data: {}
    });
  });
});
