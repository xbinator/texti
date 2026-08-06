/**
 * @file injector.ts
 * @description 记忆 runtime context 构建器，控制 token 预算和裁剪策略
 */
import type { BuildMemoryContextOptions, MemoryDoc, MemoryInjectionMode, MemorySelectionDebugInfo, MemorySelectionDebugItem, MemorySection } from './types';
import { extractMemoryKeywords, scoreMemoryItemRelevance, selectRelevantMemorySections } from './selector';

/** 裁剪优先级：数字越小越优先保留 */
const PRUNE_PRIORITY: Record<MemorySection['category'], number> = {
  Instructions: 1,
  Preferences: 2,
  'Current Context': 3,
  Facts: 4,
  Habits: 5,
  Projects: 6
};

/** 默认最大字符数（约 1000 tokens） */
const DEFAULT_MAX_CHARS = 4000;

/** 调试日志中的条目预览最大长度。 */
const DEBUG_ITEM_PREVIEW_MAX_LENGTH = 120;

/** 参与相关模式预算裁剪的条目候选。 */
interface MemoryBudgetCandidate {
  /** 分区名称。 */
  category: MemorySection['category'];
  /** 原始条目。 */
  item: MemorySection['items'][number];
  /** 相关性分数。 */
  score: number;
  /** 分区在已选分区中的顺序。 */
  sectionIndex: number;
  /** 条目在分区中的顺序。 */
  itemIndex: number;
}

/** 记忆上下文构建结果。 */
interface MemoryContextBuildResult {
  /** 最终注入文本。 */
  text: string;
  /** 最终注入分区。 */
  sections: MemorySection[];
}

/**
 * 将分区列表格式化为 Markdown 文本
 * @param sections - 非空分区列表
 * @returns 格式化后的文本
 */
function formatSections(sections: MemorySection[]): string {
  return sections
    .map((section) => {
      const items = section.items.map((item) => `- ${item.content}`).join('\n');
      return `# ${section.category}\n${items}`;
    })
    .join('\n\n');
}

/**
 * 包装记忆内容为 runtime memory context 片段。
 * @param header - XML 标签内的头部文本
 * @param sections - 非空分区列表
 * @returns 完整记忆注入文本
 */
function wrapMemoryContext(header: string, sections: MemorySection[]): string {
  const content = formatSections(sections);
  return `<user_memory>\n${header}\n\n${content}\n</user_memory>`;
}

/**
 * 创建记忆条目稳定键，用于比较最终保留与丢弃条目。
 * @param category - 分区名称
 * @param content - 条目内容
 * @returns 条目键
 */
function createMemoryItemKey(category: MemorySection['category'], content: string): string {
  return `${category}\u0000${content}`;
}

/**
 * 截断记忆条目预览，避免日志持久化完整记忆。
 * @param content - 条目内容
 * @returns 预览文本
 */
function createDebugPreview(content: string): string {
  if (content.length <= DEBUG_ITEM_PREVIEW_MAX_LENGTH) return content;
  return `${content.slice(0, DEBUG_ITEM_PREVIEW_MAX_LENGTH - 1)}…`;
}

/**
 * 消耗一个已保留条目键，支持重复内容的条目计数。
 * @param counts - 条目键计数
 * @param key - 条目键
 * @returns 是否成功消耗
 */
function consumeItemKeyCount(counts: Map<string, number>, key: string): boolean {
  const count = counts.get(key) ?? 0;
  if (count <= 0) return false;
  if (count === 1) {
    counts.delete(key);
  } else {
    counts.set(key, count - 1);
  }
  return true;
}

/**
 * 创建最终保留条目键计数。
 * @param sections - 最终注入分区
 * @returns 条目键计数
 */
