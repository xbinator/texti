/**
 * @file constants.mts
 * @description ChatRuntime 主进程工具常量。
 */
import { getToolNamesByRuntimeGroup } from '../../../../../../shared/ai/tools/index.js';

export {
  ADD_MCP_SERVER_TOOL_NAME,
  CREATE_DOCUMENT_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  GET_MCP_SETTINGS_TOOL_NAME,
  GET_SETTINGS_TOOL_NAME,
  OPEN_RESOURCE_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME,
  READ_DIRECTORY_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  REFRESH_MCP_DISCOVERY_TOOL_NAME,
  REMOVE_MCP_SERVER_TOOL_NAME,
  UPDATE_MCP_SERVER_TOOL_NAME,
  UPDATE_SETTINGS_TOOL_NAME,
  WRITE_FILE_TOOL_NAME
} from '../../../../../../shared/ai/tools/index.js';

/** 主进程只读工具名称集合。 */
export const READ_TOOL_NAMES = new Set(getToolNamesByRuntimeGroup('main', 'read'));

/** 主进程文件工具名称集合。 */
export const FILE_TOOL_NAMES = new Set(getToolNamesByRuntimeGroup('main', 'file'));

/** 主进程设置工具名称集合。 */
export const SETTINGS_TOOL_NAMES = new Set(getToolNamesByRuntimeGroup('main', 'settings'));

/** 主进程资源工具名称集合。 */
export const RESOURCE_TOOL_NAMES = new Set(getToolNamesByRuntimeGroup('main', 'resource'));

/** 主进程可执行工具名称集合。 */
export const MAIN_PROCESS_TOOL_NAMES = new Set([...READ_TOOL_NAMES, ...FILE_TOOL_NAMES, ...SETTINGS_TOOL_NAMES, ...RESOURCE_TOOL_NAMES]);

/** 默认文件读取起始行。 */
export const DEFAULT_READ_FILE_OFFSET = 1;

/** 日志查询默认返回条数。 */
export const DEFAULT_QUERY_LOG_LIMIT = 50;

/** 日志查询最大返回条数。 */
export const MAX_QUERY_LOG_LIMIT = 100;

/** settings 文件名。 */
export const RUNTIME_SETTINGS_FILE_NAME = 'settings.json';

/** MCP 默认连接超时时间。 */
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 20_000;

/** MCP 默认工具调用超时时间。 */
export const DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS = 30_000;

/** MCP 最小连接超时时间。 */
export const MIN_CONNECT_TIMEOUT_MS = 1_000;

/** MCP 最大连接超时时间。 */
export const MAX_CONNECT_TIMEOUT_MS = 120_000;

/** MCP 最小工具调用超时时间。 */
export const MIN_TOOL_CALL_TIMEOUT_MS = 1_000;

/** MCP 最大工具调用超时时间。 */
export const MAX_TOOL_CALL_TIMEOUT_MS = 120_000;

/** URL 协议正则。 */
export const RUNTIME_URL_PROTOCOL_RE = /^(https?|mailto|ftp):\/\//i;
