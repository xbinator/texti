/**
 * @file workspace-read.mts
 * @description 工作区和授权绝对路径文本文件安全读取服务。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** 默认起始行号 */
const DEFAULT_OFFSET = 1;

/** 允许读取的文本文件扩展名 */
const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.json',
  '.md',
  '.mdx',
  '.css',
  '.less',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.txt',
  '.sh',
  '.bash'
]);

/** 禁止读取的路径模式 */
const BLACKLIST_PATTERNS: RegExp[] = [
  /(^|\/)\.env(?:[./]|$)/,
  /(^|\/)\.git(?:\/|$)/,
  /(^|\/)node_modules(?:\/|$)/,
  /(^|\/)dist(?:\/|$)/,
  /(^|\/)dist-electron(?:\/|$)/,
  /\.pem$/i,
  /\.key$/i,
  /\.lock$/i,
  /\.sqlite?$/i
];

/** 工作区读取错误码 */
export type WorkspaceReadErrorCode = 'PATH_OUTSIDE_WORKSPACE' | 'PATH_BLACKLISTED' | 'EXTENSION_NOT_ALLOWED' | 'FILE_NOT_FOUND' | 'INVALID_INPUT';

/** 读取工作区文件请求 */
export interface ReadWorkspaceFileRequest {
  /** 文件路径，支持相对工作区路径或绝对路径 */
  filePath: string;
  /** 工作区根目录，缺省时仅允许读取绝对路径 */
  workspaceRoot?: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，不传时读取到文件末尾 */
  limit?: number;
}

/** 读取工作区文件结果 */
export interface ReadWorkspaceFileResult {
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

/**
 * 工作区读取错误。
 * @description 通过 code 字段让渲染层可映射到工具错误码。
 */
export class WorkspaceReadError extends Error {
  /** 工作区读取错误码 */
  public readonly code: WorkspaceReadErrorCode;

  /**
   * 创建工作区读取错误。
   * @param code - 错误码
   * @param message - 错误消息
   */
  public constructor(code: WorkspaceReadErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceReadError';
    this.code = code;
  }
}

/**
 * 判断真实路径是否位于工作区内。
 * @param realPath - 文件真实路径
 * @param realRoot - 工作区真实路径
 * @returns 是否位于工作区内
 */
export function isWithinWorkspace(realPath: string, realRoot: string): boolean {
  const relativePath = path.relative(realRoot, realPath);
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/**
 * 将路径规范化为 POSIX 风格，便于安全规则匹配。
 * @param targetPath - 待匹配路径
 * @returns POSIX 风格路径
 */
function toSafePath(targetPath: string): string {
  return targetPath.split(path.sep).join('/');
}

/**
 * 判断路径是否命中黑名单。
 * @param targetPath - 目标路径
 * @returns 是否命中黑名单
 */
function isBlacklistedPath(targetPath: string): boolean {
  const safePath = toSafePath(targetPath);
  return BLACKLIST_PATTERNS.some((pattern) => pattern.test(safePath));
}

/**
 * 判断文件扩展名是否允许读取。
 * @param filePath - 文件路径
 * @returns 是否允许读取
 */
function isAllowedExtension(filePath: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 规范化读取行范围。
 * @param offset - 起始行号
 * @param limit - 读取行数
 * @returns 规范化后的行范围
 */
function normalizeLineRange(offset?: number, limit?: number): { offset: number; limit?: number } {
  const normalizedOffset = offset ?? DEFAULT_OFFSET;

  if (!Number.isInteger(normalizedOffset) || normalizedOffset < 1) {
    throw new WorkspaceReadError('INVALID_INPUT', 'offset 必须是大于等于 1 的整数');
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new WorkspaceReadError('INVALID_INPUT', 'limit 必须是大于等于 1 的整数');
  }

  return limit === undefined ? { offset: normalizedOffset } : { offset: normalizedOffset, limit };
}

/**
 * 解析并校验文件真实路径。
 * @param request - 读取请求
 * @returns 校验后的真实路径信息
 */
async function resolveWorkspaceFile(request: ReadWorkspaceFileRequest): Promise<{ realPath: string; securityPath: string }> {
  const filePath = request.filePath.trim();
  const workspaceRoot = request.workspaceRoot?.trim() ?? '';

  if (!filePath) {
    throw new WorkspaceReadError('INVALID_INPUT', '文件路径不能为空');
  }

  if (!workspaceRoot && !path.isAbsolute(filePath)) {
    throw new WorkspaceReadError('INVALID_INPUT', '未配置工作区根目录时只能读取绝对路径');
  }

  try {
    const realRoot = workspaceRoot ? await fs.realpath(workspaceRoot) : null;
    const candidatePath = realRoot && !path.isAbsolute(filePath) ? path.join(realRoot, filePath) : filePath;
    const realPath = await fs.realpath(candidatePath);

    if (realRoot && !isWithinWorkspace(realPath, realRoot)) {
      throw new WorkspaceReadError('PATH_OUTSIDE_WORKSPACE', '文件路径不在工作区内');
    }

    return { realPath, securityPath: realRoot ? path.relative(realRoot, realPath) : realPath };
  } catch (error) {
    if (error instanceof WorkspaceReadError) {
      throw error;
    }

    throw new WorkspaceReadError('FILE_NOT_FOUND', '文件不存在或无法访问');
  }
}

/**
 * 安全读取文本文件。
 * @param request - 读取请求
 * @returns 文件读取结果
 */
export async function readWorkspaceFile(request: ReadWorkspaceFileRequest): Promise<ReadWorkspaceFileResult> {
  const lineRange = normalizeLineRange(request.offset, request.limit);
  const { realPath, securityPath } = await resolveWorkspaceFile(request);

  if (isBlacklistedPath(securityPath)) {
    throw new WorkspaceReadError('PATH_BLACKLISTED', '文件路径命中安全黑名单');
  }

  if (!isAllowedExtension(realPath)) {
    throw new WorkspaceReadError('EXTENSION_NOT_ALLOWED', '不支持读取该类型文件');
  }

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    throw new WorkspaceReadError('INVALID_INPUT', '目标路径不是文件');
  }

  const content = await fs.readFile(realPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const startIndex = lineRange.offset - 1;
  const endIndex = lineRange.limit === undefined ? undefined : startIndex + lineRange.limit;
  const selectedLines = lines.slice(startIndex, endIndex);
  const nextOffset = lineRange.offset + selectedLines.length;
  const hasMore = nextOffset <= lines.length;

  return {
    path: realPath,
    content: selectedLines.join('\n'),
    totalLines: lines.length,
    readLines: selectedLines.length,
    hasMore,
    nextOffset: hasMore ? nextOffset : null
  };
}
