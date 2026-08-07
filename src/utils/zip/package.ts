/**
 * @file package.ts
 * @description 通用 zip 包根文件与资源文件解析工具。
 */
import JSZip from 'jszip';
import { path } from '@/utils/file/path';

/** zip 文件 magic bytes（PK\x03\x04）。 */
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
/** 二进制 KiB 字节数。 */
const KIB_BYTES = 1024;
/** 二进制 MiB 字节数。 */
const MIB_BYTES = KIB_BYTES * 1024;

/**
 * zip 包资源文件。
 */
export interface ZipPackageResource {
  /** zip 内安全相对路径。 */
  relativePath: string;
  /** 文件二进制内容。 */
  content: ArrayBuffer;
}

/**
 * zip 包读取选项。
 */
export interface ZipPackageReadOptions {
  /** 根层入口文件名，如 SKILL.md 或 widget.json。 */
  rootFileName: string;
  /** 最大非目录条目数量。 */
  maxEntries?: number;
  /** 单个资源文件最大字节数。 */
  maxFileBytes?: number;
}

/**
 * zip 包读取结果。
 */
export interface ZipPackageReadResult {
  /** 根层入口文件文本内容。 */
  rootFileContent: string;
  /** 入口文件之外的资源文件。 */
  resources: ZipPackageResource[];
}

/**
 * zip 入口文件匹配结果。
 */
interface RootFileEntryMatch {
  /** 匹配到的入口文件条目。 */
  entry: JSZip.JSZipObject;
  /** 需要从资源路径中剥离的单一包装目录前缀。 */
  wrapperPrefix: string;
}

/**
 * 格式化文件大小，避免直接暴露难读的原始字节数限制。
 * @param byteLength - 文件大小字节数
 * @returns 适合错误提示展示的大小文本
 */
function formatByteSize(byteLength: number): string {
  if (byteLength >= MIB_BYTES) {
    return `${Number.parseFloat((byteLength / MIB_BYTES).toFixed(1))} MiB`;
  }

  if (byteLength >= KIB_BYTES) {
    return `${Number.parseFloat((byteLength / KIB_BYTES).toFixed(1))} KiB`;
  }

  return `${byteLength} B`;
}

/**
 * 检查 ArrayBuffer 前 4 字节是否为 zip magic bytes。
 * @param buffer - 待检查二进制内容
 * @returns 是否为 zip 格式
 */
export function isZipPackageBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < ZIP_MAGIC.byteLength) {
    return false;
  }

  const header = new Uint8Array(buffer.slice(0, ZIP_MAGIC.byteLength));

  return header.every((byte: number, index: number): boolean => byte === ZIP_MAGIC[index]);
}

/**
 * 检查并归一化 zip 条目路径。
 * @param entryName - zip 条目名
 * @returns 安全相对路径
 */
export function normalizeZipEntryPath(entryName: string): string {
  return path.validatePath(entryName, 'zip 条目路径');
}

/**
 * 校验 zip 非目录条目数量。
 * @param entries - zip 非目录条目
 * @param maxEntries - 最大数量
 */
function assertEntryCount(entries: JSZip.JSZipObject[], maxEntries: number | undefined): void {
  if (typeof maxEntries === 'number' && entries.length > maxEntries) {
    throw new Error(`压缩包包含 ${entries.length} 个文件，超过上限 ${maxEntries} 个`);
  }
}

/**
 * 获取 zip 非目录条目的单一顶层目录前缀。
 * @param entries - zip 非目录条目
 * @returns 单一顶层目录前缀，不满足时返回 null
 */
function getSingleWrapperPrefix(entries: JSZip.JSZipObject[]): string | null {
  const topLevelNames = new Set<string>();

  for (const entry of entries) {
    const relativePath = normalizeZipEntryPath(entry.name);
    const segments = relativePath.split('/');

    if (segments.length < 2) {
      return null;
    }

    topLevelNames.add(segments[0] ?? '');

    if (topLevelNames.size > 1) {
      return null;
    }
  }

  const [topLevelName] = Array.from(topLevelNames);

  return topLevelName ? `${topLevelName}/` : null;
}

/**
 * 查找单一包装目录中的入口文件。
 * @param entries - zip 非目录条目
 * @param rootFileName - 入口文件名
 * @returns 入口文件匹配结果，未匹配时返回 null
 */
function findWrappedRootFileEntry(entries: JSZip.JSZipObject[], rootFileName: string): RootFileEntryMatch | null {
  const wrapperPrefix = getSingleWrapperPrefix(entries);

  if (!wrapperPrefix) {
    return null;
  }

  const wrappedRootFileName = `${wrapperPrefix}${rootFileName}`;
  const entry = entries.find((item: JSZip.JSZipObject): boolean => normalizeZipEntryPath(item.name) === wrappedRootFileName);

  return entry ? { entry, wrapperPrefix } : null;
}

