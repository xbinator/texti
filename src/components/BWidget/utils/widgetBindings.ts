/**
 * @file widgetBindings.ts
 * @description BWidget 动态绑定表达式解析工具。
 */
import type { WidgetRenderEvaluationOptions } from '../renderOptions';
import type { WidgetMetadata } from '../types';
import type { WidgetExpressionHost, WidgetExpressionReadResult } from './widgetExpression';
import type { WidgetRenderContext } from 'types/widget';
import type { BSmartValue } from '@/components/BSmart/types';
import { isLiteralValue, isSmartValue } from '@/components/BSmart/utils/value';
import { evaluateWidgetExpression } from './widgetExpression';

/** 支持的绑定上下文根名称。 */
export type WidgetBindingContextRoot = 'input' | 'output' | 'data';

/**
 * 绑定表达式路径。
 */
export interface WidgetBindingPath {
  /** 上下文根名称 */
  root: WidgetBindingContextRoot | 'local';
  /** 局部变量根名称 */
  localRoot?: string;
  /** 根之后的路径片段 */
  segments: string[];
}

/**
 * Widget绑定局部变量上下文。
 */
export interface WidgetBindingLocalContext {
  /** 局部变量根 */
  locals?: Record<string, unknown>;
}

/**
 * Widget绑定表达式解析选项。
 */
export type WidgetBindingEvaluationOptions = WidgetBindingLocalContext;

/**
 * Widget 绑定表达式使用的根作用域。
 */
type WidgetBindingScope = Record<WidgetBindingContextRoot, unknown> & WidgetBindingLocalContext;

/**
 * 单次绑定表达式解析结果。
 */
interface WidgetBindingEvaluationResult {
  /** 表达式是否成功解析到有效值 */
  resolved: boolean;
  /** 表达式解析结果 */
  value: unknown;
}

/** 绑定插值匹配表达式。 */
const WIDGET_BINDING_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
/** 整个字段都是单个绑定插值时的匹配表达式。 */
const WIDGET_WHOLE_BINDING_PATTERN = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
/** 模板入参根名称。 */
const WIDGET_INPUT_BINDING_ROOT = '$input';
/** 模板执行结果根名称。 */
const WIDGET_OUTPUT_BINDING_ROOT = '$output';
/** 点路径标识符匹配表达式。 */
const WIDGET_BINDING_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
/** 点路径标识符前缀匹配表达式。 */
const WIDGET_BINDING_IDENTIFIER_PREFIX_PATTERN = /^[A-Za-z_$][\w$]*/;
/** 数组下标路径片段匹配表达式。 */
const WIDGET_BINDING_INDEX_PATTERN = /^\[(\d+)\]/;
/** 禁止读取的对象路径片段，避免原型链相关访问。 */
const WIDGET_UNSAFE_PATH_SEGMENTS = new Set<string>(['__proto__', 'prototype', 'constructor']);
/** 禁止表达式访问的 JavaScript 全局根名称。 */
const BLOCKED_WIDGET_EXPRESSION_ROOTS = new Set<string>(['window', 'document', 'globalThis', 'process']);

/**
 * 判断路径片段是否允许读取。
 * @param segment - 路径片段
 * @returns 是否允许读取
 */
export function isWidgetBindingPathSegmentAllowed(segment: string): boolean {
  return !WIDGET_UNSAFE_PATH_SEGMENTS.has(segment);
}

/**
 * 从渲染上下文中读取内部局部变量根。
 * @param context - Widget渲染上下文
 * @returns 局部变量根
 */
function readContextLocalRoots(context: WidgetRenderContext): Record<string, unknown> | undefined {
  const contextWithLocals = context as WidgetRenderContext & WidgetBindingLocalContext;

  return contextWithLocals.locals;
}

/**
 * 创建表达式求值使用的根作用域。
 * @param context - Widget渲染上下文
 * @param options - 绑定解析选项
 * @returns 绑定表达式根作用域
 */
