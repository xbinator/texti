/**
 * @file board-transforms.test.ts
 * @description 验证 BWidget 手动Widget element transform 与历史记录。
 */
import { describe, expect, it } from 'vitest';
import { createVariableValue } from '@/components/BSmart/utils/value';
import type { WidgetBoardState, WidgetElement, WidgetShapeElement } from '@/components/BWidget/types';
import {
  addWidgetShape,
  copyWidgetSelection,
  createWidgetBoardState,
  createWidgetDataSnapshot,
  groupWidgetSelection,
  moveWidgetElements,
  pasteWidgetElements,
  redoWidgetBoard,
  replaceWidgetElements,
  reorderWidgetElement,
  reorderWidgetSelection,
  resizeWidgetElements,
  ungroupWidgetSelection,
  undoWidgetBoard,
  updateWidgetElementStyle,
  updateWidgetElementTitle
} from '@/components/BWidget/utils/boardTransforms';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/**
 * 带可选子元素字段的测试元素。
 */
type WidgetElementWithChildren = WidgetShapeElement & {
  /** 子元素列表 */
  children?: WidgetElement[];
};

/**
 * 创建测试形状元素。
 * @param id - 元素 ID
 * @returns 测试形状元素
 */
function createShapeElement(id: string): WidgetShapeElement {
  return {
    id,
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title: '矩形',
    position: { x: 100, y: 120 },
    size: { width: 180, height: 72 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建测试组合元素。
 * @param id - 组合 ID
 * @param children - 子元素列表
 * @returns 测试组合元素
 */
function createGroupElement(id: string, children: WidgetElement[]): WidgetElementWithChildren {
  return {
    ...createShapeElement(id),
    name: 'group',
    label: '组合',
    icon: 'lucide:group',
    title: '组合',
    children
  };
}

/**
 * 创建测试文本元素。
 * @param id - 元素 ID
 * @param content - 文本正文
 * @returns 测试文本元素
 */
function createTextElement(id: string, content = 'abcdef'): WidgetShapeElement {
  return {
    id,
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '文本',
    position: { x: 100, y: 120 },
    size: { width: 180, height: 72 },
    rotation: 0,
    style: { fontSize: 10 },
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: { content }
  };
}

/**
 * 断言元素为形状元素。
 * @param element - 待检查元素
 * @returns 形状元素
 */
function expectShapeElement(element: WidgetElement | undefined): WidgetShapeElement {
  expect(element).toBeDefined();
  return element as WidgetShapeElement;
}

/**
 * 读取组合子元素 ID 顺序。
 * @param element - 组合元素
 * @returns 子元素 ID 列表
 */
function getChildIds(element: WidgetElement | undefined): string[] {
  return element?.children?.map((child: WidgetElement): string => child.id) ?? [];
}

describe('boardTransforms', (): void => {
  it('replaces external elements as one undoable history entry', (): void => {
    const initial = createWidgetBoardState({
      elements: [createShapeElement('node-1')],
      selection: ['node-1']
    });
    const nextElement = createShapeElement('node-1');
    nextElement.title = '属性面板更新';

    const updated = replaceWidgetElements(initial, [nextElement]);
    const undone = undoWidgetBoard(updated);
    const redone = redoWidgetBoard(undone);

    expect(updated.elements[0]?.title).toBe('属性面板更新');
    expect(updated.history.past).toHaveLength(1);
    expect(undone.elements[0]?.title).toBe('矩形');
    expect(redone.elements[0]?.title).toBe('属性面板更新');
  });

  it('ignores an external element tree without content changes', (): void => {
    const initial = createWidgetBoardState({ elements: [createShapeElement('node-1')] });
    const updated = replaceWidgetElements(initial, [createShapeElement('node-1')]);

    expect(updated).toBe(initial);
    expect(updated.history.past).toHaveLength(0);
  });

  it('supports undo and redo after adding a shape', (): void => {
    const added = addWidgetShape(createWidgetBoardState(), {
      id: 'shape-1',
      name: 'rect',
      label: '矩形',
      icon: 'lucide:square',
      start: { x: 40, y: 60 },
      end: { x: 160, y: 120 }
    });
    const undone = undoWidgetBoard(added);
    const redone = redoWidgetBoard(undone);

    expect(undone.elements).toHaveLength(0);
    expect(undone.history.future).toHaveLength(1);
    expect(redone.elements).toHaveLength(1);
    expect(redone.history.future).toHaveLength(0);
  });

  it('normalizes group children recursively', (): void => {
    const initial = createWidgetBoardState({
      elements: [createGroupElement('group-1', [createGroupElement('group-2', [createShapeElement('child-1')])])]
    });
    const rootGroup = initial.elements[0] as WidgetElementWithChildren | undefined;
    const nestedGroup = rootGroup?.children?.[0] as WidgetElementWithChildren | undefined;

    expect(rootGroup?.name).toBe('group');
    expect(nestedGroup?.name).toBe('group');
    expect(nestedGroup?.children?.[0]?.id).toBe('child-1');
  });

  it('removes children from non-group elements during normalization', (): void => {
    const initial = createWidgetBoardState({
      elements: [
        {
          ...createShapeElement('node-1'),
          children: [createShapeElement('child-1')]
        } as WidgetElementWithChildren
      ]
    });
    const element = initial.elements[0] as WidgetElementWithChildren | undefined;

    expect(element?.name).toBe('rect');
    expect(element?.children).toBeUndefined();
  });

  it('drops snapshots that miss the current top-level loop model', (): void => {
    const invalidElement: Partial<WidgetShapeElement> = { ...createShapeElement('node-1') };
    delete invalidElement.loop;
    const initial = createWidgetBoardState({
      elements: [invalidElement as WidgetShapeElement]
    });

    expect(initial.elements).toHaveLength(0);
  });

  it('accepts structured loop sources and rejects historical primitive sources', (): void => {
    const structuredElement = createShapeElement('structured-node');
    structuredElement.loop.source = createVariableValue('$input.items');
    const structuredState = createWidgetBoardState({ elements: [structuredElement] });
    const legacyElement = {
      ...createShapeElement('legacy-node'),
      loop: {
        ...createDefaultWidgetElementLoopConfig(),
        source: '$input.items'
      }
    } as unknown as WidgetShapeElement;
    const legacyState = createWidgetBoardState({ elements: [legacyElement] });

    expect(structuredState.elements[0]?.loop.source).toEqual(createVariableValue('$input.items'));
    expect(legacyState.elements).toHaveLength(0);
  });

  it('normalizes widget data contract fields in lightweight snapshots', (): void => {
    const partialSnapshot = {
      metadata: {},
      elements: [createShapeElement('node-1')]
    };

    const snapshot = createWidgetDataSnapshot(partialSnapshot);

    expect(snapshot.name).toBe('');
    expect(snapshot.description).toBe('');
    expect(snapshot.inputSchema).toEqual({
      type: 'object',
      properties: {},
      required: []
    });
    expect(snapshot.outputSchema).toEqual({
      type: 'object',
      properties: {},
      required: []
    });
    expect(snapshot.dataSchema).toEqual({
      type: 'object',
      properties: {},
      required: []
    });
    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot).not.toHaveProperty('viewport');
  });

  it('updates element title through a manual board command', (): void => {
    const initial = createWidgetBoardState({ elements: [createShapeElement('node-1')] });
    const updated = updateWidgetElementTitle(initial, 'node-1', '审批节点');

    expect(expectShapeElement(updated.elements[0]).title).toBe('审批节点');
    expect(updated.history.past).toHaveLength(1);
  });

  it('updates nested element title through a manual board command', (): void => {
    const initial = createWidgetBoardState({
      elements: [createGroupElement('group-1', [createShapeElement('child-1')])]
    });
    const updated = updateWidgetElementTitle(initial, 'child-1', '子节点');
    const group = updated.elements[0] as WidgetElementWithChildren | undefined;

    expect(group?.children?.[0]?.title).toBe('子节点');
    expect(updated.history.past).toHaveLength(1);
  });

  it('updates element style as one undoable history entry', (): void => {
    const initial = createWidgetBoardState({ elements: [createShapeElement('node-1')] });
    const updated = updateWidgetElementStyle(initial, 'node-1', {
      backgroundColor: '#f97316',
      borderWidth: 3
    });

    expect(expectShapeElement(updated.elements[0]).style).toEqual({
      backgroundColor: '#f97316',
      borderWidth: 3
    });
    expect(updated.history.past).toHaveLength(1);
  });

  it('updates nested element style as one undoable history entry', (): void => {
    const initial = createWidgetBoardState({
      elements: [createGroupElement('group-1', [createShapeElement('child-1')])]
    });
    const updated = updateWidgetElementStyle(initial, 'child-1', {
      backgroundColor: '#f97316',
      borderWidth: 3
    });
    const group = updated.elements[0] as WidgetElementWithChildren | undefined;

    expect(group?.children?.[0]?.style).toEqual({
      backgroundColor: '#f97316',
      borderWidth: 3
    });
    expect(updated.history.past).toHaveLength(1);
  });

  it('keeps board unchanged when updating style for an unknown element', (): void => {
    const initial = createWidgetBoardState({ elements: [createShapeElement('node-1')] });
    const updated = updateWidgetElementStyle(initial, 'missing-node', {
      backgroundColor: '#f97316'
    });

    expect(updated.elements).toEqual(initial.elements);
    expect(updated.lastError?.message).toContain('找不到元素');
    expect(updated.history.past).toHaveLength(0);
  });

  it('adds a custom sized shape from any drag direction', (): void => {
    const initial = createWidgetBoardState();
    const added = addWidgetShape(initial, {
      id: 'shape-1',
      name: 'rect',
      label: '矩形',
      icon: 'lucide:square',
      start: { x: 260, y: 220 },
      end: { x: 100, y: 120 }
    });

    expect(added.elements[0]).toMatchObject({
      id: 'shape-1',
      name: 'rect',
      label: '矩形',
      icon: 'lucide:square',
      title: '矩形',
      position: { x: 100, y: 120 },
      size: { width: 160, height: 100 },
      rotation: 0,
      style: {},
      metadata: {}
    });
    expect('text' in expectShapeElement(added.elements[0])).toBe(false);
    expect(added.selection).toEqual(['shape-1']);
    expect(added.history.past).toHaveLength(1);
  });

  it('falls back to the default size when a shape drag is too small', (): void => {
    const initial = createWidgetBoardState();
    const added = addWidgetShape(initial, {
      id: 'shape-1',
      name: 'rect',
      label: '矩形',
      icon: 'lucide:square',
      start: { x: 200, y: 180 },
      end: { x: 203, y: 184 }
    });

    expect(added.elements[0]?.position).toEqual({ x: 111.5, y: 146 });
    expect(added.elements[0]?.size).toEqual({ width: 180, height: 72 });
    expect(expectShapeElement(added.elements[0]).label).toBe('矩形');
    expect(expectShapeElement(added.elements[0]).title).toBe('矩形');
    expect(added.history.past).toHaveLength(1);
  });

  it('keeps the creation start point for a top-left anchored shape', (): void => {
    const initial = createWidgetBoardState();
    const added = addWidgetShape(initial, {
      id: 'shape-1',
      name: 'text',
      label: '文本',
      icon: 'lucide:type',
      createAnchor: 'top-left',
      start: { x: 320, y: 260 },
      end: { x: 200, y: 180 }
    });

    expect(added.elements[0]?.position).toEqual({ x: 320, y: 260 });
    expect(added.elements[0]?.size).toEqual({ width: 120, height: 80 });
  });

  it('moves multiple elements as one history entry', (): void => {
    const initial = createWidgetBoardState({
      elements: [createShapeElement('node-1'), createShapeElement('node-2')]
    });
    const moved = moveWidgetElements(initial, [
      { id: 'node-1', position: { x: 140, y: 160 } },
      { id: 'node-2', position: { x: 220, y: 240 } }
    ]);

    expect(moved.elements.map((element) => element.position)).toEqual([
      { x: 140, y: 160 },
      { x: 220, y: 240 }
    ]);
    expect(moved.history.past).toHaveLength(1);
  });

  it('moves a nested child in its direct parent coordinate system', (): void => {
    const initial = createWidgetBoardState({
      elements: [createGroupElement('group-1', [createShapeElement('child-1')])]
    });
    const moved = moveWidgetElements(initial, [{ id: 'child-1', position: { x: 24, y: 30 } }]);
    const group = moved.elements[0] as WidgetElementWithChildren | undefined;

    expect(group?.position).toEqual({ x: 100, y: 120 });
    expect(group?.children?.[0]?.position).toEqual({ x: 24, y: 30 });
    expect(moved.history.past).toHaveLength(1);
  });

  it('ignores move changes for locked elements', (): void => {
    const lockedElement = {
      ...createShapeElement('node-1'),
      locked: true
    };
    const initial = createWidgetBoardState({
      elements: [lockedElement]
    });
    const moved = moveWidgetElements(initial, [{ id: 'node-1', position: { x: 240, y: 260 } }]);

    expect(moved.elements[0]?.position).toEqual({ x: 100, y: 120 });
    expect(moved.history.past).toHaveLength(0);
  });

  it('moves groups that contain locked descendants', (): void => {
    const lockedChild = {
      ...createShapeElement('child-1'),
      locked: true
    };
    const initial = createWidgetBoardState({
      elements: [createGroupElement('group-1', [lockedChild])]
    });
    const moved = moveWidgetElements(initial, [{ id: 'group-1', position: { x: 240, y: 260 } }]);

    expect(moved.elements[0]?.position).toEqual({ x: 240, y: 260 });
    expect(moved.history.past).toHaveLength(1);
  });

  it('resizes an element with the minimum size clamp', (): void => {
    const initial = createWidgetBoardState({
      elements: [createShapeElement('node-1')]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'node-1',
        position: { x: 80, y: 90 },
        size: { width: 4, height: 12 }
      }
    ]);

    expect(resized.elements[0]?.position).toEqual({ x: 80, y: 90 });
    expect(resized.elements[0]?.size).toEqual({ width: 16, height: 16 });
    expect(resized.history.past).toHaveLength(1);
  });

  it('ignores resize changes for locked elements', (): void => {
    const lockedElement = {
      ...createShapeElement('node-1'),
      locked: true
    };
    const initial = createWidgetBoardState({
      elements: [lockedElement]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'node-1',
        position: { x: 80, y: 90 },
        size: { width: 240, height: 120 }
      }
    ]);

    expect(resized.elements[0]?.position).toEqual({ x: 100, y: 120 });
    expect(resized.elements[0]?.size).toEqual({ width: 180, height: 72 });
    expect(resized.history.past).toHaveLength(0);
  });

  it('resizes group children proportionally in group-local coordinates', (): void => {
    const child = {
      ...createShapeElement('child-1'),
      position: { x: 10, y: 20 },
      size: { width: 50, height: 40 }
    };
    const initial = createWidgetBoardState({
      elements: [
        {
          ...createGroupElement('group-1', [child]),
          position: { x: 100, y: 120 },
          size: { width: 100, height: 80 }
        }
      ]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'group-1',
        position: { x: 90, y: 100 },
        size: { width: 200, height: 160 }
      }
    ]);
    const group = resized.elements[0] as WidgetElementWithChildren | undefined;

    expect(group?.position).toEqual({ x: 90, y: 100 });
    expect(group?.size).toEqual({ width: 200, height: 160 });
    expect(group?.children?.[0]?.position).toEqual({ x: 20, y: 40 });
    expect(group?.children?.[0]?.size).toEqual({ width: 100, height: 80 });
  });

  it('resizes locked descendants when resizing their parent group', (): void => {
    const lockedChild = {
      ...createShapeElement('child-1'),
      locked: true,
      position: { x: 10, y: 20 },
      size: { width: 50, height: 40 }
    };
    const initial = createWidgetBoardState({
      elements: [
        {
          ...createGroupElement('group-1', [lockedChild]),
          position: { x: 100, y: 120 },
          size: { width: 100, height: 80 }
        }
      ]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'group-1',
        position: { x: 90, y: 100 },
        size: { width: 200, height: 160 }
      }
    ]);
    const group = resized.elements[0] as WidgetElementWithChildren | undefined;

    expect(group?.position).toEqual({ x: 90, y: 100 });
    expect(group?.children?.[0]?.position).toEqual({ x: 20, y: 40 });
    expect(group?.children?.[0]?.size).toEqual({ width: 100, height: 80 });
    expect(group?.children?.[0]?.locked).toBe(true);
  });

  it('resizes nested group descendants proportionally when resizing a parent group', (): void => {
    const nestedChild = {
      ...createShapeElement('nested-child-1'),
      position: { x: 5, y: 6 },
      size: { width: 20, height: 18 }
    };
    const nestedGroup = {
      ...createGroupElement('nested-group-1', [nestedChild]),
      position: { x: 10, y: 20 },
      size: { width: 50, height: 40 }
    };
    const initial = createWidgetBoardState({
      elements: [
        {
          ...createGroupElement('group-1', [nestedGroup]),
          position: { x: 100, y: 120 },
          size: { width: 100, height: 80 }
        }
      ]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'group-1',
        size: { width: 200, height: 160 }
      }
    ]);
    const group = resized.elements[0] as WidgetElementWithChildren | undefined;
    const resizedNestedGroup = group?.children?.[0] as WidgetElementWithChildren | undefined;

    expect(resizedNestedGroup?.position).toEqual({ x: 20, y: 40 });
    expect(resizedNestedGroup?.size).toEqual({ width: 100, height: 80 });
    expect(resizedNestedGroup?.children?.[0]?.position).toEqual({ x: 10, y: 12 });
    expect(resizedNestedGroup?.children?.[0]?.size).toEqual({ width: 40, height: 36 });
  });

  it('resizes a text element width and height while content wraps by width', (): void => {
    const initial = createWidgetBoardState({
      elements: [createTextElement('text-1')]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'text-1',
        position: { x: 80, y: 90 },
        size: { width: 30, height: 400 }
      }
    ]);

    expect(resized.elements[0]?.position).toEqual({ x: 80, y: 90 });
    expect(resized.elements[0]?.size).toEqual({ width: 30, height: 400 });
    expect(resized.history.past).toHaveLength(1);
  });

  it('keeps text resize height at least as tall as wrapped content', (): void => {
    const initial = createWidgetBoardState({
      elements: [createTextElement('text-1')]
    });
    const resized = resizeWidgetElements(initial, [
      {
        id: 'text-1',
        position: { x: 80, y: 90 },
        size: { width: 30, height: 12 }
      }
    ]);

    expect(resized.elements[0]?.size).toEqual({ width: 30, height: 31 });
  });

  it('preserves text model height when creating board state', (): void => {
    const initial = createWidgetBoardState({
      elements: [createTextElement('text-1')]
    });

    expect(initial.elements[0]?.size).toEqual({ width: 180, height: 72 });
  });

  it('normalizes text model height up to wrapped content height when loading', (): void => {
    const initial = createWidgetBoardState({
      elements: [
        {
          ...createTextElement('text-1'),
          size: { width: 30, height: 12 }
        }
      ]
    });

    expect(initial.elements[0]?.size).toEqual({ width: 30, height: 31 });
  });

  describe('reorderWidgetElement', (): void => {
    /** 创建包含 3 个元素的初始状态：node-1(底) → node-2(中) → node-3(顶) */
    function createThreeElementState(): WidgetBoardState {
      return createWidgetBoardState({
        elements: [createShapeElement('node-1'), createShapeElement('node-2'), createShapeElement('node-3')]
      });
    }

    it('brings an element to front (bringToFront)', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-1', 'bringToFront');

      // node-1 从索引 0 移到末尾
      expect(reordered.elements.map((element) => element.id)).toEqual(['node-2', 'node-3', 'node-1']);
      expect(reordered.history.past).toHaveLength(1);
    });

    it('brings an element forward by one layer (bringForward)', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-1', 'bringForward');

      // node-1 从索引 0 上移到索引 1
      expect(reordered.elements.map((element) => element.id)).toEqual(['node-2', 'node-1', 'node-3']);
      expect(reordered.history.past).toHaveLength(1);
    });

    it('sends an element backward by one layer (sendBackward)', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-3', 'sendBackward');

      // node-3 从索引 2 下移到索引 1
      expect(reordered.elements.map((element) => element.id)).toEqual(['node-1', 'node-3', 'node-2']);
      expect(reordered.history.past).toHaveLength(1);
    });

    it('sends an element to back (sendToBack)', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-3', 'sendToBack');

      // node-3 从索引 2 移到开头
      expect(reordered.elements.map((element) => element.id)).toEqual(['node-3', 'node-1', 'node-2']);
      expect(reordered.history.past).toHaveLength(1);
    });

    it('does not change order when bringing the top element forward', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-3', 'bringForward');

      // node-3 已在最顶层，上移无效
      expect(reordered.elements.map((element) => element.id)).toEqual(['node-1', 'node-2', 'node-3']);
      expect(reordered.history.past).toHaveLength(1);
    });

    it('does not change order when sending the bottom element backward', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-1', 'sendBackward');

      // node-1 已在最底层，下移无效
      expect(reordered.elements.map((element) => element.id)).toEqual(['node-1', 'node-2', 'node-3']);
      expect(reordered.history.past).toHaveLength(1);
    });

    it('keeps board unchanged when reordering a missing element', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'missing-node', 'bringToFront');

      expect(reordered.elements.map((element) => element.id)).toEqual(['node-1', 'node-2', 'node-3']);
      expect(reordered.lastError?.message).toContain('找不到元素');
      expect(reordered.history.past).toHaveLength(0);
    });

    it('supports undo and redo after reordering', (): void => {
      const state = createThreeElementState();
      const reordered = reorderWidgetElement(state, 'node-1', 'bringToFront');
      const undone = undoWidgetBoard(reordered);
      const redone = redoWidgetBoard(undone);

      expect(undone.elements.map((element) => element.id)).toEqual(['node-1', 'node-2', 'node-3']);
      expect(redone.elements.map((element) => element.id)).toEqual(['node-2', 'node-3', 'node-1']);
    });

    it('reorders a nested element inside its direct parent', (): void => {
      const state = createWidgetBoardState({
        elements: [createGroupElement('group-1', [createShapeElement('child-1'), createShapeElement('child-2'), createShapeElement('child-3')])]
      });
      const reordered = reorderWidgetElement(state, 'child-1', 'bringToFront');

      expect(getChildIds(reordered.elements[0])).toEqual(['child-2', 'child-3', 'child-1']);
      expect(reordered.elements.map((element: WidgetShapeElement): string => element.id)).toEqual(['group-1']);
    });
  });

  describe('selection commands', (): void => {
    /** 创建包含 4 个元素的初始状态：node-1(底) → node-4(顶) */
    function createFourElementState(selection: string[] = []): WidgetBoardState {
      return createWidgetBoardState({
        elements: [createShapeElement('node-1'), createShapeElement('node-2'), createShapeElement('node-3'), createShapeElement('node-4')],
        selection
      });
    }

    it('copies selected elements in layer order without mutating the source state', (): void => {
      const state = createFourElementState(['node-3', 'node-1']);
      const copied = copyWidgetSelection(state);

      expect(copied.map((element) => element.id)).toEqual(['node-1', 'node-3']);
      copied[0].position.x = 999;
      expect(state.elements[0]?.position.x).toBe(100);
    });

    it('pastes copied group subtrees at the requested board point with fresh ids', (): void => {
      const groupedElement = createGroupElement('group-1', [
        {
          ...createShapeElement('node-1'),
          position: { x: 10, y: 20 }
        },
        {
          ...createShapeElement('node-2'),
          position: { x: 50, y: 70 }
        }
      ]);
      const state = createWidgetBoardState({
        elements: [groupedElement],
        selection: ['group-1']
      });
      const copied = copyWidgetSelection(state);
      const pasted = pasteWidgetElements(state, copied, {
        anchorPoint: { x: 200, y: 300 },
        createElementId: (_element: WidgetShapeElement, index: number): string => `copy-${index + 1}`
      });
      const pastedGroup = pasted.elements[1] as WidgetElementWithChildren | undefined;

      expect(pasted.elements.map((element) => element.id)).toEqual(['group-1', 'copy-1']);
      expect(pastedGroup?.position).toEqual({ x: 200, y: 300 });
      expect(pastedGroup?.children?.map((element: WidgetElement): string => element.id)).toEqual(['copy-2', 'copy-3']);
      expect(pastedGroup?.children?.[0]?.position).toEqual({ x: 10, y: 20 });
      expect(pasted.selection).toEqual(['copy-1']);
      expect(pasted.history.past).toHaveLength(1);
    });

    it('pastes copied elements into the requested parent in parent-local coordinates', (): void => {
      const state = createWidgetBoardState({
        elements: [
          {
            ...createGroupElement('group-1', [
              {
                ...createShapeElement('child-1'),
                position: { x: 10, y: 20 }
              }
            ]),
            position: { x: 100, y: 80 }
          }
        ],
        selection: ['child-1']
      });
      const copied = copyWidgetSelection(state);
      const pasted = pasteWidgetElements(state, copied, {
        anchorPoint: { x: 150, y: 130 },
        parentId: 'group-1',
        createElementId: (_element: WidgetShapeElement, index: number): string => `copy-${index + 1}`
      });
      const group = pasted.elements[0] as WidgetElementWithChildren | undefined;

      expect(group?.children?.map((element: WidgetElement): string => element.id)).toEqual(['child-1', 'copy-1']);
      expect(group?.children?.[1]?.position).toEqual({ x: 50, y: 50 });
      expect(pasted.elements).toHaveLength(1);
      expect(pasted.selection).toEqual(['copy-1']);
    });

    it('groups and ungroups the selected elements as a real group node', (): void => {
      const grouped = groupWidgetSelection(createFourElementState(['node-1', 'node-2']), 'widget-group-1');
      const ungrouped = ungroupWidgetSelection({
        ...grouped,
        selection: ['widget-group-1']
      });
      const group = grouped.elements[0] as WidgetElementWithChildren | undefined;

      expect(group?.name).toBe('group');
      expect(group?.title).toBe('组合1');
      expect(group?.position).toEqual({ x: 100, y: 120 });
      expect(group?.children?.map((element: WidgetElement): string => element.id)).toEqual(['node-1', 'node-2']);
      expect(group?.children?.[0]?.position).toEqual({ x: 0, y: 0 });
      expect(ungrouped.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-1', 'node-2', 'node-3', 'node-4']);
      expect(ungrouped.elements[0]?.position).toEqual({ x: 100, y: 120 });
    });

    it('uses the next available group title index when grouping a selection', (): void => {
      const existingGroup = {
        ...createGroupElement('group-1', [createShapeElement('child-1')]),
        title: '组合1'
      };
      const state = createWidgetBoardState({
        elements: [existingGroup, createShapeElement('node-1'), createShapeElement('node-2')],
        selection: ['node-1', 'node-2']
      });
      const grouped = groupWidgetSelection(state, 'group-2');

      expect(grouped.elements[1]?.title).toBe('组合2');
    });

    it('reorders a multi-selection while preserving its relative order', (): void => {
      const state = createFourElementState(['node-2', 'node-3']);
      const front = reorderWidgetSelection(state, 'bringToFront');
      const backward = reorderWidgetSelection(state, 'sendBackward');

      expect(front.elements.map((element) => element.id)).toEqual(['node-1', 'node-4', 'node-2', 'node-3']);
      expect(backward.elements.map((element) => element.id)).toEqual(['node-2', 'node-3', 'node-1', 'node-4']);
    });

    it('reorders a nested multi-selection inside its direct parent', (): void => {
      const state = createWidgetBoardState({
        elements: [createGroupElement('group-1', [createShapeElement('child-1'), createShapeElement('child-2'), createShapeElement('child-3')])],
        selection: ['child-1', 'child-2']
      });
      const reordered = reorderWidgetSelection(state, 'bringToFront');

      expect(getChildIds(reordered.elements[0])).toEqual(['child-3', 'child-1', 'child-2']);
      expect(reordered.elements.map((element: WidgetShapeElement): string => element.id)).toEqual(['group-1']);
    });

    it('rejects multi-selection reordering across different parents', (): void => {
      const state = createWidgetBoardState({
        elements: [createGroupElement('group-1', [createShapeElement('child-1')]), createShapeElement('node-1')],
        selection: ['child-1', 'node-1']
      });
      const reordered = reorderWidgetSelection(state, 'bringToFront');

      expect(reordered.elements).toEqual(state.elements);
      expect(reordered.lastError?.message).toContain('相同父级');
      expect(reordered.history.past).toHaveLength(0);
    });
  });
});
