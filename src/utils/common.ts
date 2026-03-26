// 工具函数

export function addCssUnit(value: string | number): string {
  if (value == null || value === '') {
    return '';
  }

  if (typeof value === 'number' || /^\d+$/.test(value.toString())) {
    return `${value}px`;
  }

  return value.toString();
}

export function isDefined<T>(val: T): val is Exclude<T, undefined> {
  return val !== undefined;
}
