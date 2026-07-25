/**
 * @file pty-process.mts
 * @description node-pty 生命周期适配器，仅负责启动、订阅、写入和底层终止。
 */
import { createRequire } from 'node:module';
import type { ShellCommandShell } from '../types.mjs';

/** 可释放的 PTY 订阅。 */
export interface PtyDisposable {
  /** 释放订阅。 */
  dispose(): void;
}

/** node-pty 的最小可注入形状。 */
export interface NativePtyLike {
  /** 子进程 PID。 */
  pid: number;
  /** 写入 PTY。 */
  write(data: string): void;
  /** 终止 PTY。 */
  kill(signal?: string): void;
  /** 订阅输出。 */
  onData(listener: (data: string) => void): PtyDisposable;
  /** 订阅退出。 */
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable;
}

/** PTY spawn 函数。 */
export type PtySpawn = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; useConpty?: boolean }
) => NativePtyLike;

/** node-pty 运行时模块的最小形状。 */
interface NativePtyModule {
  /** 原生 PTY spawn 函数。 */
  spawn: PtySpawn;
}

/** PTY 启动请求。 */
export interface PtySpawnRequest {
  /** Shell 类型。 */
  shell: ShellCommandShell;
  /** 命令文本。 */
  command: string;
  /** 执行目录。 */
  cwd: string;
  /** 终端列数。 */
  columns: number;
  /** 终端行数。 */
  rows: number;
}

/** 与 node-pty 隔离的进程端口。 */
export interface PtyProcess {
  /** 子进程 PID。 */
  pid: number;
  /** 写入终端。 */
  write(data: string): void;
  /** 调用底层终止。 */
  kill(signal?: string): void;
  /** 订阅终端数据。 */
  onData(listener: (data: string) => void): PtyDisposable;
  /** 订阅退出。 */
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable;
}

/** PTY 工厂。 */
export interface PtyProcessFactory {
  /** 启动 PTY。 */
  spawn(request: PtySpawnRequest): PtyProcess;
}

/**
 * 构建最小化 PTY 环境变量。
 * @returns 不含应用秘密的环境变量
 */
function buildPtyEnv(): NodeJS.ProcessEnv {
  const keys = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PNPM_HOME', 'NPM_CONFIG_REGISTRY'];
  const env: NodeJS.ProcessEnv = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const key of keys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/**
 * 创建可注入的 PTY 工厂。
 * @param spawn - 已加载的原生 PTY spawn 函数
 * @returns PTY 工厂
 */
export function createPtyFactory(spawn: PtySpawn): PtyProcessFactory {
  return {
    spawn(request: PtySpawnRequest): PtyProcess {
      let file = 'bash';
      if (request.shell === 'powershell') file = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      const args = request.shell === 'powershell' ? ['-NoProfile', '-Command', request.command] : ['--noprofile', '--norc', '-c', request.command];
      return spawn(file, args, {
        name: 'xterm-256color',
        cols: request.columns,
        rows: request.rows,
        cwd: request.cwd,
        env: buildPtyEnv(),
        ...(process.platform === 'win32' ? { useConpty: true } : {})
      });
    }
  };
}

/**
 * 延迟加载 node-pty 并创建原生 PTY 工厂。
 * @returns 原生 PTY 工厂
 */
export function createNativePtyFactory(): PtyProcessFactory {
  const nativeModule = createRequire(import.meta.url)('node-pty') as NativePtyModule;
  return createPtyFactory(nativeModule.spawn);
}
