/**
 * 存储适配器接口
 * 模拟 localStorage/sessionStorage 的 API
 */
export interface StorageLike {
  /** 获取一个键名对应的值 */
  getItem(key: string): string | null;
  /** 设置一个键值对 */
  setItem(key: string, value: string): void;
  /** 移除键名对应的值 */
  removeItem(key: string): void;
}

/**
 * 数据转换选项
 */
export interface ConverterOptions {
  /** 是否通过 `JSON.stringify` 序列化 `value` 数据 */
  isSerialize?: boolean;
  /** 是否通过 encodeURIComponent / decodeURIComponent 转义 */
  isEscape?: boolean;
  /** 是否通过 Base64 编码 */
  isBase64?: boolean;
}

/**
 * BaseStorage 配置选项
 */
export interface BaseStorageOptions {
  /** 过期时间（时间戳） */
  expires?: number;
  /** 存储适配器 */
  storageAdapter(): StorageLike;
}

/**
 * 存储数据结构
 */
export interface StorageData<T = unknown> {
  /** 数据值 */
  value: T;
  /** 过期时间（时间戳） */
  expires?: number;
  /** 是否第一次访问后自动被删除 */
  once?: boolean;
}

/**
 * 设置存储选项
 */
export interface SetStorage<T = unknown> extends ConverterOptions {
  /** 过期时间（Date 对象或秒数） */
  expires?: Date | number;
  /** 是否第一次访问后自动被删除 */
  once?: boolean;
  /** 是否合并数据，或自定义合并函数 */
  merge?: boolean | ((newValue: T, oldValue: T) => T);
}

/**
 * 获取存储选项
 */
export interface GetStorage extends ConverterOptions {
  /** 获取值后将对应的键从缓存中删除 */
  isDelete?: boolean;
}
