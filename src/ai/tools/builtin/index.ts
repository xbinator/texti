/**
 * @file builtin/index.ts
 * @description 内置工具工厂函数
 */
import type { AIToolConfirmationAdapter } from '../confirmation';
import type { AIToolExecutor } from 'types/ai';
import { nanoid } from 'nanoid';
import { createAskUserChoiceTool, type PendingQuestionSnapshot } from './ask-user-choice';
import { isDefaultBuiltinReadonlyToolName, isDefaultBuiltinWritableToolName } from './catalog';
import { createBuiltinEnvironmentTools } from './environment';
import { createBuiltinReadTools } from './read';
import { createBuiltinWriteTools } from './write';

/**
 * 创建内置工具的选项
 */
interface CreateBuiltinToolsOptions {
  /** 确认适配器，用于写操作的用户确认 */
  confirm?: AIToolConfirmationAdapter;
  /** 是否包含选区替换工具 */
  includeSelectionReplace?: boolean;
  /** 是否包含危险操作工具（如替换整个文档） */
  includeDangerous?: boolean;
  /** 获取当前待回答问题，用于避免重复发起用户选择 */
  getPendingQuestion?: () => PendingQuestionSnapshot | null;
  /** 创建用户选择问题 ID */
  createQuestionId?: () => string;
}

/**
 * 创建内置工具列表
 * @param options - 创建选项
 * @returns 工具执行器列表
 */
export function createBuiltinTools(options: CreateBuiltinToolsOptions = {}): AIToolExecutor[] {
  // 创建文档只读工具
  const readTools = createBuiltinReadTools();
  // 创建环境只读工具
  const environmentTools = createBuiltinEnvironmentTools();
  // 先汇总全部只读工具，再通过共享清单筛选默认暴露项。
  const allReadonlyTools: AIToolExecutor[] = [
    readTools.readCurrentDocument,
    readTools.getCurrentSelection,
    environmentTools.getCurrentTime,
    readTools.searchCurrentDocument,
    createAskUserChoiceTool({
      getPendingQuestion: options.getPendingQuestion ?? (() => null),
      createQuestionId: options.createQuestionId ?? (() => nanoid())
    })
  ];
  const readonlyTools = allReadonlyTools.filter((tool) => isDefaultBuiltinReadonlyToolName(tool.definition.name));

  // 没有确认适配器时只返回只读工具
  if (!options.confirm) {
    return readonlyTools;
  }

  // 创建写入工具
  const writeTools = createBuiltinWriteTools(options.confirm);
  // 先汇总默认低风险写工具，再通过共享清单筛选默认暴露项。
  const allDefaultWritableTools: AIToolExecutor[] = [writeTools.insertAtCursor];
  const writableTools = allDefaultWritableTools.filter((tool) => isDefaultBuiltinWritableToolName(tool.definition.name));

  // 聊天侧默认只放开低风险写工具，替换类操作需要显式开启
  if (options.includeSelectionReplace) {
    writableTools.push(writeTools.replaceSelection);
  }

  // 危险操作需要显式开启
  if (options.includeDangerous) {
    writableTools.push(writeTools.replaceDocument);
  }

  return [...readonlyTools, ...writableTools];
}
