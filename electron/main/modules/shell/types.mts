/**
 * @file types.mts
 * @description Shell 命令安全分析、运行请求与输出事件的共享类型。
 */

/** Shell 命令工具支持的 shell 类型。 */
export type ShellCommandShell = 'bash' | 'powershell';

/** Shell 命令交互模式。 */
export type ShellInteractionMode = 'none' | 'auto-default';

/** Shell 命令权威终止语义。 */
export type ShellCommandTermination =
  | { kind: 'exit'; exitCode: number }
  | { kind: 'signal'; signal: string }
  | { kind: 'cancelled' }
  | { kind: 'tool_timeout' }
  | { kind: 'interaction_timeout' }
  | { kind: 'answer_limit' }
  | { kind: 'unsupported_prompt'; reason: 'text' | 'path' | 'account' | 'secret' }
  | { kind: 'process_cleanup_failed'; message: string }
  | { kind: 'spawn_error'; message: string };

/** Shell 命令安全分析状态。 */
export type ShellCommandSafetyStatus = 'allowed' | 'blocked';

/** Shell 命令安全发现项严重级别。 */
export type ShellCommandSafetySeverity = 'info' | 'warning' | 'blocker';

/**
 * Shell 命令安全分析请求。
 */
export interface ShellCommandSafetyRequest {
  /** 待执行 shell。 */
  shell?: unknown;
  /** 待执行命令文本。 */
  command?: unknown;
  /** 命令工作目录。 */
  cwd?: unknown;
  /** 当前工作区根目录。 */
  workspaceRoot?: unknown;
}

/**
 * Shell 命令安全分析发现项。
 */
export interface ShellCommandSafetyFinding {
  /** 发现项严重级别。 */
  severity: ShellCommandSafetySeverity;
  /** 机器可读错误码。 */
  code: string;
  /** 面向用户的说明。 */
  message: string;
  /** 触发规则的命令片段。 */
  nodeText?: string;
}

/**
 * Shell 命令安全分析报告。
 */
export interface ShellCommandSafetyReport {
  /** 安全分析状态。 */
  status: ShellCommandSafetyStatus;
  /** 分析的 shell 类型，无法识别时为 unknown。 */
  shell: ShellCommandShell | 'unknown';
  /** 安全发现项列表。 */
  findings: ShellCommandSafetyFinding[];
  /** 归一化后的命令预览。 */
  normalizedCommandPreview: string;
  /** 归一化后的执行目录。 */
  cwd: string;
}

/**
 * Shell 命令执行请求。
 */
export interface ShellCommandRunRequest {
  /** 命令唯一标识。 */
  commandId: string;
  /** 执行 shell。 */
  shell: ShellCommandShell;
  /** 命令文本。 */
  command: string;
  /** 命令执行目录。 */
  cwd: string;
  /** 当前工作区根目录。 */
  workspaceRoot: string;
  /** 进程超时时间，单位毫秒；缺省时由上层 Runtime Watchdog 管理。 */
  timeoutMs?: number;
  /** 最终结果中每个输出流的最大字符数。 */
  maxOutputChars?: number;
  /** 交互模式，缺省时使用普通管道模式。 */
  interactionMode?: ShellInteractionMode;
  /** Renderer 已完成用户确认的安全发现项编码。 */
  confirmedSafetyFindingCodes?: string[];
}

/**
 * Shell 命令实时输出片段。
 */
export interface ShellCommandOutputChunk {
  /** 命令唯一标识。 */
  commandId: string;
  /** 输出流类型。 */
  stream: 'stdout' | 'stderr';
  /** 输出文本。 */
  text: string;
  /** 单命令递增序号。 */
  sequence: number;
  /** 输出产生时间。 */
  createdAt: string;
}

/**
 * Shell 命令执行结果。
 */
export interface ShellCommandRunResult {
  /** 命令唯一标识。 */
  commandId: string;
  /** 执行 shell。 */
  shell: ShellCommandShell;
  /** 命令文本。 */
  command: string;
  /** 命令执行目录。 */
  cwd: string;
  /** 退出码，信号退出时为 null。 */
  exitCode: number | null;
  /** 退出信号，正常退出时为 null。 */
  signal: string | null;
  /** 执行耗时。 */
  durationMs: number;
  /** 是否因超时结束。 */
  timedOut: boolean;
  /** 输出是否被截断。 */
  truncated: boolean;
  /** 输出采集模式。 */
  outputMode: 'pipes' | 'pty';
  /** 管道模式 stdout。 */
  stdout?: string;
  /** 管道模式 stderr。 */
  stderr?: string;
  /** PTY 模式去除终端控制序列后的有界纯文本输出。 */
  terminalOutput?: string;
  /** 权威终止语义。 */
  termination: ShellCommandTermination;
  /** 自动交互元数据，仅 auto-default 模式存在。 */
  autoInteraction?: {
    /** 是否启用自动交互。 */
    enabled: boolean;
    /** 累计自动回答次数。 */
    answerCount: number;
    /** 自动交互停止原因。 */
    stopReason?: 'completed' | 'tool_timeout' | 'interaction_timeout' | 'answer_limit' | 'process_exit' | 'unsupported_prompt' | 'cancelled';
  };
}

/** Shell PTY 有序运行事件。 */
export type ShellRunEvent =
  | { type: 'terminal_update'; content: string }
  | { type: 'auto_answer'; count: number }
  | { type: 'finished'; result: ShellCommandRunResult };

/** Shell PTY 事件信封。 */
export interface ShellRunEventEnvelope {
  /** 命令唯一标识。 */
  commandId: string;
  /** 单命令递增序号。 */
  sequence: number;
  /** ISO 创建时间。 */
  createdAt: string;
  /** 事件载荷。 */
  event: ShellRunEvent;
}