function createBindingScope(context: WidgetRenderContext, options: WidgetBindingEvaluationOptions = {}): WidgetBindingScope {
  return {
    input: context.input,
    output: context.output,
    data: context.data,
    locals: options.locals ?? readContextLocalRoots(context)
  };
}

/**
 * 创建未解析的 Widget 表达式读取结果。
 * @returns 未解析结果
 */
function createUnresolvedExpression(): WidgetExpressionReadResult {
  return {
    resolved: false,
    value: undefined
  };
}

/**
 * 读取对象的自有数据属性，不沿原型链访问且不触发 getter。
 * @param target - 属性所属目标值
 * @param key - 属性名称或数组下标
 * @param resolveMissing - 缺少自有属性时是否保留内部 undefined
 * @returns 属性读取结果
 */
function readOwnExpressionValue(target: unknown, key: string | number, resolveMissing: boolean): WidgetExpressionReadResult {
  if (target === null || typeof target !== 'object') {
    return createUnresolvedExpression();
  }

  const propertyName = String(key);
  if (!isWidgetBindingPathSegmentAllowed(propertyName)) {
    return createUnresolvedExpression();
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, propertyName);
  } catch {
    return createUnresolvedExpression();
  }

  if (!descriptor) {
    return resolveMissing
      ? {
          resolved: true,
          value: undefined
        }
      : createUnresolvedExpression();
  }

  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return createUnresolvedExpression();
  }

  return {
    resolved: true,
    value: descriptor.value
  };
}

/**
 * 从 Widget 根作用域读取表达式标识符。
 * @param scope - Widget 绑定根作用域
 * @param name - 标识符名称
 * @returns 标识符读取结果
 */
function readExpressionIdentifier(scope: WidgetBindingScope, name: string): WidgetExpressionReadResult {
  if (BLOCKED_WIDGET_EXPRESSION_ROOTS.has(name)) {
    return createUnresolvedExpression();
  }

  if (name === WIDGET_INPUT_BINDING_ROOT) {
    return {
      resolved: true,
      value: scope.input
    };
  }

  if (name === WIDGET_OUTPUT_BINDING_ROOT) {
    return {
      resolved: true,
      value: scope.output
    };
  }

  if (scope.locals && Object.prototype.hasOwnProperty.call(scope.locals, name)) {
    return readOwnExpressionValue(scope.locals, name, false);
  }

  return readOwnExpressionValue(scope.data, name, false);
}

/**
 * 从表达式目标值读取自有属性。
 * @param target - 属性所属目标值
 * @param key - 属性名称或数组下标
 * @returns 属性读取结果
 */
function readExpressionProperty(target: unknown, key: string | number): WidgetExpressionReadResult {
  return readOwnExpressionValue(target, key, true);
}

/**
 * 创建 Widget 绑定表达式的受限数据宿主。
 * @param scope - Widget 绑定根作用域
 * @returns 安全表达式宿主
 */
function createExpressionHost(scope: WidgetBindingScope): WidgetExpressionHost {
  return {
    readIdentifier: (name: string): WidgetExpressionReadResult => readExpressionIdentifier(scope, name),
    readProperty: (target: unknown, key: string | number): WidgetExpressionReadResult => readExpressionProperty(target, key)
  };
}

/**
 * 使用安全表达式宿主求值旧版无 data 根路径。
 * @param path - 已解析的旧版绑定路径
 * @param host - 安全表达式宿主
 * @returns 路径求值结果
 */
function evaluateLegacyPath(path: WidgetBindingPath, host: WidgetExpressionHost): WidgetExpressionReadResult {
  let currentResult: WidgetExpressionReadResult;
  let remainingSegments = path.segments;

  if (path.root === 'local') {
    if (!path.localRoot) {
      return createUnresolvedExpression();
    }

    currentResult = host.readIdentifier(path.localRoot);
  } else if (path.root === 'data') {
    const [firstSegment, ...restSegments] = path.segments;
    if (!firstSegment) {
      return createUnresolvedExpression();
    }

    currentResult = host.readIdentifier(firstSegment);
    remainingSegments = restSegments;
  } else {
    const rootName = path.root === 'input' ? WIDGET_INPUT_BINDING_ROOT : WIDGET_OUTPUT_BINDING_ROOT;
    currentResult = host.readIdentifier(rootName);
  }

  for (const segment of remainingSegments) {
    if (!currentResult.resolved || currentResult.value === null || currentResult.value === undefined) {
      return createUnresolvedExpression();
    }

    currentResult = host.readProperty(currentResult.value, segment);
  }

  return currentResult.resolved && currentResult.value !== undefined ? currentResult : createUnresolvedExpression();
}

