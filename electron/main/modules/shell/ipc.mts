/**
 * @file ipc.mts
 * @description Shell 命令安全分析与执行 IPC handler 注册。
 */
import type { ShellCommandRunRequest, ShellCommandSafetyRequest } from './types.mjs';
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { shellCommandRunner } from './runner.mjs';
import { analyzeShellCommandSafety } from './safety.mjs';

/** Shell 命令输出事件名称。 */
export const SHELL_COMMAND_OUTPUT_EVENT = 'shell:output';
/** Shell 有序运行事件名称。 */
export const SHELL_RUN_EVENT = 'shell:run-event';

/**
 * 提取去重排序后的安全发现项编码。
 * @param codes - 原始编码列表
 * @returns 规范化编码列表
 */
function normalizeFindingCodes(codes: readonly string[] | undefined): string[] {
  return Array.from(new Set(codes ?? [])).sort();
}

/**
 * 判断运行请求是否确认了当前安全发现项。
 * @param request - Shell 运行请求
 * @param findings - 当前安全发现项
 * @returns 是否已确认
 */
function hasConfirmedFindings(request: ShellCommandRunRequest, findings: Awaited<ReturnType<typeof analyzeShellCommandSafety>>['findings']): boolean {
  const expectedCodes = normalizeFindingCodes(findings.map((finding): string => finding.code));
  const confirmedCodes = normalizeFindingCodes(request.confirmedSafetyFindingCodes);
  return expectedCodes.length === confirmedCodes.length && expectedCodes.every((code, index): boolean => code === confirmedCodes[index]);
}

/**
 * 格式化主进程安全拒绝信息。
 * @param findings - 安全发现项
 * @returns 错误信息
 */
function formatSafetyRunError(findings: Awaited<ReturnType<typeof analyzeShellCommandSafety>>['findings']): string {
  const messages = findings.map((finding): string => `[${finding.code}] ${finding.message}`).join('\n');
  return `Shell 命令未通过主进程安全分析:\n${messages}`;
}

/**
 * 注册 Shell 命令 IPC handlers。
 */
export function registerShellCommandHandlers(): void {
  ipcMain.handle('shell:analyze', async (_event: IpcMainInvokeEvent, request: ShellCommandSafetyRequest) => {
    return analyzeShellCommandSafety(request);
  });

  ipcMain.handle('shell:run', async (event: IpcMainInvokeEvent, request: ShellCommandRunRequest) => {
    const safety = await analyzeShellCommandSafety({ shell: request.shell, command: request.command, cwd: request.cwd, workspaceRoot: request.workspaceRoot });
    if (safety.status === 'blocked') {
      throw new Error(formatSafetyRunError(safety.findings));
    }
    if (safety.findings.length > 0 && !hasConfirmedFindings(request, safety.findings)) {
      throw new Error('Shell 命令存在未确认的安全发现项，拒绝执行。');
    }

    return shellCommandRunner.run(
      request,
      (chunk) => {
        event.sender.send(SHELL_COMMAND_OUTPUT_EVENT, chunk);
      },
      (runEvent) => {
        try {
          event.sender.send(SHELL_RUN_EVENT, runEvent);
        } catch {
          // renderer 断开不能改变命令生命周期或最终工具结果。
        }
      }
    );
  });

  ipcMain.handle('shell:cancel', async (_event: IpcMainInvokeEvent, commandId: string) => {
    return shellCommandRunner.cancel(commandId);
  });
}
