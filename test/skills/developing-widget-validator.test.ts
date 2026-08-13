/**
 * @file developing-widget-validator.test.ts
 * @description 验证 Developing Widget 校验器使用结构化 Smart 值协议。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WidgetValidationResult } from '../../skills/developing-widget/scripts/validate-widget.js';
import { afterEach, describe, expect, it } from 'vitest';
import { asyncTo } from '@/utils/asyncTo';
import { validateWidgetDirectory } from '../../skills/developing-widget/scripts/validate-widget.js';

/** 测试创建的临时 Widget 目录。 */
const temporaryDirectories: string[] = [];

/**
 * 等待测试文件操作并把错误重新抛给 Vitest。
 * @param promise - 待执行的异步操作
 * @returns 异步结果
 */
async function requireAsync<T>(promise: Promise<T>): Promise<T> {
  const [error, value] = await asyncTo(promise);
  if (error) {
    throw error;
  }

  return value;
}

/**
 * 创建结构化 Smart 值。
 * @param type - Smart 值来源
 * @param value - Smart 值内容
 * @returns Smart 值对象
 */
function createSmartValue(type: 'literal' | 'variable', value: unknown): Record<string, unknown> {
  return { type, value };
}

/**
 * 创建基础元素。
 * @param id - 元素 ID
 * @param name - 元素类型
 * @param metadata - 元素元数据
 * @param loopSource - 循环数据源
 * @param loopEnabled - 是否启用循环
 * @returns 可写入 widget.json 的元素
 */
function createElement(
  id: string,
  name: string,
  metadata: Record<string, unknown>,
  loopSource: unknown = createSmartValue('literal', ''),
  loopEnabled = false
): Record<string, unknown> {
  return {
    id,
    name,
    label: name,
    icon: 'lucide:box',
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 120, height: 60 },
    rotation: 0,
    style: {},
    loop: {
      enabled: loopEnabled,
      source: loopSource,
      autoColumns: false,
      columns: 1,
      columnGap: 0,
      rowGap: 0,
      itemName: 'item',
      indexName: 'index'
    },
    metadata
  };
}

/**
 * 创建基础 Widget 数据。
 * @param elements - Widget 元素列表
 * @returns 完整 Widget 数据
 */
function createWidget(elements: Record<string, unknown>[]): Record<string, unknown> {
  return {
    name: 'smart-validator',
    description: 'Validate structured Smart values.',
    inputSchema: {
      type: 'object',
      properties: {
        alt: { type: 'string' }
      },
      required: []
    },
    outputSchema: { type: 'object', properties: {}, required: [] },
    dataSchema: {
      type: 'object',
      properties: {
        heroUrl: { type: 'string' },
        items: { type: 'array' },
        loading: { type: 'boolean' }
      },
      required: []
    },
    execute: {
      enabled: true,
      description: 'Validate actions.',
      code: 'export default class SmartValidator extends Widget {\n  refresh() {}\n}\n'
    },
    metadata: { width: 360, height: 240 },
    elements
  };
}

/**
 * 创建带指定图片地址的合法 Swiper 元数据。
 * @param source - Swiper 图片 Smart 地址
 * @returns Swiper 元数据
 */
function createSwiperMetadata(source: Record<string, unknown>): Record<string, unknown> {
  return {
    images: [
      {
        title: '首图',
        src: source,
        alt: createSmartValue('literal', '首图')
      }
    ],
    fit: 'cover',
    autoplay: createSmartValue('literal', false),
    autoplayInterval: 3000,
    animationDuration: 300,
    initialIndex: 0,
    loop: createSmartValue('literal', true),
    showIndicator: createSmartValue('literal', true),
    vertical: createSmartValue('literal', false),
    indicatorColor: '#ffffff',
    indicatorShape: 'active-line'
  };
}

/**
 * 写入单个测试资源。
 * @param directory - Widget 临时目录
 * @param resource - 资源相对路径
 */
async function writeResource(directory: string, resource: string): Promise<void> {
  const resourcePath = join(directory, resource);
  await requireAsync(mkdir(dirname(resourcePath), { recursive: true }));
  await requireAsync(writeFile(resourcePath, 'fixture'));
}

/**
 * 写入临时 Widget 包并执行校验。
 * @param widget - Widget 数据
 * @param resources - 需要创建的相对资源路径
 * @returns 校验结果
 */
async function validateWidget(widget: Record<string, unknown>, resources: string[] = []): Promise<WidgetValidationResult> {
  const directory = await requireAsync(mkdtemp(join(tmpdir(), 'tibis-widget-validator-')));
  temporaryDirectories.push(directory);

  await requireAsync(Promise.all(resources.map((resource: string): Promise<void> => writeResource(directory, resource))));

  await requireAsync(writeFile(join(directory, 'widget.json'), JSON.stringify(widget)));
  return validateWidgetDirectory(directory);
}

