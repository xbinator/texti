/**
 * @file final-text.test.ts
 * @description 强制最终回答内部工具协议泄漏防护测试。
 */
import { describe, expect, it } from 'vitest';
import { createFinalTextFilter, sanitizeFinalText } from '../../../../../../../electron/main/modules/chat/runtime/stream/final-text.mjs';

describe('final response text guard', (): void => {
  it('keeps an ordinary final answer unchanged', (): void => {
    expect(sanitizeFinalText('已经根据现有结果完成总结。')).toBe('已经根据现有结果完成总结。');
  });

  it('removes raw tool protocol while preserving the visible prefix', (): void => {
    const result = sanitizeFinalText('我再生成一张图。<tool_calls:abc><tool_call:abc>run_shell_command');

    expect(result).toContain('我再生成一张图。');
    expect(result).toContain('工具循环因重复调用已停止');
    expect(result).not.toContain('<tool_calls:abc>');
    expect(result).not.toContain('run_shell_command');
  });

  it.each(['<tool_calls:', '<tool_call>', '<tool_sep:', '<arg_key>', '<arg_value:'])(
    'blocks %s when every character arrives separately',
    (marker: string): void => {
      const filter = createFinalTextFilter();
      const source = `可见前缀足够长，可以在流结束前显示。${marker}private-protocol`;
      let visible = '';

      for (const character of source) visible += filter.push(character);
      visible += filter.finish();

      expect(filter.blocked()).toBe(true);
      expect(visible).toContain('可见前缀足够长，可以在流结束前显示。');
      expect(visible).toContain('工具循环因重复调用已停止');
      expect(visible).not.toContain(marker);
      expect(visible).not.toContain('private-protocol');
    }
  );

  it('releases confirmed ordinary text before the stream finishes', (): void => {
    const filter = createFinalTextFilter();

    const firstVisible = filter.push('这是一段可以立即展示的普通最终回答。');

    expect(firstVisible.length).toBeGreaterThan(0);
    expect(`${firstVisible}${filter.finish()}`).toBe('这是一段可以立即展示的普通最终回答。');
  });

  it('does not block a similar literal that is not a protocol marker', (): void => {
    const filter = createFinalTextFilter();
    const source = 'literal <tool_callback should remain';

    const result = `${filter.push(source)}${filter.finish()}`;

    expect(filter.blocked()).toBe(false);
    expect(result).toBe(source);
  });

  it.each(['<tool_calls', '<tool_call', '<tool_sep', '<arg_key', '<arg_value'])('blocks an unfinished %s marker at end of stream', (marker: string): void => {
    const filter = createFinalTextFilter();

    const result = `${filter.push(`visible${marker}`)}${filter.finish()}`;

    expect(filter.blocked()).toBe(true);
    expect(result).toContain('visible');
    expect(result).toContain('工具循环因重复调用已停止');
    expect(result).not.toContain(marker);
  });
});
