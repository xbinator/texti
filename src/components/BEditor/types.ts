export type BEditorViewMode = 'rich' | 'source';

export interface SelectionRange {
  // 选中的文本起始位置
  from: number;
  //  选择结束位置
  to: number;
  // 选中的文本内容
  text: string;
}
