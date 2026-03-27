interface WindowWithTauri extends Window {
  __TAURI__?: unknown;
}

export function isDefined<T>(val: T): val is Exclude<T, undefined> {
  return val !== undefined;
}

export const isTauri = () => {
  return typeof window !== 'undefined' && (window as WindowWithTauri).__TAURI__ !== undefined;
};

export const isWeb = () => {
  return !isTauri();
};
