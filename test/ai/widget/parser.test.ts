/**
 * @file parser.test.ts
 * @description Widget JSON 内容版本与 dirPath 计算测试。
 */
import { describe, expect, it } from 'vitest';
import { parseWidgetJson } from '@/ai/widget/parser';
import { hashString } from '@/shared/utils/hash';

describe('parseWidgetJson content hash', (): void => {
  it('records a stable hash of the complete source text', (): void => {
    const source = JSON.stringify({ name: 'Weather', description: 'Old description' });
    const changedSource = JSON.stringify({ name: 'Weather', description: 'New description' });

    expect(parseWidgetJson(source, '/widgets/weather/widget.json').contentHash).toBe(hashString(source));
    expect(parseWidgetJson(changedSource, '/widgets/weather/widget.json').contentHash).not.toBe(hashString(source));
  });

  it('records the source hash when parsing fails', (): void => {
    const source = '{broken';

    expect(parseWidgetJson(source, '/widgets/broken/widget.json').contentHash).toBe(hashString(source));
  });
});

describe('parseWidgetJson dirPath', (): void => {
  it('exposes the parent directory of the widget.json file path', (): void => {
    const widget = parseWidgetJson('{"name":"天气","description":"查询天气"}', '/home/.tibis/widgets/weather/widget.json');
    expect(widget.dirPath).toBe('/home/.tibis/widgets/weather');
  });

  it('normalizes backslash separators when deriving dirPath', (): void => {
    const widget = parseWidgetJson('{"name":"天气","description":"查询天气"}', 'C:\\Users\\test\\.tibis\\widgets\\weather\\widget.json');
    expect(widget.dirPath).toBe('C:/Users/test/.tibis/widgets/weather');
  });

  it('populates dirPath even when JSON parsing fails', (): void => {
    const widget = parseWidgetJson('{broken', '/home/.tibis/widgets/broken/widget.json');
    expect(widget.dirPath).toBe('/home/.tibis/widgets/broken');
  });
});

describe('parseWidgetJson Smart contract', (): void => {
  it('reports missing Smart metadata instead of loading a partial element', (): void => {
    const source = JSON.stringify({
      elements: [{ id: 'button-1', name: 'button' }]
    });

    const widget = parseWidgetJson(source, '/widgets/incomplete/widget.json');

    expect(widget.parseError).toContain('elements[0].metadata');
  });

  it('reports an invalid empty variable path instead of silently normalizing it', (): void => {
    const source = JSON.stringify({
      elements: [
        {
          id: 'button-1',
          name: 'button',
          metadata: {
            actions: [],
            disabled: { type: 'literal', value: false },
            loading: { type: 'literal', value: false },
            text: { type: 'variable', value: '' }
          }
        }
      ]
    });

    const widget = parseWidgetJson(source, '/widgets/invalid/widget.json');

    expect(widget.parseError).toContain('elements[0].metadata.text.value');
  });

  it('reports malformed button actions at the parse boundary', (): void => {
    const source = JSON.stringify({
      elements: [
        {
          id: 'button-1',
          name: 'button',
          metadata: {
            actions: { method: 'submit' },
            disabled: { type: 'literal', value: false },
            loading: { type: 'literal', value: false },
            text: { type: 'literal', value: '提交' }
          }
        }
      ]
    });

    const widget = parseWidgetJson(source, '/widgets/invalid-actions/widget.json');

    expect(widget.parseError).toContain('elements[0].metadata.actions');
  });

  it('reports an empty Swiper image list at the parse boundary', (): void => {
    const source = JSON.stringify({
      elements: [
        {
          id: 'swiper-1',
          name: 'swiper',
          metadata: {
            autoplay: { type: 'literal', value: false },
            images: [],
            loop: { type: 'literal', value: true },
            showIndicator: { type: 'literal', value: true },
            vertical: { type: 'literal', value: false }
          }
        }
      ]
    });

    const widget = parseWidgetJson(source, '/widgets/invalid-images/widget.json');

    expect(widget.parseError).toContain('elements[0].metadata.images');
  });

  it('reports an enabled loop without a data source at the parse boundary', (): void => {
    const source = JSON.stringify({
      elements: [
        {
          id: 'rect-1',
          loop: { enabled: true },
          name: 'rect'
        }
      ]
    });

    const widget = parseWidgetJson(source, '/widgets/invalid-loop/widget.json');

    expect(widget.parseError).toContain('elements[0].loop.source');
  });

  it('allows auto-column loops to omit columns', (): void => {
    const source = JSON.stringify({
      elements: [
        {
          id: 'rect-1',
          loop: {
            autoColumns: true,
            columnGap: 12,
            enabled: false,
            indexName: 'index',
            itemName: 'item',
            rowGap: 12,
            source: { type: 'literal', value: '' }
          },
          name: 'rect'
        }
      ]
    });

    expect(parseWidgetJson(source, '/widgets/auto-columns/widget.json').parseError).toBeUndefined();
  });

  it('reports primitive elements at the parse boundary', (): void => {
    const source = JSON.stringify({ elements: ['invalid'] });

    expect(parseWidgetJson(source, '/widgets/invalid-element/widget.json').parseError).toContain('elements[0]');
  });

  it('reports a malformed children collection at the parse boundary', (): void => {
    const source = JSON.stringify({ elements: [{ children: 'invalid', id: 'group-1', name: 'group' }] });

    expect(parseWidgetJson(source, '/widgets/invalid-children/widget.json').parseError).toContain('elements[0].children');
  });
});
