/**
 * @file paths.mts
 * @description ChatRuntime 主进程工具路径解析。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RuntimeReadTarget, RuntimeWriteTarget } from './types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { WRITE_FILE_TOOL_NAME } from './constants.mjs';
import { createMainToolFailureResult } from './results.mjs';

/** 用户主目录下允许只读工具直接访问的工具数据目录。 */
const TRUSTED_HOME_READ_DIRECTORY_NAMES = ['.agents', '.tibis'] as const;

/** 文件读取真实目标。 */
export interface RuntimeRealReadTarget {
  /** realpath 后用于确认与读取的目标路径。 */
  filePath: string;
  /** 真实路径是否需要按工作区外路径确认。 */
  outsideWorkspace: boolean;
}

/**
 * 判断文件路径是否为绝对路径。
 * @param filePath - 文件路径
 * @returns 是否为绝对路径
 */
export function isAbsoluteRuntimeFilePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\');
}

/**
 * 判断相对路径是否会逃逸工作区。
 * @param resolvedPath - 已解析路径
 * @param workspaceRoot - 工作区根目录
 * @returns 是否逃逸工作区
 */
function isRuntimePathEscapedWorkspace(resolvedPath: string, workspaceRoot: string): boolean {
  const relativePath = path.relative(workspaceRoot, resolvedPath);
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
}

/**
 * 判断文件路径是否位于工作区内。
 * @param filePath - 文件路径
 * @param workspaceRoot - 工作区根目录
 * @returns 是否位于工作区内
 */
export function isRuntimePathInsideWorkspace(filePath: string, workspaceRoot: string | undefined): boolean {
  if (!workspaceRoot) return false;

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = isAbsoluteRuntimeFilePath(filePath) ? path.resolve(filePath) : path.resolve(resolvedRoot, filePath);
  return !isRuntimePathEscapedWorkspace(resolvedPath, resolvedRoot);
}

/**
 * 读取真实用户主目录，兼容 macOS /var 到 /private/var 等路径别名。
 * @returns 真实用户主目录；读取失败时返回词法规范化路径
 */
function resolveRuntimeHomeDir(): string {
  const homeDir = os.homedir().trim();
  if (!homeDir) return '';

  try {
    return fs.realpathSync(homeDir);
  } catch {
    return path.resolve(homeDir);
  }
}

/**
 * 读取用户主目录的词法路径与真实路径，用于兼容系统路径别名。
 * @returns 可用于可信目录前缀比较的主目录路径
 */
function resolveRuntimeHomeDirCandidates(): string[] {
  const homeDir = os.homedir().trim();
  if (!homeDir) return [];

  return Array.from(new Set([path.resolve(homeDir), resolveRuntimeHomeDir()]));
}

/**
 * 判断文件路径是否位于允许只读工具直接访问的用户级工具数据目录内。
 * @param filePath - 文件路径
 * @returns 是否位于 ~/.agents 或 ~/.tibis 内
 */
export function isRuntimeTrustedHomeReadPath(filePath: string): boolean {
  if (!isAbsoluteRuntimeFilePath(filePath)) return false;

  const homeDirCandidates = resolveRuntimeHomeDirCandidates();
  if (homeDirCandidates.length === 0) return false;

  const resolvedPath = path.resolve(filePath);

  return homeDirCandidates.some((homeDir) =>
    TRUSTED_HOME_READ_DIRECTORY_NAMES.some((directoryName) => {
      const trustedRoot = path.join(homeDir, directoryName);
      return isRuntimePathInsideWorkspace(resolvedPath, trustedRoot);
    })
  );
}

/**
 * 判断路径是否为未保存虚拟路径。
 * @param filePath - 文件路径
 * @returns 是否为未保存路径
 */
export function isRuntimeUnsavedPath(filePath: string): boolean {
  return filePath.startsWith('unsaved://');
}

/**
 * 解析只读文件目标路径。
 * @param filePath - 原始文件路径
 * @param workspaceRoot - 工作区根目录
 * @param toolName - 触发解析的工具名
 * @returns 读取目标或失败结果
 */
