/**
 * @file useElementVariables.ts
 * @description BWidget 元素 Setter 变量候选 hook。
 */
import type { Variable, VariableOptionGroup } from '../../BSmart/types';
import type { WidgetData, WidgetElement, WidgetElementLoopConfig, WidgetSchemaObject, WidgetSchemaProperty } from '../types';
import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import { isVariableValue } from '@/components/BSmart/utils/value';
import { formatWidgetBindingPath, isWidgetBindingPathSegmentAllowed, parseWidgetBindingPath, type WidgetBindingContextRoot } from '../utils/widgetBindings';
import { buildWidgetDataSchema } from '../utils/widgetDataSchema';
import { readWidgetExecuteMethod } from '../utils/widgetExecuteMethod';
import { collectWidgetLoopDataSourceOptions, resolveWidgetElementLoopVariableNames, type WidgetLoopDataSourceOption } from '../utils/widgetLoop';
import { findElementTreeNode } from '../utils/widgetTree';
import { useWidgetContext } from './useWidgetContext';

/** 变量路径标识符匹配表达式。 */
const WIDGET_VARIABLE_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
/** 入参变量在模板编辑器中展示和插入的根名称。 */
const WIDGET_INPUT_VARIABLE_ROOT_NAME = '$input';
/** 输出变量在模板编辑器中展示和插入的根名称。 */
const WIDGET_OUTPUT_VARIABLE_ROOT_NAME = '$output';
/** 输入变量在模板编辑器中展示的可读名称。 */
const WIDGET_INPUT_VARIABLE_LABEL = '入参';
/** 执行输出变量在模板编辑器中展示的可读名称。 */
const WIDGET_OUTPUT_VARIABLE_LABEL = '执行结果';

/**
 * Widget 元素读取函数。
 */
export type ElementTargetReader = () => WidgetElement | undefined;

/**
 * 元素变量 hook 返回值。
 */
export interface UseElementVariablesReturn {
  /** 当前可插入变量候选 */
  variableOptions: ComputedRef<VariableOptionGroup[]>;
  /** 当前可作为循环数据源的数组变量候选 */
  loopSourceOptions: ComputedRef<WidgetLoopDataSourceOption[]>;
}

/**
 * 创建变量选项。
 * @param value - 变量路径
 * @param label - 变量说明标签
 * @param description - 变量说明
 * @param children - 子级变量选项
 * @returns 变量选项
 */
function createVariable(value: string, label: string, description?: string, children: Variable[] = []): Variable {
  const variable: Variable = { label, value };

  if (description) {
    variable.description = description;
  }

  if (children.length > 0) {
    variable.children = children;
  }

  return variable;
}

/**
 * 格式化局部变量路径片段。
 * @param segment - 路径片段
 * @returns 路径片段文本
 */
function formatLocalVariablePathSegment(segment: string): string {
  if (WIDGET_VARIABLE_IDENTIFIER_PATTERN.test(segment)) {
    return `.${segment}`;
  }

  if (/^\d+$/.test(segment)) {
    return `[${segment}]`;
  }

  return `[${JSON.stringify(segment)}]`;
}

/**
 * 格式化局部变量根路径。
 * @param rootName - 局部变量根名称
 * @returns 局部变量根路径
 */
function formatLocalVariableRoot(rootName: string): string {
  return WIDGET_VARIABLE_IDENTIFIER_PATTERN.test(rootName) ? rootName : `[${JSON.stringify(rootName)}]`;
}

/**
 * 格式化局部变量绑定路径。
 * @param rootName - 局部变量根名称
 * @param segments - 子级路径片段
 * @returns 局部变量路径
 */
function formatLocalVariablePath(rootName: string, segments: string[] = []): string {
  return segments.reduce((path: string, segment: string): string => `${path}${formatLocalVariablePathSegment(segment)}`, formatLocalVariableRoot(rootName));
}

/**
 * 格式化变量候选中的绑定路径。
 * @param root - 上下文根名称
 * @param segments - 子级路径片段
 * @returns 变量候选绑定路径
 */
function formatVariableBindingPath(root: WidgetBindingContextRoot, segments: string[] = []): string {
  return formatWidgetBindingPath(root, segments);
}

