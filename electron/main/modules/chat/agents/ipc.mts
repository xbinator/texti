/**
 * @file ipc.mts
 * @description Chat Agent application IPC 的严格输入校验与窄 handler 注册。
 */
import type { ChatAgentCancelCheckpointInput, ChatAgentHandlerResult, ChatAgentResolveConfirmationInput, ChatAgentResumePrimaryInput } from 'types/chat-agent';
import { ipcMain } from 'electron';
import { chatAgentDelegationService } from './service.mjs';

/** IPC 身份最大长度。 */
const MAX_ID_LENGTH = 160;
/**
 * 创建稳定输入错误。
 * @param message - 不含不可信 payload 的错误说明
 * @returns 带机器码的 Error
 */
function createInputError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'INVALID_INPUT' });
}

/**
 * 判断未知值是否为精确普通对象。
 * @param value - 未可信 IPC 输入
 * @returns 是否为普通对象
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * 判断字符串是否含 ASCII 控制字符。
 * @param value - 待校验字符串
 * @returns 是否含控制字符
 */
function hasControlCharacters(value: string): boolean {
  return [...value].some((character): boolean => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

/**
 * 校验对象只包含指定字符串键。
 * @param input - 未可信普通对象
 * @param expectedKeys - 精确键集合
 */
function assertExactKeys(input: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const actualKeys = Reflect.ownKeys(input);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key): boolean => typeof key !== 'string' || !expectedKeys.includes(key))) {
    throw createInputError('Agent IPC input contains unexpected fields');
  }
}

/**
 * 校验稳定身份字符串。
 * @param value - 未可信身份
 * @param field - 字段名
 * @returns 校验后的身份
 */
function requireIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH || value.trim() !== value || hasControlCharacters(value)) {
    throw createInputError(`${field} is invalid`);
  }
  return value;
}

/**
 * 校验 resumePrimary 最小输入。
 * @param input - 未可信 IPC payload
 * @returns 精确 resume 输入
 */
function parseResumeInput(input: unknown): ChatAgentResumePrimaryInput {
  if (!isPlainObject(input)) throw createInputError('resumePrimary input must be a plain object');
  assertExactKeys(input, ['checkpointId', 'expectedVersion', 'resumeRuntimeId']);
  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
    throw createInputError('expectedVersion must be a non-negative safe integer');
  }
  return {
    checkpointId: requireIdentity(input.checkpointId, 'checkpointId'),
    expectedVersion: input.expectedVersion as number,
    resumeRuntimeId: requireIdentity(input.resumeRuntimeId, 'resumeRuntimeId')
  };
}

/**
 * 校验 cancelCheckpoint 最小输入。
 * @param input - 未可信 IPC payload
 * @returns 精确取消输入
 */
function parseCancelInput(input: unknown): ChatAgentCancelCheckpointInput {
  if (!isPlainObject(input)) throw createInputError('cancelCheckpoint input must be a plain object');
  assertExactKeys(input, ['checkpointId']);
  return {
    checkpointId: requireIdentity(input.checkpointId, 'checkpointId')
  };
}

/**
 * 校验 resolveConfirmation 最小 CAS 输入。
 * @param input - 未可信 IPC payload
 * @returns 精确 confirmation 决议输入
 */
function parseConfirmationInput(input: unknown): ChatAgentResolveConfirmationInput {
  if (!isPlainObject(input)) throw createInputError('resolveConfirmation input must be a plain object');
  assertExactKeys(input, ['confirmationId', 'expectedVersion', 'decision']);
  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) <= 0) {
    throw createInputError('expectedVersion must be a positive safe integer');
  }
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw createInputError('decision must be approved or rejected');
  }
  return {
    confirmationId: requireIdentity(input.confirmationId, 'confirmationId'),
    expectedVersion: input.expectedVersion as number,
    decision: input.decision
  };
}

/**
 * 从未知错误读取稳定机器码。
 * @param error - 捕获错误
 * @returns IPC 错误码
 */
function getAgentErrorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'UNKNOWN';
}

/**
 * 将 Agent handler 包装为稳定信封。
 * @param handler - 同步或异步 handler
 * @returns Electron IPC handler
 */
function wrapAgentHandler<T>(handler: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<ChatAgentHandlerResult<T>> {
  return async (...args: unknown[]): Promise<ChatAgentHandlerResult<T>> => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Chat Agent request failed',
        code: getAgentErrorCode(error)
      };
    }
  };
}

/**
 * 注册 Chat Agent application IPC handlers。
 */
export function registerChatAgentHandlers(): void {
  ipcMain.handle(
    'chat:agent:list-active',
    wrapAgentHandler((_event, ...inputs) => {
      if (inputs.length !== 0) throw createInputError('listActive does not accept input');
      return chatAgentDelegationService.listActive();
    })
  );
  ipcMain.handle(
    'chat:agent:resume-primary',
    wrapAgentHandler((_event, ...inputs) => {
      if (inputs.length !== 1) throw createInputError('resumePrimary accepts exactly one input');
      return chatAgentDelegationService.resumePrimary(parseResumeInput(inputs[0]));
    })
  );
  ipcMain.handle(
    'chat:agent:cancel-checkpoint',
    wrapAgentHandler((_event, ...inputs) => {
      if (inputs.length !== 1) throw createInputError('cancelCheckpoint accepts exactly one input');
      return chatAgentDelegationService.cancelCheckpoint(parseCancelInput(inputs[0]));
    })
  );
  ipcMain.handle(
    'chat:agent:list-confirmations',
    wrapAgentHandler((_event, ...inputs) => {
      if (inputs.length !== 0) throw createInputError('listConfirmations does not accept input');
      return chatAgentDelegationService.listConfirmations();
    })
  );
  ipcMain.handle(
    'chat:agent:resolve-confirmation',
    wrapAgentHandler((_event, ...inputs) => {
      if (inputs.length !== 1) throw createInputError('resolveConfirmation accepts exactly one input');
      return chatAgentDelegationService.resolveConfirmation(parseConfirmationInput(inputs[0]));
    })
  );
}
