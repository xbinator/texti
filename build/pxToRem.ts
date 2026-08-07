/**
 * @file pxToRem.ts
 * @description Vite CSS 构建期 px 转 rem 插件，基于 14px 设计基准缩放应用 UI。
 */

/**
 * 文件路径匹配规则。
 */
type PathPattern = string | RegExp;

/**
 * px 转 rem 插件配置。
 */
interface PxToRemOptions {
  /** 设计基准字号。 */
  rootValue?: number;
  /** rem 小数精度。 */
  precision?: number;
  /** 小于等于该值的 px 保持不变，用于 1px 边框和发丝线。 */
  minPixelValue?: number;
  /** 需要转换的源码路径。 */
  include?: PathPattern[];
  /** 不参与转换的源码路径。 */
  exclude?: PathPattern[];
}

/**
 * PostCSS 声明节点的最小接口。
 */
export interface CssDeclaration {
  /** CSS 声明值。 */
  value: string;
}

/**
 * PostCSS 根节点的最小接口。
 */
interface CssRoot {
  /**
   * 遍历 CSS 声明。
   * @param callback - 声明回调
   */
  walkDecls(callback: (decl: CssDeclaration) => void): void;
}

/**
 * PostCSS 结果对象的最小接口。
 */
interface CssResult {
  /** PostCSS 处理配置。 */
  opts?: {
    /** 源文件路径。 */
    from?: string;
  };
}

/**
 * PostCSS 插件回调参数的最小接口。
 */
interface CssPluginApi {
  /** PostCSS 结果对象。 */
  result?: CssResult;
}

/**
 * Vite 可消费的 PostCSS 插件最小结构。
 */
interface CssPostcssPlugin {
  /** PostCSS 插件名。 */
  postcssPlugin: string;
  /**
   * 处理 CSS 根节点。
   * @param root - CSS 根节点
   * @param api - PostCSS 插件上下文
   */
  Once(root: CssRoot, api: CssPluginApi): void;
}

const DEFAULT_ROOT_VALUE = 14;
const DEFAULT_PRECISION = 4;
const DEFAULT_MIN_PIXEL_VALUE = 1;

/**
 * 默认纳入转换的源码路径。
 */
const DEFAULT_INCLUDE: PathPattern[] = [/\/src\//u];

/**
 * 默认排除内容编辑、画布、代码编辑和固定像素测量相关路径。
 */
const DEFAULT_EXCLUDE: PathPattern[] = [
  /\/src\/assets\/styles\/markdown\.less$/u,
  /\/src\/components\/BEditor\//u,
  /\/src\/components\/BMonaco\//u,
  /\/src\/components\/BSmart\//u,
  /\/src\/components\/BWidget\//u,
  /\/src\/views\/widget\//u
];

/**
 * 归一化文件路径，兼容 Windows 分隔符和 Vue style query。
 * @param filePath - 原始文件路径
 * @returns 归一化后的路径
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').split('?')[0] ?? filePath;
}

/**
 * 判断路径是否命中匹配规则。
 * @param filePath - 已归一化路径
 * @param patterns - 匹配规则列表
 * @returns 是否命中
 */
function isPathMatch(filePath: string, patterns: PathPattern[]): boolean {
  return patterns.some((pattern: PathPattern): boolean => (typeof pattern === 'string' ? filePath.includes(pattern) : pattern.test(filePath)));
}

/**
 * 判断文件是否需要转换。
 * @param from - PostCSS 源文件路径
 * @param options - 插件配置
 * @returns 是否转换
 */
function shouldTransform(from: string | undefined, options: Required<PxToRemOptions>): boolean {
  if (!from) return false;

  const filePath = normalizePath(from);
  if (!isPathMatch(filePath, options.include)) return false;

  return !isPathMatch(filePath, options.exclude);
}

/**
 * 格式化 rem 数值，移除无意义的尾随 0。
 * @param value - rem 数值
 * @param precision - 小数精度
 * @returns rem 字符串
 */
function formatRem(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString();
}

/**
 * 查找 url(...) 函数的结束位置。
 * @param value - CSS 声明值
 * @param startIndex - url( 起始位置
 * @returns 结束索引
 */
function findUrlEnd(value: string, startIndex: number): number {
  let depth = 0;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return value.length;
}

/**
 * 查找字符串字面量的结束位置。
 * @param value - CSS 声明值
 * @param startIndex - 引号起始位置
 * @returns 结束索引
 */
function findQuoteEnd(value: string, startIndex: number): number {
  const quote = value[startIndex];

  for (let index = startIndex + 1; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
      continue;
    }

    if (value[index] === quote) return index + 1;
  }

  return value.length;
}

/**
 * 转换单个 CSS 声明值中的 px 单位。
 * @param value - CSS 声明值
 * @param options - 插件配置
 * @returns 转换后的 CSS 声明值
 */
function convertValue(value: string, options: Required<PxToRemOptions>): string {
  let result = '';
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    const rest = value.slice(index);

    if (char === '"' || char === "'") {
      const endIndex = findQuoteEnd(value, index);
      result += value.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    if (/^url\(/iu.test(rest)) {
      const endIndex = findUrlEnd(value, index);
      result += value.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    const match = /^(-?\d*\.?\d+)px\b/iu.exec(rest);
    if (!match) {
      result += char;
      index += 1;
      continue;
    }

    const source = match[0];
    const pxValue = Number.parseFloat(match[1] ?? '');

    if (!Number.isFinite(pxValue) || Math.abs(pxValue) <= options.minPixelValue) {
      result += source;
    } else {
      result += `${formatRem(pxValue / options.rootValue, options.precision)}rem`;
    }

    index += source.length;
  }

  return result;
}

/**
 * 创建 Vite CSS 构建期 px 转 rem 插件。
 * @param options - 插件配置
 * @returns PostCSS 插件对象
 */
export function createRemPlugin(options: PxToRemOptions = {}): CssPostcssPlugin {
  const resolvedOptions: Required<PxToRemOptions> = {
    rootValue: options.rootValue ?? DEFAULT_ROOT_VALUE,
    precision: options.precision ?? DEFAULT_PRECISION,
    minPixelValue: options.minPixelValue ?? DEFAULT_MIN_PIXEL_VALUE,
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_EXCLUDE
  };

  return {
    postcssPlugin: 'tibis-px-to-rem',

    Once(root: CssRoot, api: CssPluginApi): void {
      if (!shouldTransform(api.result?.opts?.from, resolvedOptions)) return;

      root.walkDecls((decl: CssDeclaration): void => {
        decl.value = convertValue(decl.value, resolvedOptions);
      });
    }
  };
}
