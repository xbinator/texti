/**
 * @file safety.mts
 * @description Shell 命令安全分析器，负责输入校验、工作区约束、高风险命令拦截和 AST 结构检查。
 */
/* eslint-disable no-await-in-loop */
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ShellCommandSafetyFinding, ShellCommandSafetyReport, ShellCommandSafetyRequest, ShellCommandShell } from './types.mjs';
import { parseShellCommand } from './parser.mjs';

/** 支持的 shell 集合。 */
const SUPPORTED_SHELLS = new Set<ShellCommandShell>(['bash', 'powershell']);

/** 高风险删除命令匹配。 */
const DESTRUCTIVE_DELETE_PATTERN =
  /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\b|\bRemove-Item\b[\s\S]*(?:-Recurse\b[\s\S]*-Force\b|-Force\b[\s\S]*-Recurse\b)/i;

/** 网络下载后直接交给 shell 执行的命令匹配。 */
const NETWORK_PIPE_TO_SHELL_PATTERN = /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[\s\S]*\|[\s\S]*\b(?:bash|sh|zsh|pwsh|powershell)\b/i;

/** 可能泄露环境变量或密钥的命令匹配。 */
const ENV_DUMP_PATTERN = /(?:^|[;&|]\s*)(?:env|printenv|Get-ChildItem\s+Env:)\b/i;

/** 后台或分离进程匹配。 */
const BACKGROUND_PROCESS_PATTERN = /(?:^|[^&])&\s*$|\b(?:Start-Process)\b/i;

/** 权限或所有权变更匹配，阻止递归开放权限和变更文件所有者。 */
const PERMISSION_MUTATION_PATTERN = /\bchmod\s+(?:-[a-zA-Z]*[Rr][a-zA-Z]*\s*)?(?:777|a\+rwx|ugo\+rwx)\b|\bchown\b|\bicacls\b|\bSet-Acl\b/i;

/** Shell 配置文件写入匹配，阻止覆盖或追加到 shell profile。 */
const SHELL_PROFILE_PATTERN =
  /[>>>]\s*(?:~\/(?:\.bashrc|\.bash_profile|\.profile|\.zshrc|\.zshenv)|\$profile\b|\$PROFILE\b|\$HOME\/\.(?:bashrc|bash_profile|profile|zshrc|zshenv))/i;

/** Bash 中会删除文件或空目录的命令。 */
const BASH_DELETE_COMMANDS = new Set(['rm', 'rmdir', 'unlink']);

/** PowerShell 中会删除文件或目录的命令与常见别名。 */
const POWERSHELL_DELETE_COMMANDS = new Set(['remove-item', 'rm', 'rmdir', 'del', 'erase', 'ri']);

/** PowerShell 中表示命令实参的节点类型。 */
const POWERSHELL_ARGUMENT_NODE_TYPES = ['generic_token', 'string_literal', 'expandable_string_literal', 'verbatim_string_literal'] as const;

/** PowerShell 中会再次解释命令字符串的 shell 命令。 */
const POWERSHELL_NESTED_SHELL_COMMANDS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

/** PowerShell 中会执行字符串的命令与别名。 */
const POWERSHELL_EVAL_COMMANDS = new Set(['invoke-expression', 'iex']);

/** Bash 中可绕过 alias/function 的命令包装器。 */
const BASH_COMMAND_WRAPPERS = new Set(['command', 'builtin']);

/** Bash 中表示命令实参的节点类型。 */
const BASH_ARGUMENT_NODE_TYPES = new Set(['word', 'raw_string', 'string', 'concatenation']);

/** Bash 中会再次解释命令字符串的 shell 命令。 */
const BASH_NESTED_SHELL_COMMANDS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/** Bash 中会执行参数拼接结果的命令。 */
const BASH_EVAL_COMMANDS = new Set(['eval']);

/** Bash 中会转发执行后续命令的包装器。 */
const BASH_FORWARDER_COMMANDS = new Set(['env', 'sudo', 'doas']);

/** find 中会执行命令或删除文件的动作参数。 */
const BASH_FIND_EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/** Git 中会破坏工作区文件状态的子命令。 */
const GIT_DESTRUCTIVE_SUBCOMMANDS = new Set(['clean']);

/** Bash 中会创建或更新所有路径参数的写入命令。 */
const BASH_WRITE_ALL_TARGET_COMMANDS = new Set(['touch', 'mkdir', 'mkfifo']);

/** Bash 中会写入最后一个路径参数的命令。 */
const BASH_WRITE_DESTINATION_COMMANDS = new Set(['cp', 'mv', 'install']);

/** Bash 中会向路径参数写入标准输入的命令。 */
const BASH_WRITE_STREAM_COMMANDS = new Set(['tee']);

/** 工作区内读取也应确认的敏感文件名。 */
const SENSITIVE_READ_FILE_NAMES = new Set(['.env', '.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519', 'id_dsa', 'id_ecdsa']);

/** 工作区内读取也应确认的敏感目录名。 */
const SENSITIVE_READ_DIRECTORY_NAMES = new Set(['.ssh', '.gnupg']);

/** 嵌套命令递归分析深度上限。 */
const MAX_NESTED_COMMAND_DEPTH = 3;

/** 用户主目录下允许 Shell 读取类命令免确认访问的工具数据目录。 */
const TRUSTED_HOME_READ_DIRECTORY_NAMES = ['.agents', '.tibis'] as const;

/**
 * 判断未知值是否为支持的 shell。
 * @param value - 待检查值
 * @returns 是否为支持的 shell
 */
function isSupportedShell(value: unknown): value is ShellCommandShell {
  return typeof value === 'string' && SUPPORTED_SHELLS.has(value as ShellCommandShell);
}

/**
 * 创建安全发现项。
 * @param severity - 严重级别
 * @param code - 发现项编码
 * @param message - 发现项说明
 * @param nodeText - 触发规则的命令片段
 * @returns 安全发现项
 */
function createFinding(severity: ShellCommandSafetyFinding['severity'], code: string, message: string, nodeText?: string): ShellCommandSafetyFinding {
  return { severity, code, message, ...(nodeText ? { nodeText } : {}) };
}

/**
 * 判断是否已存在同编码发现项。
 * @param findings - 发现项列表
 * @param code - 发现项编码
 * @returns 是否已存在
 */
function hasFindingCode(findings: ShellCommandSafetyFinding[], code: string): boolean {
  return findings.some((finding) => finding.code === code);
}

/**
 * 判断 Bash 命令名是否为删除操作。
 * @param commandName - 命令名
 * @returns 是否为删除命令
 */
function isBashDelete(commandName: string): boolean {
  return BASH_DELETE_COMMANDS.has(commandName);
}

/**
 * 判断 PowerShell 命令名是否为删除操作。
 * @param commandName - 命令名
 * @returns 是否为删除命令
 */
function isPowerShellDelete(commandName: string): boolean {
  return POWERSHELL_DELETE_COMMANDS.has(commandName.toLowerCase());
}

