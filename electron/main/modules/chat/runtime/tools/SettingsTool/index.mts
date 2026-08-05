/**
 * @file index.mts
 * @description ChatRuntime 主进程设置工具。
 */
import type { ChatRuntimeMainToolExecutionInput } from '../../types.mjs';
import type {
  MainToolsDependencies,
  RuntimeGetSettingsInput,
  RuntimeRefreshMcpDiscoveryInput,
  RuntimeRemoveMcpServerInput,
  RuntimeSettingKey,
  RuntimeSettingValue,
  RuntimeUpdateMcpServerInput,
  RuntimeUpdateSettingsInput
} from '../types.mjs';
import type { AIToolExecutionResult, MCPServerConfig } from 'types/ai';
import { nanoid } from 'nanoid';
import { refreshMcpDiscovery } from '../../../../mcp/session.mjs';
import {
  ADD_MCP_SERVER_TOOL_NAME,
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
  GET_MCP_SETTINGS_TOOL_NAME,
  GET_SETTINGS_TOOL_NAME,
  MAX_CONNECT_TIMEOUT_MS,
  MAX_TOOL_CALL_TIMEOUT_MS,
  MIN_CONNECT_TIMEOUT_MS,
  MIN_TOOL_CALL_TIMEOUT_MS,
  REFRESH_MCP_DISCOVERY_TOOL_NAME,
  REMOVE_MCP_SERVER_TOOL_NAME,
  SETTINGS_TOOL_NAMES,
  UPDATE_MCP_SERVER_TOOL_NAME,
  UPDATE_SETTINGS_TOOL_NAME
} from '../constants.mjs';
import { isRecord, isRuntimeSettingKey, isRuntimeSettingsSnapshot, isRuntimeUpdateSettingsResult } from '../guards.mjs';
import { createBridgeFailureResult, createMainDeniedResult, createMainToolFailureResult, createMainToolSuccessResult } from '../results.mjs';
import {
  findRuntimeMcpServer,
  normalizeRuntimeMcpSettings,
  normalizeRuntimeMcpTimeoutMs,
  normalizeRuntimeStringArray,
  normalizeRuntimeStringRecord,
  redactMcpEditorJson,
  readRuntimeMcpSettings,
  updateRuntimeMcpSettings
} from '../settings-file.mjs';

/**
 * 判断工具是否属于设置工具模块。
 * @param toolName - 工具名称
 * @returns 是否为设置工具
 */
export function isSettingsTool(toolName: string): boolean {
  return SETTINGS_TOOL_NAMES.has(toolName);
}

/**
 * 判断值是否为 Runtime 设置值。
 * @param value - 待判断值
 * @returns 是否为设置值
 */
function isRuntimeSettingValue(value: unknown): value is RuntimeSettingValue {
  return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number';
}

/**
 * 归一化 get_settings 输入。
 * @param input - 原始工具输入
 * @returns 归一化设置读取输入或失败结果
 */
function normalizeRuntimeGetSettingsInput(input: unknown): RuntimeGetSettingsInput | AIToolExecutionResult {
  const source = isRecord(input) ? input : {};
  const rawKeys = source.keys;

  if (rawKeys === undefined) return { keys: ['theme', 'themePreset', 'sourceMode', 'editorPageWidth'] };
  if (Array.isArray(rawKeys)) return { keys: rawKeys.filter(isRuntimeSettingKey) };
  if (isRuntimeSettingKey(rawKeys)) return { keys: [rawKeys] };
  return createMainToolFailureResult(GET_SETTINGS_TOOL_NAME, 'INVALID_INPUT', '不支持的设置键。');
}

/**
 * 判断值是否为主题模式。
 * @param value - 待判断值
 * @returns 是否为主题模式
 */
function isRuntimeThemeMode(value: unknown): value is string {
  return value === 'dark' || value === 'light' || value === 'system';
}

/**
 * 判断值是否为编辑器页宽。
 * @param value - 待判断值
 * @returns 是否为编辑器页宽
 */
