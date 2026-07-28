/**
 * @file package-config.test.ts
 * @description Shell PTY 原生依赖和打包边界配置测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import packageJson from '@@/package.json';

/** Electron Builder 配置的测试所需形状。 */
interface BuilderConfig {
  /** asar 解包规则。 */
  asarUnpack?: unknown;
}

describe('Shell PTY package configuration', (): void => {
  it('pins native dependencies and rebuilds node-pty for Electron', (): void => {
    expect(packageJson.dependencies['node-pty']).toBe('1.1.0');
    expect(packageJson.dependencies['@xterm/headless']).toBe('6.0.0');
    expect(packageJson.pnpm.onlyBuiltDependencies).toContain('node-pty');
    expect(packageJson.scripts.postinstall).toContain('better-sqlite3,node-pty');
    expect(packageJson.scripts['shell:pty:smoke']).toContain('electron:build-main');
    expect(packageJson.scripts['shell:pty:smoke']).toContain('electron/cli.js');
    expect(packageJson.scripts['shell:pty:smoke']).toContain('--shell-pty-smoke');
    expect(packageJson.scripts['shell:pty:packaged-smoke']).toContain('pty-packaged-smoke.mjs');
  });

  it('unpacks node-pty native files and platform helpers', (): void => {
    const yaml = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    const config = load(yaml) as BuilderConfig;

    expect(config.asarUnpack).toEqual(expect.arrayContaining(['node_modules/node-pty/**/*']));
  });

  it('keeps PTY smoke checks out of the release workflow', (): void => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).not.toContain('pnpm shell:pty:smoke');
    expect(workflow).not.toContain('pnpm shell:pty:packaged-smoke');
    expect(workflow).not.toContain('xvfb-run -a pnpm shell:pty:smoke');
  });
});
