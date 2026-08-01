/**
 * @file languageDetect.ts
 * @description BSkill 文件扩展名到 lowlight 规范语言名的推断。
 */

/**
 * 扩展名（小写含点）到 lowlight common 已注册规范语言名的映射。
 * 直接映射到规范名，避免依赖 BMessage codeHighlight 内部别名表的完整性。
 */
const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.vue': 'xml',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.css': 'css',
  '.less': 'less',
  '.scss': 'scss',
  '.sql': 'sql',
  '.php': 'php',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.lua': 'lua',
  '.r': 'r',
  '.diff': 'diff',
  '.patch': 'diff',
  '.ini': 'ini',
  '.conf': 'ini',
  '.graphql': 'graphql',
  '.wasm': 'wasm'
};

/**
 * 根据文件路径推断高亮语言名。
 * 仅取最后一个 `.` 之后的扩展名，未识别或无扩展名返回空字符串。
 * @param filePath - 文件路径（可能含目录）
 * @returns lowlight 规范语言名（如 `'typescript'`），未识别返回 `''`
 */
export function detectLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? '';
}
