import type { ConverterOptions, StorageData, SetStorage } from './type';
import { isNull, isNumber } from 'lodash-es';

/**
 * 数据转换器
 * 提供序列化和反序列化功能
 */
export const converter = {
  /**
   * 反序列化
   * @param value 待反序列字符串
   * @param options 转换选项
   * @returns 反序列化后的数据
   */
  deserialization<T = string>(value: string, options: ConverterOptions): null | T {
    try {
      let result: string = value;

      if (options.isBase64) {
        result = atob(result);
      }

      if (options.isEscape) {
        result = decodeURIComponent(result);
      }

      return options.isSerialize ? (JSON.parse(result) as T) : (result as T);
    } catch {
      return null;
    }
  },

  /**
   * 序列化
   * @param value 待序列化的值
   * @param options 转换选项
   * @returns 序列化后的字符串
   */
  serializeValue(value: unknown, options: ConverterOptions): string {
    let result: string;

    if (options.isSerialize) {
      result = JSON.stringify(value);
    } else {
      result = `${value}`;
    }

    if (options.isEscape) {
      result = encodeURIComponent(result);
    }

    if (options.isBase64) {
      result = btoa(result);
    }

    return result;
  }
};

/**
 * 判断是否为 Date 类型
 * @param data 待检测的数据
 * @returns 是否为 Date 类型
 */
function isDate(data: unknown): data is Date {
  return Object.prototype.toString.call(data) === '[object Date]';
}

/**
 * 编码数据
 * 将数据编码为存储格式
 * @param value 存储数据
 * @param options 设置选项
 * @returns 编码后的字符串
 */
export function encodeData<T = unknown>(value: StorageData<T>, options: SetStorage<T> = {}): string {
  const data: StorageData<T> = { ...value };

  if (isDate(options.expires)) {
    data.expires = options.expires.getTime();
  } else if (isNumber(options.expires) && Number.isFinite(options.expires)) {
    data.expires = new Date(Date.now() + options.expires * 1000).getTime();
  }

  const configs = { isSerialize: true, isEscape: false, ...options };

  return converter.serializeValue(data, configs);
}

/**
 * 解码数据
 * 从存储格式解码数据
 * @param val 存储的字符串值
 * @param options 转换选项
 * @returns 解码后的数据，已过期则返回 null
 */
export function decodeData<T>(val: string | null, options: ConverterOptions = {}): StorageData<T> | null {
  if (isNull(val)) return null;

  const configs = { isSerialize: true, isEscape: false, ...options };

  const result = converter.deserialization<StorageData<T>>(val, configs);

  if (isNull(result)) return null;

  // 检查是否过期
  if (!isNumber(result.expires) || result.expires - Date.now() > 0) return result;

  return null;
}
