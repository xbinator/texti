let listenerIdCounter = 0;
const listenersByType = new Map<string, Map<string, (payload: unknown) => void>>();

export const emitter = {
  on(type: string, handler: (payload: unknown) => void): () => void {
    const id = `${Date.now()}_${(listenerIdCounter += 1)}`;
    const map = listenersByType.get(type) ?? new Map<string, (payload: unknown) => void>();
    listenersByType.set(type, map);

    map.set(id, handler);

    return () => {
      const current = listenersByType.get(type);
      if (!current) return;

      current.delete(id);
      if (current.size === 0) listenersByType.delete(type);
    };
  },

  emit(type: string, payload: unknown = {}): void {
    const map = listenersByType.get(type);
    if (!map) return;

    [...map.values()].forEach((handler) => handler(payload));
  }
};
