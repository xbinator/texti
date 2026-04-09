export type BEditorViewMode = 'rich' | 'source';

export interface SelectionRange {
  // 选中的文本起始位置
  from: number;
  //  选择结束位置
  to: number;
  // 选中的文本内容
  text: string;
}

export interface EditorSearchState {
  currentIndex: number;
  matchCount: number;
  term: string;
}

export interface BEditorPublicInstance {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setSearchTerm: (term: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearSearch: () => void;
  focusEditor: () => void;
  getSearchState: () => EditorSearchState;
}
