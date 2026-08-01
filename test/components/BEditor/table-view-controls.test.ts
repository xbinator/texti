/**
 * @file table-view-controls.test.ts
 * @description BEditor Rich 模式表格控制区结构回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 读取 TableView 组件源码。
 * @returns TableView.vue 文件内容
 */
function readTableViewSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/BEditor/components/TableView.vue'), 'utf8');
}

/**
 * 从 Vue 组件源码中提取指定样式规则内容。
 * @param source - Vue 组件源码
 * @param selector - 需要匹配的 CSS 选择器
 * @returns 样式规则内容；未命中时返回空字符串
 */
function extractStyleRuleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`).exec(source);
  return rule?.groups?.body ?? '';
}

describe('BEditor TableView controls', (): void => {
  it('removes the hover divider add-button interaction from the table node view', (): void => {
    const source = readTableViewSource();

    expect(source).not.toContain('showAddRowButton');
    expect(source).not.toContain('showAddColumnButton');
    expect(source).not.toContain('add-button');
    expect(source).not.toContain('handleAdd(');
    expect(source).not.toContain('findHoveredDividers');
  });

  it('shows focus-gated row and column control rails that can select deletion targets', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('showControlOverlay');
    expect(source).toContain("bem('control-overlay')");
    expect(source).toContain("bem('column-control')");
    expect(source).toContain("bem('row-control')");
    expect(source).toContain('handleColumnControlClick');
    expect(source).toContain('handleRowControlClick');
    expect(source).toContain('selectedSegment');
  });

  it('renders thin non-draggable rails with rounded ends only', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('CONTROL_SIZE: 14');
    expect(source).toContain('is-first');
    expect(source).toContain('is-last');
    expect(source).not.toContain('mdi:drag');
    expect(source).not.toContain("bem('control-icon')");
  });

  it('places persistent insert dots on every divider and one segment toolbar outside the selected rail', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('applyAddAction');
    expect(source).toContain('hoveredInsert');
    expect(source).toContain('insertPoints');
    expect(source).toContain('createInsertPoints');
    expect(source).toContain('handleInsertPointEnter');
    expect(source).toContain("bem('segment-toolbar'");
    expect(source).toContain("bem('insert-point'");
    expect(source).not.toContain("bem('insert-button-group'");
  });

  it('renders one selected segment toolbar with format actions and a single delete action', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('SEGMENT_FORMAT_BUTTONS');
    expect(source).toContain("command: 'bold'");
    expect(source).toContain("command: 'italic'");
    expect(source).toContain("command: 'strike'");
    expect(source).toContain('handleSegmentFormat');
    expect(source).toContain('handleSelectedSegmentRemove');
    expect(source).toContain('selectedSegmentToolbarStyle');
    expect(source).not.toContain('showRowActionGroup');
    expect(source).not.toContain('showColumnActionGroup');
    expect(source).not.toContain("bem('remove-button', 'row')");
    expect(source).not.toContain("bem('remove-button', 'column')");
  });

  it('shows alignment actions only when the selected segment is a column', (): void => {
    const source = readTableViewSource();
    const alignSection = /function handleColumnAlign[\s\S]*?function handleSegmentFormat/.exec(source)?.[0] ?? '';

    expect(source).toContain('SEGMENT_COLUMN_ALIGN_BUTTONS');
    expect(source).toContain("alignment: 'left'");
    expect(source).toContain("alignment: 'center'");
    expect(source).toContain("alignment: 'right'");
    expect(source).toContain('showColumnAlignButtons');
    expect(source).toContain("selectedSegment.value?.type === 'column'");
    expect(alignSection).toContain('restoreSelectedSegmentSelection()');
    expect(alignSection).toContain("setCellAttribute('align', alignment)");
  });

  it('restores the selected row or column before formatting the selected segment', (): void => {
    const source = readTableViewSource();
    const formatSection = /function handleSegmentFormat[\s\S]*?function handleSelectedSegmentRemove/.exec(source)?.[0] ?? '';

    expect(source).toContain('function restoreSelectedSegmentSelection(): boolean');
    expect(formatSection).toContain('restoreSelectedSegmentSelection()');
    expect(formatSection).toContain('toggleBold()');
    expect(formatSection).toContain('toggleItalic()');
    expect(formatSection).toContain('toggleStrike()');
  });

  it('refreshes table geometry after insert commands render the updated table', (): void => {
    const source = readTableViewSource();
    const insertSection = /function handleInsert[\s\S]*?\/\/ ─── 样式计算/.exec(source)?.[0] ?? '';

    expect(source).toContain('nextTick');
    expect(source).toContain('function scheduleTableGeometryRefresh(): void');
    expect(insertSection).toContain('if (hit && applyAddAction(editorContext, hit))');
    expect(insertSection).toContain('scheduleTableGeometryRefresh();');
  });

  it('refreshes table geometry after remove commands render the updated table', (): void => {
    const source = readTableViewSource();
    const removeSection = /function handleRemove[\s\S]*?function handleInsert/.exec(source)?.[0] ?? '';

    expect(removeSection).toContain('if (hit && applyRemoveAction(editorContext, hit))');
    expect(removeSection).toContain('scheduleTableGeometryRefresh();');
  });

  it('uses text selection for command target cells to avoid single-cell selected state', (): void => {
    const source = readTableViewSource();
    const focusCellBody = /function focusCellAt[\s\S]*?\n\}/.exec(source)?.[0] ?? '';

    expect(source).toContain('TextSelection');
    expect(focusCellBody).toContain('TextSelection.near');
    expect(focusCellBody).not.toContain('CellSelection.create');
  });

  it('derives column insert points from full-table logical column boundaries', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('readCellGeometryRows');
    expect(source).toContain('createLogicalColumnRects');
    expect(source).toContain('getCellColSpan');
    expect(source).toContain('getCellRowSpan');
    expect(source).toContain('cell.colSpan');
    expect(source).toContain('cell.rowSpan');
  });

  it('keeps selected row and column controls index-based instead of storing stale rectangles', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('SelectedTableSegment');
    expect(source).toContain('selectedSegmentHover');
    expect(source).toContain('createSelectedSegmentHover');
    expect(source).toContain('isCellSelectionMatchingSelectedSegment');
    expect(source).toContain("selectedSegment.value = { type: 'column', index }");
    expect(source).toContain("selectedSegment.value = { type: 'row', index }");
    expect(source).not.toContain('selectedSegment.value = { row:');
  });

  it('selects rows and columns from control rails without forcing scroll into view', (): void => {
    const source = readTableViewSource();
    const selectColumnBody = /function selectColumnAt[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    const selectRowBody = /function selectRowAt[\s\S]*?\n\}/.exec(source)?.[0] ?? '';

    expect(selectColumnBody).not.toContain('scrollIntoView');
    expect(selectRowBody).not.toContain('scrollIntoView');
  });

  it('keeps action buttons away from the table edge and renders insert guides plus the corner seam', (): void => {
    const source = readTableViewSource();

    expect(source).toContain('ACTION_OFFSET: 8');
    expect(source).toContain("bem('corner-control')");
    expect(source).toContain('cornerControlStyle');
    expect(source).toContain("bem('insert-guide'");
    expect(source).toContain('insertGuideStyle');
  });

  it('keeps the first row and column control segments square beside the corner seam', (): void => {
    const source = readTableViewSource();
    const firstColumnControlRule = /\.b-markdown-table__column-control\.is-first\s*\{[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    const firstRowControlRule = /\.b-markdown-table__row-control\.is-first\s*\{[\s\S]*?\n\}/.exec(source)?.[0] ?? '';

    expect(firstColumnControlRule).not.toContain('border-top-left-radius');
    expect(firstRowControlRule).not.toContain('border-top-left-radius');
  });

  it('renders borderless themed control rails beside the table', (): void => {
    const source = readTableViewSource();
    const controlRuleBody = extractStyleRuleBody(source, '.b-markdown-table__column-control,\n.b-markdown-table__row-control');
    const cornerRuleBody = extractStyleRuleBody(source, '.b-markdown-table__corner-control');

    expect(controlRuleBody).toContain('box-sizing: border-box;');
    expect(cornerRuleBody).toContain('box-sizing: border-box;');
    expect(controlRuleBody).toContain('background: color-mix(in srgb, var(--bg-secondary)');
    expect(cornerRuleBody).toContain('background: color-mix(in srgb, var(--bg-secondary)');
    expect(controlRuleBody).toContain('border: none;');
    expect(cornerRuleBody).toContain('border: none;');
    expect(source).not.toContain('border-left-width: 0;');
    expect(source).not.toContain('border-right-width: 0;');
    expect(source).not.toContain('border-top-width: 0;');
    expect(source).not.toContain('border-bottom-width: 0;');
  });

  it('expands insert dots into primary add buttons on hover', (): void => {
    const source = readTableViewSource();
    const pointRuleBody = extractStyleRuleBody(source, '.b-markdown-table__insert-point');
    const iconRuleBody = extractStyleRuleBody(source, '.b-markdown-table__insert-point .b-markdown-table__button-icon');
    const hoverRuleBody = extractStyleRuleBody(source, '.b-markdown-table__insert-point:hover,\n.b-markdown-table__insert-point.is-active');

    expect(pointRuleBody).toContain('background: transparent;');
    expect(pointRuleBody).toContain('background-image: radial-gradient(');
    expect(pointRuleBody).toContain('border: none;');
    expect(pointRuleBody).toContain('transform: translate(-50%, -50%);');
    expect(pointRuleBody).toContain('transition:');
    expect(iconRuleBody).toContain('opacity: 0;');
    expect(hoverRuleBody).toContain('background: var(--color-primary);');
    expect(hoverRuleBody).toContain('background-image: none;');
    expect(hoverRuleBody).toContain('box-shadow:');
    expect(source).not.toContain('.b-markdown-table__insert-point::before');
  });

  it('renders selected segment toolbar actions like the selection toolbar', (): void => {
    const source = readTableViewSource();
    const toolbarRuleBody = extractStyleRuleBody(source, '.b-markdown-table__segment-toolbar');
    const toolbarButtonRuleBody = extractStyleRuleBody(source, '.b-markdown-table__segment-toolbar-button');
    const dividerRuleBody = extractStyleRuleBody(source, '.b-markdown-table__segment-toolbar-divider');

    expect(source).not.toContain('viewportRef');
    expect(toolbarRuleBody).toContain('gap: 2px;');
    expect(toolbarRuleBody).toContain('padding: 4px;');
    expect(toolbarRuleBody).toContain('background: var(--bg-primary);');
    expect(toolbarRuleBody).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(toolbarRuleBody).toContain('border-radius: var(--overlay-radius);');
    expect(toolbarRuleBody).toContain('box-shadow: var(--shadow-lg);');
    expect(toolbarButtonRuleBody).toContain('width: 28px;');
    expect(toolbarButtonRuleBody).toContain('height: 28px;');
    expect(toolbarButtonRuleBody).toContain('font-size: 14px;');
    expect(toolbarButtonRuleBody).toContain('color: var(--text-secondary);');
    expect(toolbarButtonRuleBody).toContain('background: transparent;');
    expect(toolbarButtonRuleBody).toContain('border: none;');
    expect(toolbarButtonRuleBody).toContain('border-radius: var(--control-radius);');
    expect(toolbarButtonRuleBody).toContain('background: var(--bg-hover);');
    expect(dividerRuleBody).toContain('width: 1px;');
    expect(dividerRuleBody).toContain('height: 16px;');
    expect(dividerRuleBody).toContain('background: var(--border-primary);');
  });
});
