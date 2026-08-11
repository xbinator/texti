/**
 * @file resource-budget.mts
 * @description 以有界迭代扫描估算 Provider 结构化 JSON 载荷字节数。
 */

/** JSON 使用两字节转义的引号、反斜杠与控制字符。 */
const TWO_BYTE_ESCAPE_UNITS = new Set<number>([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x22, 0x5c]);

/** 单个 UTF-16 code unit 的 JSON 计量结果。 */
interface CodeUnitMeasure {
  /** JSON UTF-8 字节数。 */
  bytes: number;
  /** 需要额外跳过的后续 code unit 数。 */
  advance: number;
}

/** 待计量的 JSON 值帧。 */
interface ValueMeasureFrame {
  /** 帧类型。 */
  kind: 'value';
  /** 待计量值。 */
  value: unknown;
}

/** 容器子树完成后的退出帧。 */
interface LeaveMeasureFrame {
  /** 帧类型。 */
  kind: 'leave';
  /** 需要移出当前祖先集的容器。 */
  value: object;
}

/** 迭代 JSON 计量帧。 */
type MeasureFrame = ValueMeasureFrame | LeaveMeasureFrame;

/** JSON 计量器可变状态。 */
interface JsonMeasureState {
  /** 最大允许字节数。 */
  maximum: number;
  /** 已计量字节数。 */
  bytes: number;
  /** 待处理帧栈。 */
  pending: MeasureFrame[];
  /** 当前访问路径的祖先容器，只拒绝真正循环。 */
  ancestors: WeakSet<object>;
}

/**
 * 计算单个 UTF-16 code unit 的 JSON UTF-8 字节数。
 * @param value - 完整字符串
 * @param index - 当前 code unit 下标
 * @returns 字节数与额外跳过量
 */
function measureCodeUnit(value: string, index: number): CodeUnitMeasure {
  const codeUnit = value.charCodeAt(index);
  if (TWO_BYTE_ESCAPE_UNITS.has(codeUnit)) return { bytes: 2, advance: 0 };
  if (codeUnit <= 0x1f) return { bytes: 6, advance: 0 };
  if (codeUnit <= 0x7f) return { bytes: 1, advance: 0 };
  if (codeUnit <= 0x7ff) return { bytes: 2, advance: 0 };
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const nextUnit = value.charCodeAt(index + 1);
    return nextUnit >= 0xdc00 && nextUnit <= 0xdfff ? { bytes: 4, advance: 1 } : { bytes: 6, advance: 0 };
  }
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff ? { bytes: 6, advance: 0 } : { bytes: 3, advance: 0 };
}

/**
 * 计算 JSON 字符串序列化后的 UTF-8 字节数。
 * @param value - 不含外层引号的字符串
 * @param limit - 可提前退出的剩余上限
 * @returns 含外层引号的字节数
 */
function measureStringBytes(value: string, limit: number): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const measured = measureCodeUnit(value, index);
    bytes += measured.bytes;
    index += measured.advance;
    if (bytes > limit) return bytes;
  }
  return bytes;
}

/**
 * 计量非容器 JSON 值。
 * @param value - 待计量值
 * @param limit - 当前剩余上限
 * @returns 字节数；容器对象返回 -1
 */
function measurePrimitive(value: unknown, limit: number): number {
  if (value === null) return 4;
  if (typeof value === 'string') return measureStringBytes(value, limit);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).length : 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'bigint') return limit + 1;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return 4;
  return -1;
}

/**
 * 将 JSON 数组展开为待计量值帧，不调用访问器。
 * @param value - 待展开数组
 * @param state - 计量器状态
 * @returns 数组是否安全
 */
function expandJsonArray(value: unknown[], state: JsonMeasureState): boolean {
  if (value.length > state.maximum) return false;
  state.bytes += 2 + Math.max(0, value.length - 1);
  for (let index = value.length - 1; index >= 0; index -= 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor && !('value' in descriptor)) return false;
      state.pending.push({ kind: 'value', value: descriptor?.value ?? null });
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * 将普通 JSON 对象展开为待计量值帧，不调用访问器。
 * @param value - 待展开对象
 * @param state - 计量器状态
 * @returns 对象是否安全
 */
function expandJsonObject(value: object, state: JsonMeasureState): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = Object.entries(descriptors).filter(([, descriptor]): boolean => descriptor.enumerable === true);
    state.bytes += 2 + Math.max(0, entries.length - 1);
    for (const [key, descriptor] of entries) {
      if (!('value' in descriptor)) return false;
      state.bytes += measureStringBytes(key, state.maximum - state.bytes) + 1;
      state.pending.push({ kind: 'value', value: descriptor.value });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 进入一个 JSON 容器并安排子树与退出帧。
 * @param value - 待展开容器
 * @param state - 计量器状态
 * @returns 容器是否无循环且安全
 */
function enterJsonContainer(value: object, state: JsonMeasureState): boolean {
  if (state.ancestors.has(value)) return false;
  state.ancestors.add(value);
  state.pending.push({ kind: 'leave', value });
  return Array.isArray(value) ? expandJsonArray(value, state) : expandJsonObject(value, state);
}

/**
 * 测量只包含 JSON 数据的未知值，遇到循环、访问器或非普通对象时按超限处理。
 * @param value - Provider 工具输入
 * @param limit - 最大允许字节数
 * @returns JSON 序列化字节数；不安全或超限时返回大于 limit 的值
 */
export function measureJsonBytes(value: unknown, limit: number): number {
  const maximum = Math.max(0, Math.floor(limit));
  const state: JsonMeasureState = {
    maximum,
    bytes: 0,
    pending: [{ kind: 'value', value }],
    ancestors: new WeakSet<object>()
  };

  while (state.pending.length > 0) {
    const frame = state.pending.pop();
    if (!frame) break;
    if (frame.kind === 'leave') {
      state.ancestors.delete(frame.value);
      continue;
    }

    const primitiveBytes = measurePrimitive(frame.value, maximum - state.bytes);
    if (primitiveBytes >= 0) state.bytes += primitiveBytes;
    else if (!enterJsonContainer(frame.value as object, state)) return maximum + 1;
    if (state.bytes > maximum) return state.bytes;
  }
  return state.bytes;
}
