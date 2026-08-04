/**
 * @file index.ts
 * @description 内置 Shell 命令执行工具，负责安全分析、危险级确认和主进程命令执行。
 */
import type { AIToolConfirmationDecision, AIToolConfirmationRequest } from '../../confirmation';
import type { ToolRequiredConfirmationOptions, ToolWorkspaceOptions } from '../../shared/types';
import type { AIToolExecutionResult, AIToolExecutor } from 'types/ai';
import type {
  ElectronShellCommandRunResult,
  ElectronShellCommandSafetyReport,
  ElectronShellCommandShell,
  ElectronShellAutoDefaultCapability,
  ElectronShellInteractionMode
} from 'types/electron-api';
import { nanoid } from 'nanoid';
import { native } from '@/shared/platform';
import { asyncTo } from '@/utils/asyncTo';
import { workspace } from '@/utils/file/workspace';
import { createToolCancelledResult, createToolDeniedResult, createToolFailureResult, createToolSuccessResult } from '../../results';

/** run_shell_command 工具名称。 */
export const RUN_SHELL_COMMAND_TOOL_NAME = 'run_shell_command';

/** 默认命令超时时间。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 最小命令超时时间。 */
const MIN_TIMEOUT_MS = 1_000;

/** 最大命令超时时间。 */
const MAX_TIMEOUT_MS = 120_000;

/** Renderer capability fail-closed 时使用的当前验证版本。 */
const AUTO_DEFAULT_VERIFICATION_VERSION = 'v1';

/**
 * Shell 命令工具输入。
 */
export interface RunShellCommandInput {
  /** 内部命令 ID，通常来自 toolCallId。 */
  commandId?: unknown;
  /** Runtime 注入的原始工具调用 ID，不进入模型 schema。 */
  toolCallId?: unknown;
  /** Shell 类型。 */
  shell?: unknown;
  /** 命令文本。 */
  command?: unknown;
  /** 执行目录，默认使用工作区根目录。 */
  cwd?: unknown;
  /** 超时时间，单位毫秒。 */
  timeoutMs?: unknown;
  /** 交互模式，默认使用普通管道执行。 */
  interactionMode?: unknown;
  /** Runtime 注入的本地执行中止信号，不进入模型 schema。 */
  abortSignal?: unknown;
  /** 是否由 Runtime Watchdog 管理总生命周期，不进入模型 schema。 */
  runtimeManaged?: unknown;
}

/**
 * Shell 命令工具结果。
 */
export interface RunShellCommandToolResult extends ElectronShellCommandRunResult {
  /** 安全分析报告。 */
  safety: ElectronShellCommandSafetyReport;
}

/**
 * 创建 Shell 命令工具选项。
 */
export interface CreateBuiltinShellCommandToolOptions extends ToolRequiredConfirmationOptions, ToolWorkspaceOptions {
  /** 获取额外允许作为 Shell 安全边界的目录，如已启用 Skill 的目录。 */
  getAdditionalShellWorkspaceRoots?: () => string[];
  /** 获取版本化 auto-default capability。 */
  getAutoDefaultCapability?: () => ElectronShellAutoDefaultCapability;
}

/**
 * 判断是否为支持的 shell。
 * @param value - 待检查值
 * @returns 是否为支持的 shell
 */
function isSupportedShell(value: unknown): value is ElectronShellCommandShell {
  return value === 'bash' || value === 'powershell';
}

/**
 * 归一化命令超时时间。
 * @param timeoutMs - 原始超时时间
 * @param runtimeManaged - 是否由 Runtime Watchdog 管理生命周期
 * @returns 归一化超时时间
 */
function normalizeTimeoutMs(timeoutMs: unknown, runtimeManaged: unknown): number | undefined {
  if (runtimeManaged === true) {
    return undefined;
  }

  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (!Number.isInteger(timeoutMs)) {
    throw new Error('timeoutMs 必须是整数');
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs as number));
}

/**
 * 归一化 Shell 交互模式。
 * @param value - 原始交互模式
 * @returns 受支持的交互模式
 */
function normalizeInteractionMode(value: unknown): ElectronShellInteractionMode {
  if (value === undefined) return 'none';
  if (value === 'none' || value === 'auto-default') return value;
  throw new Error('interactionMode 仅支持 none 或 auto-default');
}

/**
 * 提取有界的 Shell 失败输出。
 * @param result - Shell 运行结果
 * @returns 最多 500 字符的输出说明
 */
