/**
 * @file toolLabels.ts
 * @description 聊天工具调用的用户可读展示文案。
 */

/** 内置工具对应的用户可读动作文案。 */
export const TOOL_ACTION_LABELS: Record<string, { alias: string }> = {
  read_file: { alias: '读取文件' },
  read_current_document: { alias: '读取当前文档' },
  read_current_webpage: { alias: '读取当前网页' },
  read_directory: { alias: '读取目录' },
  glob: { alias: '查找文件' },
  grep: { alias: '搜索内容' },
  delegate_task: { alias: '委派任务' },
  stage_file_write: { alias: '暂存写入文件' },
  stage_file_edit: { alias: '暂存修改文件' },
  list_files: { alias: '查看文件列表' },
  search_files: { alias: '搜索文件' },
  write_file: { alias: '写入文件' },
  edit_file: { alias: '修改文件' },
  operate_webpage: { alias: '操作当前网页' },
  edit_memory: { alias: '管理记忆' },
  run_shell_command: { alias: '终端命令' },
  get_current_time: { alias: '获取当前时间' },
  get_settings: { alias: '获取设置' },
  get_mcp_settings: { alias: '获取 MCP 设置' },
  update_settings: { alias: '更新设置' },
  add_mcp_server: { alias: '添加 MCP 服务器' },
  update_mcp_server: { alias: '更新 MCP 服务器' },
  remove_mcp_server: { alias: '移除 MCP 服务器' },
  refresh_mcp_discovery: { alias: '刷新 MCP 发现' },
  query_logs: { alias: '查询日志' },
  skill: { alias: '调用技能' },
  question: { alias: '提问' },
  ask_user_choice: { alias: '提问' },
  ask_user_question: { alias: '提问' },
  todowrite: { alias: '已完成' },
  create_document: { alias: '创建文档' },
  tavily_search: { alias: '搜索网页' },
  tavily_extract: { alias: '提取网页内容' },
  open_draft: { alias: '打开草稿' },
  open_resource: { alias: '打开资源' },
  open_widget: { alias: '打开小组件' },
  widget: { alias: '小组件' }
};

/**
 * 将十六进制编码的字符串还原为 UTF-8 文本。
 * @param value - 十六进制字符串
 * @returns 解码后的文本，失败时返回空字符串
 */
function decodeHexText(value: string): string {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
    return '';
  }

  const bytes = value.match(/[0-9a-f]{2}/gi)?.map((item) => Number.parseInt(item, 16)) ?? [];
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return '';
  }
}

/**
 * 将 MCP SDK 工具名转换为用户可读展示名。
 * @param toolName - 内部 MCP SDK 工具名
 * @returns 用户可读展示名，非 MCP 工具或解析失败时返回空字符串
 */
function getMcpActionAlias(toolName: string): string {
  const match = /^mcp_[0-9a-f]+_([0-9a-f]+)$/i.exec(toolName);
  if (!match) {
    return '';
  }

  const decodedToolName = decodeHexText(match[1]);
  return decodedToolName ? `MCP: ${decodedToolName}` : '';
}

/**
 * 获取工具对应的用户可读动作。
 * @param toolName - 内部工具名称
 * @returns 用户可读动作文案
 */
export function getActionLabel(toolName: string): { alias: string } {
  const mcpAlias = getMcpActionAlias(toolName);
  if (mcpAlias) {
    return { alias: mcpAlias };
  }

  return TOOL_ACTION_LABELS[toolName] ?? { alias: toolName };
}
