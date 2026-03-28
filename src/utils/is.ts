interface WindowWithTauri extends Window {
  __TAURI_INTERNALS__?: unknown;
}

export function isDefined<T>(val: T): val is Exclude<T, undefined> {
  return val !== undefined;
}

export const isTauri = () => {
  return typeof window !== 'undefined' && (window as WindowWithTauri).__TAURI_INTERNALS__ !== undefined;
};

export const isWeb = () => {
  return !isTauri();
};

export const isMac = () => {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
};
