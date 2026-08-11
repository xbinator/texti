/**
 * @file resource-budget.test.ts
 * @description Provider 结构化工具输入的有界字节扫描测试。
 */
import { describe, expect, it, vi } from 'vitest';
import { measureJsonBytes } from '../../../../../../../electron/main/modules/chat/runtime/stream/resource-budget.mjs';

describe('stream resource budget', (): void => {
  it('matches JSON UTF-8 bytes for ordinary structured input', (): void => {
    const input = { path: '文档/report.md', content: 'line\n"quoted"' };

    expect(measureJsonBytes(input, 10_000)).toBe(Buffer.byteLength(JSON.stringify(input), 'utf8'));
  });

  it('stops scanning oversized strings at the configured boundary', (): void => {
    expect(measureJsonBytes({ content: 'x'.repeat(4_096) }, 1_024)).toBeGreaterThan(1_024);
  });

  it('treats cyclic or accessor-bearing input as over budget without invoking the getter', (): void => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const getter = vi.fn((): string => 'secret');
    const accessor = Object.defineProperty({}, 'content', { enumerable: true, get: getter });

    expect(measureJsonBytes(cyclic, 1_024)).toBeGreaterThan(1_024);
    expect(measureJsonBytes(accessor, 1_024)).toBeGreaterThan(1_024);
    expect(getter).not.toHaveBeenCalled();
  });

  it('allows repeated acyclic references and counts each serialized occurrence', (): void => {
    const shared = { path: 'CONTEXT.md' };
    const input = { first: shared, second: shared };

    expect(measureJsonBytes(input, 10_000)).toBe(Buffer.byteLength(JSON.stringify(input), 'utf8'));
  });
});
