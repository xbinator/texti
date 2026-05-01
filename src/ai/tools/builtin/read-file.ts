/**
 * @file read-file.ts
 * @description 内置本地文件读取工具实现，支持磁盘路径和编辑器文档 ID 两种读取方式。
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '../confirmation';
import type { AIToolExecutionError, AIToolExecutor } from 'types/ai';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { native } from '@/shared/platform';
import type {
  ReadWorkspaceDirectoryOptions,
  ReadWorkspaceDirectoryResult,
  ReadWorkspaceFileOptions,
  ReadWorkspaceFileResult
} from '@/shared/platform/native/types';
import { chatStorage } from '@/shared/storage';
import { createToolCancelledResult, createToolFailureResult, createToolSuccessResult } from '../results';

/** read_file 工具名称 */
export const READ_FILE_TOOL_NAME = 'read_file';
/** read_directory 工具名称 */
export const READ_DIRECTORY_TOOL_NAME = 'read_directory';
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
  /** 文件路径（磁盘文件），与 documentId 二选一 */
  path?: string;
  /** 文档 ID（未保存的编辑器文件），与 path 二选一 */
  documentId?: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，不传时读取到文件末尾 */
  limit?: number;
}

/** extractLines 辅助函数参数 */
interface ExtractLinesParams {
  /** 起始行号 */
  offset?: number;
  /** 读取行数 */
  limit?: number;
}

/** extractLines 返回结果 */
interface ExtractLinesResult {
  /** 截取后的文本内容 */
  excerpt: string;
  /** 文件总行数 */
  totalLines: number;
  /** 实际读取行数 */
  readLines: number;
  /** 是否还有后续内容 */
  hasMore: boolean;
  /** 下一次滚动读取的起始行号 */
  nextOffset: number | null;
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
  /** 读取本地目录，测试时可注入替身 */
  readWorkspaceDirectory?: (options: ReadWorkspaceDirectoryOptions) => Promise<ReadWorkspaceDirectoryResult>;
}