function createKeptItemCounts(sections: MemorySection[]): Map<string, number> {
  const counts = new Map<string, number>();

  sections.forEach((section) => {
    section.items.forEach((item) => {
      const key = createMemoryItemKey(section.category, item.content);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  });

  return counts;
}

/**
 * 创建记忆选择调试条目。
 * @param category - 分区名称
 * @param content - 条目内容
 * @param keywords - 当前召回关键词
 * @returns 调试条目
 */
function createDebugItem(category: MemorySection['category'], content: string, keywords: string[]): MemorySelectionDebugItem {
  return {
    category,
    preview: createDebugPreview(content),
    score: keywords.length > 0 ? scoreMemoryItemRelevance({ content }, category, keywords) : 0
  };
}

/**
 * 创建记忆选择调试信息。
 * @param allSections - 完整非空记忆分区
 * @param finalSections - 最终注入分区
 * @param mode - 实际注入模式
 * @param keywords - 当前召回关键词
 * @param maxChars - 最大注入字符数
 * @param finalText - 最终注入文本
 * @returns 调试信息
 */
function createSelectionDebugInfo(
  allSections: MemorySection[],
  finalSections: MemorySection[],
  mode: MemoryInjectionMode,
  keywords: string[],
  maxChars: number,
  finalText: string
): MemorySelectionDebugInfo {
  const selectedItems = finalSections.flatMap((section) => section.items.map((item) => createDebugItem(section.category, item.content, keywords)));
  const keptCounts = createKeptItemCounts(finalSections);
  const droppedItems: MemorySelectionDebugItem[] = [];

  allSections.forEach((section) => {
    section.items.forEach((item) => {
      const key = createMemoryItemKey(section.category, item.content);
      if (consumeItemKeyCount(keptCounts, key)) return;
      droppedItems.push(createDebugItem(section.category, item.content, keywords));
    });
  });

  return {
    mode,
    maxChars,
    finalChars: finalText.length,
    keywords,
    selectedItems,
    droppedItems
  };
}

/**
 * 将已保留条目恢复成原始分区顺序。
 * @param sections - 相关模式下已选分区
 * @param keptItemsByCategory - 已保留条目映射
 * @returns 可格式化的分区列表
 */
function materializeKeptSections(sections: MemorySection[], keptItemsByCategory: Map<MemorySection['category'], MemorySection['items']>): MemorySection[] {
  return sections
    .map((section) => {
      const items = keptItemsByCategory.get(section.category) ?? [];
      return { category: section.category, items };
    })
    .filter((section) => section.items.length > 0);
}

/**
 * 创建相关模式的预算候选条目。
 * @param sections - 相关模式下已选分区
 * @param options - 标准化后的构建选项
 * @returns 按相关性排序前的候选条目
 */
function createRelevantBudgetCandidates(sections: MemorySection[], options: BuildMemoryContextOptions): MemoryBudgetCandidate[] {
  const keywords = options.selection ? extractMemoryKeywords(options.selection) : [];

  return sections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => {
      const matchedScore = section.category === 'Instructions' ? Number.MAX_SAFE_INTEGER : scoreMemoryItemRelevance(item, section.category, keywords);
      const fallbackScore = section.category === 'Preferences' ? 1 : 0;
      return {
        category: section.category,
        item,
        score: Math.max(matchedScore, fallbackScore),
        sectionIndex,
        itemIndex
      };
    })
  );
}

/**
 * 按预算裁剪分区内条目，优先保留高相关条目。
 * @param sections - 非空分区列表
 * @param header - XML 标签内的头部文本
 * @param options - 构建选项
 * @param maxChars - 最大字符数
 * @returns 裁剪后的完整注入文本
 */
function pruneItemsToBudget(sections: MemorySection[], header: string, options: BuildMemoryContextOptions, maxChars: number): MemoryContextBuildResult {
  const candidates = createRelevantBudgetCandidates(sections, options).sort(
    (a, b) => b.score - a.score || PRUNE_PRIORITY[a.category] - PRUNE_PRIORITY[b.category] || a.sectionIndex - b.sectionIndex || a.itemIndex - b.itemIndex
  );
  let keptItemsByCategory = new Map<MemorySection['category'], MemorySection['items']>();

  for (const candidate of candidates) {
    const nextKeptItemsByCategory = new Map(keptItemsByCategory);
    const nextItems = [...(nextKeptItemsByCategory.get(candidate.category) ?? []), candidate.item];
    nextKeptItemsByCategory.set(candidate.category, nextItems);

    const nextSections = materializeKeptSections(sections, nextKeptItemsByCategory);
    if (wrapMemoryContext(header, nextSections).length <= maxChars) {
      keptItemsByCategory = nextKeptItemsByCategory;
    }
  }

  const keptSections = materializeKeptSections(sections, keptItemsByCategory);
  if (keptSections.length === 0) return { text: '', sections: [] };

  return { text: wrapMemoryContext(header, keptSections), sections: keptSections };
}

