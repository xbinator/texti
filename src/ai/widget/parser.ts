/**
 * @file parser.ts
 * @description 小组件 JSON 文件解析器。
 */
import type { WidgetDefinition } from './types';
import { cloneDeep } from 'lodash-es';
import type { WidgetData } from '@/components/BWidget/types';
import { createDefaultWidgetData, normalizeWidgetDataContract } from '@/components/BWidget/utils/widgetData';
import { hashString } from '@/shared/utils/hash';
import { posix } from '@/utils/file/posix';

/**
 * 判断值是否为普通记录。
 * @param value - 待判断值
 * @returns 是否为普通记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Smart 字段要求的 literal 载荷类型。
 */
type SmartLiteralType = 'string' | 'boolean';

/**
 * 元素 metadata 中的 Smart 字段规则。
 */
interface SmartFieldRule {
  /** 字段名 */
  field: string;
  /** literal.value 要求的类型 */
  literalType: SmartLiteralType;
}

/**
 * 当前 Widget 元素的 Smart 字段规则。
 */
const SMART_METADATA_FIELD_RULES: Record<string, SmartFieldRule[]> = {
  button: [
    { field: 'text', literalType: 'string' },
    { field: 'disabled', literalType: 'boolean' },
    { field: 'loading', literalType: 'boolean' }
  ],
  image: [
    { field: 'src', literalType: 'string' },
    { field: 'alt', literalType: 'string' }
  ],
  swiper: [
    { field: 'autoplay', literalType: 'boolean' },
    { field: 'loop', literalType: 'boolean' },
    { field: 'showIndicator', literalType: 'boolean' },
    { field: 'vertical', literalType: 'boolean' }
  ]
};

/**
 * 读取单个 Smart 字段的协议错误。
 * @param value - Smart 字段候选值
 * @param path - 字段 JSON 路径
 * @param literalType - literal.value 的预期类型
 * @returns 协议错误，合法时返回 null
 */
function readSmartValueError(value: unknown, path: string, literalType: SmartLiteralType, literalNonEmpty = false): string | null {
  if (!isRecord(value)) {
    return `${path} must be a structured Smart value`;
  }

  if (value.type !== 'literal' && value.type !== 'variable') {
    return `${path}.type must be "literal" or "variable"`;
  }

  if (value.type === 'literal') {
    const isExpectedType = literalType === 'string' ? typeof value.value === 'string' : typeof value.value === 'boolean';

    if (!isExpectedType) {
      return `${path}.value must be a ${literalType} literal`;
    }

    return literalNonEmpty && typeof value.value === 'string' && !value.value.trim() ? `${path}.value must be non-empty` : null;
  }

  if (typeof value.value !== 'string') {
    return `${path}.value must be a variable path string`;
  }

  if (!value.value.trim()) {
    return `${path}.value must be a non-empty variable path`;
  }

  if (value.value.includes('{{') || value.value.includes('}}')) {
    return `${path}.value must store a raw variable path without moustache delimiters`;
  }

  return null;
}

/**
 * 读取按钮动作参数中的协议错误。
 * @param actions - 动作候选列表
 * @param path - 动作列表 JSON 路径
 * @returns 协议错误，合法时返回 null
 */
function readButtonActionSmartError(actions: unknown, path: string): string | null {
  if (actions === undefined) {
    return null;
  }

  if (!Array.isArray(actions)) {
    return `${path} must be an array`;
  }

  for (const [actionIndex, action] of actions.entries()) {
    const actionPath = `${path}[${actionIndex}]`;
    if (!isRecord(action)) {
      return `${actionPath} must be an object`;
    }

    if (typeof action.method !== 'string' || !action.method.trim()) {
      return `${actionPath}.method must be a non-empty string`;
    }

    if (action.args !== undefined && !Array.isArray(action.args)) {
      return `${actionPath}.args must be an array`;
    }

    if (Array.isArray(action.args)) {
      for (const [argumentIndex, argument] of action.args.entries()) {
        const error = readSmartValueError(argument, `${actionPath}.args[${argumentIndex}]`, 'string');
        if (error) {
          return error;
        }
      }
    }
  }

  return null;
}