/**
 * 读取转义字符对应的真实字符。
 * @param character - 转义后的字符
 * @returns 真实字符
 */
function readEscapedPathCharacter(character: string): string {
  if (character === 'n') {
    return '\n';
  }

  if (character === 'r') {
    return '\r';
  }

  if (character === 't') {
    return '\t';
  }

  if (character === 'b') {
    return '\b';
  }

  if (character === 'f') {
    return '\f';
  }

  return character;
}

/**
 * 解析括号路径中的字符串字面量。
 * @param expression - 完整表达式
 * @param startIndex - 字符串起始下标
 * @returns 字符串值和下一个下标，解析失败时返回 null
 */
function parseQuotedPathSegment(expression: string, startIndex: number): { nextIndex: number; value: string } | null {
  const quote = expression[startIndex];

  if (quote !== '"' && quote !== "'") {
    return null;
  }

  let index = startIndex + 1;
  let value = '';

  while (index < expression.length) {
    const character = expression[index];

    if (character === '\\') {
      const nextCharacter = expression[index + 1];

      if (nextCharacter === undefined) {
        return null;
      }

      if (nextCharacter === 'u') {
        const hex = expression.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return null;
        }

        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }

      value += readEscapedPathCharacter(nextCharacter);
      index += 2;
      continue;
    }

    if (character === quote) {
      return {
        value,
        nextIndex: index + 1
      };
    }

    value += character;
    index += 1;
  }

  return null;
}

/**
 * 解析括号路径片段。
 * @param expression - 完整表达式
 * @param startIndex - 片段起始下标
 * @returns 路径片段和下一个下标，解析失败时返回 null
 */
function parseBracketPathSegment(expression: string, startIndex: number): { nextIndex: number; value: string } | null {
  const indexMatch = expression.slice(startIndex).match(WIDGET_BINDING_INDEX_PATTERN);

  if (indexMatch) {
    return {
      value: indexMatch[1],
      nextIndex: startIndex + indexMatch[0].length
    };
  }

  const quotedSegment = parseQuotedPathSegment(expression, startIndex + 1);

  if (!quotedSegment || expression[quotedSegment.nextIndex] !== ']') {
    return null;
  }

  return {
    value: quotedSegment.value,
    nextIndex: quotedSegment.nextIndex + 1
  };
}

/**
 * 解析绑定路径片段。
 * @param expression - 完整表达式
 * @param startIndex - 当前下标
 * @returns 路径片段和下一个下标，解析失败时返回 null
 */
function parsePathSegment(expression: string, startIndex: number): { nextIndex: number; value: string } | null {
  if (expression[startIndex] === '[') {
    return parseBracketPathSegment(expression, startIndex);
  }

  const identifierMatch = expression.slice(startIndex).match(WIDGET_BINDING_IDENTIFIER_PREFIX_PATTERN);

  if (!identifierMatch) {
    return null;
  }

  return {
    value: identifierMatch[0],
    nextIndex: startIndex + identifierMatch[0].length
  };
}

/**
 * 读取表达式显式访问的运行态根。
 * @param expression - 绑定表达式
 * @returns 运行态根名称，未显式访问时返回 undefined
 */
