/**
 * @file package-scripts.test.ts
 * @description 验证 package.json 中的脚本声明满足当前仓库的跨平台执行要求。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * package.json 中的 scripts 数据结构。
 */
interface PackageScriptsManifest {
  /** npm scripts 映射表。 */
  scripts?: Record<string, string>;
}

/**
 * 读取仓库根目录 package.json 的脚本配置。
 * @returns package.json 中的 scripts 配置对象
 */
function readPackageScripts(): PackageScriptsManifest {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  const packageJsonContent = readFileSync(packageJsonPath, 'utf8');

  return JSON.parse(packageJsonContent) as PackageScriptsManifest;
}

describe('package scripts', () => {
  it('uses a cross-platform test command', () => {
    const manifest = readPackageScripts();

    expect(manifest.scripts?.test).toBe('cross-env HOST=127.0.0.1 vitest run');
  });
});
