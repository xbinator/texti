/**
 * @file env.test.ts
 * @description 验证 Electron 主进程环境变量解析规则。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnvBoolean } from '../../../electron/main/env.mts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 读取生产环境变量文件内容。
 * @returns 生产环境变量文件内容
 */
function readProductionEnv(): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../.env.production'), 'utf-8');
}

describe('main process env', (): void => {
  it('parses boolean env values as booleans', (): void => {
    expect(parseEnvBoolean('true', false)).toBe(true);
    expect(parseEnvBoolean('false', true)).toBe(false);
  });

  it('declares reload menu production switch as a boolean value', (): void => {
    const content = readProductionEnv();

    expect(content).toContain('TIBIS_ENABLE_RELOAD_MENU=false');
    expect(content).not.toContain('TIBIS_ENABLE_RELOAD_MENU=0');
  });
});
