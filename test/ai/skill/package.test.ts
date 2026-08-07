/**
 * @file package.test.ts
 * @description Skill zip 包解析测试。
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseSkillPackageBuffer } from '@/ai/skill/package';

/**
 * 创建 Skill zip 测试数据。
 * @param wrapperPrefix - 可选的 zip 单一顶层目录前缀
 * @param skillName - SKILL.md frontmatter name
 * @returns zip 二进制内容
 */
async function createSkillZipBuffer(
  wrapperPrefix = '',
  skillName = 'demo-skill',
  resourceContent: Uint8Array = new Uint8Array([5, 6, 7])
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(`${wrapperPrefix}SKILL.md`, ['---', `name: ${skillName}`, 'description: Demo skill', '---', '', 'Use bundled resources.'].join('\n'));
  zip.file(`${wrapperPrefix}assets/icon.bin`, resourceContent);

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('parseSkillPackageBuffer', (): void => {
  it('parses SKILL.md and keeps bundled resources as binary content', async (): Promise<void> => {
    const buffer = await createSkillZipBuffer();

    const result = await parseSkillPackageBuffer(buffer);

    expect(result.skill.name).toBe('demo-skill');
    expect(result.rawSkillMd).toContain('Use bundled resources.');
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.relativePath).toBe('assets/icon.bin');
    expect(Array.from(new Uint8Array(result.resources[0]?.content ?? new ArrayBuffer(0)))).toEqual([5, 6, 7]);
  });

  it('parses SKILL.md from a single wrapper directory and strips resource paths', async (): Promise<void> => {
    const buffer = await createSkillZipBuffer('developing-widget/');

    const result = await parseSkillPackageBuffer(buffer);

    expect(result.skill.name).toBe('demo-skill');
    expect(result.rawSkillMd).toContain('Use bundled resources.');
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.relativePath).toBe('assets/icon.bin');
    expect(Array.from(new Uint8Array(result.resources[0]?.content ?? new ArrayBuffer(0)))).toEqual([5, 6, 7]);
  });

  it('accepts bundled resources larger than the previous 1 MiB limit', async (): Promise<void> => {
    const buffer = await createSkillZipBuffer('', 'demo-skill', new Uint8Array(2 * 1024 * 1024));

    const result = await parseSkillPackageBuffer(buffer);

    expect(result.resources[0]?.relativePath).toBe('assets/icon.bin');
    expect(result.resources[0]?.content.byteLength).toBe(2 * 1024 * 1024);
  });

  it('rejects unsafe skill names before install paths are created', async (): Promise<void> => {
    const buffer = await createSkillZipBuffer('', '../demo');

    await expect(parseSkillPackageBuffer(buffer)).rejects.toThrow('Skill name 只能包含字母、数字、下划线和短横线');
  });

  it('rejects Windows reserved skill names before install paths are created', async (): Promise<void> => {
    const buffer = await createSkillZipBuffer('', 'CON');

    await expect(parseSkillPackageBuffer(buffer)).rejects.toThrow('Skill name 不能使用 Windows 保留名称');
  });
});
