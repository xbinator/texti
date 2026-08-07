/**
 * @file package.ts
 * @description Skill zip 包解析与资源归一化工具。
 */
import type { SkillDefinition } from './types';
import { path } from '@/utils/file/path';
import { isZipPackageBuffer, readZipPackage, type ZipPackageResource } from '@/utils/zip/package';
import { parseSkillMarkdown } from './parser';

/** 最大 zip 条目数。 */
const MAX_ENTRIES = 50;
/** 单个资源文件最大解压后字节数。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Skill 根层入口文件名。 */
const SKILL_MD_FILE_NAME = 'SKILL.md';

/**
 * Skill 包资源文件。
 */
export interface SkillPackageResource extends ZipPackageResource {
  /** 预览时展示的文本内容。 */
  previewContent: string;
}

/**
 * Skill 包解析结果。
 */
export interface SkillPackageParseResult {
  /** Skill 定义。 */
  skill: SkillDefinition;
  /** 原始 SKILL.md 完整内容。 */
  rawSkillMd: string;
  /** 附带资源文件。 */
  resources: SkillPackageResource[];
  /** 解析警告。 */
  warnings: string[];
}

/**
 * 生成资源预览文本。
 * @param resource - zip 包资源
 * @returns 预览文本
 */
function createResourcePreviewContent(resource: ZipPackageResource): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(resource.content);
  } catch {
    return `二进制资源，无法预览（${resource.content.byteLength} bytes）`;
  }
}

/**
 * 归一化 Skill 资源文件。
 * @param resource - zip 包资源
 * @returns Skill 包资源
 */
function normalizeSkillPackageResource(resource: ZipPackageResource): SkillPackageResource {
  return {
    ...resource,
    previewContent: createResourcePreviewContent(resource)
  };
}

/**
 * 校验导入 Skill 名称可安全作为安装目录名。
 * @param name - SKILL.md frontmatter name
 */
function assertSafeSkillName(name: string): void {
  if (path.isWindowsReservedFileName(name)) {
    throw new Error('Skill name 不能使用 Windows 保留名称');
  }
}

/**
 * 解析 Skill zip 包。
 * @param buffer - zip 文件二进制内容
 * @returns Skill 包解析结果
 */
export async function parseSkillPackageBuffer(buffer: ArrayBuffer): Promise<SkillPackageParseResult> {
  if (!isZipPackageBuffer(buffer)) {
    throw new Error('不支持的文件格式，仅支持 .skill 和 .zip（ZIP 格式）');
  }

  const zipPackage = await readZipPackage(buffer, {
    rootFileName: SKILL_MD_FILE_NAME,
    maxEntries: MAX_ENTRIES,
    maxFileBytes: MAX_FILE_BYTES
  });
  const skill = parseSkillMarkdown(zipPackage.rootFileContent, SKILL_MD_FILE_NAME, {
    source: 'global'
  });

  if (skill.parseError || !skill.name) {
    throw new Error(`SKILL.md 解析失败：${skill.parseError || '缺少必填字段 name'}`);
  }

  assertSafeSkillName(skill.name);

  return {
    skill,
    rawSkillMd: zipPackage.rootFileContent,
    resources: zipPackage.resources.map(normalizeSkillPackageResource),
    warnings: []
  };
}