/**
 * 读取入口文件，优先根层级，其次兼容单一包装目录。
 * @param entries - zip 非目录条目
 * @param rootFileName - 入口文件名
 * @returns 入口文件匹配结果
 */
function findRootFileEntry(entries: JSZip.JSZipObject[], rootFileName: string): RootFileEntryMatch {
  const rootFileEntry = entries.find((entry: JSZip.JSZipObject): boolean => normalizeZipEntryPath(entry.name) === rootFileName);

  if (rootFileEntry) {
    return { entry: rootFileEntry, wrapperPrefix: '' };
  }

  const wrappedRootFileEntry = findWrappedRootFileEntry(entries, rootFileName);

  if (wrappedRootFileEntry) {
    return wrappedRootFileEntry;
  }

  throw new Error(`zip 中未找到根层级 ${rootFileName}`);
}

/**
 * 从 zip 条目路径中剥离单一包装目录前缀。
 * @param relativePath - zip 内安全相对路径
 * @param wrapperPrefix - 包装目录前缀
 * @returns 对外暴露的资源相对路径
 */
function stripWrapperPrefix(relativePath: string, wrapperPrefix: string): string {
  if (!wrapperPrefix || !relativePath.startsWith(wrapperPrefix)) {
    return relativePath;
  }

  return relativePath.slice(wrapperPrefix.length);
}

/**
 * 判断 zip 包资源是否存在。
 * @param resource - 待判断资源
 * @returns 是否为有效资源
 */
function isZipPackageResource(resource: ZipPackageResource | null): resource is ZipPackageResource {
  return resource !== null;
}

/**
 * 读取单个资源条目。
 * @param entry - zip 条目
 * @param rootFileEntry - 根层入口文件条目
 * @param options - 读取选项
 * @returns 资源文件或空值
 */
async function readResourceEntry(
  entry: JSZip.JSZipObject,
  rootFileEntry: RootFileEntryMatch,
  options: ZipPackageReadOptions
): Promise<ZipPackageResource | null> {
  const relativePath = stripWrapperPrefix(normalizeZipEntryPath(entry.name), rootFileEntry.wrapperPrefix);

  if (entry === rootFileEntry.entry) {
    return null;
  }

  const content = await entry.async('arraybuffer');

  if (typeof options.maxFileBytes === 'number' && content.byteLength > options.maxFileBytes) {
    throw new Error(`文件 "${relativePath}" 解压后超过 ${formatByteSize(options.maxFileBytes)} 限制`);
  }

  return {
    relativePath,
    content
  };
}

/**
 * 顺序读取资源条目，避免多个大文件同时解压造成内存峰值过高。
 * @param entries - zip 非目录条目
 * @param rootFileEntry - 根层入口文件条目
 * @param options - 读取选项
 * @returns 资源文件列表
 */
async function readResourceEntries(
  entries: JSZip.JSZipObject[],
  rootFileEntry: RootFileEntryMatch,
  options: ZipPackageReadOptions
): Promise<ZipPackageResource[]> {
  return entries.reduce<Promise<ZipPackageResource[]>>(
    async (previous: Promise<ZipPackageResource[]>, entry: JSZip.JSZipObject): Promise<ZipPackageResource[]> => {
      const resources = await previous;
      const resource = await readResourceEntry(entry, rootFileEntry, options);

      if (isZipPackageResource(resource)) {
        resources.push(resource);
      }

      return resources;
    },
    Promise.resolve([])
  );
}

/**
 * 读取 zip 包根层入口文件与附带资源。
 * @param buffer - zip 文件二进制内容
 * @param options - 读取选项
 * @returns zip 包读取结果
 */
export async function readZipPackage(buffer: ArrayBuffer, options: ZipPackageReadOptions): Promise<ZipPackageReadResult> {
  if (!isZipPackageBuffer(buffer)) {
    throw new Error('不支持的文件格式，仅支持 ZIP 格式');
  }

  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((entry: JSZip.JSZipObject): boolean => !entry.dir);

  entries.forEach((entry: JSZip.JSZipObject): void => {
    normalizeZipEntryPath(entry.name);
  });
  assertEntryCount(entries, options.maxEntries);

  const rootFileEntry = findRootFileEntry(entries, options.rootFileName);
  const resources = await readResourceEntries(entries, rootFileEntry, options);

  return {
    rootFileContent: await rootFileEntry.entry.async('string'),
    resources
  };
}