function readExplicitBindingRoot(expression: string): 'input' | 'output' | undefined {
  const inputRootPrefixes = [`${WIDGET_INPUT_BINDING_ROOT}.`, `${WIDGET_INPUT_BINDING_ROOT}[`];
  const outputRootPrefixes = [`${WIDGET_OUTPUT_BINDING_ROOT}.`, `${WIDGET_OUTPUT_BINDING_ROOT}[`];

  if (expression === WIDGET_INPUT_BINDING_ROOT || inputRootPrefixes.some((prefix: string): boolean => expression.startsWith(prefix))) {
    return 'input';
  }

  if (expression === WIDGET_OUTPUT_BINDING_ROOT || outputRootPrefixes.some((prefix: string): boolean => expression.startsWith(prefix))) {
    return 'output';
  }

  return undefined;
}

/**
 * 解析绑定表达式路径。
 * @param expression - 绑定表达式
 * @param options - 绑定解析选项
 * @returns 绑定路径，非法时返回 null
 */
export function parseWidgetBindingPath(expression: string, options: WidgetBindingEvaluationOptions = {}): WidgetBindingPath | null {
  const { locals } = options;
  const explicitRoot = readExplicitBindingRoot(expression);
  const root = explicitRoot ?? 'data';
  const segments: string[] = [];
  let index = 0;

  if (root === 'input') {
    index = WIDGET_INPUT_BINDING_ROOT.length;
  } else if (root === 'output') {
    index = WIDGET_OUTPUT_BINDING_ROOT.length;
  }

  if (root === 'data') {
    const firstSegment = parsePathSegment(expression, index);

    if (!firstSegment) {
      return null;
    }

    if (locals && Object.prototype.hasOwnProperty.call(locals, firstSegment.value)) {
      index = firstSegment.nextIndex;

      while (index < expression.length) {
        const character = expression[index];

        if (character === '.') {
          const identifierMatch = expression.slice(index + 1).match(WIDGET_BINDING_IDENTIFIER_PREFIX_PATTERN);
          if (!identifierMatch) {
            return null;
          }

          segments.push(identifierMatch[0]);
          index += identifierMatch[0].length + 1;
          continue;
        }

        if (character === '[') {
          const bracketSegment = parseBracketPathSegment(expression, index);
          if (!bracketSegment) {
            return null;
          }

          segments.push(bracketSegment.value);
          index = bracketSegment.nextIndex;
          continue;
        }

        return null;
      }

      if (![firstSegment.value, ...segments].every((segment: string): boolean => isWidgetBindingPathSegmentAllowed(segment))) {
        return null;
      }

      return {
        root: 'local',
        localRoot: firstSegment.value,
        segments
      };
    }

    segments.push(firstSegment.value);
    index = firstSegment.nextIndex;
  }

  while (index < expression.length) {
    const character = expression[index];

    if (character === '.') {
      const identifierMatch = expression.slice(index + 1).match(WIDGET_BINDING_IDENTIFIER_PREFIX_PATTERN);
      if (!identifierMatch) {
        return null;
      }

      segments.push(identifierMatch[0]);
      index += identifierMatch[0].length + 1;
      continue;
    }

    if (character === '[') {
      const bracketSegment = parseBracketPathSegment(expression, index);
      if (!bracketSegment) {
        return null;
      }

      segments.push(bracketSegment.value);
      index = bracketSegment.nextIndex;
      continue;
    }

    return null;
  }

  if (root === 'data' && segments.length === 0) {
    return null;
  }

  if (segments.some((segment: string): boolean => !isWidgetBindingPathSegmentAllowed(segment))) {
    return null;
  }

  return {
    root,
    segments
  };
}

/**
 * 格式化绑定路径首个片段。
 * @param segment - 路径片段
 * @returns 首个路径片段文本
 */
function formatFirstBindingPathSegment(segment: string): string {
  if (WIDGET_BINDING_IDENTIFIER_PATTERN.test(segment)) {
    return segment;
  }

  if (/^\d+$/.test(segment)) {
    return `[${segment}]`;
  }

  return `[${JSON.stringify(segment)}]`;
}

/**
 * 将展示对象归一化为不会触发 getter 或 toJSON 的 JSON 安全快照。
 * @param value - 待归一化的展示值
 * @param seenObjects - 当前序列化链路已访问的对象集合
 * @returns JSON 安全值；对象属性不支持 JSON 时返回 undefined
 */
