/**
 * @file query.test.ts
 * @description 验证 BCommandPanel 输入内容到 source 的路由解析。
 */
import { describe, expect, it } from 'vitest';
import { parseCommandPanelQuery } from '@/components/BCommandPanel/utils/query';

describe('parseCommandPanelQuery', (): void => {
  it('routes model scope to model source for every input', (): void => {
    expect(parseCommandPanelQuery('model', '')).toEqual({ sourceId: 'model', keyword: '' });
    expect(parseCommandPanelQuery('model', 'qwen')).toEqual({ sourceId: 'model', keyword: 'qwen' });
    expect(parseCommandPanelQuery('model', '>')).toEqual({ sourceId: 'model', keyword: '>' });
  });

  it('routes normal recent input to recent source', (): void => {
    expect(parseCommandPanelQuery('recent', '')).toEqual({ sourceId: 'recent', keyword: '' });
    expect(parseCommandPanelQuery('recent', 'alpha')).toEqual({ sourceId: 'recent', keyword: 'alpha' });
    expect(parseCommandPanelQuery('recent', 'model')).toEqual({ sourceId: 'recent', keyword: 'model' });
    expect(parseCommandPanelQuery('recent', 'chat')).toEqual({ sourceId: 'recent', keyword: 'chat' });
    expect(parseCommandPanelQuery('recent', '>')).toEqual({ sourceId: 'recent', keyword: '>' });
  });

  it('routes exact ? input to hint source', (): void => {
    expect(parseCommandPanelQuery('recent', '?')).toEqual({ sourceId: 'hint', keyword: '' });
    expect(parseCommandPanelQuery('recent', '?m')).toEqual({ sourceId: 'recent', keyword: '?m' });
    expect(parseCommandPanelQuery('recent', '? mo')).toEqual({ sourceId: 'recent', keyword: '? mo' });
  });

  it('routes model prefix with trailing space to model source', (): void => {
    expect(parseCommandPanelQuery('recent', 'model ')).toEqual({ sourceId: 'model', keyword: '' });
    expect(parseCommandPanelQuery('recent', 'model qwen')).toEqual({ sourceId: 'model', keyword: 'qwen' });
    expect(parseCommandPanelQuery('recent', 'model qwen extra')).toEqual({ sourceId: 'model', keyword: 'qwen extra' });
    expect(parseCommandPanelQuery('recent', 'modelx ')).toEqual({ sourceId: 'recent', keyword: 'modelx' });
  });

  it('routes chat prefix with trailing space to chat source', (): void => {
    expect(parseCommandPanelQuery('recent', 'chat ')).toEqual({ sourceId: 'chat', keyword: '' });
    expect(parseCommandPanelQuery('recent', 'chat 重构')).toEqual({ sourceId: 'chat', keyword: '重构' });
    expect(parseCommandPanelQuery('recent', 'chat 重构 计划')).toEqual({ sourceId: 'chat', keyword: '重构 计划' });
    expect(parseCommandPanelQuery('recent', 'chats ')).toEqual({ sourceId: 'recent', keyword: 'chats' });
  });
});
