/**
 * @file importer.test.ts
 * @description 小组件文件导入解析测试。
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { importWidgetJsonFile, importWidgetZipFile, WIDGET_ZIP_MAX_RESOURCE_BYTES } from '@/ai/widget/importer';

/**
 * 测试 zip 资源条目。
 */
interface WidgetZipResourceFixture {
  /** zip 内相对路径。 */
  path: string;
  /** 二进制内容。 */
  content: Uint8Array;
}

/**
 * 创建测试 zip 文件。
 * @param name - 文件名
 * @param widgetJson - widget.json 内容
 * @returns zip 文件
 */
async function createWidgetZipFile(name: string, widgetJson: Record<string, unknown>, resources: WidgetZipResourceFixture[] = []): Promise<File> {
  const zip = new JSZip();
  zip.file('widget.json', JSON.stringify(widgetJson));
  resources.forEach((resource: WidgetZipResourceFixture): void => {
    zip.file(resource.path, resource.content);
  });
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });

  return new File([buffer], name, { type: 'application/zip' });
}

describe('importWidgetZipFile', (): void => {
  it('reads root widget.json from zip and suggests id from zip filename', async (): Promise<void> => {
    const file = await createWidgetZipFile('Coffee Menu.zip', {
      name: '咖啡菜单',
      description: '展示咖啡列表',
      elements: [
        {
          id: 'text-1',
          name: 'text',
          label: '文本',
          icon: 'lucide:type',
          title: '文本节点',
          position: { x: 12, y: 24 },
          size: { width: 120, height: 48 },
          rotation: 0,
          style: {},
          metadata: {}
        }
      ]
    });

    const result = await importWidgetZipFile(file);

    expect(result.suggestedId).toBe('coffee-menu');
    expect(result.sourceName).toBe('Coffee Menu.zip');
    expect(result.data.name).toBe('咖啡菜单');
    expect(result.data.description).toBe('展示咖啡列表');
    expect(result.data.elements).toHaveLength(1);
  });

  it('keeps non widget.json zip files as import resources', async (): Promise<void> => {
    const file = await createWidgetZipFile(
      'Coffee Menu.zip',
      {
        name: '咖啡菜单',
        description: '展示咖啡列表'
      },
      [
        {
          path: 'assets/icon.png',
          content: new Uint8Array([1, 2, 3, 4])
        }
      ]
    );

    const result = await importWidgetZipFile(file);

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.relativePath).toBe('assets/icon.png');
    expect(Array.from(new Uint8Array(result.resources[0]?.content ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);
  });

  it('reads widget.json from a single wrapper directory and strips resource paths', async (): Promise<void> => {
    const zip = new JSZip();
    zip.file('coffee-menu/widget.json', JSON.stringify({ name: '咖啡菜单', description: '展示咖啡列表' }));
    zip.file('coffee-menu/assets/icon.png', new Uint8Array([1, 2, 3, 4]));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buffer], 'Coffee Menu.zip', { type: 'application/zip' });

    const result = await importWidgetZipFile(file);

    expect(result.data.name).toBe('咖啡菜单');
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.relativePath).toBe('assets/icon.png');
    expect(Array.from(new Uint8Array(result.resources[0]?.content ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);
  });

  it('rejects zip files without root widget.json', async (): Promise<void> => {
    const zip = new JSZip();
    zip.file('nested/not-widget.json', JSON.stringify({ name: '嵌套小组件' }));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buffer], 'nested.zip', { type: 'application/zip' });

    await expect(importWidgetZipFile(file)).rejects.toThrow('未找到根层级 widget.json');
  });

  it('rejects resources larger than the widget zip resource limit', async (): Promise<void> => {
    const file = await createWidgetZipFile(
      'large-resource.zip',
      {
        name: '大资源小组件',
        description: '包含超大资源'
      },
      [
        {
          path: 'assets/large.bin',
          content: new Uint8Array(WIDGET_ZIP_MAX_RESOURCE_BYTES + 1)
        }
      ]
    );

    await expect(importWidgetZipFile(file)).rejects.toThrow('超过 5 MiB 限制');
  });
});

describe('importWidgetJsonFile', (): void => {
  it('reads widget data from json and suggests id from json filename', async (): Promise<void> => {
    const file = new File(
      [
        JSON.stringify({
          name: '咖啡菜单',
          description: '展示咖啡列表',
          elements: [
            {
              id: 'text-1',
              name: 'text',
              label: '文本',
              icon: 'lucide:type',
              title: '文本节点',
              position: { x: 12, y: 24 },
              size: { width: 120, height: 48 },
              rotation: 0,
              style: {},
              metadata: {}
            }
          ]
        })
      ],
      'Coffee Menu.json',
      { type: 'application/json' }
    );

    const result = await importWidgetJsonFile(file);

    expect(result.suggestedId).toBe('coffee-menu');
    expect(result.sourceName).toBe('Coffee Menu.json');
    expect(result.data.name).toBe('咖啡菜单');
    expect(result.data.description).toBe('展示咖啡列表');
    expect(result.data.elements).toHaveLength(1);
    expect(result.resources).toEqual([]);
  });

  it('uses widget as suggested id when importing a root widget.json file', async (): Promise<void> => {
    const file = new File(
      [
        JSON.stringify({
          name: '天气',
          description: '查询天气'
        })
      ],
      'widget.json',
      { type: 'application/json' }
    );

    const result = await importWidgetJsonFile(file);

    expect(result.suggestedId).toBe('widget');
    expect(result.data.name).toBe('天气');
    expect(result.data.description).toBe('查询天气');
  });

  it('rejects invalid widget json files with parser feedback', async (): Promise<void> => {
    const file = new File(['[]'], 'bad.json', { type: 'application/json' });

    await expect(importWidgetJsonFile(file)).rejects.toThrow('widget.json 解析失败：Widget JSON must be an object.');
  });
});
