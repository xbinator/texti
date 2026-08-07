/**
 * @file path.ts
 * @description 路径片段安全校验与跨平台路径常量。
 *
 * 所有函数均与 `posix.ts` 协作：调用方传入任意分隔符的路径，由 `path` 完成分隔符归一
 * 与片段级安全校验，确保 `posix` 工具链拿到的是已规范化的输入。
 */

/** Windows 文件名非法字符。 */
const WINDOWS_INVALID_PATH_CHARS = /[<>:"|?*]/u;
/** Windows 保留设备名，带扩展名也不可作为文件名。 */
const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/** 可安全作为跨平台资源目录名的标识格式。 */
export const PORTABLE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/u;

/**
 * 将路径分隔符统一为 `/`。
 * @param filePath - 原始路径
 * @returns 统一分隔符后的路径
 */
function slashify(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

/**
 * 判断路径片段是否为 Windows 保留设备名。
 * @param segment - 单一路径片段
 * @returns 是否为 Windows 保留名称
 */
function isWindowsReservedFileName(segment: string): boolean {
  return WINDOWS_RESERVED_PATH_SEGMENT.test(segment);
}

/**
 * 判断单一路径片段能否安全用于跨平台文件路径。
 * @param segment - 单一路径片段
 * @returns 是否为安全片段
 */
function isValidSegment(segment: string): boolean {
  const hasControlCharacter = Array.from(segment).some((character: string): boolean => character.charCodeAt(0) <= 31);

  return Boolean(
    segment &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.includes('/') &&
      !segment.includes('\\') &&
      !WINDOWS_INVALID_PATH_CHARS.test(segment) &&
      !hasControlCharacter &&
      !isWindowsReservedFileName(segment) &&
      !segment.endsWith(' ') &&
      !segment.endsWith('.')
  );
}

/**
 * 校验并规范化跨平台安全相对文件路径。
 * @param filePath - 待校验相对路径
 * @param description - 错误信息中的路径描述
 * @returns 使用 `/` 分隔的安全相对路径
 */
function validatePath(filePath: string, description = '路径'): string {
  const normalized = slashify(filePath);
  const segments = normalized.split('/');

  if (!normalized || normalized.startsWith('/') || segments.some((segment: string): boolean => !isValidSegment(segment))) {
    throw new Error(`${description}不安全：${filePath}`);
  }

  return normalized;
}

/** 路径片段安全校验集合。 */
export const path = {
  isValidSegment,
  isWindowsReservedFileName,
  validatePath,
  /** 将 `\` 归一为 `/`。 */
  slashify
};
