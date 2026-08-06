/**
 * @file MemoryTool/index.ts
 * @description 记忆编辑工具——AI 声明分区内容的最终形态，工具负责完整替换
 */
import type { AIToolExecutor } from 'types/ai';
import type { MemoryCategory, MemorySection } from '@/ai/memory/types';
import { MEMORY_CATEGORIES } from '@/ai/memory/types';
import { useMemoryStore } from '@/stores/ai/memory';
import { createToolFailureResult, createToolSuccessResult } from '../../results';

export const EDIT_MEMORY_TOOL_NAME = 'edit_memory';

/** 单分区最大条目数 */
const MAX_ITEMS_PER_SECTION = 20;

/**
 * edit_memory 输入：一个或多个分区 → 该分区应当包含的完整条目列表
 */
interface EditMemoryInput {
  sections: Partial<Record<MemoryCategory, string[]>>;
}

/**
 * 工具返回的分区快照
 */
interface MemorySectionSnapshot {
  /** 分区名称 */
  category: MemoryCategory;
  /** 分区条目文本 */
  items: string[];
  /** 分区条目数量 */
  count: number;
}

/**
 * 获取分区快照
 * @param store - 记忆 Store
 * @returns 当前所有分区的条目快照
 */
function getSectionsSnapshot(store: ReturnType<typeof useMemoryStore>): MemorySectionSnapshot[] {
  return store.doc.sections.map((s: MemorySection) => ({
    category: s.category,
    items: s.items.map((i) => i.content),
    count: s.items.length
  }));
}

export function createBuiltinEditMemoryTool(): AIToolExecutor<EditMemoryInput> {
  return {
    definition: {
      name: EDIT_MEMORY_TOOL_NAME,
      description:
        '修改用户记忆。你已在本轮 runtime memory context 中持有当前完整记忆内容。' +
        '决定某个分区应该包含哪些条目，提供完整列表即可，工具会直接覆盖该分区。' +
        '未提及的分区不受影响。单分区最多 20 条，每条一行文本。',
      source: 'builtin',
      riskLevel: 'write',
      safeAutoApprove: true,
      requiresActiveDocument: false,
      parameters: {
        type: 'object',
        properties: {
          sections: {
            type: 'object',
            description: '要更新的分区及其完整条目列表。key 为分区名，value 为该分区应含的全部条目（字符串数组）。空数组=清空。',
            properties: {
              Instructions: { type: 'array', items: { type: 'string' }, description: '规则约束' },
              Preferences: { type: 'array', items: { type: 'string' }, description: '输出偏好' },
              Habits: { type: 'array', items: { type: 'string' }, description: '工作习惯' },
              Facts: { type: 'array', items: { type: 'string' }, description: '事实信息' },
              Projects: { type: 'array', items: { type: 'string' }, description: '项目描述' },
              'Current Context': { type: 'array', items: { type: 'string' }, description: '当前事项' }
            },
            additionalProperties: false
          }
        },
        required: ['sections'],
        additionalProperties: false
      }
    },

    async execute(input: EditMemoryInput) {
      const { sections } = input;

      if (!sections || typeof sections !== 'object' || Object.keys(sections).length === 0) {
        return createToolFailureResult(EDIT_MEMORY_TOOL_NAME, 'INVALID_INPUT', '需要提供至少一个分区。');
      }

      const store = useMemoryStore();
      if (!store.loaded) await store.loadMemory();

      const changes: string[] = [];
      const previousDoc = {
        sections: store.doc.sections.map((section: MemorySection) => ({
          category: section.category,
          items: section.items.map((item) => ({ content: item.content }))
        }))
      };
      const previousRawContent = store.rawContent;

      for (const [category, items] of Object.entries(sections)) {
        // 校验分区名
        if (!MEMORY_CATEGORIES.includes(category as MemoryCategory)) {
          return createToolFailureResult(EDIT_MEMORY_TOOL_NAME, 'INVALID_INPUT', `无效分区：${category}。`);
        }

        // 校验条目格式
        if (!Array.isArray(items)) {
          return createToolFailureResult(EDIT_MEMORY_TOOL_NAME, 'INVALID_INPUT', `${category} 的值必须是数组。`);
        }

        const hasInvalidItem = items.some((item: unknown) => typeof item !== 'string');
        if (hasInvalidItem) {
          return createToolFailureResult(EDIT_MEMORY_TOOL_NAME, 'INVALID_INPUT', `${category} 的条目必须全部是字符串。`);
        }

        // 过滤空字符串
        const validItems = items.map((i: string) => i.trim()).filter((s: string) => s.length > 0);

        // 条数上限
        if (validItems.length > MAX_ITEMS_PER_SECTION) {
          return createToolFailureResult(
            EDIT_MEMORY_TOOL_NAME,
            'EXECUTION_FAILED',
            `${category} 最多 ${MAX_ITEMS_PER_SECTION} 条，你提供了 ${validItems.length} 条。`
          );
        }

        const target = store.doc.sections.find((s) => s.category === category)!;
        const oldCount = target.items.length;
        target.items = validItems.map((content: string) => ({ content }));

        if (oldCount === 0 && validItems.length === 0) {
          changes.push(`${category}: 仍为空`);
        } else if (oldCount === 0) {
          changes.push(`${category}: +${validItems.length} 条`);
        } else if (validItems.length === 0) {
          changes.push(`${category}: 已清空`);
        } else {
          changes.push(`${category}: ${oldCount} → ${validItems.length} 条`);
        }
      }

      try {
        await store.saveMemory();
      } catch {
        store.doc = previousDoc;
        store.rawContent = previousRawContent;
        return createToolFailureResult(EDIT_MEMORY_TOOL_NAME, 'EXECUTION_FAILED', '记忆保存失败，请稍后重试。');
      }

      return createToolSuccessResult(EDIT_MEMORY_TOOL_NAME, {
        summary: changes.join('，'),
        sections: getSectionsSnapshot(store)
      });
    }
  };
}