/**
 * 读取轮播图片项中的协议错误。
 * @param images - 图片项候选列表
 * @param path - 图片列表 JSON 路径
 * @returns 协议错误，合法时返回 null
 */
function readSwiperImageSmartError(images: unknown, path: string): string | null {
  if (!Array.isArray(images) || images.length === 0) {
    return `${path} must be a non-empty array`;
  }

  for (const [imageIndex, image] of images.entries()) {
    const imagePath = `${path}[${imageIndex}]`;
    if (!isRecord(image)) {
      return `${imagePath} must be an object`;
    }

    for (const field of ['src', 'alt']) {
      const error = readSmartValueError(image[field], `${imagePath}.${field}`, 'string');
      if (error) {
        return error;
      }
    }

    if (image.title !== undefined && typeof image.title !== 'string') {
      return `${imagePath}.title must be a string`;
    }
  }

  return null;
}

/**
 * 读取循环配置中的协议错误。
 * @param loop - 循环配置候选值
 * @param path - 循环 JSON 路径
 * @returns 协议错误，合法时返回 null
 */
function readLoopSmartError(loop: unknown, path: string): string | null {
  if (!isRecord(loop)) {
    return `${path} must be an object`;
  }

  if (typeof loop.enabled !== 'boolean') {
    return `${path}.enabled must be a boolean`;
  }

  const sourceError = readSmartValueError(loop.source, `${path}.source`, 'string', loop.enabled);
  if (sourceError) {
    return sourceError;
  }

  if (loop.autoColumns !== undefined && typeof loop.autoColumns !== 'boolean') {
    return `${path}.autoColumns must be a boolean`;
  }

  const allowsMissingColumns = loop.autoColumns === true;
  if (loop.columns !== undefined && loop.columns !== 'auto' && (typeof loop.columns !== 'number' || !Number.isInteger(loop.columns) || loop.columns <= 0)) {
    return `${path}.columns must be a positive integer or "auto"`;
  }

  if (!allowsMissingColumns && loop.columns === undefined) {
    return `${path}.columns must be a positive integer or "auto"`;
  }

  for (const field of ['columnGap', 'rowGap']) {
    if (typeof loop[field] !== 'number' || !Number.isFinite(loop[field]) || loop[field] < 0) {
      return `${path}.${field} must be a non-negative number`;
    }
  }

  for (const field of ['itemName', 'indexName']) {
    if (typeof loop[field] !== 'string') {
      return `${path}.${field} must be a string`;
    }
  }

  return null;
}

/**
 * 读取元素树中的 Smart 协议错误。
 * @param element - 元素候选值
 * @param path - 元素 JSON 路径
 * @returns 协议错误，合法时返回 null
 */
