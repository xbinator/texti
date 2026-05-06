/**
 * @file constant.test.ts
 * @description 上下文压缩配置常量测试
 */
import { describe, expect, it } from 'vitest';
import {
  RECENT_ROUND_PRESERVE,
  COMPRESSION_ROUND_THRESHOLD,
  COMPRESSION_CHAR_THRESHOLD,
  COMPRESSION_INPUT_CHAR_LIMIT,
  COMPRESSION_SUMMARY_TEXT_MAX,
  CURRENT_SCHEMA_VERSION
} from '@/components/BChatSidebar/utils/compression/constant';

describe('compression constant', () => {
  it('RECENT_ROUND_PRESERVE is 6', () => {
    expect(RECENT_ROUND_PRESERVE).toBe(6);
  });

  it('COMPRESSION_ROUND_THRESHOLD is 30', () => {
    expect(COMPRESSION_ROUND_THRESHOLD).toBe(30);
  });

  it('COMPRESSION_CHAR_THRESHOLD is 24000', () => {
    expect(COMPRESSION_CHAR_THRESHOLD).toBe(24_000);
  });

  it('COMPRESSION_INPUT_CHAR_LIMIT is 32000', () => {
    expect(COMPRESSION_INPUT_CHAR_LIMIT).toBe(32_000);
  });

  it('COMPRESSION_SUMMARY_TEXT_MAX is 4000', () => {
    expect(COMPRESSION_SUMMARY_TEXT_MAX).toBe(4_000);
  });

  it('CURRENT_SCHEMA_VERSION is 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it('round threshold should be greater than recent preserve', () => {
    expect(COMPRESSION_ROUND_THRESHOLD).toBeGreaterThan(RECENT_ROUND_PRESERVE);
  });

  it('char threshold should be greater than input limit', () => {
    // 验证阈值合理：输入限制应大于触发阈值（为裁剪留空间）
    expect(COMPRESSION_INPUT_CHAR_LIMIT).toBeGreaterThan(COMPRESSION_CHAR_THRESHOLD);
  });
});
