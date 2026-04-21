import type { EditorFile } from '../types';

export function parseFileName(filePath: string): { name: string; ext: string } {
  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  const [, name = '', ext = ''] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) ?? [];
  return { name, ext };
}

function buildFilePath(dirPath: string, fileName: string, originalPath: string): string {
  if (!dirPath) {
    return fileName;
  }

  const separator = originalPath.includes('\\') ? '\\' : '/';
  return `${dirPath}${separator}${fileName}`;
}

export function replaceFileName(filePath: string, nextName: string, ext: string): string {
  const separator = filePath.includes('\\') ? '\\' : '/';
  const segments = filePath.split(/[/\\]/);
  const dirPath = segments.slice(0, -1).join(separator);
  const nextFileName = ext ? `${nextName}.${ext}` : nextName;

  return buildFilePath(dirPath, nextFileName, filePath);
}

export function getDefaultSavePath(file: Pick<EditorFile, 'name' | 'ext'>): string {
  const name = file.name || '未命名';
  const ext = file.ext || 'md';
  return `${name}.${ext}`;
}

export function getRecoveredSavePath(filePath: string): string {
  const { name, ext } = parseFileName(filePath);
  const recoveredName = `${name || '未命名'}-recovered`;

  return replaceFileName(filePath, recoveredName, ext);
}
