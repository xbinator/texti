/**
 * @file constant.ts
 * @description 上下文压缩模块配置常量，集中定义所有阈值和限制。
 */

/** 最近保留消息轮数 */
export const RECENT_ROUND_PRESERVE = 6;

/** 自动压缩触发——消息轮数阈值 */
export const COMPRESSION_ROUND_THRESHOLD = 30;

/** 自动压缩触发——上下文体积阈值（字符数） */
export const COMPRESSION_CHAR_THRESHOLD = 24_000;

/** 规则裁剪输入体积硬上限（字符数） */
export const COMPRESSION_INPUT_CHAR_LIMIT = 32_000;

/** 摘要 summaryText 硬上限（字符数），超出截断 */
export const COMPRESSION_SUMMARY_TEXT_MAX = 4_000;

/** 当前支持的摘要 schema 版本 */
export const CURRENT_SCHEMA_VERSION = 1;