/**
 * 按 token 预算裁剪分区，优先保留高优先级分区
 * @param sections - 非空分区列表
 * @param header - XML 标签内的头部文本
 * @param maxChars - 最大字符数
 * @returns 裁剪后的完整注入文本
 */
function pruneToBudget(sections: MemorySection[], header: string, maxChars: number): MemoryContextBuildResult {
  const sorted = [...sections].sort((a, b) => (PRUNE_PRIORITY[a.category] ?? 99) - (PRUNE_PRIORITY[b.category] ?? 99));

  const keptSections: MemorySection[] = [];
  const overhead = `<user_memory>\n${header}\n\n\n</user_memory>`.length;
  let remaining = maxChars - overhead;

  for (const section of sorted) {
    const sectionText = formatSections([section]);
    if (sectionText.length <= remaining) {
      keptSections.push(section);
      remaining -= sectionText.length + 2;
    } else {
      continue;
    }
  }

  if (keptSections.length === 0) return { text: '', sections: [] };

  return { text: wrapMemoryContext(header, keptSections), sections: keptSections };
}

/**
 * 解析构建选项，兼容旧的数字预算参数。
 * @param options - 构建选项或旧版最大字符数
 * @returns 标准化后的构建选项
 */
function resolveBuildOptions(
  options?: BuildMemoryContextOptions | number
): Required<Pick<BuildMemoryContextOptions, 'maxChars'>> & Pick<BuildMemoryContextOptions, 'selection' | 'onSelectionDebug'> {
  if (typeof options === 'number') {
    return { maxChars: options };
  }

  return {
    maxChars: options?.maxChars ?? DEFAULT_MAX_CHARS,
    selection: options?.selection,
    onSelectionDebug: options?.onSelectionDebug
  };
}

/**
 * 构建要注入到 Runtime Context 的记忆上下文
 *
 * 格式：<user_memory>...</user_memory>
 * 包含所有分区内容，控制在 token 预算内
 *
 * @param doc - 记忆文档
 * @param options - 构建选项，兼容旧版最大字符数
 * @returns 注入到 runtime context 的字符串，无记忆时返回空字符串
 */
export function buildSystemPromptContext(doc: MemoryDoc, options?: BuildMemoryContextOptions | number): string {
  const resolvedOptions = resolveBuildOptions(options);
  const nonEmptySections = doc.sections.filter((section) => section.items.length > 0);
  if (nonEmptySections.length === 0) return '';

  const header = '以下是关于该用户的已知信息，请在回应中自然地参考这些信息，不要刻意提及"根据记忆..."。';
  const mode: MemoryInjectionMode = resolvedOptions.selection ? resolvedOptions.selection.mode ?? 'relevant' : 'full';
  const keywords = resolvedOptions.selection ? extractMemoryKeywords(resolvedOptions.selection) : [];
  const selectedSections =
    resolvedOptions.selection && mode !== 'full'
      ? selectRelevantMemorySections(doc, resolvedOptions.selection).filter((section) => section.items.length > 0)
      : nonEmptySections;
  if (selectedSections.length === 0) return '';

  const fullText = wrapMemoryContext(header, selectedSections);

  let result: MemoryContextBuildResult;
  if (fullText.length <= resolvedOptions.maxChars) {
    result = { text: fullText, sections: selectedSections };
  } else if (resolvedOptions.selection && mode !== 'full') {
    result = pruneItemsToBudget(selectedSections, header, resolvedOptions, resolvedOptions.maxChars);
  } else {
    result = pruneToBudget(selectedSections, header, resolvedOptions.maxChars);
  }

  resolvedOptions.onSelectionDebug?.(createSelectionDebugInfo(nonEmptySections, result.sections, mode, keywords, resolvedOptions.maxChars, result.text));

  return result.text;
}