/**
 * 添加删除操作确认提示。
 * @param findings - 待追加发现项列表
 * @param nodeText - 触发规则的命令片段
 */
function appendDeleteWarning(findings: ShellCommandSafetyFinding[], nodeText: string): void {
  findings.push(createFinding('warning', 'DELETE_OPERATION', '命令包含文件或目录删除操作，执行前需要用户确认。', nodeText.slice(0, 80)));
}

/**
 * 追加删除操作阻塞项。
 * @param findings - 待追加发现项列表
 * @param code - 阻塞编码
 * @param message - 阻塞说明
 * @param nodeText - 触发规则的命令片段
 */
function appendDeleteBlocker(findings: ShellCommandSafetyFinding[], code: string, message: string, nodeText: string): void {
  findings.push(createFinding('blocker', code, message, nodeText.slice(0, 80)));
}

/**
 * 归一化可执行命令名，支持 /bin/rm 这类绝对命令路径。
 * @param commandName - 原始命令名
 * @returns 归一化后的命令名
 */
function normalizeCommandName(commandName: string): string {
  return path.posix.basename(commandName.trim()).toLowerCase();
}

/**
 * 判断路径文本是否包含通配删除模式。
 * @param rawPath - 原始路径文本
 * @returns 是否包含通配符
 */
function hasGlobPattern(rawPath: string): boolean {
  return /[*?[\]]/.test(rawPath);
}

/**
 * 归一化路径字符串。
 * @param value - 未知输入
 * @returns 归一化路径，非法时返回空字符串
 */
