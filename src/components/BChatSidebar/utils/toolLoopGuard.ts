/**
 * @file toolLoopGuard.ts
 * @description BChat 工具续轮防护器。
 */

/**
 * 工具续轮保护配置
 */
export interface ToolLoopGuardOptions {
  /** 最大工具续轮次数 */
  maxRounds: number;
  /** 相同签名允许连续重复的最大次数 */
  maxRepeatedCalls: number;
}

/**
 * 防护结果
 */
export interface ToolLoopGuardResult {
  /** 是否允许继续 */
  allowed: boolean;
  /** 拦截原因 */
  reason?: string;
}

/**
 * 工具续轮防护器
 */
export interface ToolLoopGuard {
  /**
   * 进入下一轮工具续传
   */
  advanceRound(): ToolLoopGuardResult;
  /**
   * 记录一次工具调用
   * @param toolName - 工具名称
   * @param input - 工具输入
   */
  recordToolCall(toolName: string, input: unknown): ToolLoopGuardResult;
  /**
   * 判断当前状态是否允许继续
   */
  canContinue(): ToolLoopGuardResult;
}

/**
 * 生成工具调用签名
 * @param toolName - 工具名称
 * @param input - 工具输入
 */
function createToolCallSignature(toolName: string, input: unknown): string {
  return `${toolName}:${JSON.stringify(input)}`;
}

/**
 * 创建工具续轮防护器
 * @param options - 防护配置
 */
export function createToolLoopGuard(options: ToolLoopGuardOptions): ToolLoopGuard {
  let roundCount = 0;
  let lastSignature = '';
  let repeatedCount = 0;
  let blockedReason = '';

  return {
    advanceRound(): ToolLoopGuardResult {
      roundCount += 1;
      if (roundCount >= options.maxRounds) {
        blockedReason = `工具调用轮次超过限制（${options.maxRounds}），已停止自动续轮。`;
      }

      return this.canContinue();
    },
    recordToolCall(toolName: string, input: unknown): ToolLoopGuardResult {
      const signature = createToolCallSignature(toolName, input);
      if (signature === lastSignature) {
        repeatedCount += 1;
      } else {
        lastSignature = signature;
        repeatedCount = 1;
      }

      if (repeatedCount > options.maxRepeatedCalls) {
        blockedReason = `工具 \`${toolName}\` 使用相同参数重复调用超过限制（${options.maxRepeatedCalls}），已停止自动续轮。`;
      }

      return this.canContinue();
    },
    canContinue(): ToolLoopGuardResult {
      if (blockedReason) {
        return { allowed: false, reason: blockedReason };
      }

      return { allowed: true };
    }
  };
}