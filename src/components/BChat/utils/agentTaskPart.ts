/**
 * @file agentTaskPart.ts
 * @description 保护性读取 delegate_task 终态 Result 中可用于交叉验证的 Task 身份。
 */
import type { ChatMessageToolPart } from 'types/chat';
import { isPlainObject, isString } from 'lodash-es';

/** IPC 稳定身份允许的最大长度。 */
const MAX_ID_LENGTH = 160;

/** metadata-only fallback 允许观察的工具结果状态。 */
export type TaskResultStatus = 'success' | 'failure' | 'cancelled';

/**
 * 判断字符串是否包含 Unicode Cc 控制字符。
 * @param value - 待校验字符串
 * @returns 是否包含控制字符
 */
function hasControlChars(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

/**
 * 读取普通对象自有数据属性，拒绝 getter 与继承属性。
 * @param value - 待读取普通对象
 * @param key - 自有属性名
 * @returns 数据属性值；访问器或缺失时返回 undefined
 */
function readOwnValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * 使用 lodash 判定精确普通对象并向 TypeScript 暴露安全收窄。
 * @param value - 未可信值
 * @returns 是否可作为普通记录读取
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

/**
 * 从 Tool Part 自有数据属性读取普通 Result 对象。
 * @param part - 原始 Tool Part
 * @returns 自有普通 Result；缺失、getter 或反射失败时返回 undefined
 */
function readOwnResult(part: ChatMessageToolPart): Record<string, unknown> | undefined {
  try {
    if (part.status !== 'done' || !Object.hasOwn(part, 'result')) return undefined;
    const result = readOwnValue(part as unknown as Record<string, unknown>, 'result');
    return isPlainRecord(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 保护性读取 Tool Result 状态，不执行 result 或 status getter。
 * @param part - 原始 Tool Part
 * @returns 可用于 metadata-only fallback 的稳定状态
 */
export function readTaskResultStatus(part: ChatMessageToolPart): TaskResultStatus | undefined {
  const result = readOwnResult(part);
  if (!result) return undefined;
  const status = readOwnValue(result, 'status');
  return status === 'success' || status === 'failure' || status === 'cancelled' ? status : undefined;
}

/**
 * 从终态 delegate_task Result 中保护性读取 Task 身份。
 * 只接受与 Main IPC 身份规则一致的自有普通对象字段。
 * @param part - 原始工具消息片段
 * @returns 合法 Task 身份；其他输入返回 undefined
 */
export function readTaskResultId(part: ChatMessageToolPart): string | undefined {
  try {
    if (readTaskResultStatus(part) !== 'success') return undefined;
    const result = readOwnResult(part);
    if (!result) return undefined;

    const data = readOwnValue(result, 'data');
    if (!isPlainRecord(data)) return undefined;
    const taskId = readOwnValue(data, 'taskId');
    if (!isString(taskId) || typeof taskId !== 'string') return undefined;
    if (taskId.length < 1 || taskId.length > MAX_ID_LENGTH || taskId.trim() !== taskId || hasControlChars(taskId)) return undefined;
    return taskId;
  } catch {
    // Proxy 反射或防御性 getter 异常时必须 fail closed，不能让历史消息渲染失败。
    return undefined;
  }
}