/** read_directory 工具输入参数 */
export interface ReadDirectoryInput {
  /** 目录路径，支持相对工作区路径或绝对路径 */
  path: string;
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
 * 从文本内容中按 offset/limit 截取行。
 * 不依赖 ReadFileInput 的必填字段约束，供 documentId 和快照降级路径复用。
 * @param content - 全文内容
 * @param params - 截取参数
 * @returns 截取结果
 */
function extractLines(content: string, params: ExtractLinesParams): ExtractLinesResult {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const offset = params.offset && params.offset >= 1 ? params.offset : DEFAULT_OFFSET;
  const hasLimit = params.limit !== undefined && params.limit >= 1;
  const endIndex = hasLimit ? Math.min(offset - 1 + params.limit!, totalLines) : totalLines;

  const excerpt = lines.slice(offset - 1, endIndex).join('\n');
  const readLines = endIndex - offset + 1;
  const hasMore = endIndex < totalLines;

  return {
    excerpt,
    totalLines,
    readLines,
    hasMore,
    nextOffset: hasMore ? offset + readLines : null
  };
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
 * 请求用户确认读取本地绝对路径目录。
 * @param adapter - 确认适配器
 * @param directoryPath - 目录路径
 * @returns 是否已确认
 */
async function confirmAbsoluteDirectoryRead(adapter: AIToolConfirmationAdapter, directoryPath: string): Promise<boolean> {
  const request: AIToolConfirmationRequest = {
    toolName: READ_DIRECTORY_TOOL_NAME,
    title: 'AI 想要读取本地目录',
    description: `AI 请求读取本地目录：${directoryPath}\n仅返回当前目录的直接子项。`,
    riskLevel: 'read',
    beforeText: directoryPath
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
      description:
        '读取指定本地文件或编辑器文档的内容。' +
        '当用户消息中包含 [file: /path/to/file.ts#L3-L5] 标记时，使用 path 参数读取磁盘文件，offset 从标记中的行号获取。' +
        '当用户消息中包含 [file: id=xxx name="foo" @L3-L5] 标记时，使用 documentId 参数（id 的值）读取编辑器中的未保存文档。',
      source: 'builtin',
      riskLevel: 'read',
      requiresActiveDocument: false,
      permissionCategory: 'system',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径（绝对路径），与 documentId 二选一。对应 [file: /path/...] 标记中的路径部分。' },
          documentId: { type: 'string', description: '文档 ID（未保存的编辑器文件），与 path 二选一。对应 [file: id=xxx ...] 标记中的 id 值。' },
          offset: { type: 'number', description: '起始行号，默认 1。' },
          limit: { type: 'number', description: '读取行数；不传时读取到文件末尾。' }
        },
        required: [],
        additionalProperties: false
      }
    },
    async execute(input: ReadFileInput) {
      // ── documentId 分支：编辑器内存 → SQLite 快照降级 ──
      if (input.documentId) {
        const context = editorToolContextRegistry.getContext(input.documentId);
        let content: string;
        let pathLabel: string;

        if (context) {
          // 路径 1：从编辑器内存读取（当前激活的 tab）
          content = context.document.getContent();
          pathLabel = context.document.path ?? '';
        } else {
          // 路径 2：降级到 SQLite 快照（tab 已关闭，但有历史快照）
          const snapshot = await chatStorage.getReferenceSnapshotByDocumentId(input.documentId);
          if (snapshot) {
            content = snapshot.content;
            pathLabel = `[快照] ${snapshot.title}`;
          } else {
            return createToolFailureResult(READ_FILE_TOOL_NAME, 'EXECUTION_FAILED', '文档未在编辑器中打开，且无历史快照');
          }
        }

        const { excerpt, totalLines, readLines, hasMore, nextOffset } = extractLines(content, {
          offset: input.offset,
          limit: input.limit
        });
        return createToolSuccessResult(READ_FILE_TOOL_NAME, {
          path: pathLabel,
          content: excerpt,
          totalLines,
          readLines,
          hasMore,
          nextOffset
        });
      }

      // ── path 分支：磁盘读取逻辑 ──
      const filePath = typeof input.path === 'string' ? input.path.trim() : '';
      if (!filePath) {
        return createToolFailureResult(READ_FILE_TOOL_NAME, 'INVALID_INPUT', 'path 或 documentId 必须提供一个');
      }

      // 如果文件已在编辑器中打开，直接从编辑器上下文读取（跳过权限确认）
      const editorContext = editorToolContextRegistry.getContextByPath(filePath);
      if (editorContext) {
        const content = editorContext.document.getContent();
        const { excerpt, totalLines, readLines, hasMore, nextOffset } = extractLines(content, {
          offset: input.offset,
          limit: input.limit
        });
        return createToolSuccessResult(READ_FILE_TOOL_NAME, {
          path: editorContext.document.path ?? filePath,
          content: excerpt,
          totalLines,
          readLines,
          hasMore,
          nextOffset
        });
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

/**
 * 创建内置 read_directory 工具。
 * @param options - 工具创建选项
 * @returns read_directory 工具执行器
 */
export function createBuiltinReadDirectoryTool(
  options: CreateBuiltinReadFileToolOptions = {}
): AIToolExecutor<ReadDirectoryInput, ReadWorkspaceDirectoryResult> {
  const readWorkspaceDirectory = options.readWorkspaceDirectory ?? native.readWorkspaceDirectory.bind(native);

  return {
    definition: {
      name: READ_DIRECTORY_TOOL_NAME,
      description: '读取指定目录下的直接子项列表，仅返回当前目录中的文件和子目录，不递归展开。相对路径需要工作区根目录，绝对路径需要用户确认。',
      source: 'builtin',
      riskLevel: 'read',
      requiresActiveDocument: false,
      permissionCategory: 'system',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，支持相对工作区路径或绝对路径。' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    async execute(input: ReadDirectoryInput) {
      const directoryPath = typeof input.path === 'string' ? input.path.trim() : '';
      if (!directoryPath) {
        return createToolFailureResult(READ_DIRECTORY_TOOL_NAME, 'INVALID_INPUT', '目录路径不能为空');
      }

      const workspaceRoot = options.getWorkspaceRoot?.() ?? null;
      const confirmationAdapter = options.confirm;
      if (!workspaceRoot) {
        if (!isAbsoluteFilePath(directoryPath)) {
          return createToolFailureResult(READ_DIRECTORY_TOOL_NAME, 'PERMISSION_DENIED', '未配置工作区根目录时只能读取绝对路径');
        }

        if (!confirmationAdapter) {
          return createToolFailureResult(READ_DIRECTORY_TOOL_NAME, 'PERMISSION_DENIED', '读取本地绝对路径目录需要用户确认');
        }
      }

      try {
        if (!workspaceRoot) {
          const confirmed = await confirmAbsoluteDirectoryRead(confirmationAdapter!, directoryPath);
          if (!confirmed) {
            return createToolCancelledResult(READ_DIRECTORY_TOOL_NAME);
          }
        }

        const result = await readWorkspaceDirectory({
          directoryPath,
          ...(workspaceRoot ? { workspaceRoot } : {})
        });

        return createToolSuccessResult(READ_DIRECTORY_TOOL_NAME, result);
      } catch (error) {
        const code = mapWorkspaceErrorCode(readErrorCode(error));
        return createToolFailureResult(READ_DIRECTORY_TOOL_NAME, code, error instanceof Error ? error.message : '读取目录失败');
      }
    }
  };
}
