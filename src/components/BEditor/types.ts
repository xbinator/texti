export type { BEditorPublicInstance, EditorController, EditorSearchState, EditorSelection as SelectionRange } from './adapters/types';

export type BEditorViewMode = 'rich' | 'source';

export interface EditorState {
  // 编辑器内容
  content: string;
  // 文件名
  name: string;
  // 文件路径
  path: string | null;
  // 编辑器实例ID
  id: string;
  // 扩展名
  ext: string;
}
