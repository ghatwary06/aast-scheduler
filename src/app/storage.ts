export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function memoryStore(initial: Record<string, unknown> = {}): Store {
  const data = new Map<string, unknown>(Object.entries(copy(initial)));
  return {
    async get<T>(key: string) {
      return copy(data.get(key)) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, copy(value));
    },
  };
}

export function chromeStore(): Store {
  return {
    async get<T>(key: string) {
      const r = await chrome.storage.local.get(key);
      return r[key] as T | undefined;
    },
    async set(key: string, value: unknown) {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}

export function defaultStore(): Store {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chromeStore() : memoryStore();
}