function isRuntimeEditorPageWidth(value: unknown): value is string {
  return value === 'default' || value === 'wide' || value === 'full';
}

/**
 * 归一化 update_settings 输入。
 * @param input - 原始工具输入
 * @returns 归一化设置修改输入或失败结果
 */
function normalizeRuntimeUpdateSettingsInput(input: unknown): RuntimeUpdateSettingsInput | AIToolExecutionResult {
  const source = isRecord(input) ? input : {};
  if (!isRuntimeSettingKey(source.key)) return createMainToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', '不支持修改该设置项。');

  if (source.key === 'theme') {
    if (isRuntimeThemeMode(source.value)) return { key: source.key, value: source.value };
    return createMainToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', 'theme 只能设置为 dark、light 或 system。');
  }
  if (source.key === 'themePreset') {
    if (typeof source.value === 'string' && source.value.trim()) return { key: source.key, value: source.value };
    return createMainToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', 'themePreset 必须设置为主题预设 ID。');
  }
  if (source.key === 'sourceMode') {
    if (typeof source.value === 'boolean') return { key: source.key, value: source.value };
    return createMainToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', 'sourceMode 必须设置为布尔值。');
  }
  if (source.key === 'editorPageWidth') {
    if (isRuntimeEditorPageWidth(source.value)) return { key: source.key, value: source.value };
    return createMainToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', 'editorPageWidth 只能设置为 default、wide 或 full。');
  }

  return createMainToolFailureResult(UPDATE_SETTINGS_TOOL_NAME, 'INVALID_INPUT', '不支持修改该设置项。');
}

/**
 * 创建 MCP server 配置。
 * @param input - 原始工具输入
 * @returns MCP server 配置或失败结果
 */
function createRuntimeMcpServerFromInput(input: unknown): MCPServerConfig | AIToolExecutionResult {
  const source = isRecord(input) ? input : {};
  const command = typeof source.command === 'string' ? source.command.trim() : '';
  if (!command) return createMainToolFailureResult(ADD_MCP_SERVER_TOOL_NAME, 'INVALID_INPUT', 'command 不能为空。');

  return {
    id: nanoid(),
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : command,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    transport: 'stdio',
    command,
    args: normalizeRuntimeStringArray(source.args),
    env: normalizeRuntimeStringRecord(source.env),
    headers: {},
    toolAllowlist: normalizeRuntimeStringArray(source.toolAllowlist),
    connectTimeoutMs: normalizeRuntimeMcpTimeoutMs(source.connectTimeoutMs, DEFAULT_MCP_CONNECT_TIMEOUT_MS, MIN_CONNECT_TIMEOUT_MS, MAX_CONNECT_TIMEOUT_MS),
    toolCallTimeoutMs: normalizeRuntimeMcpTimeoutMs(
      source.toolCallTimeoutMs,
      DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
      MIN_TOOL_CALL_TIMEOUT_MS,
      MAX_TOOL_CALL_TIMEOUT_MS
    )
  };
}

/**
 * 创建 MCP server 更新补丁。
 * @param value - 原始补丁
 * @returns MCP server 补丁
 */
