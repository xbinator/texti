/**
 * @file variables.ts
 * @description BSmartEditor 变量树转换工具。
 */
import type { Variable } from '../types';

/**
 * 带树深度信息的变量项。
 */
export interface FlatVariable extends Variable {
  /** 变量在树中的深度，根节点为 0 */
  depth: number;
}

/**
 * 下拉菜单中可见的变量项。
 */
export interface VisibleVariable extends FlatVariable {
  /** 是否存在子级变量 */
  hasChildren: boolean;
  /** 子级变量是否展开 */
  expanded: boolean;
  /** 是否需要展示折叠按钮占位；当前叶子节点不再占用折叠列 */
  showTogglePlaceholder: boolean;
}

/**
 * 扁平化变量树，并保留每个节点的深度。
 * @param variables - 变量树节点列表
 * @param depth - 当前递归深度
 * @returns 带深度信息的扁平变量列表
 */
export function flattenVariables(variables: readonly Variable[], depth = 0): FlatVariable[] {
  return variables.flatMap((variable: Variable): FlatVariable[] => {
    const current: FlatVariable = {
      ...variable,
      depth
    };

    return [current, ...flattenVariables(variable.children ?? [], depth + 1)];
  });
}

/**
 * 查找指定变量路径的所有祖先节点值。
 * @param variables - 变量树节点列表
 * @param targetValue - 目标变量完整路径
 * @param ancestorValues - 当前递归层级的祖先值
 * @returns 从根节点到直接父节点的变量值，不存在时返回空数组
 */
export function findVariableAncestorValues(variables: readonly Variable[], targetValue: string, ancestorValues: readonly string[] = []): string[] {
  for (const variable of variables) {
    if (variable.value === targetValue) {
      return [...ancestorValues];
    }

    const children = variable.children ?? [];
    const matchedValues = findVariableAncestorValues(children, targetValue, [...ancestorValues, variable.value]);
    if (matchedValues.length > 0) {
      return matchedValues;
    }
  }

  return [];
}

/**
 * 判断变量是否匹配搜索词。
 * @param variable - 变量节点
 * @param query - 标准化后的搜索词
 * @returns 是否匹配搜索词
 */
function isVariableMatched(variable: Variable, query: string): boolean {
  return (
    variable.label.toLowerCase().includes(query) || variable.value.toLowerCase().includes(query) || Boolean(variable.description?.toLowerCase().includes(query))
  );
}

/**
 * 按搜索词过滤变量树，同时保留命中节点的祖先上下文。
 * @param variables - 变量树节点列表
 * @param query - 标准化后的搜索词
 * @returns 过滤后的变量树
 */
function filterVariableTree(variables: readonly Variable[], query: string): Variable[] {
  return variables.flatMap((variable: Variable): Variable[] => {
    const children = filterVariableTree(variable.children ?? [], query);

    if (!isVariableMatched(variable, query) && children.length === 0) {
      return [];
    }

    return [
      {
        ...variable,
        children
      }
    ];
  });
}

/**
 * 扁平化可见变量树，并附加折叠状态。
 * @param variables - 变量树节点列表
 * @param collapsedValues - 已折叠的变量值集合
 * @param forceExpanded - 是否强制展开子级
 * @param depth - 当前递归深度
 * @returns 可见变量列表
 */
function flattenVisibleVariables(variables: readonly Variable[], collapsedValues: ReadonlySet<string>, forceExpanded: boolean, depth = 0): VisibleVariable[] {
  return variables.flatMap((variable: Variable): VisibleVariable[] => {
    const children = variable.children ?? [];
    const hasChildren = children.length > 0;
    const expanded = hasChildren ? forceExpanded || !collapsedValues.has(variable.value) : true;
    const current: VisibleVariable = {
      ...variable,
      depth,
      hasChildren,
      expanded,
      showTogglePlaceholder: false
    };

    if (!hasChildren || !expanded) {
      return [current];
    }

    return [current, ...flattenVisibleVariables(children, collapsedValues, forceExpanded, depth + 1)];
  });
}

/**
 * 获取变量树当前应展示的可见节点。
 * @param variables - 变量树节点列表
 * @param collapsedValues - 已折叠的变量值集合
 * @param query - 触发器搜索词
 * @returns 可见变量列表
 */
export function getVisibleVariables(variables: readonly Variable[], collapsedValues: ReadonlySet<string>, query: string): VisibleVariable[] {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTree = normalizedQuery ? filterVariableTree(variables, normalizedQuery) : variables;

  return flattenVisibleVariables(visibleTree, collapsedValues, normalizedQuery.length > 0);
}
