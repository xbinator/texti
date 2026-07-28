/**
 * @file resource-scopes.mts
 * @description 把 Child 契约资源解析为工作区内、realpath 规范化的只读范围。
 */
import { realpathSync, statSync, type Stats } from 'node:fs';
import * as path from 'node:path';
import type { AgentResourceReference, AgentTaskError } from 'types/chat-agent';
import { isAbsoluteRuntimeFilePath, isRuntimePathInsideWorkspace, isRuntimeUnsavedPath } from '../runtime/tools/paths.mjs';

/** Scheduler 接受的 canonical 本地 scope。 */
interface CanonicalAgentScope {
  /** 文件或递归目录。 */
  readonly kind: 'file' | 'directory';
  /** 不含 scope 前缀与通配后缀的 canonical 绝对路径。 */
  readonly path: string;
}

/** 非 canonical scope 的稳定协议错误。 */
export class AgentScopeProtocolError extends Error {
  /** 机器错误码。 */
  readonly code = 'protocol_error';

  /** 资源 scope 解析阶段。 */
  readonly phase = 'resource_validation';

  /** 非 canonical scope 属于协议错误。 */
  readonly category = 'protocol';

  /** 稳定机器原因。 */
  readonly reason = 'canonical_resource_scope_invalid';

  /** 协议错误不可通过原请求自动重试。 */
  readonly retryable = false;

  /** 经 allowlist 裁剪的机器细节。 */
  readonly details = Object.freeze({ reason: this.reason });

  /** 创建不包含原始本地路径的 scope 协议错误。 */
  constructor() {
    super('Canonical resource scope is invalid');
    this.name = 'AgentScopeProtocolError';
  }
}

/** 资源范围解析成功结果。 */
export interface AgentScopeResolution {
  /** 解析成功。 */
  readonly ok: true;
  /** realpath 后的工作区根目录。 */
  readonly workspaceRealRoot: string;
  /** 排序去重后的持久化资源范围。 */
  readonly resourceScopes: readonly string[];
}

/** 资源范围解析失败结果。 */
export interface AgentScopeFailure {
  /** 解析失败。 */
  readonly ok: false;
  /** 稳定资源校验错误。 */
  readonly error: AgentTaskError;
}

/** 资源范围解析结果。 */
export type AgentScopeResult = AgentScopeResolution | AgentScopeFailure;

/**
 * 创建不泄露本地绝对路径的资源错误。
 * @param reason - 稳定失败原因
 * @param message - 用户可读说明
 * @returns 结构化资源错误
 */
function createScopeError(reason: string, message: string): AgentScopeFailure {
  return {
    ok: false,
    error: {
      code: 'resource_scope_invalid',
      phase: 'resource_validation',
      category: 'resource',
      retryable: false,
      message,
      details: { reason }
    }
  };
}

/**
 * 解析一个显式资源并返回 canonical scope。
 * @param resource - 不可变契约资源
 * @param workspaceRealRoot - realpath 后的工作区根目录
 * @returns canonical scope 或结构化失败
 */
function resolveResourceScope(resource: AgentResourceReference, workspaceRealRoot: string): string | AgentScopeFailure {
  if (resource.kind !== 'file' && resource.kind !== 'directory') {
    return createScopeError('resource_kind_unsupported', '首版 Child Runtime 只接受本地文件或目录资源');
  }
  const reference = resource.reference.trim();
  if (!reference || isRuntimeUnsavedPath(reference)) {
    return createScopeError('resource_virtual_path_denied', 'Child Runtime 不能读取未保存或空资源路径');
  }
  if (isAbsoluteRuntimeFilePath(reference)) {
    return createScopeError('resource_absolute_path_denied', 'Child Runtime 契约资源必须使用工作区相对路径');
  }

  let resourceRealPath: string;
  try {
    resourceRealPath = realpathSync(path.resolve(workspaceRealRoot, reference));
  } catch {
    return createScopeError('resource_not_found', 'Child Runtime 资源不存在或不可读取');
  }
  if (!isRuntimePathInsideWorkspace(resourceRealPath, workspaceRealRoot)) {
    return createScopeError('resource_outside_workspace', 'Child Runtime 资源超出冻结工作区');
  }

  let resourceStats: Stats;
  try {
    resourceStats = statSync(resourceRealPath);
  } catch {
    return createScopeError('resource_not_found', 'Child Runtime 资源不存在或不可读取');
  }
  if ((resource.kind === 'file' && !resourceStats.isFile()) || (resource.kind === 'directory' && !resourceStats.isDirectory())) {
    return createScopeError('resource_kind_mismatch', 'Child Runtime 资源类型与契约声明不一致');
  }
  return resource.kind === 'file' ? `file:${resourceRealPath}` : `directory:${resourceRealPath}/**`;
}

