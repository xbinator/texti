/**
 * @file types.ts
 * @description 定义最近文件存储记录及其时间元数据结构。
 */

/**
 * 文件主记录。
 */
export interface StoredFile {
  /** 文件唯一标识。 */
  id: string;
  /** 文件唯一路径，未保存文件为 null。 */
  path: string | null;
  /** 当前文件内容。 */
  content: string;
  /** 最近一次与磁盘同步的内容基线。 */
  savedContent?: string;
  /** 文件名。 */
  name: string;
  /** 文件扩展名。 */
  ext: string;
  /** 本地记录首次创建时间（毫秒时间戳）。 */
  createdAt?: number;
  /** 最近一次显式打开时间。 */
  openedAt?: number;
  /** 最近一次内容变更时间。 */
  modifiedAt?: number;
  /** 最近一次成功保存时间。 */
  savedAt?: number;
  /** 文件被固定的时间（预留字段）。 */
  pinnedAt?: number;
  /** 文件所属工作区 ID（预留字段）。 */
  workspaceId?: string | null;
}
