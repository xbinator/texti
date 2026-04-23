/**
 * @file read-file.ts
 * @description 内置本地文件读取工具实现。
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '../confirmation';
import type { AIToolExecutionError, AIToolExecutor } from 'types/ai';
import { native } from '@/shared/platform';
import type { ReadWorkspaceFileOptions, ReadWorkspaceFileResult } from '@/shared/platform/native/types';
import { createToolCancelledResult, createToolFailureResult, createToolSuccessResult } from '../results';

/** read_file 工具名称 */
const READ_FILE_TOOL_NAME = 'read_file';
/** 默认起始行号 */
const DEFAULT_OFFSET = 1;

/** 工作区读取业务错误码 */
type WorkspaceReadErrorCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_BLACKLISTED'
  | 'EXTENSION_NOT_ALLOWED'
  | 'FILE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_PROVIDER';

/** read_file 工具输入参数 */
export interface ReadFileInput {
  /** 文件路径，支持相对工作区路径或绝对路径 */
  path: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，不传时读取到文件末尾 */
  limit?: number;
}

/** read_file 工具返回结果 */
export interface ReadFileResult {
  /** 规范化后的真实文件路径 */
  path: string;
  /** 截取后的文本内容 */
  content: string;
  /** 文件总行数 */
  totalLines: number;
  /** 实际读取行数 */
  readLines: number;
  /** 是否还有后续内容 */
  hasMore: boolean;
  /** 下一次滚动读取的起始行号，没有后续内容时为 null */
  nextOffset: number | null;
}

/** 创建 read_file 工具的选项 */
export interface CreateBuiltinReadFileToolOptions {
  /** 读取工作区外绝对路径时使用的用户确认适配器 */
  confirm?: AIToolConfirmationAdapter;
  /** 获取工作区根目录，无工作区时返回 null */
  getWorkspaceRoot?: () => string | null;
  /** 读取本地文件，测试时可注入替身 */
  readWorkspaceFile?: (options: ReadWorkspaceFileOptions) => Promise<ReadWorkspaceFileResult>;
}

/**
 * 从未知错误中提取业务错误码。
 * @param error - 未知错误
 * @returns 业务错误码或 null
 */
function readErrorCode(error: unknown): WorkspaceReadErrorCode | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  const { code } = error as { code: unknown };
  if (typeof code !== 'string') {
    return null;
  }

  return code as WorkspaceReadErrorCode;
}

/**
 * 将工作区读取错误码映射为工具错误码。
 * @param code - 工作区读取错误码
 * @returns 工具错误码
 */
function mapWorkspaceErrorCode(code: WorkspaceReadErrorCode | null): AIToolExecutionError['code'] {
  switch (code) {
    case 'INVALID_INPUT':
      return 'INVALID_INPUT';
    case 'PATH_OUTSIDE_WORKSPACE':
    case 'PATH_BLACKLISTED':
    case 'EXTENSION_NOT_ALLOWED':
      return 'PERMISSION_DENIED';
    case 'UNSUPPORTED_PROVIDER':
      return 'UNSUPPORTED_PROVIDER';
    case 'FILE_NOT_FOUND':
    default:
      return 'EXECUTION_FAILED';
  }
}

/**
 * 读取错误消息。
 * @param error - 未知错误
 * @returns 可展示错误消息
 */
function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '读取文件失败';
}

/**
 * 规范化读取行范围。
 * @param input - read_file 输入参数
 * @returns 规范化后的读取行范围
 */
function normalizeReadRange(input: ReadFileInput): { offset: number; limit?: number } {
  const offset = input.offset ?? DEFAULT_OFFSET;

  if (!Number.isInteger(offset) || offset < 1) {
    throw new Error('offset 必须是大于等于 1 的整数');
  }

  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
    throw new Error('limit 必须是大于等于 1 的整数');
  }

  return input.limit === undefined ? { offset } : { offset, limit: input.limit };
}

/**
 * 判断输入路径是否为绝对路径。
 * @param filePath - 文件路径
 * @returns 是否为 Windows 或 POSIX 绝对路径
 */
function isAbsoluteFilePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\');
}

/**
 * 请求用户确认读取本地绝对路径。
 * @param adapter - 确认适配器
 * @param filePath - 文件路径
 * @param range - 读取行范围
 * @returns 是否已确认
 */
async function confirmAbsoluteRead(adapter: AIToolConfirmationAdapter, filePath: string, range: { offset: number; limit?: number }): Promise<boolean> {
  const rangeText = range.limit === undefined ? `从第 ${range.offset} 行开始读取到文件末尾` : `从第 ${range.offset} 行开始，读取 ${range.limit} 行`;
  const request: AIToolConfirmationRequest = {
    toolName: READ_FILE_TOOL_NAME,
    title: 'AI 想要读取本地文件',
    description: `AI 请求读取本地文件：${filePath}\n读取范围：${rangeText}。`,
    riskLevel: 'read',
    beforeText: filePath
  };
  const decision = await adapter.confirm(request);

  return typeof decision === 'boolean' ? decision : decision.approved;
}

/**
 * 创建内置 read_file 工具。
 * @param options - 工具创建选项
 * @returns read_file 工具执行器
 */
export function createBuiltinReadFileTool(options: CreateBuiltinReadFileToolOptions = {}): AIToolExecutor<ReadFileInput, ReadFileResult> {
  const readWorkspaceFile = options.readWorkspaceFile ?? native.readWorkspaceFile.bind(native);

  return {
    definition: {
      name: READ_FILE_TOOL_NAME,
      description: '读取指定本地文本文件内容，可通过 offset 和 limit 滚动读取。相对路径需要工作区根目录，绝对路径需要用户确认。',
      source: 'builtin',
      riskLevel: 'read',
      requiresActiveDocument: false,
      permissionCategory: 'system',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，支持相对工作区路径或绝对路径。' },
          offset: { type: 'number', description: '起始行号，默认 1。' },
          limit: { type: 'number', description: '读取行数；不传时读取到文件末尾。' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    async execute(input: ReadFileInput) {
      const filePath = typeof input.path === 'string' ? input.path.trim() : '';
      if (!filePath) {
        return createToolFailureResult(READ_FILE_TOOL_NAME, 'INVALID_INPUT', '文件路径不能为空');
      }

      const workspaceRoot = options.getWorkspaceRoot?.() ?? null;
      const confirmationAdapter = options.confirm;
      if (!workspaceRoot) {
        if (!isAbsoluteFilePath(filePath)) {
          return createToolFailureResult(READ_FILE_TOOL_NAME, 'PERMISSION_DENIED', '未配置工作区根目录时只能读取绝对路径');
        }

        if (!confirmationAdapter) {
          return createToolFailureResult(READ_FILE_TOOL_NAME, 'PERMISSION_DENIED', '读取本地绝对路径需要用户确认');
        }
      }

      try {
        const range = normalizeReadRange(input);
        if (!workspaceRoot) {
          const confirmed = await confirmAbsoluteRead(confirmationAdapter!, filePath, range);
          if (!confirmed) {
            return createToolCancelledResult(READ_FILE_TOOL_NAME);
          }
        }

        const result = await readWorkspaceFile({
          filePath,
          ...(workspaceRoot ? { workspaceRoot } : {}),
          offset: range.offset,
          ...(range.limit === undefined ? {} : { limit: range.limit })
        });

        return createToolSuccessResult(READ_FILE_TOOL_NAME, result);
      } catch (error) {
        const code = mapWorkspaceErrorCode(readErrorCode(error));
        return createToolFailureResult(READ_FILE_TOOL_NAME, code, readErrorMessage(error));
      }
    }
  };
}
