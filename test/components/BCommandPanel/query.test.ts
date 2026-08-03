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
  });

  it('routes ? hint prefix to hint source', (): void => {
    expect(parseCommandPanelQuery('recent', '?')).toEqual({ sourceId: 'hint', keyword: '' });
    expect(parseCommandPanelQuery('recent', '?m')).toEqual({ sourceId: 'hint', keyword: 'm' });
    expect(parseCommandPanelQuery('recent', '? mo')).toEqual({ sourceId: 'hint', keyword: 'mo' });
  });

  it('routes incomplete jump input to jump source', (): void => {
    expect(parseCommandPanelQuery('recent', '>')).toEqual({ sourceId: 'jump', keyword: '' });
    expect(parseCommandPanelQuery('recent', '> mo')).toEqual({ sourceId: 'jump', keyword: 'mo' });
    expect(parseCommandPanelQuery('recent', '> models')).toEqual({ sourceId: 'jump', keyword: 'models' });
    expect(parseCommandPanelQuery('recent', '> modelx')).toEqual({ sourceId: 'jump', keyword: 'modelx' });
    expect(parseCommandPanelQuery('recent', '> cha')).toEqual({ sourceId: 'jump', keyword: 'cha' });
    expect(parseCommandPanelQuery('recent', '> chats')).toEqual({ sourceId: 'jump', keyword: 'chats' });
  });

  it('routes model jump command to model source', (): void => {
    expect(parseCommandPanelQuery('recent', '> model')).toEqual({ sourceId: 'model', keyword: '' });
    expect(parseCommandPanelQuery('recent', '> model ')).toEqual({ sourceId: 'model', keyword: '' });
    expect(parseCommandPanelQuery('recent', '> model qwen')).toEqual({ sourceId: 'model', keyword: 'qwen' });
    expect(parseCommandPanelQuery('recent', '> model qwen extra')).toEqual({ sourceId: 'model', keyword: 'qwen extra' });
  });

  it('routes chat jump command to chat source', (): void => {
    expect(parseCommandPanelQuery('recent', '> chat')).toEqual({ sourceId: 'chat', keyword: '' });
    expect(parseCommandPanelQuery('recent', '> chat ')).toEqual({ sourceId: 'chat', keyword: '' });
    expect(parseCommandPanelQuery('recent', '> chat 重构')).toEqual({ sourceId: 'chat', keyword: '重构' });
    expect(parseCommandPanelQuery('recent', '> chat 重构 计划')).toEqual({ sourceId: 'chat', keyword: '重构 计划' });
  });
});
