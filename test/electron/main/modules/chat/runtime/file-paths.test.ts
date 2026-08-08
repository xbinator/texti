/**
 * @file file-paths.test.ts
 * @description ChatRuntime 文件工具跨平台路径识别测试。
 */
import { describe, expect, it } from 'vitest';
import { isAbsoluteRuntimeFilePath, resolveRuntimeWriteTarget } from '../../../../../../electron/main/modules/chat/runtime/tools/paths.mjs';

describe('runtime file paths', (): void => {
  it.each(['C:\\workspace\\src\\index.ts', 'C:/workspace/src/index.ts', '\\\\server\\share\\src\\index.ts'])(
    'recognizes Windows absolute path %s',
    (filePath: string): void => {
      expect(isAbsoluteRuntimeFilePath(filePath)).toBe(true);
      expect(resolveRuntimeWriteTarget(filePath, undefined)).toMatchObject({ type: 'file', filePath, outsideWorkspace: true });
    }
  );

  it.each(['C:workspace\\src\\index.ts', 'workspace\\src\\index.ts'])('rejects Windows relative path %s as absolute', (filePath: string): void => {
    expect(isAbsoluteRuntimeFilePath(filePath)).toBe(false);
  });
});