/**
 * 从 schema 属性中收集子级变量路径。
 * @param root - 上下文根名称
 * @param properties - schema 属性集合
 * @param parentSegments - 父级路径片段
 * @returns 子级变量选项列表
 */
function collectSchemaVariableChildren(
  root: WidgetBindingContextRoot,
  properties: Record<string, WidgetSchemaProperty> | undefined,
  parentSegments: string[] = []
): Variable[] {
  if (!properties) {
    return [];
  }

  const variables = Object.entries(properties).flatMap(([key, property]: [string, WidgetSchemaProperty]): Variable[] => {
    if (!isWidgetBindingPathSegmentAllowed(key)) {
      return [];
    }

    const segments = [...parentSegments, key];
    const path = formatVariableBindingPath(root, segments);
    const children = property.type === 'object' ? collectSchemaVariableChildren(root, property.properties, segments) : [];

    return [createVariable(path, property.description ?? '', undefined, children)];
  });

  return variables;
}

/**
 * 从 schema 属性中收集循环项子级变量。
 * @param rootName - 循环项变量名
 * @param properties - schema 属性集合
 * @param parentSegments - 父级路径片段
 * @returns 子级变量选项列表
 */
function collectLoopItemVariableChildren(
  rootName: string,
  properties: Record<string, WidgetSchemaProperty> | undefined,
  parentSegments: string[] = []
): Variable[] {
  if (!properties) {
    return [];
  }

  return Object.entries(properties).flatMap(([key, property]: [string, WidgetSchemaProperty]): Variable[] => {
    if (!isWidgetBindingPathSegmentAllowed(key)) {
      return [];
    }

    const segments = [...parentSegments, key];
    const path = formatLocalVariablePath(rootName, segments);
    const children = property.type === 'object' ? collectLoopItemVariableChildren(rootName, property.properties, segments) : [];

    return [createVariable(path, property.description ?? '', undefined, children)];
  });
}

/**
 * 读取 schema 路径对应的属性。
 * @param schema - schema 对象
 * @param segments - 数据路径片段
 * @returns 匹配到的 schema 属性
 */
function readSchemaPropertyAtPath(schema: WidgetSchemaObject, segments: string[]): WidgetSchemaProperty | undefined {
  let currentProperties: Record<string, WidgetSchemaProperty> | undefined = schema.properties;
  let currentProperty: WidgetSchemaProperty | undefined;

  for (const segment of segments) {
    currentProperty = currentProperties?.[segment];
    if (!currentProperty) {
      return undefined;
    }

    currentProperties = currentProperty.type === 'object' ? currentProperty.properties : undefined;
  }

  return currentProperty;
}

/**
 * 读取循环数据源数组 schema。
 * @param widgetData - Widget 数据
 * @param dataSchema - 静态推导 data schema
 * @param config - 循环配置
 * @returns 数组数据源 schema
 */
function readLoopArraySchema(widgetData: WidgetData, dataSchema: WidgetSchemaObject, config: WidgetElementLoopConfig): WidgetSchemaProperty | undefined {
  if (!isVariableValue(config.source)) {
    return undefined;
  }

  const path = parseWidgetBindingPath(config.source.value);
  if (!path || path.root === 'local') {
    return undefined;
  }

  const sourceSchema = path.root === 'input' ? widgetData.inputSchema : dataSchema;
  const sourceSegments = path.segments;
  const sourceProperty = readSchemaPropertyAtPath(sourceSchema, sourceSegments);

  return sourceProperty?.type === 'array' ? sourceProperty : undefined;
}

/**
 * 查找离当前元素最近的循环上下文元素。
 * @param pathElements - 从顶层到当前元素的路径元素列表
 * @returns 最近的循环上下文元素
 */
function findNearestLoopContextElement(pathElements: WidgetElement[]): WidgetElement | null {
  return [...pathElements].reverse().find((item: WidgetElement): boolean => item.loop.enabled) ?? null;
}

/**
 * 读取当前元素可用的循环配置。
 * @param widgetData - Widget 数据
 * @param element - 当前元素
 * @returns 循环配置，缺少时返回 null
 */