function normalizePathInput(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

/**
 * 判断目标目录是否在工作区内。
 * @param targetPath - 目标目录
 * @param workspaceRoot - 工作区根目录
 * @returns 是否在工作区内
 */
function isPathInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(workspaceRoot);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/**
 * 读取可用于可信目录比较的用户主目录候选。
 * @returns 用户主目录候选路径
 */
function getHomeCandidates(): string[] {
  return Array.from(
    new Set([process.env.HOME, process.env.USERPROFILE, os.homedir()].filter((candidate): candidate is string => Boolean(candidate?.trim())))
  ).map((candidate) => path.resolve(candidate));
}

/**
 * 解析真实路径，路径不存在时回退到字面规范化路径。
 * @param targetPath - 目标路径
 * @returns 真实路径或规范化路径
 */
async function resolveRealPath(targetPath: string): Promise<string> {
  return realpath(targetPath).catch((): string => path.resolve(targetPath));
}

/**
 * 读取可信用户级只读目录的真实路径候选。
 * @returns 可信目录真实路径候选
 */
async function getTrustedReadRoots(): Promise<string[]> {
  const trustedRoots = getHomeCandidates().flatMap((homeDir) => TRUSTED_HOME_READ_DIRECTORY_NAMES.map((directoryName) => path.join(homeDir, directoryName)));
  const resolvedRoots = await Promise.all(trustedRoots.map((trustedRoot): Promise<string> => resolveRealPath(trustedRoot)));
  return Array.from(new Set(resolvedRoots));
}

/**
 * 判断目标路径是否位于可信用户级只读目录。
 * @param targetPath - 目标路径
 * @returns 是否位于可信目录
 */
async function isTrustedReadPath(targetPath: string): Promise<boolean> {
  const resolvedTarget = await resolveRealPath(targetPath);
  const trustedRoots = await getTrustedReadRoots();
  return trustedRoots.some((trustedRoot) => isPathInsideWorkspace(resolvedTarget, trustedRoot));
}

/**
 * 判断读取目标是否位于免确认边界内。
 * @param targetPath - 目标路径
 * @param workspaceRoot - 工作区根目录
 * @returns 是否可免确认读取
 */
async function isAllowedReadPath(targetPath: string, workspaceRoot: string): Promise<boolean> {
  const [resolvedTarget, resolvedWorkspaceRoot, trustedReadPath] = await Promise.all([
    resolveRealPath(targetPath),
    resolveRealPath(workspaceRoot),
    isTrustedReadPath(targetPath)
  ]);
  return isPathInsideWorkspace(resolvedTarget, resolvedWorkspaceRoot) || trustedReadPath;
}

/**
 * 判断目标真实路径是否位于工作区真实路径内。
 * @param targetPath - 目标路径
 * @param workspaceRoot - 工作区根目录
 * @returns 是否位于工作区真实路径内
 */
async function isPathInsideRealWorkspace(targetPath: string, workspaceRoot: string): Promise<boolean> {
  const [resolvedTarget, resolvedWorkspaceRoot] = await Promise.all([resolveRealPath(targetPath), resolveRealPath(workspaceRoot)]);
  return isPathInsideWorkspace(resolvedTarget, resolvedWorkspaceRoot);
}

/**
 * 判断执行目录的真实路径是否位于工作区真实路径内。
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @returns 是否位于工作区真实路径内
 */
async function isAllowedExecutionCwd(cwd: string, workspaceRoot: string): Promise<boolean> {
  return isPathInsideRealWorkspace(cwd, workspaceRoot);
}

/**
 * 判断路径是否像敏感凭证或环境配置。
 * @param targetPath - 目标路径
 * @returns 是否为敏感读取路径
 */
function isSensitiveReadPath(targetPath: string): boolean {
  const normalizedSegments = targetPath.split(path.sep).filter(Boolean);
  if (normalizedSegments.some((segment): boolean => SENSITIVE_READ_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  const fileName = path.basename(targetPath);
  return SENSITIVE_READ_FILE_NAMES.has(fileName) || /^\.env\./.test(fileName) || /\.(?:pem|key|p12|pfx)$/i.test(fileName);
}

/**
 * 判断参数文本是否像路径字面量。
 * @param rawPath - 原始参数文本
 * @returns 是否为路径字面量
 */
function isPathToken(rawPath: string): boolean {
  const trimmed = rawPath.trim();
  return (
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.startsWith('/') ||
    /^~[^/]*\//.test(trimmed) ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

/**
 * 从非路径参数中提取嵌入的路径字面量。
 * @param value - 参数文本
 * @returns 嵌入路径列表
 */
function extractEmbeddedPaths(value: string): string[] {
  const paths: string[] = [];
  const pathPattern = /(?:^|[\s"'`=(:,[])(~[^/\s]*\/|\.{1,2}\/|\/(?!\/)|[a-zA-Z]:[\\/])([^"'`\s),;\]]*)/g;
  let match: RegExpExecArray | null = pathPattern.exec(value);

  while (match) {
    const pathPrefix = match[1] ?? '';
    const pathRest = match[2] ?? '';
    const embeddedPath = `${pathPrefix}${pathRest}`.replace(/[,:;]+$/, '');

    if (embeddedPath && !paths.includes(embeddedPath)) {
      paths.push(embeddedPath);
    }

    match = pathPattern.exec(value);
  }

  return paths;
}

/**
 * 判断命令是否包含 heredoc 输入。
 * @param command - 命令文本
 * @returns 是否包含 heredoc
 */
function hasHeredoc(command: string): boolean {
  return /<<-?\s*(?:'[^']+'|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/.test(command);
}

/**
 * 添加命令策略发现项（regex 模式匹配）。
 * @param command - 命令文本
 * @param findings - 待追加发现项列表
 */
function appendPolicyFindings(command: string, findings: ShellCommandSafetyFinding[]): void {
  if (DESTRUCTIVE_DELETE_PATTERN.test(command) && !hasFindingCode(findings, 'DESTRUCTIVE_DELETE')) {
    findings.push(createFinding('blocker', 'DESTRUCTIVE_DELETE', '命令包含递归强制删除操作，需要人工改写为更小范围的安全操作。', command));
  }

  if (NETWORK_PIPE_TO_SHELL_PATTERN.test(command)) {
    findings.push(createFinding('blocker', 'NETWORK_PIPE_TO_SHELL', '命令将网络下载内容直接交给 shell 执行，存在供应链执行风险。', command));
  }

  if (ENV_DUMP_PATTERN.test(command)) {
    findings.push(createFinding('blocker', 'ENVIRONMENT_DUMP', '命令可能输出环境变量或密钥信息。', command));
  }

  if (BACKGROUND_PROCESS_PATTERN.test(command)) {
    findings.push(createFinding('blocker', 'BACKGROUND_PROCESS', '命令可能启动后台或分离进程，当前工具只支持有界前台命令。', command));
  }

  if (PERMISSION_MUTATION_PATTERN.test(command)) {
    findings.push(
      createFinding('blocker', 'PERMISSION_MUTATION', '命令包含权限或所有权变更操作（chmod 777 / chown / icacls / Set-Acl），需要人工审核。', command)
    );
  }

  if (SHELL_PROFILE_PATTERN.test(command)) {
    findings.push(createFinding('blocker', 'SHELL_PROFILE_MUTATION', '命令尝试写入 Shell 配置文件，可能持久化恶意行为。', command));
  }
}

/**
 * 从 AST 节点提取字面量字符串值。
 * 如果节点包含变量扩展或命令替换，返回 null（无法静态解析）。
 * @param node - AST 节点
 * @returns 字面量字符串，或 null
 */
function extractLiteralPath(node: import('web-tree-sitter').Node): string | null {
  // 检查是否包含无法静态解析的结构
  const hasExpansion =
    node.descendantsOfType(['expansion', 'simple_expansion', 'command_substitution', 'variable_name', 'sub_expression', 'braced_variable']).length > 0;
  if (hasExpansion) {
    return null;
  }

  const text = node.text.trim();
  // 去除引号
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * 解析目标路径相对于执行目录的实际路径。
 * @param rawPath - 原始路径字符串
 * @param cwd - 命令执行目录
 * @returns 解析后的绝对路径，或 null（路径包含变量无法解析）
 */
function resolveTargetPath(rawPath: string | null, cwd: string): string | null {
  if (!rawPath) return null;
  // 展开 ~ 为用户主目录
  if (rawPath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return null;
    return path.resolve(home, rawPath.slice(2));
  }
  const namedHomeMatch = rawPath.match(/^~([^/]+)\/(.*)$/);
  if (namedHomeMatch) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return null;
    return path.resolve(path.dirname(home), namedHomeMatch[1], namedHomeMatch[2]);
  }
  return path.resolve(cwd, rawPath);
}

/**
 * 为单个路径文本创建读取边界发现项。
 * @param rawPath - 原始路径文本
 * @param nodeText - 触发规则的命令片段
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @returns 安全发现项，无风险时返回 null
 */
async function createReadPathFinding(rawPath: string, nodeText: string, cwd: string, workspaceRoot: string): Promise<ShellCommandSafetyFinding | null> {
  const resolvedTarget = resolveTargetPath(rawPath, cwd);
  if (!resolvedTarget) {
    return null;
  }

  if (!(await isAllowedReadPath(resolvedTarget, workspaceRoot))) {
    return createFinding('warning', 'READ_OUTSIDE_WORKSPACE', `命令可能读取工作区外路径: ${rawPath}`, nodeText.slice(0, 80));
  }

  if (isSensitiveReadPath(resolvedTarget)) {
    return createFinding('warning', 'READ_SENSITIVE_WORKSPACE_PATH', `命令可能读取敏感路径: ${rawPath}`, nodeText.slice(0, 80));
  }

  return null;
}

/**
 * Bash 命令快照。
 */
interface BashCommandSnapshot {
  /** 有效命令名。 */
  name: string;
  /** 有效参数节点。 */
  args: import('web-tree-sitter').Node[];
  /** 命令原文。 */
  text: string;
}

/**
 * 从 Bash command 节点中创建有效命令快照。
 * @param commandNode - Bash command 节点
 * @returns 命令快照，无法解析时返回 null
 */
function createBashCommand(commandNode: import('web-tree-sitter').Node): BashCommandSnapshot | null {
  const nameNode = commandNode.child(0);
  if (!nameNode || nameNode.type !== 'command_name') return null;

  const args = commandNode.children.filter((child): boolean => child.id !== nameNode.id && BASH_ARGUMENT_NODE_TYPES.has(child.type));
  const rawName = normalizeCommandName(nameNode.text);
  // Bash command 节点可能包含 alias/function 包装器，需解析到实际命令名
  if (BASH_COMMAND_WRAPPERS.has(rawName) && args[0]) {
    return { name: normalizeCommandName(args[0].text), args: args.slice(1), text: commandNode.text };
  }
  // Bash command 节点可能包含 alias/function 包装器，需解析到实际命令名
  return { name: rawName, args, text: commandNode.text };
}

/**
 * 读取 Bash 删除命令的目标参数，跳过选项参数。
 * @param args - Bash 参数节点
 * @returns 删除目标参数节点
 */
function getBashDeleteTargets(args: import('web-tree-sitter').Node[]): import('web-tree-sitter').Node[] {
  const targets: import('web-tree-sitter').Node[] = [];
  let parsingOptions = true;

  for (const arg of args) {
    const text = arg.text.trim();
    if (parsingOptions && text === '--') {
      parsingOptions = false;
      continue;
    }
    if (parsingOptions && text.startsWith('-') && text !== '-') continue;

    targets.push(arg);
  }

  return targets;
}

/**
 * 读取 Bash 命令中的路径参数，跳过选项参数。
 * @param args - Bash 参数节点
 * @returns 路径参数节点
 */
function getBashPathArgs(args: import('web-tree-sitter').Node[]): import('web-tree-sitter').Node[] {
  const targets: import('web-tree-sitter').Node[] = [];
  let parsingOptions = true;

  for (const arg of args) {
    const text = arg.text.trim();
    if (parsingOptions && text === '--') {
      parsingOptions = false;
      continue;
    }
    if (parsingOptions && text.startsWith('-') && text !== '-') continue;

    targets.push(arg);
  }

  return targets;
}

/**
 * 判断 Bash rm 参数是否同时包含递归和强制删除。
 * @param args - Bash 参数节点
 * @returns 是否为递归强制删除
 */
function hasBashRecursiveForce(args: import('web-tree-sitter').Node[]): boolean {
  let recursive = false;
  let force = false;

  for (const arg of args) {
    const text = arg.text.trim();
    if (text === '--') break;
    if (!text.startsWith('-') || text === '-') continue;

    if (text === '--recursive') recursive = true;
    if (text === '--force') force = true;
    if (!text.startsWith('--')) {
      const normalizedFlags = text.slice(1).toLowerCase();
      recursive = recursive || normalizedFlags.includes('r');
      force = force || normalizedFlags.includes('f');
    }
  }

  return recursive && force;
}

/**
 * 判断 ln 参数是否请求创建符号链接。
 * @param args - ln 参数节点
 * @returns 是否包含 -s/--symbolic
 */
function hasBashSymlinkOption(args: import('web-tree-sitter').Node[]): boolean {
  for (const arg of args) {
    const text = arg.text.trim();
    if (text === '--') return false;
    if (text === '--symbolic') return true;
    if (text.startsWith('--')) continue;
    if (text.startsWith('-') && text.slice(1).includes('s')) return true;
  }
  return false;
}

/**
 * 解析符号链接目标的实际指向。
 * @param targetPath - 符号链接目标参数
 * @param linkPath - 符号链接创建位置
 * @param cwd - 执行目录
 * @returns 解析后的目标路径
 */
function resolveSymlinkTarget(targetPath: string, linkPath: string, cwd: string): string | null {
  const resolvedLink = resolveTargetPath(linkPath, cwd);
  if (!resolvedLink) return null;

  if (targetPath.startsWith('~/') || path.isAbsolute(targetPath)) {
    return resolveTargetPath(targetPath, cwd);
  }

  return path.resolve(path.dirname(resolvedLink), targetPath);
}

/**
 * 检查 ln -s 是否在工作区内创建指向外部的链接。
 * @param args - ln 参数节点
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @param findings - 待追加发现项列表
 * @param nodeText - 命令原文
 */
async function appendSymlinkFindings(
  args: import('web-tree-sitter').Node[],
  cwd: string,
  workspaceRoot: string,
  findings: ShellCommandSafetyFinding[],
  nodeText: string
): Promise<void> {
  if (!hasBashSymlinkOption(args)) return;

  const pathArgs = getBashPathArgs(args);
  const targetNode = pathArgs[0];
  const linkNode = pathArgs[1];
  if (!targetNode || !linkNode) return;

  const targetPath = extractLiteralPath(targetNode);
  const linkPath = extractLiteralPath(linkNode);
  if (targetPath === null || linkPath === null) {
    findings.push(createFinding('warning', 'SYMLINK_DYNAMIC_TARGET', '符号链接目标包含变量或扩展，无法静态验证是否指向工作区外。', nodeText.slice(0, 80)));
    return;
  }

  const resolvedLink = resolveTargetPath(linkPath, cwd);
  const resolvedTarget = resolveSymlinkTarget(targetPath, linkPath, cwd);
  if (!resolvedLink || !resolvedTarget) return;

  const [linkInsideWorkspace, targetInsideWorkspace] = await Promise.all([
    isPathInsideRealWorkspace(resolvedLink, workspaceRoot),
    isPathInsideRealWorkspace(resolvedTarget, workspaceRoot)
  ]);
  if (linkInsideWorkspace && !targetInsideWorkspace) {
    findings.push(createFinding('warning', 'SYMLINK_TO_OUTSIDE_WORKSPACE', `符号链接会在工作区内指向外部路径: ${targetPath}`, nodeText.slice(0, 80)));
  }
}

/**
 * 按工作区约束检查写入目标。
 * @param targetNodes - 写入目标节点
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @param findings - 待追加发现项列表
 */
async function appendWriteTargetFindings(
  targetNodes: import('web-tree-sitter').Node[],
  cwd: string,
  workspaceRoot: string,
  findings: ShellCommandSafetyFinding[]
): Promise<void> {
  for (const targetNode of targetNodes) {
    const rawPath = extractLiteralPath(targetNode);
    if (rawPath === null) {
      findings.push(createFinding('warning', 'WRITE_DYNAMIC_PATH', '命令写入目标包含变量或扩展，无法静态验证是否在工作区内。', targetNode.text.slice(0, 80)));
      continue;
    }

    const resolvedTarget = resolveTargetPath(rawPath, cwd);
    if (resolvedTarget && !(await isPathInsideRealWorkspace(resolvedTarget, workspaceRoot))) {
      findings.push(createFinding('warning', 'WRITE_OUTSIDE_WORKSPACE', `命令可能写入工作区外路径: ${rawPath}`, targetNode.text.slice(0, 80)));
    }
  }
}

/**
 * 检查 Bash 常见写入命令的目标路径。
 * @param commandName - 命令名
 * @param args - Bash 参数节点
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @param findings - 待追加发现项列表
 */
async function appendBashWriteFindings(
  commandName: string,
  args: import('web-tree-sitter').Node[],
  cwd: string,
  workspaceRoot: string,
  findings: ShellCommandSafetyFinding[]
): Promise<void> {
  const pathArgs = getBashPathArgs(args);
  if (BASH_WRITE_ALL_TARGET_COMMANDS.has(commandName) || BASH_WRITE_STREAM_COMMANDS.has(commandName)) {
    await appendWriteTargetFindings(pathArgs, cwd, workspaceRoot, findings);
    return;
  }

  if (BASH_WRITE_DESTINATION_COMMANDS.has(commandName)) {
    const destination = pathArgs[pathArgs.length - 1];
    if (destination) {
      await appendWriteTargetFindings([destination], cwd, workspaceRoot, findings);
    }
  }
}

/**
 * 判断 Bash shell 参数是否会启用命令字符串执行。
 * @param text - 参数文本
 * @returns 是否为 -c 类参数
 */
function isBashCommandStringOption(text: string): boolean {
  if (text === '-c') return true;
  if (text.startsWith('--')) return false;
  return text.startsWith('-') && text.slice(1).includes('c');
}

/**
 * 提取 bash/sh/zsh -c 的命令字符串参数。
 * @param args - shell 命令参数节点
 * @returns 命令字符串节点，未找到时返回 null
 */
function findBashCommandStringArg(args: import('web-tree-sitter').Node[]): import('web-tree-sitter').Node | null {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (isBashCommandStringOption(args[index].text.trim())) {
      return args[index + 1] ?? null;
    }
  }
  return null;
}

/**
 * 拼接 eval 的静态字面量参数。
 * @param args - eval 参数节点
 * @returns 静态命令字符串，包含动态扩展时返回 null
 */
function joinLiteralArgs(args: import('web-tree-sitter').Node[]): string | null {
  const literalParts: string[] = [];

  for (const arg of args) {
    const literal = extractLiteralPath(arg);
    if (literal === null) return null;
    literalParts.push(literal);
  }

  return literalParts.join(' ').trim();
}

/**
 * 从包装器参数中提取被转发执行的命令快照。
 * @param args - 包装器参数节点
 * @returns 被转发命令快照，未找到时返回 null
 */
function createForwardedCommand(args: import('web-tree-sitter').Node[]): BashCommandSnapshot | null {
  for (let index = 0; index < args.length; index += 1) {
    const text = args[index].text.trim();
    if (!text || text === '--') continue;
    if (text.startsWith('-')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) continue;

    return {
      name: normalizeCommandName(text),
      args: args.slice(index + 1),
      text: args
        .slice(index)
        .map((arg): string => arg.text)
        .join(' ')
    };
  }

  return null;
}

/** 嵌套命令分析回调。 */
type AppendNestedCommand = (nestedCommand: string | null, nodeText: string) => Promise<void>;

/**
 * 检查 find 命令中的删除动作。
 * @param args - find 参数节点
 * @param findings - 待追加发现项列表
 * @param nodeText - find 命令原文
 * @param appendNestedCommand - 嵌套命令分析回调
 */
async function appendFindDeleteFindings(
  args: import('web-tree-sitter').Node[],
  findings: ShellCommandSafetyFinding[],
  nodeText: string,
  appendNestedCommand: AppendNestedCommand
): Promise<void> {
  if (args.some((arg): boolean => arg.text.trim() === '-delete')) {
    appendDeleteWarning(findings, nodeText);
  }

  for (let index = 0; index < args.length - 1; index += 1) {
    const action = args[index].text.trim();
    if (!BASH_FIND_EXEC_ACTIONS.has(action)) continue;

    const executableNode = args[index + 1];
    const executableName = normalizeCommandName(executableNode.text);
    const execArgs = args.slice(index + 2);

    if (BASH_NESTED_SHELL_COMMANDS.has(executableName)) {
      const commandArg = findBashCommandStringArg(execArgs);
      if (commandArg) {
        await appendNestedCommand(extractLiteralPath(commandArg), commandArg.text);
      }
      continue;
    }

    if (!isBashDelete(executableName)) continue;

    if (executableName === 'rm' && hasBashRecursiveForce(execArgs)) {
      appendDeleteBlocker(findings, 'DESTRUCTIVE_DELETE', 'find -exec 中包含递归强制删除操作，需要人工改写为更小范围的安全操作。', nodeText);
    } else {
      appendDeleteWarning(findings, nodeText);
    }
  }
}

/**
 * 检查 xargs 命令中的删除目标命令。
 * @param args - xargs 参数节点
 * @param findings - 待追加发现项列表
 * @param nodeText - xargs 命令原文
 * @param appendNestedCommand - 嵌套命令分析回调
 */
async function appendXargsDeleteFindings(
  args: import('web-tree-sitter').Node[],
  findings: ShellCommandSafetyFinding[],
  nodeText: string,
  appendNestedCommand: AppendNestedCommand
): Promise<void> {
  for (let index = 0; index < args.length; index += 1) {
    const executableName = normalizeCommandName(args[index].text);
    const xargsCommandArgs = args.slice(index + 1);

    if (BASH_NESTED_SHELL_COMMANDS.has(executableName)) {
      const commandArg = findBashCommandStringArg(xargsCommandArgs);
      if (commandArg) {
        await appendNestedCommand(extractLiteralPath(commandArg), commandArg.text);
      }
      return;
    }

    if (!isBashDelete(executableName)) continue;

    if (executableName === 'rm' && hasBashRecursiveForce(xargsCommandArgs)) {
      appendDeleteBlocker(findings, 'DESTRUCTIVE_DELETE', 'xargs 中包含递归强制删除操作，需要人工改写为更小范围的安全操作。', nodeText);
    } else {
      appendDeleteWarning(findings, nodeText);
    }
    return;
  }
}

/**
 * 检查 Git 工作区破坏性操作。
 * @param args - git 参数节点
 * @param findings - 待追加发现项列表
 * @param nodeText - git 命令原文
 */
function appendGitFindings(args: import('web-tree-sitter').Node[], findings: ShellCommandSafetyFinding[], nodeText: string): void {
  const subcommandNode = args.find((arg): boolean => {
    const text = arg.text.trim();
    return Boolean(text) && !text.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(text);
  });
  const subcommand = subcommandNode?.text.trim().toLowerCase();
  if (!subcommand) return;

  if (GIT_DESTRUCTIVE_SUBCOMMANDS.has(subcommand)) {
    appendDeleteWarning(findings, nodeText);
    return;
  }

  if (subcommand === 'reset' && args.some((arg): boolean => arg.text.trim() === '--hard')) {
    findings.push(createFinding('warning', 'DESTRUCTIVE_GIT_OPERATION', '命令会重置工作区文件状态，执行前需要用户确认。', nodeText.slice(0, 80)));
  }
}

/**
 * 按工作区约束检查删除目标。
 * @param targetNodes - 删除目标节点
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @param findings - 待追加发现项列表
 * @returns 是否产生阻塞项
 */
async function appendDeleteTargetFindings(
  targetNodes: import('web-tree-sitter').Node[],
  cwd: string,
  workspaceRoot: string,
  findings: ShellCommandSafetyFinding[]
): Promise<boolean> {
  let blocked = false;

  for (const targetNode of targetNodes) {
    const rawPath = extractLiteralPath(targetNode);
    if (rawPath === null) continue;

    if (hasGlobPattern(rawPath)) {
      appendDeleteBlocker(findings, 'DELETE_GLOB_PATTERN', `删除目标包含通配符: ${rawPath}`, targetNode.text);
      blocked = true;
    }

    const resolvedTarget = resolveTargetPath(rawPath, cwd);
    if (resolvedTarget && !(await isPathInsideRealWorkspace(resolvedTarget, workspaceRoot))) {
      appendDeleteBlocker(findings, 'DELETE_OUTSIDE_WORKSPACE', `删除目标位于工作区外: ${rawPath}`, targetNode.text);
      blocked = true;
    }
  }

  return blocked;
}

/**
 * 为读取目标节点创建安全发现项。
 * @param targetNode - 读取目标节点
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @returns 安全发现项，无风险时返回 null
 */
async function createReadFinding(targetNode: import('web-tree-sitter').Node, cwd: string, workspaceRoot: string): Promise<ShellCommandSafetyFinding | null> {
  const rawPath = extractLiteralPath(targetNode);
  if (rawPath === null) {
    return createFinding('warning', 'READ_DYNAMIC_PATH', '命令读取目标包含变量或扩展，无法静态验证是否在工作区内。', targetNode.text.slice(0, 80));
  }

  const candidatePaths = isPathToken(rawPath) ? [rawPath] : extractEmbeddedPaths(rawPath);
  if (candidatePaths.length === 0) return null;

  const findings = await Promise.all(
    candidatePaths.map((candidatePath): Promise<ShellCommandSafetyFinding | null> => createReadPathFinding(candidatePath, targetNode.text, cwd, workspaceRoot))
  );
  return findings.find((finding): finding is ShellCommandSafetyFinding => finding !== null) ?? null;
}

/**
 * 按工作区约束检查读取目标。
 * @param targetNodes - 读取目标节点
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @param findings - 待追加发现项列表
 */
async function appendReadFindings(
  targetNodes: import('web-tree-sitter').Node[],
  cwd: string,
  workspaceRoot: string,
  findings: ShellCommandSafetyFinding[]
): Promise<void> {
  const readFindings = await Promise.all(
    targetNodes.map((targetNode): Promise<ShellCommandSafetyFinding | null> => createReadFinding(targetNode, cwd, workspaceRoot))
  );
  findings.push(...readFindings.filter((finding): finding is ShellCommandSafetyFinding => finding !== null));
}

/**
 * 检查 heredoc 脚本文本中的路径读取边界。
 * @param command - 命令文本
 * @param cwd - 执行目录
 * @param workspaceRoot - 工作区根目录
 * @param findings - 待追加发现项列表
 */
async function appendHeredocFindings(command: string, cwd: string, workspaceRoot: string, findings: ShellCommandSafetyFinding[]): Promise<void> {
  if (!hasHeredoc(command)) return;

  const candidatePaths = extractEmbeddedPaths(command);
  const readFindings = await Promise.all(
    candidatePaths.map(
      (candidatePath): Promise<ShellCommandSafetyFinding | null> => createReadPathFinding(candidatePath, command.slice(0, 80), cwd, workspaceRoot)
    )
  );
  findings.push(...readFindings.filter((finding): finding is ShellCommandSafetyFinding => finding !== null));
}

/**
 * 向上查找指定类型的祖先节点。
 * @param node - 起始节点
 * @param type - 目标节点类型
 * @returns 匹配的祖先节点，未找到时返回 null
 */
function findAncestor(node: import('web-tree-sitter').Node, type: string): import('web-tree-sitter').Node | null {
  let current = node.parent;
  while (current) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return null;
}

/**
 * 读取 PowerShell 命令的字面量实参节点。
 * @param commandNode - PowerShell command 节点
 * @returns 实参节点列表
 */
function getPowerShellArguments(commandNode: import('web-tree-sitter').Node): import('web-tree-sitter').Node[] {
  return commandNode.descendantsOfType([...POWERSHELL_ARGUMENT_NODE_TYPES]).filter((node): boolean => !node.text.trim().startsWith('-'));
}

/**
 * 提取 PowerShell 命令字符串参数。
 * @param args - PowerShell 参数节点
 * @returns 命令字符串节点，未找到时返回 null
 */
function findPowerShellCommandArg(args: import('web-tree-sitter').Node[]): import('web-tree-sitter').Node | null {
  return args[0] ?? null;
}

/**
 * Bash 安全重定向目标白名单。
 * /dev/null 是 Unix 空设备，丢弃输出，不构成文件写入风险。
 */
const BASH_SAFE_REDIRECT_TARGETS = new Set(['/dev/null']);

/**
 * PowerShell 安全重定向目标白名单。
 * $null 和 Out-Null 是 PowerShell 丢弃输出的方式。
 */
const POWERSHELL_SAFE_REDIRECT_TARGETS = new Set(['$null', 'out-null']);

/**
 * 判断重定向目标是否为安全例外（如 /dev/null、$null）。
 * @param rawPath - 原始路径字符串
 * @param shell - Shell 类型
 * @returns 是否为安全重定向目标
 */
function isSafeRedirectTarget(rawPath: string, shell: ShellCommandShell): boolean {
  const normalized = rawPath.toLowerCase().trim();
  if (shell === 'bash') {
    return BASH_SAFE_REDIRECT_TARGETS.has(normalized);
  }
  if (shell === 'powershell') {
    return POWERSHELL_SAFE_REDIRECT_TARGETS.has(normalized);
  }
  return false;
}

/** AST 结构检查的公共参数。 */
interface StructuralCheckOptions {
  /** 命令文本 */
  command: string;
  /** 执行目录 */
  cwd: string;
  /** 工作区根目录 */
  workspaceRoot: string;
  /** AST 根节点 */
  rootNode: import('web-tree-sitter').Node;
  /** 待追加发现项列表 */
  findings: ShellCommandSafetyFinding[];
}

/**
 * Bash AST 结构检查。
 * @param options - 结构检查参数
 */
async function appendBashStructuralFindings(options: StructuralCheckOptions, depth = 0): Promise<void> {
  const { cwd, workspaceRoot, rootNode, findings } = options;

  /**
   * 递归分析嵌套 Bash 命令字符串。
   * @param nestedCommand - 嵌套命令文本
   * @param nodeText - 外层触发片段
   */
  async function appendNestedCommand(nestedCommand: string | null, nodeText: string): Promise<void> {
    if (nestedCommand === null) {
      findings.push(createFinding('warning', 'NESTED_SHELL_DYNAMIC_COMMAND', '嵌套 shell 命令包含变量或扩展，无法静态验证其行为。', nodeText.slice(0, 80)));
      return;
    }
    if (!nestedCommand) return;
    if (depth >= MAX_NESTED_COMMAND_DEPTH) {
      findings.push(createFinding('warning', 'NESTED_SHELL_DEPTH_LIMIT', '嵌套 shell 命令超过静态分析深度限制。', nodeText.slice(0, 80)));
      return;
    }

    appendPolicyFindings(nestedCommand, findings);
    const parseResult = await parseShellCommand(nestedCommand, 'bash');
    if (parseResult.ok && parseResult.rootNode) {
      await appendBashStructuralFindings({ command: nestedCommand, cwd, workspaceRoot, rootNode: parseResult.rootNode, findings }, depth + 1);
    } else if (parseResult.error?.includes('初始化失败')) {
      findings.push(createFinding('blocker', 'PARSER_UNAVAILABLE', '命令解析器初始化失败，无法进行嵌套 shell 结构检查，拒绝执行。'));
    } else {
      findings.push(createFinding('warning', 'NESTED_SHELL_UNPARSED', `嵌套 shell 命令无法解析: ${parseResult.error ?? '未知错误'}`, nodeText.slice(0, 80)));
    }
  }

  // 收集所有 command 节点，检查 cd 到 workspace 外
  const commands = rootNode.descendantsOfType('command');
  const bashCommands = commands
    .map((cmd): BashCommandSnapshot | null => createBashCommand(cmd))
    .filter((command): command is BashCommandSnapshot => command !== null);
  await Promise.all(bashCommands.map((bashCommand): Promise<void> => appendReadFindings(bashCommand.args, cwd, workspaceRoot, findings)));
  await appendHeredocFindings(options.command, cwd, workspaceRoot, findings);

  for (const bashCommand of bashCommands) {
    const cmdName = bashCommand.name;

    if (BASH_NESTED_SHELL_COMMANDS.has(cmdName)) {
      const commandArg = findBashCommandStringArg(bashCommand.args);
      if (commandArg) {
        await appendNestedCommand(extractLiteralPath(commandArg), commandArg.text);
      }
    }

    if (BASH_FORWARDER_COMMANDS.has(cmdName)) {
      const forwardedCommand = createForwardedCommand(bashCommand.args);
      if (forwardedCommand) {
        await appendNestedCommand(forwardedCommand.text, forwardedCommand.text);
      }
    }

    if (BASH_EVAL_COMMANDS.has(cmdName)) {
      await appendNestedCommand(joinLiteralArgs(bashCommand.args), bashCommand.text);
    }

    if (cmdName === 'find') {
      await appendFindDeleteFindings(bashCommand.args, findings, bashCommand.text, appendNestedCommand);
    }

    if (cmdName === 'xargs') {
      await appendXargsDeleteFindings(bashCommand.args, findings, bashCommand.text, appendNestedCommand);
    }

    if (cmdName === 'git') {
      appendGitFindings(bashCommand.args, findings, bashCommand.text);
    }

    if (cmdName === 'ln') {
      await appendSymlinkFindings(bashCommand.args, cwd, workspaceRoot, findings, bashCommand.text);
    }

    await appendBashWriteFindings(cmdName, bashCommand.args, cwd, workspaceRoot, findings);

    if (isBashDelete(cmdName)) {
      let blocked = await appendDeleteTargetFindings(getBashDeleteTargets(bashCommand.args), cwd, workspaceRoot, findings);
      if (cmdName === 'rm' && hasBashRecursiveForce(bashCommand.args)) {
        appendDeleteBlocker(findings, 'DESTRUCTIVE_DELETE', '命令包含递归强制删除操作，需要人工改写为更小范围的安全操作。', bashCommand.text);
        blocked = true;
      }
      if (!blocked) {
        appendDeleteWarning(findings, bashCommand.text);
      }
    }

    // 检查 cd / builtin cd
    if (cmdName === 'cd') {
      const argNode = bashCommand.args[0];
      if (!argNode) continue;

      const rawPath = extractLiteralPath(argNode);
      if (rawPath === null) {
        // 包含变量，无法静态分析
        findings.push(
          createFinding('warning', 'CD_DYNAMIC_PATH', '命令中 cd 的目标路径包含变量或扩展，无法静态验证是否在工作区内。', argNode.text.slice(0, 80))
        );
        continue;
      }

      const resolvedTarget = resolveTargetPath(rawPath, cwd);
      if (resolvedTarget && !(await isPathInsideRealWorkspace(resolvedTarget, workspaceRoot))) {
        findings.push(createFinding('blocker', 'CD_OUTSIDE_WORKSPACE', `cd 目标目录位于工作区外: ${rawPath}`, argNode.text.slice(0, 80)));
      }
    }
  }

  // 检查文件重定向目标是否在工作区外
  const redirects = rootNode.descendantsOfType('file_redirect');
  for (const redir of redirects) {
    // file_redirect 的子节点包含文件路径（word 节点）
    const wordNodes = redir.descendantsOfType('word');
    if (wordNodes.length === 0) continue;

    // 最后一个 word 通常是文件路径
    const fileNode = wordNodes[wordNodes.length - 1];
    const rawPath = extractLiteralPath(fileNode);
    if (rawPath === null) continue;

    // 放行安全重定向目标（如 /dev/null）
    if (isSafeRedirectTarget(rawPath, 'bash')) continue;

    const resolvedTarget = resolveTargetPath(rawPath, cwd);
    if (resolvedTarget && !(await isPathInsideRealWorkspace(resolvedTarget, workspaceRoot))) {
      findings.push(createFinding('blocker', 'REDIRECT_OUTSIDE_WORKSPACE', `输出重定向目标位于工作区外: ${rawPath}`, fileNode.text.slice(0, 80)));
    }
  }

  // 检查命令替换中是否嵌套了危险命令
  const substitutions = rootNode.descendantsOfType('command_substitution');
  for (const sub of substitutions) {
    const innerCommands = sub.descendantsOfType('command');
    for (const innerCmd of innerCommands) {
      const innerCmdText = innerCmd.text;
      if (DESTRUCTIVE_DELETE_PATTERN.test(innerCmdText)) {
        findings.push(createFinding('blocker', 'SUBSTITUTED_DANGEROUS_COMMAND', '命令替换中包含危险删除操作。', innerCmdText.slice(0, 80)));
      }
      if (NETWORK_PIPE_TO_SHELL_PATTERN.test(innerCmdText)) {
        findings.push(createFinding('blocker', 'SUBSTITUTED_NETWORK_PIPE', '命令替换中包含网络下载管道到 shell 执行。', innerCmdText.slice(0, 80)));
      }
    }
  }
}

/**
 * PowerShell AST 结构检查。
 * @param options - 结构检查参数
 */
async function appendPowerShellStructuralFindings(options: StructuralCheckOptions, depth = 0): Promise<void> {
  const { cwd, workspaceRoot, rootNode, findings } = options;

  /**
   * 递归分析嵌套 PowerShell 命令字符串。
   * @param nestedCommand - 嵌套命令文本
   * @param nodeText - 外层触发片段
   */
  async function appendNestedCommand(nestedCommand: string | null, nodeText: string): Promise<void> {
    if (nestedCommand === null) {
      findings.push(
        createFinding('warning', 'NESTED_POWERSHELL_DYNAMIC_COMMAND', '嵌套 PowerShell 命令包含变量或扩展，无法静态验证其行为。', nodeText.slice(0, 80))
      );
      return;
    }
    if (!nestedCommand) return;
    if (depth >= MAX_NESTED_COMMAND_DEPTH) {
      findings.push(createFinding('warning', 'NESTED_POWERSHELL_DEPTH_LIMIT', '嵌套 PowerShell 命令超过静态分析深度限制。', nodeText.slice(0, 80)));
      return;
    }

    appendPolicyFindings(nestedCommand, findings);
    const parseResult = await parseShellCommand(nestedCommand, 'powershell');
    if (parseResult.ok && parseResult.rootNode) {
      await appendPowerShellStructuralFindings({ command: nestedCommand, cwd, workspaceRoot, rootNode: parseResult.rootNode, findings }, depth + 1);
    } else if (parseResult.error?.includes('初始化失败')) {
      findings.push(createFinding('blocker', 'PARSER_UNAVAILABLE', '命令解析器初始化失败，无法进行嵌套 PowerShell 结构检查，拒绝执行。'));
    } else {
      findings.push(
        createFinding('warning', 'NESTED_POWERSHELL_UNPARSED', `嵌套 PowerShell 命令无法解析: ${parseResult.error ?? '未知错误'}`, nodeText.slice(0, 80))
      );
    }
  }

  // 收集所有 PowerShell 命令名节点，检查删除操作和 cd / Set-Location 到 workspace 外
  const commandNames = rootNode.descendantsOfType(['command_name_expr', 'command_name']);
  const visitedCommandIds = new Set<number>();
  const powerShellCommands: Array<{ cmdName: string; argumentNodes: import('web-tree-sitter').Node[]; commandNode: import('web-tree-sitter').Node }> = [];
  for (const nameNode of commandNames) {
    const commandNode = findAncestor(nameNode, 'command');
    if (!commandNode || visitedCommandIds.has(commandNode.id)) continue;
    visitedCommandIds.add(commandNode.id);

    const cmdName = nameNode.text.trim().toLowerCase();
    const argumentNodes = getPowerShellArguments(commandNode);
    powerShellCommands.push({ cmdName, argumentNodes, commandNode });
  }

  await Promise.all(powerShellCommands.map((command): Promise<void> => appendReadFindings(command.argumentNodes, cwd, workspaceRoot, findings)));

  for (const { cmdName, argumentNodes, commandNode } of powerShellCommands) {
    if (POWERSHELL_NESTED_SHELL_COMMANDS.has(cmdName) || POWERSHELL_EVAL_COMMANDS.has(cmdName)) {
      const commandArg = findPowerShellCommandArg(argumentNodes);
      if (commandArg) {
        await appendNestedCommand(extractLiteralPath(commandArg), commandArg.text);
      }
    }

    if (isPowerShellDelete(cmdName)) {
      const blocked = await appendDeleteTargetFindings(argumentNodes, cwd, workspaceRoot, findings);
      if (!blocked) {
        appendDeleteWarning(findings, commandNode.text);
      }
    }

    if (cmdName === 'cd' || cmdName === 'sl' || cmdName === 'set-location' || cmdName === 'chdir') {
      const pathArg = argumentNodes[0];
      if (!pathArg) continue;

      const rawPath = extractLiteralPath(pathArg);
      if (rawPath === null) {
        findings.push(
          createFinding(
            'warning',
            'CD_DYNAMIC_PATH',
            '命令中 cd/Set-Location 的目标路径包含变量或扩展，无法静态验证是否在工作区内。',
            pathArg.text.slice(0, 80)
          )
        );
        continue;
      }

      const resolvedTarget = resolveTargetPath(rawPath, cwd);
      if (resolvedTarget && !(await isPathInsideRealWorkspace(resolvedTarget, workspaceRoot))) {
        findings.push(createFinding('blocker', 'CD_OUTSIDE_WORKSPACE', `cd/Set-Location 目标目录位于工作区外: ${rawPath}`, pathArg.text.slice(0, 80)));
      }
    }
  }

  // 检查重定向目标是否在工作区外
  const redirections = rootNode.descendantsOfType('redirection');
  for (const redir of redirections) {
    const fileNodes = redir.descendantsOfType('redirected_file_name');
    for (const fileNode of fileNodes) {
      const rawPath = extractLiteralPath(fileNode);
      if (rawPath === null) continue;

      // 放行安全重定向目标（如 $null）
      if (isSafeRedirectTarget(rawPath, 'powershell')) continue;

      const resolvedTarget = resolveTargetPath(rawPath, cwd);
      if (resolvedTarget && !(await isPathInsideRealWorkspace(resolvedTarget, workspaceRoot))) {
        findings.push(createFinding('blocker', 'REDIRECT_OUTSIDE_WORKSPACE', `输出重定向目标位于工作区外: ${rawPath}`, fileNode.text.slice(0, 80)));
      }
    }
  }

  // 检查子表达式中的危险命令
  const subExpressions = rootNode.descendantsOfType('sub_expression');
  for (const sub of subExpressions) {
    const innerText = sub.text;
    if (DESTRUCTIVE_DELETE_PATTERN.test(innerText)) {
      findings.push(createFinding('blocker', 'SUBSTITUTED_DANGEROUS_COMMAND', '子表达式中包含危险删除操作。', innerText.slice(0, 80)));
    }
    if (NETWORK_PIPE_TO_SHELL_PATTERN.test(innerText)) {
      findings.push(createFinding('blocker', 'SUBSTITUTED_NETWORK_PIPE', '子表达式中包含网络下载管道到 shell 执行。', innerText.slice(0, 80)));
    }
  }
}

/**
 * 添加基于 AST 的结构化安全检查。
 * @param options - 结构检查参数
 * @param shell - shell 类型
 */
async function appendStructuralFindings(options: StructuralCheckOptions, shell: ShellCommandShell): Promise<void> {
  if (shell === 'bash') {
    await appendBashStructuralFindings(options);
  } else {
    await appendPowerShellStructuralFindings(options);
  }
}

/**
 * 分析 Shell 命令安全性。
 * @param request - 安全分析请求
 * @returns 安全分析报告
 */
export async function analyzeShellCommandSafety(request: ShellCommandSafetyRequest): Promise<ShellCommandSafetyReport> {
  const command = typeof request.command === 'string' ? request.command.trim() : '';
  const cwd = normalizePathInput(request.cwd);
  const workspaceRoot = normalizePathInput(request.workspaceRoot);
  const shell = isSupportedShell(request.shell) ? request.shell : 'unknown';
  const findings: ShellCommandSafetyFinding[] = [];

  if (!isSupportedShell(request.shell)) {
    findings.push(createFinding('blocker', 'UNSUPPORTED_SHELL', '仅支持 bash 和 powershell 命令。'));
  }

  if (!command) {
    findings.push(createFinding('blocker', 'EMPTY_COMMAND', '命令不能为空。'));
  }

  if (!workspaceRoot) {
    findings.push(createFinding('blocker', 'MISSING_WORKSPACE_ROOT', '缺少工作区根目录，拒绝执行本地命令。'));
  }

  if (!cwd) {
    findings.push(createFinding('blocker', 'MISSING_CWD', '缺少命令执行目录。'));
  }

  if (cwd && workspaceRoot && !(await isAllowedExecutionCwd(cwd, workspaceRoot))) {
    findings.push(createFinding('blocker', 'CWD_OUTSIDE_WORKSPACE', '命令执行目录必须位于当前工作区内。', cwd));
  }

  // AST 结构检查（语法错误会阻塞，初始化失败同样阻塞）
  if (command && isSupportedShell(request.shell) && cwd && workspaceRoot) {
    const parseResult = await parseShellCommand(command, request.shell as ShellCommandShell);

    if (parseResult.ok && parseResult.rootNode) {
      await appendStructuralFindings({ command, cwd, workspaceRoot, rootNode: parseResult.rootNode, findings }, request.shell as ShellCommandShell);
    } else if (parseResult.error) {
      if (parseResult.error.includes('初始化失败')) {
        // 解析器不可用时阻塞执行，避免仅靠 regex 遗漏结构性风险
        findings.push(createFinding('blocker', 'PARSER_UNAVAILABLE', '命令解析器初始化失败，无法进行 AST 结构检查，拒绝执行。'));
      } else {
        // 语法错误阻塞执行
        findings.push(createFinding('blocker', 'SYNTAX_ERROR', `命令语法错误: ${parseResult.error}`));
      }
    }
  }

  // Regex 策略检查（作为 AST 检查的补充和降级兜底）
  if (command) {
    appendPolicyFindings(command, findings);
  }

  return {
    status: findings.some((finding) => finding.severity === 'blocker') ? 'blocked' : 'allowed',
    shell,
    findings,
    normalizedCommandPreview: command,
    cwd
  };
}
