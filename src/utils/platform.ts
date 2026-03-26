interface WindowWithTauri extends Window {
  __TAURI__?: unknown;
}

export const isTauri = () => {
  return typeof window !== 'undefined' && (window as WindowWithTauri).__TAURI__ !== undefined;
};

export const isWeb = () => {
  return !isTauri();
};