function createDisplayJsonValue(value: unknown, seenObjects: WeakSet<object>): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seenObjects.has(value)) {
    return '[Circular]';
  }

  seenObjects.add(value);

  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }

  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    const length =
      lengthDescriptor && Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') && typeof lengthDescriptor.value === 'number'
        ? lengthDescriptor.value
        : 0;
    const snapshot = Array.from({ length }, (_unusedValue: unknown, index: number): unknown => {
      const descriptor = descriptors[String(index)];

      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return null;
      }

      return createDisplayJsonValue(descriptor.value, seenObjects) ?? null;
    });

    // 屏蔽可能被全局扩展的 Array.prototype.toJSON，确保后续序列化不会调用代码。
    Object.defineProperty(snapshot, 'toJSON', {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false
    });

    return snapshot;
  }

  const snapshot = Object.create(null) as Record<string, unknown>;

  Object.entries(descriptors).forEach(([key, descriptor]: [string, PropertyDescriptor]): void => {
    if (!descriptor.enumerable || !isWidgetBindingPathSegmentAllowed(key) || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return;
    }

    const descriptorValue = createDisplayJsonValue(descriptor.value, seenObjects);
    if (descriptorValue !== undefined) {
      snapshot[key] = descriptorValue;
    }
  });

  return snapshot;
}

/**
 * 将绑定值格式化为展示文本。
 * @param value - 绑定解析值
 * @returns 展示文本
 */
export function formatWidgetDisplayTextValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const safeValue = createDisplayJsonValue(value, new WeakSet<object>());

  return JSON.stringify(safeValue, null, 2) ?? '';
}

/**
 * 格式化单个绑定路径片段。
 * @param segment - 路径片段
 * @returns 路径片段文本
 */
function formatBindingPathSegment(segment: string): string {
  if (WIDGET_BINDING_IDENTIFIER_PATTERN.test(segment)) {
    return `.${segment}`;
  }

  if (/^\d+$/.test(segment)) {
    return `[${segment}]`;
  }

  return `[${JSON.stringify(segment)}]`;
}

/**
 * 格式化绑定路径。
 * @param root - 上下文根名称
 * @param segments - 路径片段
 * @returns 可插入模板的绑定路径
 */
export function formatWidgetBindingPath(root: WidgetBindingContextRoot, segments: string[] = []): string {
  if (root === 'data') {
    const [firstSegment, ...restSegments] = segments;

    if (!firstSegment) {
      return '';
    }

    return restSegments.reduce(
      (path: string, segment: string): string => `${path}${formatBindingPathSegment(segment)}`,
      formatFirstBindingPathSegment(firstSegment)
    );
  }

  const rootName = root === 'input' ? WIDGET_INPUT_BINDING_ROOT : WIDGET_OUTPUT_BINDING_ROOT;

  return segments.reduce((path: string, segment: string): string => `${path}${formatBindingPathSegment(segment)}`, rootName);
}

/**
 * 解析单个绑定表达式。
 * @param expression - 去掉双花括号后的表达式
 * @param context - Widget渲染上下文
 * @param options - 绑定解析选项
 * @returns 表达式解析结果
 */
export function evaluateWidgetBindingExpression(
  expression: string,
  context: WidgetRenderContext,
  options: WidgetBindingEvaluationOptions = {}
): WidgetBindingEvaluationResult {
  const normalizedExpression = expression.trim();
  const scope = createBindingScope(context, options);
  const host = createExpressionHost(scope);
  const expressionResult = evaluateWidgetExpression(normalizedExpression, host);

  if (expressionResult.resolved) {
    return expressionResult;
  }

  // 兼容变量选择器生成的 `["field-name"]` 路径，但仍通过受限宿主读取，不开放数组字面量求值。
  const legacyPath = parseWidgetBindingPath(normalizedExpression, { ...options, locals: scope.locals });

  return legacyPath ? evaluateLegacyPath(legacyPath, host) : createUnresolvedExpression();
}

