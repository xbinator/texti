/**
 * 安全存储管理模块
 * 使用 electron-store 提供加密的数据持久化存储
 * 支持使用系统安全存储（safeStorage）加密敏感数据
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, safeStorage } from 'electron';
import ElectronStore from 'electron-store';

// 存储数据结构定义
interface StoreSchema extends Record<string, unknown> {
  salt: string; // 加密盐值
}

// 扩展 Store 类型以包含 get/set/delete 方法
type StoreType = ElectronStore<StoreSchema> & {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

// Store 实例（单例模式）
let storeInstance: StoreType | null = null;

// 加密密钥文件名
const KEY_FILE_NAME = 'texti-key.bin';
// 存储文件名
const STORE_NAME = 'texti-secure-store';

/**
 * 获取加密密钥文件路径
 */
function getEncryptionKeyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
}

/**
 * 获取存储文件路径
 */
function getStorePath(): string {
  return path.join(app.getPath('userData'), `${STORE_NAME}.json`);
}

/**
 * 加载或创建加密密钥
 * 优先从文件加载已存在的密钥，否则生成新密钥并加密保存
 * 使用系统 safeStorage 进行密钥加密（macOS Keychain / Windows DPAPI）
 */
function loadOrCreateEncryptionKey(): string {
  const keyPath = getEncryptionKeyPath();

  // 尝试加载已存在的加密密钥
  if (fs.existsSync(keyPath)) {
    const encryptedKey = fs.readFileSync(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        // 使用系统安全存储解密
        return safeStorage.decryptString(encryptedKey);
      } catch {
        // 解密失败，删除损坏的密钥文件
        fs.unlinkSync(keyPath);
      }
    }
  }

  // 生成新密钥
  const newKey = `texti-encryption-key-${Date.now().toString(36)}`;

  // 使用系统安全存储加密并保存
  if (safeStorage.isEncryptionAvailable()) {
    const encryptedKey = safeStorage.encryptString(newKey);
    fs.writeFileSync(keyPath, encryptedKey);
  }

  return newKey;
}

/**
 * 清除损坏的存储文件
 * 当存储文件损坏无法读取时调用
 */
function clearCorruptedStore(): void {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    try {
      fs.unlinkSync(storePath);
      console.log('[store] Cleared corrupted store file');
    } catch (error) {
      console.error('[store] Failed to clear corrupted store:', error);
    }
  }
}

/**
 * 初始化安全存储
 * 创建加密存储实例，用于保存应用配置和敏感数据
 * 如果存储文件损坏，会自动清除并重新创建
 */
export async function initStore(): Promise<void> {
  const encryptionKey = loadOrCreateEncryptionKey();

  try {
    storeInstance = new ElectronStore<StoreSchema>({
      name: STORE_NAME, // 存储文件名
      encryptionKey, // 加密密钥
      defaults: { salt: '' } // 默认值
    }) as StoreType;
  } catch (error) {
    // 如果初始化失败（如存储文件损坏），清除后重试
    console.error('[store] Failed to initialize store, attempting to clear corrupted data:', error);
    clearCorruptedStore();

    // 重新创建存储
    storeInstance = new ElectronStore<StoreSchema>({
      name: STORE_NAME,
      encryptionKey,
      defaults: { salt: '' }
    }) as StoreType;

    console.log('[store] Store reinitialized successfully');
  }
}

/**
 * 获取存储实例
 * @throws 如果存储未初始化会抛出错误
 */
export function getStore(): StoreType {
  if (!storeInstance) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return storeInstance;
}