/**
 * 把契约资源解析为工作区内的真实路径范围。
 * @param resources - 不可变契约资源集合
 * @param workspaceRoot - Primary Runtime A 冻结的工作区根目录
 * @returns 完整 canonical scope 集合或 fail-closed 错误
 */
export function resolveAgentScopes(resources: readonly AgentResourceReference[], workspaceRoot: string): AgentScopeResult {
  const normalizedRoot = workspaceRoot.trim();
  if (!normalizedRoot) return createScopeError('workspace_root_missing', 'Child Runtime 缺少冻结工作区根目录');

  let workspaceRealRoot: string;
  try {
    workspaceRealRoot = realpathSync(normalizedRoot);
  } catch {
    return createScopeError('workspace_root_invalid', 'Child Runtime 工作区不存在或不可读取');
  }
  try {
    if (!statSync(workspaceRealRoot).isDirectory()) {
      return createScopeError('workspace_root_invalid', 'Child Runtime 工作区根必须是目录');
    }
  } catch {
    return createScopeError('workspace_root_invalid', 'Child Runtime 工作区不存在或不可读取');
  }
  if (resources.length === 0) return createScopeError('resource_scope_empty', 'Child Runtime 必须声明至少一个资源');

  const resourceScopes: string[] = [];
  for (const resource of resources) {
    const resolvedScope = resolveResourceScope(resource, workspaceRealRoot);
    if (typeof resolvedScope !== 'string') return resolvedScope;
    resourceScopes.push(resolvedScope);
  }

  return {
    ok: true,
    workspaceRealRoot,
    resourceScopes: [...new Set(resourceScopes)].sort()
  };
}

/**
 * 选择当前 scope 路径使用的 path 实现。
 * @param filePath - canonical 绝对路径
 * @returns Windows 或当前平台 path API
 */
function selectPathApi(filePath: string): typeof path.posix {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') ? path.win32 : path.posix;
}

/**
 * 解析严格 canonical 的 file/directory scope。
 * @param resourceScope - 未可信 scope 字符串
 * @returns canonical scope
 */
function parseCanonicalScope(resourceScope: string): CanonicalAgentScope {
  if (!resourceScope || resourceScope.trim() !== resourceScope) throw new AgentScopeProtocolError();
  let kind: CanonicalAgentScope['kind'];
  let scopePath: string;
  if (resourceScope.startsWith('file:')) {
    kind = 'file';
    scopePath = resourceScope.slice('file:'.length);
  } else if (resourceScope.startsWith('directory:') && resourceScope.endsWith('/**')) {
    kind = 'directory';
    scopePath = resourceScope.slice('directory:'.length, -'/**'.length);
  } else {
    throw new AgentScopeProtocolError();
  }
  if (!scopePath || !isAbsoluteRuntimeFilePath(scopePath)) throw new AgentScopeProtocolError();
  const pathApi = selectPathApi(scopePath);
  if (pathApi.resolve(scopePath) !== scopePath || (kind === 'file' && scopePath.endsWith(pathApi.sep))) {
    throw new AgentScopeProtocolError();
  }
  return { kind, path: scopePath };
}

/**
 * 判断目标路径是否等于或位于目录路径内。
 * @param targetPath - 文件或子目录 canonical 路径
 * @param directoryPath - canonical 目录路径
 * @returns 是否命中目录 scope
 */
function isPathWithin(targetPath: string, directoryPath: string): boolean {
  const pathApi = selectPathApi(directoryPath);
  const relativePath = pathApi.relative(directoryPath, targetPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relativePath));
}

/**
 * 判断两个 canonical file/directory scope 是否有资源交集。
 * @param left - 左侧 canonical scope
 * @param right - 右侧 canonical scope
 * @returns 两个范围是否重叠
 */
export function scopesOverlap(left: string, right: string): boolean {
  const leftScope = parseCanonicalScope(left);
  const rightScope = parseCanonicalScope(right);
  if (selectPathApi(leftScope.path) !== selectPathApi(rightScope.path)) return false;
  if (leftScope.kind === 'file' && rightScope.kind === 'file') return leftScope.path === rightScope.path;
  if (leftScope.kind === 'directory' && rightScope.kind === 'directory') {
    return isPathWithin(leftScope.path, rightScope.path) || isPathWithin(rightScope.path, leftScope.path);
  }
  const directory = leftScope.kind === 'directory' ? leftScope : rightScope;
  const file = leftScope.kind === 'file' ? leftScope : rightScope;
  return isPathWithin(file.path, directory.path);
}
