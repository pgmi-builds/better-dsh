/**
 * 扩展名 → 内置 tree-sitter 语法。AST 语言面的单一真相源：
 * walker 的语言推断与 ast-reminder 的提醒集合都从这里派生，
 * 不再各自维护（也不再"对 shipped 二进制实测"）。
 */
export const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.py': 'python', '.pyi': 'python',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.rs': 'rust',
  '.go': 'go',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp',
  '.html': 'html',
  '.css': 'css',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.sh': 'bash',
  '.rb': 'ruby',
}

/** 该设备支持的全部语法（去重、稳定序）。 */
export const AST_LANGUAGES: readonly string[] = [...new Set(Object.values(EXTENSION_TO_LANGUAGE))]

/** 小写扩展名 → 语法；未知扩展名返回 undefined。 */
export function languageForPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.')
  if (dot <= filePath.lastIndexOf('/')) return undefined
  return EXTENSION_TO_LANGUAGE[filePath.slice(dot).toLowerCase()]
}
