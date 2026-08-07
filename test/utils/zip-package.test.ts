/**
 * @file zip-package.test.ts
 * @description 通用 zip 包解析工具测试。
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readZipPackage } from '@/utils/zip/package';

/**
 * zip 测试资源。
 */
interface ZipPackageFixtureResource {
  /** zip 内路径。 */
  path: string;
  /** 文件内容。 */
  content: string | Uint8Array;
}

/**
 * 创建 zip 测试数据。
 * @param resources - zip 文件列表
 * @returns zip 二进制内容
 */
async function createZipBuffer(resources: ZipPackageFixtureResource[]): Promise<ArrayBuffer> {
  const zip = new JSZip();

  resources.forEach((resource: ZipPackageFixtureResource): void => {
    zip.file(resource.path, resource.content);
  });

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('readZipPackage', (): void => {
  it('reads root file and keeps other files as binary resources', async (): Promise<void> => {
    const buffer = await createZipBuffer([
      { path: 'widget.json', content: JSON.stringify({ name: '咖啡菜单' }) },
      { path: 'assets/icon.bin', content: new Uint8Array([1, 2, 3]) }
    ]);

    const result = await readZipPackage(buffer, { rootFileName: 'widget.json' });

    expect(result.rootFileContent).toBe(JSON.stringify({ name: '咖啡菜单' }));
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.relativePath).toBe('assets/icon.bin');
    expect(Array.from(new Uint8Array(result.resources[0]?.content ?? new ArrayBuffer(0)))).toEqual([1, 2, 3]);
  });

  it('reads root file from a single wrapper directory and strips wrapper from resource paths', async (): Promise<void> => {
    const buffer = await createZipBuffer([
      { path: 'coffee-menu/widget.json', content: JSON.stringify({ name: '咖啡菜单' }) },
      { path: 'coffee-menu/assets/icon.bin', content: new Uint8Array([1, 2, 3]) }
    ]);

    const result = await readZipPackage(buffer, { rootFileName: 'widget.json' });

    expect(result.rootFileContent).toBe(JSON.stringify({ name: '咖啡菜单' }));
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.relativePath).toBe('assets/icon.bin');
    expect(Array.from(new Uint8Array(result.resources[0]?.content ?? new ArrayBuffer(0)))).toEqual([1, 2, 3]);
  });

  it('rejects packages without root file', async (): Promise<void> => {
    const buffer = await createZipBuffer([{ path: 'nested/not-widget.json', content: '{}' }]);

    await expect(readZipPackage(buffer, { rootFileName: 'widget.json' })).rejects.toThrow('zip 中未找到根层级 widget.json');
  });

  it('rejects unsafe resource paths', async (): Promise<void> => {
    const buffer = await createZipBuffer([
      { path: 'widget.json', content: '{}' },
      { path: '/assets/icon.bin', content: new Uint8Array([1]) }
    ]);

    await expect(readZipPackage(buffer, { rootFileName: 'widget.json' })).rejects.toThrow('zip 条目路径不安全');
  });

  it('rejects resource paths with Windows-invalid characters', async (): Promise<void> => {
    const buffer = await createZipBuffer([
      { path: 'widget.json', content: '{}' },
      { path: 'assets/icon:bad.bin', content: new Uint8Array([1]) }
    ]);

    await expect(readZipPackage(buffer, { rootFileName: 'widget.json' })).rejects.toThrow('zip 条目路径不安全');
  });

  it('rejects resource paths with Windows reserved names', async (): Promise<void> => {
    const buffer = await createZipBuffer([
      { path: 'widget.json', content: '{}' },
      { path: 'assets/CON.txt', content: new Uint8Array([1]) }
    ]);

    await expect(readZipPackage(buffer, { rootFileName: 'widget.json' })).rejects.toThrow('zip 条目路径不安全');
  });

  it('rejects resources larger than maxFileBytes with readable limit text', async (): Promise<void> => {
    const buffer = await createZipBuffer([
      { path: 'SKILL.md', content: '---\nname: demo\ndescription: demo\n---\nbody' },
      { path: 'assets/big.bin', content: new Uint8Array(1024 * 1024 + 1) }
    ]);

    await expect(readZipPackage(buffer, { rootFileName: 'SKILL.md', maxFileBytes: 1024 * 1024 })).rejects.toThrow(
      '文件 "assets/big.bin" 解压后超过 1 MiB 限制'
    );
  });
});