export function resolveRuntimeReadTarget(filePath: string, workspaceRoot: string | undefined, toolName: string): RuntimeReadTarget | AIToolExecutionResult {
  if (isRuntimeUnsavedPath(filePath)) {
    return createMainToolFailureResult(toolName, 'EDITOR_UNAVAILABLE', '未保存文件需要由当前编辑器提供内容');
  }

  if (!workspaceRoot) {
    if (!isAbsoluteRuntimeFilePath(filePath)) {
      return createMainToolFailureResult(toolName, 'INVALID_INPUT', '未配置工作区时不能读取相对路径');
    }

    return { filePath, outsideWorkspace: true };
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  if (isAbsoluteRuntimeFilePath(filePath)) {
    return {
      filePath,
      outsideWorkspace: !isRuntimePathInsideWorkspace(filePath, resolvedRoot) && !isRuntimeTrustedHomeReadPath(filePath)
    };
  }

  const resolvedPath = path.resolve(resolvedRoot, filePath);
  if (isRuntimePathEscapedWorkspace(resolvedPath, resolvedRoot)) {
    return createMainToolFailureResult(toolName, 'PERMISSION_DENIED', '相对路径超出了当前工作区范围');
  }

  return { filePath: resolvedPath, outsideWorkspace: false };
}

/**
 * 根据 realpath 判断只读目标是否仍需要工作区外确认。
 * @param target - 词法解析后的读取目标
 * @param realFilePath - realpath 后的目标路径
 * @param realWorkspaceRoot - realpath 后的工作区根目录
 * @returns 是否需要工作区外确认
 */
export function isRuntimeRealReadTargetOutsideWorkspace(target: RuntimeReadTarget, realFilePath: string, realWorkspaceRoot: string | undefined): boolean {
  let { outsideWorkspace } = target;

  if (realWorkspaceRoot) {
    outsideWorkspace = !isRuntimePathInsideWorkspace(realFilePath, realWorkspaceRoot);
  }

  if (isRuntimeTrustedHomeReadPath(realFilePath)) {
    outsideWorkspace = false;
  }

  return outsideWorkspace;
}

/**
 * 解析只读目标的真实路径，并基于 realpath 复核工作区与用户级可信目录边界。
 * @param target - 词法解析后的读取目标
 * @param workspaceRoot - 工作区根目录
 * @returns 真实读取目标
 */
export async function resolveRuntimeRealReadTarget(target: RuntimeReadTarget, workspaceRoot: string | undefined): Promise<RuntimeRealReadTarget> {
  const realFilePath = await fs.promises.realpath(target.filePath);
  const realWorkspaceRoot = workspaceRoot ? await fs.promises.realpath(workspaceRoot) : undefined;
  const realPathOutsideWorkspace = realWorkspaceRoot ? !isRuntimePathInsideWorkspace(realFilePath, realWorkspaceRoot) : false;
  const outsideWorkspace = isRuntimeRealReadTargetOutsideWorkspace(target, realFilePath, realWorkspaceRoot);

  return {
    filePath: outsideWorkspace || realPathOutsideWorkspace ? realFilePath : target.filePath,
    outsideWorkspace
  };
}

/**
 * 解析 write_file 目标路径。
 * @param filePath - 原始文件路径
 * @param workspaceRoot - 工作区根目录
 * @returns 写入目标或失败结果
 */
export function resolveRuntimeWriteTarget(filePath: string, workspaceRoot: string | undefined): RuntimeWriteTarget | AIToolExecutionResult {
  if (isRuntimeUnsavedPath(filePath)) {
    return { type: 'unsaved', filePath };
  }

  if (!workspaceRoot) {
    if (!isAbsoluteRuntimeFilePath(filePath)) {
      return { type: 'draft', originalPath: filePath };
    }

    return { type: 'file', filePath, outsideWorkspace: true };
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  if (isAbsoluteRuntimeFilePath(filePath)) {
    return {
      type: 'file',
      filePath,
      outsideWorkspace: !isRuntimePathInsideWorkspace(filePath, resolvedRoot)
    };
  }

  const resolvedPath = path.resolve(resolvedRoot, filePath);
  if (isRuntimePathEscapedWorkspace(resolvedPath, resolvedRoot)) {
    return createMainToolFailureResult(WRITE_FILE_TOOL_NAME, 'PERMISSION_DENIED', '相对路径超出了当前工作区范围');
  }

  return { type: 'file', filePath: resolvedPath, outsideWorkspace: false };
}