function createRuntimeMcpServerPatch(value: unknown): Partial<MCPServerConfig> {
  const source = isRecord(value) ? value : {};
  const patch: Partial<MCPServerConfig> = {};

  if (typeof source.name === 'string') patch.name = source.name.trim();
  if (typeof source.enabled === 'boolean') patch.enabled = source.enabled;
  if (typeof source.command === 'string') patch.command = source.command.trim();
  if (Array.isArray(source.args)) patch.args = normalizeRuntimeStringArray(source.args);
  if (source.env !== undefined) patch.env = normalizeRuntimeStringRecord(source.env);
  if (Array.isArray(source.toolAllowlist)) patch.toolAllowlist = normalizeRuntimeStringArray(source.toolAllowlist);
  if (source.connectTimeoutMs !== undefined) {
    patch.connectTimeoutMs = normalizeRuntimeMcpTimeoutMs(
      source.connectTimeoutMs,
      DEFAULT_MCP_CONNECT_TIMEOUT_MS,
      MIN_CONNECT_TIMEOUT_MS,
      MAX_CONNECT_TIMEOUT_MS
    );
  }
  if (source.toolCallTimeoutMs !== undefined) {
    patch.toolCallTimeoutMs = normalizeRuntimeMcpTimeoutMs(
      source.toolCallTimeoutMs,
      DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
      MIN_TOOL_CALL_TIMEOUT_MS,
      MAX_TOOL_CALL_TIMEOUT_MS
    );
  }

  return patch;
}

/**
 * 归一化 MCP server 更新输入。
 * @param input - 原始工具输入
 * @returns 更新输入或失败结果
 */
function normalizeRuntimeUpdateMcpServerInput(input: unknown): RuntimeUpdateMcpServerInput | AIToolExecutionResult {
  const source = isRecord(input) ? input : {};
  if (typeof source.serverId !== 'string' || !source.serverId.trim()) {
    return createMainToolFailureResult(UPDATE_MCP_SERVER_TOOL_NAME, 'INVALID_INPUT', 'serverId 不能为空。');
  }

  return { serverId: source.serverId.trim(), patch: createRuntimeMcpServerPatch(source.patch) };
}

/**
 * 归一化 MCP server ID 输入。
 * @param input - 原始工具输入
 * @param toolName - 工具名称
 * @returns server ID 输入或失败结果
 */
function normalizeRuntimeMcpServerIdInput(
  input: unknown,
  toolName: string
): RuntimeRemoveMcpServerInput | RuntimeRefreshMcpDiscoveryInput | AIToolExecutionResult {
  const source = isRecord(input) ? input : {};
  if (typeof source.serverId !== 'string' || !source.serverId.trim()) {
    return createMainToolFailureResult(toolName, 'INVALID_INPUT', 'serverId 不能为空。');
  }

  return { serverId: source.serverId.trim() };
}

/**
 * 格式化 MCP 确认对比内容。
 * @param value - 待展示值
 * @returns JSON 字符串
 */
function formatRuntimeMcpConfirmationValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * 执行 get_settings 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeGetSettingsTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const normalizedInput = normalizeRuntimeGetSettingsInput(input.input);
  if ('status' in normalizedInput) return normalizedInput;

  const bridgeResult = await deps.requestBridge({ runtimeId: input.runtime.runtimeId, toolCallId: input.toolCallId, kind: 'settings-snapshot' });
  if (bridgeResult.status === 'failure') return createBridgeFailureResult(input.toolName, bridgeResult.error);
  if (!isRuntimeSettingsSnapshot(bridgeResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '设置快照格式无效');

  const settings: Partial<Record<RuntimeSettingKey, RuntimeSettingValue>> = {};
  for (const key of normalizedInput.keys) {
    if (bridgeResult.data.settings[key] !== undefined && isRuntimeSettingValue(bridgeResult.data.settings[key])) {
      settings[key] = bridgeResult.data.settings[key];
    }
  }
  return createMainToolSuccessResult(GET_SETTINGS_TOOL_NAME, { settings });
}

