/**
 * @file languageDetect.test.ts
 * @description 验证 BSkill 文件扩展名到高亮语言名的推断。
 */
import { describe, expect, it } from 'vitest';
import { detectLanguage } from '@/components/BSkill/utils/languageDetect';

describe('detectLanguage', (): void => {
  it('maps common code extensions to canonical lowlight language names', (): void => {
    expect(detectLanguage('index.ts')).toBe('typescript');
    expect(detectLanguage('App.tsx')).toBe('typescript');
    expect(detectLanguage('main.js')).toBe('javascript');
    expect(detectLanguage('App.vue')).toBe('xml');
    expect(detectLanguage('config.json')).toBe('json');
    expect(detectLanguage('script.sh')).toBe('shell');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('style.css')).toBe('css');
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('Program.cs')).toBe('csharp');
    expect(detectLanguage('index.html')).toBe('xml');
  });

  it('is case-insensitive on extensions', (): void => {
    expect(detectLanguage('INDEX.TS')).toBe('typescript');
    expect(detectLanguage('App.VUE')).toBe('xml');
    expect(detectLanguage('Script.SH')).toBe('shell');
  });

  it('returns empty string for unknown extensions', (): void => {
    expect(detectLanguage('file.unknownext')).toBe('');
    expect(detectLanguage('data.dat')).toBe('');
  });

  it('returns empty string for paths without extension', (): void => {
    expect(detectLanguage('Makefile')).toBe('');
    expect(detectLanguage('path/to/noext')).toBe('');
  });

  it('handles paths with directories and only inspects the last extension', (): void => {
    expect(detectLanguage('src/components/BSkill/index.vue')).toBe('xml');
    expect(detectLanguage('/abs/path/to/file.py')).toBe('python');
    expect(detectLanguage('a/b.c/d.ts')).toBe('typescript');
  });
});
