/**
 * 文件引用 Chip 数据，用于 Prompt 编辑器
 */
export interface FileReferenceChip {
  /** 稳定的引用 ID，用于 `{{file-ref:...}}` 标记 */
  referenceId: string;
  /** 稳定的文档 ID，用于限定草稿范围内的引用 */
  documentId: string;
  /** 完整文件路径（可用时），未保存的引用则为 `null` */
  filePath: string | null;
  /** Chip 内显示的展示名称 */
  fileName: string;
  /** 行号或行范围标签 */
  line: number | string;
}
