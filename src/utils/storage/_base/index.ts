// 导出 BaseStorage 类
export { default as BaseStorage } from './BaseStorage';

// 导出数据编解码工具
export { encodeData, decodeData, converter } from './manipulator';

// 导出类型定义
export type { StorageLike, ConverterOptions, BaseStorageOptions, StorageData, SetStorage, GetStorage } from './type';

import BaseStorage from './BaseStorage';

/**
 * 本地存储实例
 * 使用 localStorage 作为存储适配器
 */
export const local = new BaseStorage({
  storageAdapter: () => localStorage
});

/**
 * 会话存储实例
 * 使用 sessionStorage 作为存储适配器
 */
export const session = new BaseStorage({
  storageAdapter: () => sessionStorage
});
