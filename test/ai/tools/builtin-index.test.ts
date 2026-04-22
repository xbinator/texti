import { describe, expect, it } from 'vitest';
import { createBuiltinTools } from '@/ai/tools/builtin';

/**
 * 提取工具名称列表。
 * @param includeWriteTools - 是否包含写工具
 * @returns 工具名称列表
 */
function getToolNames(includeWriteTools = false): string[] {
  return createBuiltinTools(
    includeWriteTools
      ? {
          confirm: {
            confirm: async () => true
          }
        }
      : undefined
  ).map((tool) => tool.definition.name);
}

describe('createBuiltinTools', () => {
  it('returns read tools by default', () => {
    expect(getToolNames()).toEqual([
      'read_current_document',
      'get_current_selection',
      'get_current_time',
      'search_current_document'
    ]);
  });

  it('only exposes low-risk write tools by default when confirmation is available', () => {
    expect(getToolNames(true)).toEqual([
      'read_current_document',
      'get_current_selection',
      'get_current_time',
      'search_current_document',
      'insert_at_cursor'
    ]);
  });

  it('can opt into selection replacement and dangerous document replacement explicitly', () => {
    const tools = createBuiltinTools({
      confirm: {
        confirm: async () => true
      },
      includeSelectionReplace: true,
      includeDangerous: true
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual([
      'read_current_document',
      'get_current_selection',
      'get_current_time',
      'search_current_document',
      'insert_at_cursor',
      'replace_selection',
      'replace_document'
    ]);
  });
});
