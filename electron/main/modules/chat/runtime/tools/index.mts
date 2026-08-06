/**
 * @file index.mts
 * @description ChatRuntime 主进程工具执行入口。
 */
import type { ChatRuntimeMainToolExecutionInput } from '../types.mjs';
import type { MainToolExecutor, MainToolsDependencies } from './types.mjs';
import { executeFileTool, isFileTool } from './FileTool/index.mjs';
import { executeReadTool, isReadTool } from './ReadTool/index.mjs';
import { executeResourceTool, isResourceTool } from './ResourceTool/index.mjs';
import { createMainToolFailureResult } from './results.mjs';
import { executeSettingsTool, isSettingsTool } from './SettingsTool/index.mjs';

/**
 * 创建主进程工具执行器。
 * @param deps - 主进程工具依赖
 * @returns 主进程工具执行函数
 */
export function createMainToolExecutor(deps: MainToolsDependencies): MainToolExecutor {
  return async (input: ChatRuntimeMainToolExecutionInput) => {
    // 工具无需逐个手动透传 signal；确认等待通过活动协议暂停 Watchdog。
    const toolDeps: MainToolsDependencies =
      input.signal || input.activity
        ? {
            ...deps,
            requestBridge: (request) => deps.requestBridge({ ...request, signal: input.signal }),
            requestConfirmation: async (request) => {
              input.activity?.waitUser(request.request.description);
              try {
                return await deps.requestConfirmation({ ...request, signal: input.signal });
              } finally {
                input.activity?.resume();
              }
            }
          }
        : deps;

    if (isReadTool(input.toolName)) return executeReadTool(input);
    if (isFileTool(input.toolName)) return executeFileTool(input, toolDeps);
    if (isSettingsTool(input.toolName)) return executeSettingsTool(input, toolDeps);
    if (isResourceTool(input.toolName)) return executeResourceTool(input, toolDeps);
    return createMainToolFailureResult(input.toolName, 'TOOL_NOT_FOUND', `Unsupported main-process tool: ${input.toolName}`);
  };
}