/**
 * 解析绑定模板。
 * @param template - 绑定模板文本
 * @param context - Widget渲染上下文
 * @param fallback - 解析失败时使用的静态回退值
 * @param options - 绑定解析选项
 * @returns 解析后的绑定值
 */
export function resolveWidgetBindingTemplate(
  template: string,
  context: WidgetRenderContext,
  fallback: unknown,
  options: WidgetBindingEvaluationOptions = {}
): unknown {
  const wholeMatch = template.match(WIDGET_WHOLE_BINDING_PATTERN);

  if (wholeMatch) {
    const result = evaluateWidgetBindingExpression(wholeMatch[1], context, options);

    return result.resolved ? result.value : fallback;
  }

  let hasBinding = false;
  let hasUnresolvedBinding = false;
  const resolvedText = template.replace(WIDGET_BINDING_PATTERN, (_matchedText: string, expression: string): string => {
    hasBinding = true;
    const result = evaluateWidgetBindingExpression(expression, context, options);

    if (!result.resolved) {
      hasUnresolvedBinding = true;
      return '';
    }

    return formatWidgetDisplayTextValue(result.value);
  });

  if (!hasBinding) {
    return template;
  }

  return hasUnresolvedBinding ? fallback : resolvedText;
}

/**
 * 解析字段模板值。
 * @param template - 字段模板文本
 * @param context - Widget渲染上下文
 * @param options - 绑定解析选项
 * @returns 字段模板值
 */
export function resolveWidgetTemplateValue(template: string, context: WidgetRenderContext | undefined, options: WidgetBindingEvaluationOptions = {}): unknown {
  if (!context) {
    return template;
  }

  return resolveWidgetBindingTemplate(template, context, template, options);
}

/**
 * 移除模板文本中的绑定占位。
 * @param template - 字段模板文本
 * @returns 只保留静态片段后的展示文本
 */
export function removeWidgetTemplateBindings(template: string): string {
  return template.replace(WIDGET_BINDING_PATTERN, '');
}

/**
 * 按当前渲染模式解析结构化 Smart 值。
 * @param value - Smart 值
 * @param options - Widget 渲染求值选项
 * @returns 静态值或变量解析结果，无法解析时返回 undefined
 */
export function resolveWidgetSmartValue<T>(value: BSmartValue<T> | undefined, options: WidgetRenderEvaluationOptions = {}): unknown {
  if (!isSmartValue(value)) {
    return undefined;
  }

  if (isLiteralValue(value)) {
    return value.value;
  }

  const { renderContext, renderOptions = { mode: 'design' } } = options;
  if (renderOptions.mode !== 'runtime' || !renderContext || !value.value.trim()) {
    return undefined;
  }

  const result = evaluateWidgetBindingExpression(value.value, renderContext);

  return result.resolved ? result.value : undefined;
}

/**
 * 按当前渲染模式解析字段展示值。
 * @param value - 字段原始值
 * @param options - Widget 渲染求值选项
 * @returns 当前模式下实际展示的字段值
 */
export function resolveWidgetDisplayValue(value: unknown, options: WidgetRenderEvaluationOptions = {}): unknown {
  if (isSmartValue(value)) {
    return resolveWidgetSmartValue(value, options);
  }

  if (typeof value !== 'string') {
    return value;
  }

  const { renderContext, renderOptions = { mode: 'design' } } = options;

  return renderOptions.mode === 'runtime' ? resolveWidgetTemplateValue(value, renderContext) : removeWidgetTemplateBindings(value);
}

/**
 * 解析元素元数据字段为展示文本。
 * @param metadata - 元素元数据
 * @param fieldName - 字段名称
 * @param options - Widget 渲染求值选项
 * @returns 字段展示文本
 */
export function resolveWidgetTemplateFieldText(metadata: WidgetMetadata, fieldName: string, options: WidgetRenderEvaluationOptions = {}): string {
  const fieldValue = metadata[fieldName];
  const template = typeof fieldValue === 'string' ? fieldValue : '';
  const resolvedValue = resolveWidgetDisplayValue(template, options);

  return formatWidgetDisplayTextValue(resolvedValue);
}
