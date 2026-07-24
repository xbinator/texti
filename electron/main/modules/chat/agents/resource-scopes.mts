/**
 * @file resource-scopes.mts
 * @description 把 Child 契约资源解析为工作区内、realpath 规范化的只读范围。
 */
import { realpathSync, statSync, type Stats } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentResourceReference, AgentTaskError } from 'types/chat-agent';
import { isAbsoluteRuntimeFilePath, isRuntimePathInsideWorkspace, isRuntimeUnsavedPath } from '../runtime/tools/paths.mjs';

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
    resourceRealPath = realpathSync(resolve(workspaceRealRoot, reference));
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
