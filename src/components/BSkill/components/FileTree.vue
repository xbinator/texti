<!--
  @file FileTree.vue
  @description BSkill 文件树子组件，支持目录折叠/展开，默认全部展开。
-->
<template>
  <div :class="bem('file-tree')" aria-label="Skill 文件树">
    <div v-if="loading" :class="bem('file-tree-empty')">正在加载文件…</div>
    <div v-else-if="error" :class="bem('file-tree-error')">{{ error }}</div>
    <div v-else-if="nodes.length === 0" :class="bem('file-tree-empty')">未发现文件</div>
    <template v-else>
      <button
        v-for="node in visibleNodes"
        :key="node.path"
        :class="
          bem('file-tree-node', {
            directory: node.type === 'directory',
            active: selectedFilePath === node.path,
            collapsed: node.type === 'directory' && collapsedPaths.has(node.path)
          })
        "
        :style="{ paddingLeft: `${12 + node.depth * 14}px` }"
        @click="handleNodeClick(node)"
      >
        <Icon
          v-if="node.type === 'directory'"
          :icon="collapsedPaths.has(node.path) ? 'lucide:chevron-right' : 'lucide:chevron-down'"
          :width="12"
          :class="bem('file-tree-chevron')"
        />
        <span v-else-if="hasDirectories" :class="bem('file-tree-chevron-placeholder')"></span>
        <Icon :icon="getNodeIcon(node)" :width="14" :class="bem('file-tree-icon')" />
        <span>{{ node.name }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @file FileTree.vue
 * @description BSkill 文件树子组件，支持目录折叠/展开，默认全部展开。
 */

import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { native } from '@/shared/platform';
import type { ReadWorkspaceDirectoryEntry } from '@/shared/platform/native/types';
import { resolveFileIcon } from '@/utils/file/icons';
import { createNamespace } from '@/utils/namespace';

const [, bem] = createNamespace('skill');

/**
 * 文件树节点。
 */
interface FileTreeNode {
  /** 文件或目录名称。 */
  name: string;
  /** 文件或目录绝对路径。 */
  path: string;
  /** 节点类型。 */
  type: 'file' | 'directory';
  /** 相对根目录的展示层级。 */
  depth: number;
}

/**
 * 虚拟文件树构建节点。
 */
interface VirtualTreeNode extends FileTreeNode {
  /** 子节点映射，目录节点用于保存下级文件与目录。 */
  children: Map<string, VirtualTreeNode>;
}

interface Props {
  /** 根目录路径，为空时不加载。与 virtualPaths 互斥。 */
  rootPath?: string;
  /** 虚拟文件路径列表，传入时跳过文件系统扫描。与 rootPath 互斥。 */
  virtualPaths?: string[];
  /** 当前选中文件路径。 */
  selectedFilePath: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  /**
   * 选中文件时触发。
   * @param event - 事件名
   * @param filePath - 选中的文件路径
   */
  (event: 'select-file', filePath: string): void;
  /**
   * 文件树加载完成时触发。
   * @param event - 事件名
   * @param fileCount - 文件数量（不含目录）
   */
  (event: 'loaded', fileCount: number): void;
}>();

/** 全量扁平节点列表。 */
const nodes = ref<FileTreeNode[]>([]);
const loading = ref(false);
const error = ref('');
/** 已折叠的目录路径集合，默认为空即全部展开。 */
const collapsedPaths = ref<Set<string>>(new Set());
let requestId = 0;

/** 树中是否包含目录节点，用于决定是否显示对齐占位符。 */
const hasDirectories = computed<boolean>(() => nodes.value.some((n) => n.type === 'directory'));

/**
 * 根据折叠状态过滤出可见节点。
 * 遍历扁平列表，若某目录已折叠，则跳过其下所有子节点（depth 更深且紧随其后的节点）。
 */
const visibleNodes = computed<FileTreeNode[]>(() => {
  const result: FileTreeNode[] = [];
  /** 当前被折叠的目录深度栈，用于判断节点是否处于折叠目录内 */
  let skipDepth = -1;

  for (const node of nodes.value) {
    if (skipDepth >= 0 && node.depth > skipDepth) {
      // 当前节点处于被折叠的目录内，跳过
      continue;
    }
    // 退出折叠目录范围
    skipDepth = -1;
    result.push(node);

    // 若当前目录节点已折叠，则标记其子节点需要跳过
    if (node.type === 'directory' && collapsedPaths.value.has(node.path)) {
      skipDepth = node.depth;
    }
  }

  return result;
});

/**
 * 按目录优先、名称升序排序文件树节点。
 * @param left - 左侧文件树节点
 * @param right - 右侧文件树节点
 * @returns 排序结果
 */
function sortFileTreeNodes(left: Pick<FileTreeNode, 'name' | 'type'>, right: Pick<FileTreeNode, 'name' | 'type'>): number {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

/**
 * 创建虚拟文件树节点。
 * @param name - 节点名称
 * @param path - 节点完整相对路径
 * @param type - 节点类型
 * @param depth - 节点层级
 * @returns 虚拟文件树节点
 */
function createVirtualTreeNode(name: string, path: string, type: FileTreeNode['type'], depth: number): VirtualTreeNode {
  return {
    name,
    path,
    type,
    depth,
    children: new Map<string, VirtualTreeNode>()
  };
}

/**
 * 向虚拟树写入单个路径。
 * @param root - 虚拟树根节点
 * @param rawPath - 文件相对路径
 */
function insertVirtualPath(root: VirtualTreeNode, rawPath: string): void {
  const segments = rawPath.split('/').filter((segment: string): boolean => segment.length > 0);
  let parent = root;
  let currentPath = '';

  segments.forEach((segment: string, index: number): void => {
    const isLast = index === segments.length - 1;
    currentPath = index === 0 ? segment : `${currentPath}/${segment}`;

    if (!parent.children.has(segment)) {
      parent.children.set(segment, createVirtualTreeNode(segment, currentPath, isLast ? 'file' : 'directory', index));
    }

    parent = parent.children.get(segment)!;
  });
}

/**
 * 将虚拟树深度优先展开为文件树节点。
 * @param parent - 当前父节点
 * @returns 扁平文件树节点列表
 */
function flattenVirtualTree(parent: VirtualTreeNode): FileTreeNode[] {
  return Array.from(parent.children.values())
    .sort(sortFileTreeNodes)
    .flatMap((node: VirtualTreeNode): FileTreeNode[] => {
      const currentNode: FileTreeNode = {
        name: node.name,
        path: node.path,
        type: node.type,
        depth: node.depth
      };

      return node.type === 'directory' ? [currentNode, ...flattenVirtualTree(node)] : [currentNode];
    });
}

/**
 * 从虚拟路径列表构建文件树节点（无文件系统依赖）。
 * @param paths - 文件相对路径列表，如 ["SKILL.md", "scripts/helper.js"]
 * @returns 扁平文件树节点列表
 */
function buildVirtualTree(paths: string[]): FileTreeNode[] {
  const root = createVirtualTreeNode('', '', 'directory', -1);

  paths.forEach((rawPath: string): void => {
    insertVirtualPath(root, rawPath);
  });

  return flattenVirtualTree(root);
}

/**
 * 按目录优先、名称升序排序。
 * @param entries - 目录项列表
 * @returns 排序后的目录项
 */
function sortEntries(entries: ReadWorkspaceDirectoryEntry[]): ReadWorkspaceDirectoryEntry[] {
  return [...entries].sort(sortFileTreeNodes);
}

/**
 * 递归读取目录并生成扁平文件树节点。
 * @param directoryPath - 当前目录路径
 * @param depth - 当前目录层级
 * @returns 文件树节点列表
 */
async function collectTreeNodes(directoryPath: string, depth: number): Promise<FileTreeNode[]> {
  const { entries } = await native.readWorkspaceDirectory({ directoryPath });
  const nodeGroups = await Promise.all(
    sortEntries(entries).map(async (entry): Promise<FileTreeNode[]> => {
      const node: FileTreeNode = {
        name: entry.name,
        path: entry.path,
        type: entry.type,
        depth
      };

      if (entry.type !== 'directory') {
        return [node];
      }

      const childNodes = await collectTreeNodes(entry.path, depth + 1);
      return [node, ...childNodes];
    })
  );

  return nodeGroups.flat();
}

/**
 * 加载文件树。virtualPaths 或 rootPath 二选一。
 */
async function loadTree(): Promise<void> {
  const currentRequestId = ++requestId;
  loading.value = true;
  error.value = '';
  nodes.value = [];
  collapsedPaths.value = new Set();

  try {
    let result: FileTreeNode[];

    if (props.virtualPaths && props.virtualPaths.length > 0) {
      result = buildVirtualTree(props.virtualPaths);
    } else if (props.rootPath) {
      result = await collectTreeNodes(props.rootPath, 0);
    } else {
      result = [];
    }

    if (currentRequestId !== requestId) return;
    nodes.value = result;
    emit('loaded', result.filter((n) => n.type === 'file').length);
  } catch (err: unknown) {
    if (currentRequestId !== requestId) return;
    error.value = err instanceof Error ? err.message : '无法加载 Skill 文件树。';
  } finally {
    if (currentRequestId === requestId) {
      loading.value = false;
    }
  }
}

/**
 * 获取节点图标名：目录区分展开/折叠，文件优先按完整文件名匹配。
 * @param node - 文件树节点
 * @returns Iconify 图标名
 */
function getNodeIcon(node: FileTreeNode): string {
  if (node.type === 'directory') {
    return collapsedPaths.value.has(node.path) ? 'lucide:folder' : 'lucide:folder-open';
  }
  return resolveFileIcon(node.name);
}

/**
 * 处理节点点击：目录切换折叠，文件触发选中。
 * @param node - 当前点击的节点
 */
function handleNodeClick(node: FileTreeNode): void {
  if (node.type === 'directory') {
    const next = new Set(collapsedPaths.value);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    collapsedPaths.value = next;
    return;
  }
  emit('select-file', node.path);
}

watch(
  [() => props.rootPath, () => props.virtualPaths],
  () => {
    loadTree().catch((err: unknown) => {
      console.error('Skill tree load failed:', err);
    });
  },
  { immediate: true, deep: true }
);
</script>

<style scoped lang="less">
.b-skill__file-tree {
  min-width: 0;
  height: 100%;
  padding: 4px 6px 6px;
  overflow: auto;
  background: var(--bg-secondary);
  border-right: var(--surface-border-width) solid var(--border-tertiary);
}

.b-skill__file-tree-node {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  height: 30px;
  padding-right: 8px;
  overflow: hidden;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: var(--control-border-width) solid transparent;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard);

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover:not(.b-skill__file-tree-node--directory),
  &.b-skill__file-tree-node--active {
    background: var(--bg-tertiary);
    border-color: var(--border-hover);
  }

  &:focus-visible {
    outline: none;
    border-color: var(--color-primary-border);
  }

  &.b-skill__file-tree-node--active {
    border-color: var(--color-primary-border);
  }

  &.b-skill__file-tree-node--directory {
    font-weight: 600;

    &:hover {
      background: var(--bg-tertiary);
      border-color: var(--border-hover);
    }
  }

  & + & {
    margin-top: 2px;
  }
}

.b-skill__file-tree-icon {
  flex-shrink: 0;
}

/** 折叠箭头 */
.b-skill__file-tree-chevron {
  flex-shrink: 0;
}

/** 非目录节点的箭头占位，保持图标对齐 */
.b-skill__file-tree-chevron-placeholder {
  display: inline-block;
  flex-shrink: 0;
  width: 12px;
}

.b-skill__file-tree-empty,
.b-skill__file-tree-error {
  padding: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.b-skill__file-tree-error {
  color: var(--color-danger, #ff4d4f);
}
</style>