function formatRunOutput(result: ElectronShellCommandRunResult): string {
  const output = result.terminalOutput ?? [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (!output) return '';
  return `\n${output.slice(Math.max(0, output.length - 500))}${result.truncated ? '\n输出已截断' : ''}`;
}

/**
 * 将主进程终止语义映射为 AI 工具结果。
 * @param runResult - Shell 运行结果
 * @param safety - Shell 安全报告
 * @returns 统一工具执行结果
 */
function mapRunResult(runResult: ElectronShellCommandRunResult, safety: ElectronShellCommandSafetyReport): AIToolExecutionResult<RunShellCommandToolResult> {
  const toolResult: RunShellCommandToolResult = { ...runResult, safety };
  const output = formatRunOutput(runResult);

  switch (runResult.termination.kind) {
    case 'exit':
    case 'signal':
      return createToolSuccessResult(RUN_SHELL_COMMAND_TOOL_NAME, toolResult);
    case 'cancelled':
      return createToolCancelledResult(RUN_SHELL_COMMAND_TOOL_NAME);
    case 'tool_timeout':
      return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'TOOL_TIMEOUT', `命令在 ${runResult.durationMs}ms 后超时${output}`, toolResult);
    case 'interaction_timeout':
      return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'INTERACTION_TIMEOUT', `命令在等待可处理的交互提示时超时${output}`, toolResult);
    case 'answer_limit':
      return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'INTERACTION_LIMIT_EXCEEDED', `自动选择默认项次数达到上限${output}`, toolResult);
    case 'unsupported_prompt':
      return createToolFailureResult(
        RUN_SHELL_COMMAND_TOOL_NAME,
        'UNSUPPORTED_INTERACTION',
        `命令要求不支持的 ${runResult.termination.reason} 输入，已停止${output}`,
        toolResult
      );
    case 'process_cleanup_failed':
      return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'PROCESS_CLEANUP_FAILED', `${runResult.termination.message}${output}`, toolResult);
    case 'spawn_error':
      return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'EXECUTION_FAILED', `${runResult.termination.message}${output}`, toolResult);
    default:
      return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'EXECUTION_FAILED', `未知 Shell 终止状态${output}`);
  }
}

/**
 * 判断确认结果是否批准。
 * @param decision - 确认结果
 * @returns 是否批准
 */
function isConfirmationApproved(decision: AIToolConfirmationDecision | boolean): boolean {
  if (typeof decision === 'boolean') {
    return decision;
  }

  return decision.approved;
}

/**
 * 提取安全检查失败消息。
 * @param safety - 安全分析报告
 * @returns 失败消息
 */
function formatSafetyFailureMessage(safety: ElectronShellCommandSafetyReport): string {
  const firstBlocker = safety.findings.find((finding) => finding.severity === 'blocker');
  return `Shell 命令安全检查未通过：${firstBlocker?.message ?? '命令被安全策略拦截'}`;
}

/**
 * 格式化确认描述。
 * @param shell - Shell 类型
 * @param cwd - 执行目录
 * @param timeoutMs - 超时时间
 * @param safety - 安全分析报告
 * @returns 确认描述
 */
function formatConfirmationDescription(
  shell: ElectronShellCommandShell,
  cwd: string,
  timeoutMs: number | undefined,
  safety: ElectronShellCommandSafetyReport
): string {
  const findingText = safety.findings.map((finding) => `- [${finding.severity}] ${finding.message}`).join('\n');
  const timeoutText = timeoutMs === undefined ? '由 Runtime 活性监控' : `${timeoutMs}ms`;

  return [`Shell: ${shell}`, `执行目录: ${cwd}`, `Timeout: ${timeoutText}`, `安全风险:`, findingText].join('\n');
}

/**
 * 获取非空的额外 Shell 工作区根目录。
 * @param options - Shell 工具选项
 * @returns 额外允许根目录列表
 */
function getAdditionalShellWorkspaceRoots(options: CreateBuiltinShellCommandToolOptions): string[] {
  return (options.getAdditionalShellWorkspaceRoots?.() ?? []).map((root) => root.trim()).filter(Boolean);
}

/**
 * 去除简单引号包裹。
 * @param value - 原始路径文本
 * @returns 去除引号后的路径
 */
function stripSimpleShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * 从命令开头提取字面量 cd 目标目录。
 * @param command - 命令文本
 * @returns cd 目标目录，无法安全识别时返回 null
 */
function extractLeadingCdTarget(command: string): string | null {
  const match = command.match(/^\s*cd\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+))\s*(?:&&|;)/);
  if (!match?.[1]) {
    return null;
  }

  const target = stripSimpleShellQuotes(match[1]);
  if (!target || target.includes('$') || target.includes('`')) {
    return null;
  }

  return target;
}

