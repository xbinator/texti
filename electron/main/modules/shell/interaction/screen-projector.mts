/**
 * @file screen-projector.mts
 * @description 使用 headless terminal 将终端控制序列投影为有界纯文本 Screen Snapshot。
 */
import { createRequire } from 'node:module';
import type { ShellScreenActivity, ShellScreenSnapshot } from './types.mjs';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';

/** Screen Snapshot 默认最大字符数。 */
const DEFAULT_SNAPSHOT_CHARS = 12_000;
/** 保证默认结果字符上限内的短行不会先被 xterm scrollback 淘汰。 */
const DEFAULT_SCROLLBACK_ROWS = 20_000;

/**
 * 延迟读取 @xterm/headless，避免 capability 关闭时提前加载 PTY 运行依赖。
 * @returns headless terminal 构造器
 */
function loadTerminal(): typeof HeadlessTerminal {
  const headless = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless');
  return headless.Terminal;
}

/** Screen projector 创建选项。 */
export interface ScreenProjectorOptions {
  /** 终端列数。 */
  columns: number;
  /** 终端行数。 */
  rows: number;
  /** 是否让换行符同时回到第 0 列，普通 pipe 输出需要启用。 */
  convertEol?: boolean;
}

/** 有界纯文本投影。 */
export interface BoundedTerminalOutput {
  /** 投影内容。 */
  content: string;
  /** 是否发生截断。 */
  truncated: boolean;
}

/** 终端快照 projector。 */
export interface TerminalSnapshotProjector {
  /** 写入终端原始数据并等待解析完成。 */
  write(data: string): Promise<void>;
  /** 读取当前可见屏幕。 */
  snapshot(now: number, maxChars?: number): ShellScreenSnapshot;
  /** 读取去除终端控制序列后的有界 scrollback 投影。 */
  projectOutput(maxChars: number): BoundedTerminalOutput;
  /** 释放 headless terminal。 */
  dispose(): void;
}

/**
 * 对文本保留尾部并报告截断。
 * @param content - 原始文本
 * @param maxChars - 最大字符数
 * @returns 有界文本
 */
function boundText(content: string, maxChars: number): BoundedTerminalOutput {
  if (content.length <= maxChars) return { content, truncated: false };
  return { content: content.slice(content.length - maxChars), truncated: true };
}

/**
 * 从 terminal buffer 读取指定行范围。
 * @param terminal - headless terminal
 * @param start - 起始行
 * @param end - 结束行（不含）
 * @returns 纯文本行
 */
function readLines(terminal: HeadlessTerminal, start: number, end: number): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = start; index < Math.min(end, buffer.length); index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * 检测当前屏幕中的反向活动信号。
 * @param content - 当前屏幕纯文本
 * @returns 活动信号
 */
function detectActivity(content: string): ShellScreenActivity {
  return {
    spinner: /(?:^|\s)[|/\\-](?:\s|$)|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/m.test(content),
    progress: /\b\d{1,3}%\b|\b(?:KB|MB|GB)\/?s\b|\bETA\b|\bdownloading\b/i.test(content),
    compiling: /\b(?:compiling|building|bundling|transpiling|linking)\b/i.test(content),
    streamingLogs: /\b(?:watching|tailing|dev server|listening on)\b/i.test(content)
  };
}

/**
 * 从屏幕选项标记推断当前默认索引。
 * @param lines - 当前屏幕行
 * @returns 默认选项索引
 */
function findSelectedIndex(lines: string[]): number | undefined {
  const optionLines = lines.filter((line: string): boolean => /^\s*(?:❯|>|●|○|◉)\s+/.test(line) || /^\s{2,}\S/.test(line));
  const selected = optionLines.findIndex((line: string): boolean => /^\s*(?:❯|>|●|◉)\s+/.test(line));
  return selected >= 0 ? selected : undefined;
}

/**
 * 创建 headless terminal projector。
 * @param options - 固定终端尺寸
 * @returns projector
 */
export function createScreenProjector(options: ScreenProjectorOptions): TerminalSnapshotProjector {
  const Terminal = loadTerminal();
  const terminal = new Terminal({
    cols: options.columns,
    rows: options.rows,
    convertEol: options.convertEol ?? false,
    scrollback: DEFAULT_SCROLLBACK_ROWS,
    allowProposedApi: true
  });
  let sequence = 0;
  let cursorVisible = true;
  let disposed = false;

  return {
    write(data: string): Promise<void> {
      if (disposed) return Promise.resolve();
      if (data.includes('\u001b[?25l')) cursorVisible = false;
      if (data.includes('\u001b[?25h')) cursorVisible = true;
      return new Promise<void>((resolve: () => void): void => {
        terminal.write(data, resolve);
      });
    },
    snapshot(now: number, maxChars: number = DEFAULT_SNAPSHOT_CHARS): ShellScreenSnapshot {
      const buffer = terminal.buffer.active;
      const lines = readLines(terminal, buffer.viewportY, buffer.viewportY + terminal.rows);
      const bounded = boundText(lines.join('\n'), maxChars);
      sequence += 1;
      return {
        sequence,
        content: bounded.content,
        cursor: { row: buffer.cursorY, column: buffer.cursorX, visible: cursorVisible },
        selectedIndex: findSelectedIndex(lines),
        activity: detectActivity(bounded.content),
        createdAt: now
      };
    },
    projectOutput(maxChars: number): BoundedTerminalOutput {
      const buffer = terminal.buffer.active;
      return boundText(readLines(terminal, 0, buffer.length).join('\n'), maxChars);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      terminal.dispose();
    }
  };
}
