import type { ConverterOptions, StorageData, BaseStorageOptions, SetStorage, GetStorage, StorageLike } from './type';
import { isNull } from 'lodash-es';
import { decodeData, encodeData } from './manipulator';

/**
 * 基础存储类
 * 提供统一的本地存储管理功能，支持过期时间、数据合并、Base64编码等特性
 */
export default class BaseStorage {
  /** 存储适配器 */
  private storageAdapter: () => StorageLike;

  /** 默认过期时间（秒） */
  private expires?: number;

  /**
   * 创建 BaseStorage 实例
   * @param options 配置选项
   */
  constructor(options: BaseStorageOptions) {
    this.storageAdapter = options.storageAdapter;
    this.expires = options.expires;
  }

  /**
   * 读取原始数据
   * @param key 键名
   * @param options 转换选项
   * @returns 存储数据对象
   */
  private read<T>(key: string, options: ConverterOptions = {}): StorageData<T> | null {
    const storage = this.getStorage();
    const result = decodeData<T>(storage.getItem(key), options);

    if (isNull(result)) {
      this.removeItem(key);
      return result;
    }

    return result;
  }

  /**
   * 合并新旧数据值
   * @param key 键名
   * @param value 新值
   * @param options 设置选项
   * @returns 合并后的值
   */
  private mergeValues<T>(key: string, value: T, options: SetStorage<T> = {}): T {
    const rawValue = this.read<T>(key, options);

    if (this.isObject(rawValue)) {
      const { value: oValue } = rawValue;

      if (typeof options.merge === 'function') {
        return options.merge(value, oValue);
      }

      if (this.isObject(oValue)) {
        return { ...oValue, ...value } as T;
      }
    }

    return value;
  }

  /**
   * 判断是否为对象类型
   * @param data 待检测的数据
   * @returns 是否为对象类型
   */
  private isObject<T>(data: T | null): data is T & object {
    return !isNull(data) && typeof data === 'object' && !Array.isArray(data);
  }

  /**
   * 获取存储实例
   * @returns StorageLike 对象
   */
  private getStorage(): StorageLike {
    return this.storageAdapter();
  }

  /**
   * 从本地缓存中获取指定 key 对应的内容
   * @param key 获取缓存数据的键值
   * @param options 选项对象
   * @returns 存储的值，不存在或已过期则返回 null
   */
  getItem<T>(key: string, options: GetStorage = {}): T | null {
    const result = this.read<T>(key, options);

    if (isNull(result)) return null;

    const { value, once } = result;

    // 如果设置了 once 或 isDelete，获取后删除
    if (once || options.isDelete) {
      this.removeItem(key);
    }

    return value;
  }

  /**
   * 将数据存储在本地缓存中指定的 key 中
   * @param key 创建或更新的键名
   * @param value 创建或更新的键名对应的值
   * @param options 选项对象
   */
  setItem<T = unknown>(key: string, value: T, options: SetStorage<T> = {}): void {
    const opt = { expires: this.expires, ...options };
    const storage = this.getStorage();

    // 合并数据
    const nValue = opt.merge ? this.mergeValues(key, value, opt) : value;

    const data: StorageData<T> = { value: nValue, once: opt.once ?? false };
    const configs = { isSerialize: true, isEscape: false, ...opt };

    storage.setItem(key, encodeData<T>(data, configs));
  }

  /**
   * 从本地缓存中移除指定 key
   * @param key 键值
   */
  removeItem(key: string): void {
    const storage = this.getStorage();
    storage.removeItem(key);
  }

  /**
   * 修改默认配置
   * @param options 配置选项（不包含 storageAdapter）
   */
  updateOptions(options: Omit<BaseStorageOptions, 'storageAdapter'>): void {
    this.expires = options.expires;
  }
}