/**
 * 根据 cwd 选择用于安全分析和执行的工作区根目录。
 * @param cwd - 命令执行目录
 * @param primaryWorkspaceRoot - 当前主工作区根目录
 * @param additionalWorkspaceRoots - 额外允许根目录
 * @returns 匹配到的工作区根目录
 */
function resolveShellWorkspaceRoot(cwd: string, primaryWorkspaceRoot: string | null, additionalWorkspaceRoots: string[]): string | null {
  if (primaryWorkspaceRoot && workspace.contains(primaryWorkspaceRoot, cwd)) {
    return primaryWorkspaceRoot;
  }

  const matchedAdditionalRoot = additionalWorkspaceRoots.find((root) => workspace.contains(root, cwd));
  if (matchedAdditionalRoot) {
    return matchedAdditionalRoot;
  }

  return primaryWorkspaceRoot;
}

/**
 * 当调用方未显式传 cwd 时，尝试从安全的命令前缀中推断 cwd。
 * @param command - 命令文本
 * @param additionalWorkspaceRoots - 额外允许根目录
 * @returns 推断出的 cwd，无法推断时返回 null
 */
function inferCwdFromLeadingCd(command: string, additionalWorkspaceRoots: string[]): string | null {
  const leadingCdTarget = extractLeadingCdTarget(command);
  if (!leadingCdTarget) {
    return null;
  }

  const matchedAdditionalRoot = additionalWorkspaceRoots.find((root) => workspace.contains(root, leadingCdTarget));
  return matchedAdditionalRoot ? leadingCdTarget : null;
}

/**
 * 创建内置 Shell 命令执行工具。
 * @param options - 工具创建选项
 * @returns Shell 命令工具执行器
 */
