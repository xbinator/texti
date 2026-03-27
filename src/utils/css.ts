export function addCssUnit(value: string | number): string {
  if (value == null || value === '') {
    return '';
  }

  if (typeof value === 'number' || /^\d+$/.test(value.toString())) {
    return `${value}px`;
  }

  return value.toString();
}