function readElementLoopConfig(widgetData: WidgetData | undefined, element: WidgetElement | undefined): WidgetElementLoopConfig | null {
  if (!widgetData || !element) {
    return null;
  }

  const currentNode = findElementTreeNode(widgetData.elements, element.id);
  const pathElements = currentNode
    ? currentNode.path
        .map((elementId: string): WidgetElement | undefined => findElementTreeNode(widgetData.elements, elementId)?.element)
        .filter((item: WidgetElement | undefined): item is WidgetElement => item !== undefined)
    : [element];
  const loopContextElement = findNearestLoopContextElement(pathElements);

  return loopContextElement ? loopContextElement.loop : null;
}

/**
 * 创建循环局部变量候选。
 * @param widgetData - Widget 数据
 * @param dataSchema - 静态推导 data schema
 * @param element - 当前元素
 * @returns 循环局部变量候选
 */
function createLoopVariables(widgetData: WidgetData | undefined, dataSchema: WidgetSchemaObject, element: WidgetElement | undefined): Variable[] {
  const config = readElementLoopConfig(widgetData, element);
  if (!widgetData || !config) {
    return [];
  }

  const loopArraySchema = readLoopArraySchema(widgetData, dataSchema, config);
  if (!loopArraySchema) {
    return [];
  }

  const variableNames = resolveWidgetElementLoopVariableNames(config);
  const itemSchema = loopArraySchema.items;
  const itemChildren = itemSchema?.type === 'object' ? collectLoopItemVariableChildren(variableNames.itemName, itemSchema.properties) : [];
  const variables = [createVariable(formatLocalVariableRoot(variableNames.itemName), '循环项', undefined, itemChildren)];

  if (variableNames.indexName !== variableNames.itemName) {
    variables.push(createVariable(formatLocalVariableRoot(variableNames.indexName), '循环索引'));
  }

  return variables;
}

/**
 * 创建变量分组。
 * @param options - 变量选项
 * @returns 变量分组
 */
function createVariableGroup(options: Variable[]): VariableOptionGroup {
  return {
    type: 'variable',
    options
  };
}

/**
 * 读取 Widget JS 脚本代码。
 * @param widgetData - Widget 数据
 * @returns JS 脚本代码
 */
function readWidgetMethodScriptCode(widgetData: WidgetData | undefined): string {
  if (!widgetData) {
    return '';
  }

  return readWidgetExecuteMethod(widgetData.execute).code;
}

/**
 * 创建元素 Setter 可插入变量候选。
 * @param readElement - Widget 元素读取函数
 * @returns 变量候选响应式对象
 */
export function useElementVariables(readElement?: ElementTargetReader): UseElementVariablesReturn {
  const widgetContext = useWidgetContext();
  const currentWidgetData = computed<WidgetData | undefined>((): WidgetData | undefined => widgetContext.widgetData.value);
  const currentDataSchema = computed<WidgetSchemaObject>(
    (): WidgetSchemaObject => buildWidgetDataSchema(readWidgetMethodScriptCode(currentWidgetData.value), currentWidgetData.value?.inputSchema)
  );
  const variableOptions = computed<VariableOptionGroup[]>((): VariableOptionGroup[] => {
    const widgetData = currentWidgetData.value;
    const loopVariables = createLoopVariables(widgetData, currentDataSchema.value, readElement?.());
    const inputVariable = createVariable(
      WIDGET_INPUT_VARIABLE_ROOT_NAME,
      WIDGET_INPUT_VARIABLE_LABEL,
      undefined,
      collectSchemaVariableChildren('input', widgetData?.inputSchema.properties)
    );
    const outputVariable = createVariable(WIDGET_OUTPUT_VARIABLE_ROOT_NAME, WIDGET_OUTPUT_VARIABLE_LABEL);
    const dataVariables = collectSchemaVariableChildren('data', currentDataSchema.value.properties);

    return [createVariableGroup([...loopVariables, inputVariable, outputVariable, ...dataVariables])];
  });
  const loopSourceOptions = computed<WidgetLoopDataSourceOption[]>((): WidgetLoopDataSourceOption[] => {
    if (!currentWidgetData.value) {
      return [];
    }

    return collectWidgetLoopDataSourceOptions(currentWidgetData.value.inputSchema, currentDataSchema.value);
  });

  return {
    loopSourceOptions,
    variableOptions
  };
}
