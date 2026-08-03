/**
 * @file env.mts
 * @description 主进程环境变量读取与默认配置。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 主进程环境变量配置。
 */
interface EnvConfig {
  /** 渲染进程开发服务 host。 */
  DEV_SERVER_HOST: string;
  /** 渲染进程开发服务 port。 */
  DEV_SERVER_PORT: string;
  /** 开发环境是否启用刷新菜单，生产环境仍会强制关闭。 */
  TIBIS_ENABLE_RELOAD_MENU: boolean;
}

const ENV_KEYS = ['DEV_SERVER_HOST', 'DEV_SERVER_PORT', 'TIBIS_ENABLE_RELOAD_MENU'] as const;

/**
 * 支持读取的环境变量键。
 */
type EnvKey = (typeof ENV_KEYS)[number];

/**
 * 判断主进程目录是否来自编译后的 dist-electron 输出。
 * @param mainModuleDir - 主进程模块目录
 * @returns 是否为 dist-electron/electron/main 目录
 */
function isBuiltMainDir(mainModuleDir: string): boolean {
  return path.normalize(mainModuleDir).endsWith(path.join('dist-electron', 'electron', 'main'));
}

/**
 * 解析项目根目录，用于在源码与编译后主进程中读取同一份环境文件。
 * @returns 项目根目录绝对路径
 */
function resolveProjectRoot(): string {
  return isBuiltMainDir(__dirname) ? path.resolve(__dirname, '../../..') : path.resolve(__dirname, '../..');
}

/**
 * 判断字符串键是否属于主进程环境变量白名单。
 * @param key - 待判断的环境变量键
 * @returns 是否为支持的环境变量键
 */
function isEnvKey(key: string): key is EnvKey {
  return ENV_KEYS.includes(key as EnvKey);
}

/**
 * 将环境变量字符串解析为布尔值。
 * @param value - 环境变量字符串
 * @param fallback - 无法识别时使用的回退值
 * @returns 解析后的布尔值
 */
export function parseEnvBoolean(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

/**
 * 从单个环境变量文件读取白名单配置。
 * @param envPath - 环境变量文件路径
 * @returns 解析后的局部环境配置
 */
function readEnvFile(envPath: string): Partial<Record<EnvKey, string>> {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  const config: Partial<Record<EnvKey, string>> = {};

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (isEnvKey(key)) {
      config[key] = value;
    }
  }

  return config;
}

/**
 * 选择按优先级覆盖后的字符串环境变量。
 * @param key - 环境变量键
 * @param configs - 按低优先级到高优先级排列的配置
 * @returns 命中的字符串环境变量
 */
function pickEnvValue(key: EnvKey, configs: Array<Partial<Record<EnvKey, string>>>): string | undefined {
  for (let i = configs.length - 1; i >= 0; i--) {
    const value = configs[i][key];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

/**
 * 加载主进程环境变量配置。
 * @returns 主进程环境变量配置
 */
function loadEnv(): EnvConfig {
  const defaultConfig: EnvConfig = {
    DEV_SERVER_HOST: '127.0.0.1',
    DEV_SERVER_PORT: '1420',
    TIBIS_ENABLE_RELOAD_MENU: true
  };

  const projectRoot = resolveProjectRoot();
  const baseConfig = readEnvFile(path.join(projectRoot, '.env'));
  const productionConfig = process.env.NODE_ENV === 'production' ? readEnvFile(path.join(projectRoot, '.env.production')) : {};
  const processConfig: Partial<Record<EnvKey, string>> = {};

  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      processConfig[key] = value;
    }
  }

  const configs = [baseConfig, productionConfig, processConfig];
  const reloadMenuValue = pickEnvValue('TIBIS_ENABLE_RELOAD_MENU', configs);

  return {
    DEV_SERVER_HOST: pickEnvValue('DEV_SERVER_HOST', configs) ?? defaultConfig.DEV_SERVER_HOST,
    DEV_SERVER_PORT: pickEnvValue('DEV_SERVER_PORT', configs) ?? defaultConfig.DEV_SERVER_PORT,
    TIBIS_ENABLE_RELOAD_MENU:
      reloadMenuValue === undefined ? defaultConfig.TIBIS_ENABLE_RELOAD_MENU : parseEnvBoolean(reloadMenuValue, defaultConfig.TIBIS_ENABLE_RELOAD_MENU)
  };
}

export const env = loadEnv();