export function createBuiltinShellCommandTool(options: CreateBuiltinShellCommandToolOptions): AIToolExecutor<RunShellCommandInput, RunShellCommandToolResult> {
  const readAutoDefaultCapability = options.getAutoDefaultCapability ?? ((): ElectronShellAutoDefaultCapability => native.getShellAutoDefaultCapability());

  /** Electron bridge 不可用或版本不匹配时按 disabled 处理，绝不开放能力。 */
  function getAutoDefaultCapability(): ElectronShellAutoDefaultCapability {
    try {
      return readAutoDefaultCapability();
    } catch {
      return {
        enabled: false,
        reason: 'FEATURE_DISABLED',
        verificationVersion: AUTO_DEFAULT_VERIFICATION_VERSION,
        platform: 'unknown',
        arch: 'unknown'
      };
    }
  }

  const initialCapability = getAutoDefaultCapability();
  return {
    definition: {
      name: RUN_SHELL_COMMAND_TOOL_NAME,
      description: initialCapability.enabled
        ? '在工作区内执行一条 bash 或 PowerShell 命令。命令会先经过安全检查；interactionMode=auto-default 仅用于自动按 Enter 选择明确的默认项。'
        : '在工作区内执行一条 bash 或 PowerShell 命令。命令会先经过安全检查。',
      source: 'builtin',
      riskLevel: 'dangerous',
      requiresActiveDocument: false,
      permissionCategory: 'system',
      safeAutoApprove: false,
      parameters: {
        type: 'object',
        properties: {
          shell: { type: 'string', enum: ['bash', 'powershell'], description: '命令使用的 shell。' },
          command: { type: 'string', description: '要执行的命令文本。' },
          cwd: { type: 'string', description: '可选执行目录，必须位于 Tibis 工作区内；默认工作区目录。' },
          timeoutMs: { type: 'number', description: '可选超时时间；直接调用默认 30000ms，Runtime 调用由活性监控管理。' },
          ...(initialCapability.enabled
            ? {
                interactionMode: {
                  type: 'string',
                  enum: ['none', 'auto-default'],
                  description: '可选交互模式；默认 none，auto-default 仅自动选择明确默认项。'
                }
              }
            : {})
        },
        required: ['shell', 'command'],
        additionalProperties: false
      }
    },
    async execute(input: RunShellCommandInput) {
      if (!isSupportedShell(input.shell)) {
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'INVALID_INPUT', 'shell 仅支持 bash 或 powershell');
      }

      const command = typeof input.command === 'string' ? input.command.trim() : '';
      if (!command) {
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'INVALID_INPUT', '命令不能为空');
      }

      const workspaceRoot = options.getWorkspaceRoot?.() ?? null;

      if (input.interactionMode === 'auto-default' && !getAutoDefaultCapability().enabled) {
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'ACTION_NOT_SUPPORTED', '当前构建尚未通过 Shell auto-default release gate');
      }

      let timeoutMs: number | undefined;
      let interactionMode: ElectronShellInteractionMode;
      try {
        timeoutMs = normalizeTimeoutMs(input.timeoutMs, input.runtimeManaged);
        interactionMode = normalizeInteractionMode(input.interactionMode);
      } catch (error) {
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'INVALID_INPUT', error instanceof Error ? error.message : 'Shell 参数无效');
      }

      const additionalWorkspaceRoots = getAdditionalShellWorkspaceRoots(options);
      const explicitCwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0 ? input.cwd.trim() : null;
      const cwd = explicitCwd ?? inferCwdFromLeadingCd(command, additionalWorkspaceRoots) ?? workspaceRoot;
      const resolvedWorkspaceRoot = cwd ? resolveShellWorkspaceRoot(cwd, workspaceRoot, additionalWorkspaceRoots) : null;
      if (!cwd || !resolvedWorkspaceRoot) {
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'PERMISSION_DENIED', '无法初始化 Tibis 工作区目录，拒绝执行 Shell 命令');
      }

      const safety = await native.analyzeShellCommand({
        shell: input.shell,
        command,
        cwd,
        workspaceRoot: resolvedWorkspaceRoot
      });

      if (safety.status === 'blocked') {
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'PERMISSION_DENIED', formatSafetyFailureMessage(safety));
      }

      const hasSafetyFindings = safety.findings.length > 0;
      let confirmationRequest: AIToolConfirmationRequest | undefined;

      if (hasSafetyFindings) {
        confirmationRequest = {
          toolCallId: typeof input.toolCallId === 'string' && input.toolCallId.trim().length > 0 ? input.toolCallId.trim() : undefined,
          toolName: RUN_SHELL_COMMAND_TOOL_NAME,
          title: 'AI 想要执行 Shell 命令',
          description: formatConfirmationDescription(input.shell, cwd, timeoutMs, safety),
          riskLevel: 'dangerous',
          allowRemember: false,
          beforeText: safety.normalizedCommandPreview
        };
        const decision = await options.confirm.confirm(confirmationRequest);
        if (!isConfirmationApproved(decision)) {
          return createToolDeniedResult(RUN_SHELL_COMMAND_TOOL_NAME);
        }
        await options.confirm.onExecutionStart?.(confirmationRequest);
      }
      const commandId = typeof input.commandId === 'string' && input.commandId.trim().length > 0 ? input.commandId.trim() : nanoid();
      const abortSignal = input.abortSignal instanceof AbortSignal ? input.abortSignal : undefined;
      if (abortSignal?.aborted) {
        return createToolCancelledResult(RUN_SHELL_COMMAND_TOOL_NAME);
      }
      const cancelCommand = (): void => {
        asyncTo(native.cancelShellCommand(commandId)).then((): undefined => undefined);
      };
      abortSignal?.addEventListener('abort', cancelCommand, { once: true });

      const [runError, runResult] = await asyncTo(
        native.runShellCommand({
          commandId,
          shell: input.shell as ElectronShellCommandShell,
          command,
          cwd,
          workspaceRoot: resolvedWorkspaceRoot,
          interactionMode,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(hasSafetyFindings ? { confirmedSafetyFindingCodes: safety.findings.map((finding): string => finding.code) } : {})
        })
      );
      abortSignal?.removeEventListener('abort', cancelCommand);

      if (abortSignal?.aborted) {
        return createToolCancelledResult(RUN_SHELL_COMMAND_TOOL_NAME);
      }
      if (runError || !runResult) {
        const message = runError?.message ?? '执行 Shell 命令失败';
        if (confirmationRequest && options.confirm.onExecutionComplete) {
          await asyncTo(Promise.resolve(options.confirm.onExecutionComplete(confirmationRequest, { status: 'failure', errorMessage: message })));
        }
        return createToolFailureResult(RUN_SHELL_COMMAND_TOOL_NAME, 'EXECUTION_FAILED', message);
      }

      const result = mapRunResult(runResult, safety);
      if (confirmationRequest && options.confirm.onExecutionComplete && result.status !== 'cancelled') {
        const completion =
          result.status === 'success'
            ? { status: 'success' as const }
            : { status: 'failure' as const, errorMessage: result.status === 'failure' ? result.error.message : 'Shell 命令执行未完成' };
        await asyncTo(Promise.resolve(options.confirm.onExecutionComplete(confirmationRequest, completion)));
      }
      return result;
    }
  };
}