function readElementSmartError(element: unknown, path: string): string | null {
  if (!isRecord(element)) {
    return `${path} must be an object`;
  }

  const { metadata } = element;
  const fieldRules = SMART_METADATA_FIELD_RULES[element.name as string] ?? [];
  if (fieldRules.length > 0) {
    if (!isRecord(metadata)) {
      return `${path}.metadata must be an object containing Smart fields`;
    }

    for (const rule of fieldRules) {
      if (!Object.prototype.hasOwnProperty.call(metadata, rule.field)) {
        return `${path}.metadata.${rule.field} must be a structured Smart value`;
      }

      const error = readSmartValueError(metadata[rule.field], `${path}.metadata.${rule.field}`, rule.literalType);
      if (error) {
        return error;
      }
    }

    if (element.name === 'button') {
      const error = readButtonActionSmartError(metadata.actions, `${path}.metadata.actions`);
      if (error) {
        return error;
      }
    }

    if (element.name === 'swiper') {
      const error = readSwiperImageSmartError(metadata.images, `${path}.metadata.images`);
      if (error) {
        return error;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(element, 'loop')) {
    const error = readLoopSmartError(element.loop, `${path}.loop`);
    if (error) {
      return error;
    }
  }

  if (Object.prototype.hasOwnProperty.call(element, 'children') && !Array.isArray(element.children)) {
    return `${path}.children must be an array`;
  }

  if (Array.isArray(element.children)) {
    for (const [childIndex, child] of element.children.entries()) {
      const error = readElementSmartError(child, `${path}.children[${childIndex}]`);
      if (error) {
        return error;
      }
    }
  }

  return null;
}

/**
 * 读取 Widget 元素树中的首个 Smart 协议错误。
 * @param value - Widget JSON 候选值
 * @returns 协议错误，合法时返回 null
 */
function readWidgetSmartError(value: Record<string, unknown>): string | null {
  if (!Array.isArray(value.elements)) {
    return null;
  }

  for (const [elementIndex, element] of value.elements.entries()) {
    const error = readElementSmartError(element, `elements[${elementIndex}]`);
    if (error) {
      return error;
    }
  }

  return null;
}

/**
 * 判断值是否包含可用的 Widget execute 脚本。
 * @param value - 待检查值
 * @returns 是否包含可用 execute
 */
function hasWidgetExecuteMethod(value: Record<string, unknown>): boolean {
  const { execute } = value;

  return isRecord(execute) && typeof execute.code === 'string';
}

/**
 * 从小组件配置文件路径读取目录形式的小组件 ID。
 * @param filePath - 小组件 JSON 文件路径
 * @returns 小组件 ID
 */
export function readWidgetIdFromFilePath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  const fileName = pathSegments.at(-1) ?? '';

  if (fileName === 'widget.json') {
    return pathSegments.at(-2) ?? fileName;
  }

  return fileName.endsWith('.json') ? fileName.slice(0, -'.json'.length) : fileName;
}

/**
 * 从未知记录归一化 WidgetData。
 * @param id - 小组件文件 ID
 * @param value - 原始 JSON 数据
 * @returns 小组件数据
 */
function normalizeWidgetData(id: string, value: Record<string, unknown>): WidgetData {
  const defaults = createDefaultWidgetData(id);
  const contract = normalizeWidgetDataContract(value);
  const data: WidgetData = {
    ...defaults,
    ...contract,
    execute: hasWidgetExecuteMethod(value) ? contract.execute : defaults.execute,
    elements: Array.isArray(value.elements) ? (cloneDeep(value.elements) as WidgetData['elements']) : defaults.elements
  };

  return {
    ...data,
    name: data.name || id
  };
}

/**
 * 创建解析失败的小组件定义。
 * @param filePath - 小组件 JSON 文件路径
 * @param message - 错误信息
 * @param contentHash - 完整源文本的内容版本
 * @returns 解析失败定义
 */
function createWidgetParseError(filePath: string, message: string, contentHash: string): WidgetDefinition {
  const id = readWidgetIdFromFilePath(filePath);
  const data = createDefaultWidgetData(id);
  const normalizedFilePath = filePath.replace(/\\/g, '/');

  return {
    id,
    name: id,
    description: '',
    data: {
      ...data,
      name: id
    },
    contentHash,
    filePath: normalizedFilePath,
    dirPath: posix.dirname(normalizedFilePath),
    enabled: true,
    parsedAt: Date.now(),
    parseError: message
  };
}

/**
 * 解析小组件 JSON 文件内容。
 * @param content - JSON 文件文本
 * @param filePath - 小组件 JSON 文件路径
 * @returns 小组件定义
 */
export function parseWidgetJson(content: string, filePath: string): WidgetDefinition {
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const id = readWidgetIdFromFilePath(normalizedFilePath);
  const contentHash = hashString(content);

  try {
    const parsed: unknown = JSON.parse(content);

    if (!isRecord(parsed)) {
      return createWidgetParseError(normalizedFilePath, 'Widget JSON must be an object.', contentHash);
    }

    const smartError = readWidgetSmartError(parsed);
    if (smartError) {
      return createWidgetParseError(normalizedFilePath, `Widget Smart contract invalid: ${smartError}.`, contentHash);
    }

    const data = normalizeWidgetData(id, parsed);

    return {
      id,
      name: data.name,
      description: data.description,
      data,
      contentHash,
      filePath: normalizedFilePath,
      dirPath: posix.dirname(normalizedFilePath),
      enabled: true,
      parsedAt: Date.now()
    };
  } catch (error: unknown) {
    return createWidgetParseError(normalizedFilePath, error instanceof Error ? error.message : String(error), contentHash);
  }
}
