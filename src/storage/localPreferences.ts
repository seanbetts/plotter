export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMigratedStorageValue(
  storage: StorageLike | null,
  currentKey: string,
  legacyKey: string,
) {
  if (!storage) return null;

  try {
    const currentValue = storage.getItem(currentKey);
    if (currentValue !== null) return currentValue;

    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue !== null) {
      storage.setItem(currentKey, legacyValue);
    }
    return legacyValue;
  } catch {
    return null;
  }
}

export function writeStorageValue(storage: StorageLike | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Preferences are best-effort in private browsing and restricted storage contexts.
  }
}

export function removeStorageValue(storage: StorageLike | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Preferences are best-effort in private browsing and restricted storage contexts.
  }
}