/**
 * 执行 update_settings 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeUpdateSettingsTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const normalizedInput = normalizeRuntimeUpdateSettingsInput(input.input);
  if ('status' in normalizedInput) return normalizedInput;

  const snapshotResult = await deps.requestBridge({ runtimeId: input.runtime.runtimeId, toolCallId: input.toolCallId, kind: 'settings-snapshot' });
  if (snapshotResult.status === 'failure') return createBridgeFailureResult(input.toolName, snapshotResult.error);
  if (!isRuntimeSettingsSnapshot(snapshotResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '设置快照格式无效');

  const previousValue = snapshotResult.data.settings[normalizedInput.key] ?? '';
  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: UPDATE_SETTINGS_TOOL_NAME,
      title: 'AI 想要修改应用设置',
      description: `AI 请求修改设置项 ${normalizedInput.key}。`,
      riskLevel: 'write',
      allowRemember: true,
      rememberScopes: ['session', 'always'],
      customInput: { enabled: true, placeholder: '输入新的设置值...', triggerLabel: '改成别的' },
      beforeText: `${normalizedInput.key}: ${String(previousValue)}`,
      afterText: `${normalizedInput.key}: ${String(normalizedInput.value)}`
    }
  });
  if (!decision.approved) return createMainDeniedResult(input.toolName);

  const applyResult = await deps.requestBridge({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    kind: 'apply-setting',
    payload: normalizedInput
  });
  if (applyResult.status === 'failure') return createBridgeFailureResult(input.toolName, applyResult.error);
  if (!isRuntimeUpdateSettingsResult(applyResult.data)) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '设置修改结果格式无效');
  return createMainToolSuccessResult(UPDATE_SETTINGS_TOOL_NAME, applyResult.data);
}

/**
 * 执行新增 MCP server 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeAddMcpServerTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const server = createRuntimeMcpServerFromInput(input.input);
  if ('status' in server) return server;

  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: ADD_MCP_SERVER_TOOL_NAME,
      title: 'AI 想要新增 MCP server',
      description: `AI 请求新增 MCP server：${server.name}。`,
      riskLevel: 'write',
      beforeText: '新增前不会修改现有 MCP server。',
      afterText: formatRuntimeMcpConfirmationValue(server)
    }
  });
  if (!decision.approved) return createMainDeniedResult(input.toolName);

  try {
    const settings = await updateRuntimeMcpSettings((current) => ({ servers: [...current.servers, server] }));
    return createMainToolSuccessResult(ADD_MCP_SERVER_TOOL_NAME, { applied: true, server: findRuntimeMcpServer(settings, server.id) ?? server });
  } catch (error) {
    const message = error instanceof Error ? error.message : '新增 MCP server 失败';
    return createMainToolFailureResult(input.toolName, 'EXECUTION_FAILED', message);
  }
}

/**
 * 执行更新 MCP server 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeUpdateMcpServerTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const normalizedInput = normalizeRuntimeUpdateMcpServerInput(input.input);
  if ('status' in normalizedInput) return normalizedInput;

  const settings = await readRuntimeMcpSettings();
  const existingServer = findRuntimeMcpServer(settings, normalizedInput.serverId);
  if (!existingServer) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '找不到指定的 MCP server。');

  const nextServer: MCPServerConfig = { ...existingServer, ...normalizedInput.patch, id: existingServer.id, transport: 'stdio' };
  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: UPDATE_MCP_SERVER_TOOL_NAME,
      title: 'AI 想要更新 MCP server',
      description: `AI 请求更新 MCP server：${existingServer.name}。`,
      riskLevel: 'write',
      beforeText: formatRuntimeMcpConfirmationValue(existingServer),
      afterText: formatRuntimeMcpConfirmationValue(nextServer)
    }
  });
  if (!decision.approved) return createMainDeniedResult(input.toolName);

  try {
    const updatedSettings = await updateRuntimeMcpSettings((current) => ({
      servers: current.servers.map((server) => (server.id === existingServer.id ? nextServer : server))
    }));
    return createMainToolSuccessResult(UPDATE_MCP_SERVER_TOOL_NAME, {
      applied: true,
      previousServer: existingServer,
      currentServer: findRuntimeMcpServer(updatedSettings, existingServer.id) ?? nextServer
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新 MCP server 失败';
    return createMainToolFailureResult(input.toolName, 'EXECUTION_FAILED', message);
  }
}

/**
 * 执行删除 MCP server 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeRemoveMcpServerTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const normalizedInput = normalizeRuntimeMcpServerIdInput(input.input, input.toolName);
  if ('status' in normalizedInput) return normalizedInput;

  const settings = await readRuntimeMcpSettings();
  const existingServer = findRuntimeMcpServer(settings, normalizedInput.serverId);
  if (!existingServer) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '找不到指定的 MCP server。');

  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: REMOVE_MCP_SERVER_TOOL_NAME,
      title: 'AI 想要删除 MCP server',
      description: `AI 请求删除 MCP server：${existingServer.name}。`,
      riskLevel: 'write',
      beforeText: formatRuntimeMcpConfirmationValue(existingServer),
      afterText: '删除后该 MCP server 不会再出现在配置中。'
    }
  });
  if (!decision.approved) return createMainDeniedResult(input.toolName);

  try {
    await updateRuntimeMcpSettings((current) => ({ servers: current.servers.filter((server) => server.id !== existingServer.id) }));
    return createMainToolSuccessResult(REMOVE_MCP_SERVER_TOOL_NAME, { applied: true, removedServer: existingServer });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除 MCP server 失败';
    return createMainToolFailureResult(input.toolName, 'EXECUTION_FAILED', message);
  }
}

/**
 * 执行刷新 MCP discovery 工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
async function executeRefreshMcpDiscoveryTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  const normalizedInput = normalizeRuntimeMcpServerIdInput(input.input, input.toolName);
  if ('status' in normalizedInput) return normalizedInput;

  const settings = await readRuntimeMcpSettings();
  const existingServer = findRuntimeMcpServer(settings, normalizedInput.serverId);
  if (!existingServer) return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '找不到指定的 MCP server。');

  const decision = await deps.requestConfirmation({
    runtimeId: input.runtime.runtimeId,
    toolCallId: input.toolCallId,
    request: {
      toolCallId: input.toolCallId,
      toolName: REFRESH_MCP_DISCOVERY_TOOL_NAME,
      title: 'AI 想要刷新 MCP discovery',
      description: `AI 请求启动本地 MCP server 并刷新工具列表：${existingServer.name}。`,
      riskLevel: 'write',
      beforeText: '刷新前不会修改 MCP 配置。',
      afterText: formatRuntimeMcpConfirmationValue(existingServer)
    }
  });
  if (!decision.approved) return createMainDeniedResult(input.toolName);

  try {
    const result = await refreshMcpDiscovery(existingServer);
    return createMainToolSuccessResult(REFRESH_MCP_DISCOVERY_TOOL_NAME, { refreshed: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '刷新 MCP discovery 失败';
    return createMainToolFailureResult(input.toolName, 'EXECUTION_FAILED', message);
  }
}

/**
 * 执行设置工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
export async function executeSettingsTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  if (input.toolName === GET_SETTINGS_TOOL_NAME) return executeGetSettingsTool(input, deps);
  if (input.toolName === UPDATE_SETTINGS_TOOL_NAME) return executeUpdateSettingsTool(input, deps);
  if (input.toolName === GET_MCP_SETTINGS_TOOL_NAME) {
    const settings = await readRuntimeMcpSettings();
    return createMainToolSuccessResult(GET_MCP_SETTINGS_TOOL_NAME, { settings: redactMcpEditorJson(normalizeRuntimeMcpSettings(settings)) });
  }
  if (input.toolName === ADD_MCP_SERVER_TOOL_NAME) return executeAddMcpServerTool(input, deps);
  if (input.toolName === UPDATE_MCP_SERVER_TOOL_NAME) return executeUpdateMcpServerTool(input, deps);
  if (input.toolName === REMOVE_MCP_SERVER_TOOL_NAME) return executeRemoveMcpServerTool(input, deps);
  if (input.toolName === REFRESH_MCP_DISCOVERY_TOOL_NAME) return executeRefreshMcpDiscoveryTool(input, deps);
  return createMainToolFailureResult(input.toolName, 'TOOL_NOT_FOUND', `Unsupported settings tool: ${input.toolName}`);
}