describe('Developing Widget validator Smart values', (): void => {
  afterEach(async (): Promise<void> => {
    await requireAsync(Promise.all(temporaryDirectories.splice(0).map((directory: string): Promise<void> => rm(directory, { recursive: true, force: true }))));
  });

  it('accepts structured Button, Image, Swiper, Loop and method arguments', async (): Promise<void> => {
    const widget = createWidget([
      createElement(
        'button',
        'button',
        {
          text: createSmartValue('literal', '刷新'),
          disabled: createSmartValue('variable', 'loading'),
          loading: createSmartValue('literal', false),
          actions: [
            {
              method: 'refresh',
              args: [createSmartValue('literal', 'manual'), createSmartValue('variable', '$input.alt')]
            }
          ]
        },
        createSmartValue('variable', 'items'),
        true
      ),
      createElement('image', 'image', {
        src: createSmartValue('literal', 'assets/photo.png'),
        alt: createSmartValue('variable', '$input.alt'),
        fit: 'cover'
      }),
      createElement('swiper', 'swiper', {
        images: [
          {
            title: '首图',
            src: createSmartValue('variable', 'heroUrl'),
            alt: createSmartValue('literal', '首图')
          }
        ],
        fit: 'cover',
        autoplay: createSmartValue('variable', 'loading'),
        autoplayInterval: 3000,
        animationDuration: 300,
        initialIndex: 0,
        loop: createSmartValue('literal', true),
        showIndicator: createSmartValue('literal', true),
        vertical: createSmartValue('literal', false),
        indicatorColor: '#ffffff',
        indicatorShape: 'active-line'
      })
    ]);

    const result = await validateWidget(widget, ['assets/photo.png']);

    expect(result.errors).toEqual([]);
  });

  it('rejects historical primitive Smart fields', async (): Promise<void> => {
    const widget = createWidget([
      createElement(
        'button',
        'button',
        {
          text: '刷新',
          disabled: false,
          loading: '{{ loading }}',
          actions: [{ method: 'refresh', args: ['old'] }]
        },
        'items',
        true
      ),
      createElement('image', 'image', { src: 'https://example.com/photo.png', alt: '' })
    ]);

    const result = await validateWidget(widget);
    const errorPaths = result.errors.map((diagnostic): string => diagnostic.path);

    expect(errorPaths).toEqual(
      expect.arrayContaining([
        'elements[0].loop.source',
        'elements[0].metadata.text',
        'elements[0].metadata.disabled',
        'elements[0].metadata.loading',
        'elements[0].metadata.actions[0].args[0]',
        'elements[1].metadata.src',
        'elements[1].metadata.alt'
      ])
    );
  });

  it('rejects invalid literal types and malformed variable paths', async (): Promise<void> => {
    const widget = createWidget([
      createElement('button', 'button', {
        text: createSmartValue('literal', false),
        disabled: createSmartValue('literal', 'false'),
        loading: createSmartValue('variable', 42),
        actions: [{ method: 'refresh', args: [createSmartValue('literal', false)] }]
      }),
      createElement('image', 'image', {
        src: createSmartValue('literal', true),
        alt: createSmartValue('variable', '{{ $input.alt }}')
      })
    ]);

    const result = await validateWidget(widget);
    const errorPaths = result.errors.map((diagnostic): string => diagnostic.path);

    expect(errorPaths).toEqual(
      expect.arrayContaining([
        'elements[0].metadata.text.value',
        'elements[0].metadata.disabled.value',
        'elements[0].metadata.loading.value',
        'elements[0].metadata.actions[0].args[0].value',
        'elements[1].metadata.src.value',
        'elements[1].metadata.alt.value'
      ])
    );
  });

  it('checks only literal image paths as local package resources', async (): Promise<void> => {
    const variableWidget = createWidget([
      createElement('image', 'image', {
        src: createSmartValue('variable', 'assets.missingImage'),
        alt: createSmartValue('literal', '')
      }),
      createElement('variable-swiper', 'swiper', createSwiperMetadata(createSmartValue('variable', 'assets.missingSlides')))
    ]);
    const literalWidget = createWidget([
      createElement('image', 'image', {
        src: createSmartValue('literal', 'assets/missing.png'),
        alt: createSmartValue('literal', '')
      }),
      createElement('literal-swiper', 'swiper', createSwiperMetadata(createSmartValue('literal', 'assets/missing-slide.png')))
    ]);

    const variableResult = await validateWidget(variableWidget);
    const literalResult = await validateWidget(literalWidget);

    expect(variableResult.errors.some((diagnostic): boolean => diagnostic.message.includes('local resource'))).toBe(false);
    expect(literalResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'elements[0].metadata.src',
          message: 'local resource does not exist'
        })
      ])
    );
    expect(literalResult.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'elements[1].metadata.images[0].src',
          message: 'local resource does not exist'
        })
      ])
    );
  });

  it('accepts item and index bindings in the loop element metadata', async (): Promise<void> => {
    const widget = createWidget([
      createElement(
        'loop-text',
        'text',
        {
          content: '{{ item.label }} #{{ index }}',
          maxLines: 2
        },
        createSmartValue('variable', 'items'),
        true
      ),
      createElement(
        'loop-button',
        'button',
        {
          text: createSmartValue('literal', '打开'),
          disabled: createSmartValue('literal', false),
          loading: createSmartValue('literal', false),
          actions: [{ method: 'refresh', args: [createSmartValue('variable', 'item.id')] }]
        },
        createSmartValue('variable', 'items'),
        true
      )
    ]);

    const result = await validateWidget(widget);
    const bindingWarnings = result.warnings.filter((diagnostic): boolean => diagnostic.message.includes('undeclared data field'));

    expect(result.errors).toEqual([]);
    expect(bindingWarnings).toEqual([]);
  });
});
