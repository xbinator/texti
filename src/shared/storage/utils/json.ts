export function parseJson<T>(json: string | null): T | undefined {
  if (!json) return undefined;

  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function parseJsonArray<T>(json: string | null): T[] | undefined {
  const parsed = parseJson<unknown>(json);
  if (!Array.isArray(parsed)) return undefined;
  return parsed as T[];
}
