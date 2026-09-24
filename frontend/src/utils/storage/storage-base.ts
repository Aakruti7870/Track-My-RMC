// Abstract base for the storage wrapper — shared types + helpers.
// Concrete implementations live in index.ts (native) and index.web.ts (web).

export type StorageItemKey = string;
export type StorageItemValue = string | number | boolean | null;

// Helper for subclasses to enforce that they don't declare methods beyond
// StorageBase. Use as: type _ = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;
export type AssertNoExtras<T extends never> = T;

function isStorageItemValue(value: unknown): value is StorageItemValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export abstract class StorageBase {
  protected warn(op: string, key: StorageItemKey, e: unknown) {
    console.warn(`[storage] ${op}(${key}) failed`, e);
  }

  // raw is whatever AsyncStorage / SecureStore returned: a JSON-encoded primitive
  // (because setItem always JSON.stringifies) or null if the key was missing.
  // Reject objects/arrays from corrupted or legacy entries instead of unsafely
  // casting them into a primitive caller type.
  protected retrieve<Fallback extends StorageItemValue>(
    raw: string | null,
    fallback: Fallback,
  ): Fallback | null {
    if (raw === null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isStorageItemValue(parsed)) {
        this.warn("retrieve", "invalid stored value", new Error("Stored value is not a supported primitive"));
        return fallback;
      }
      return parsed as Fallback | null;
    } catch (e) {
      this.warn("retrieve", "parse error", e);
      return fallback;
    }
  }

  abstract getItem<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null>;
  abstract setItem<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean>;
  abstract removeItem(key: string): Promise<boolean>;
  abstract secureGet<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null>;
  abstract secureSet<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean>;
  abstract secureRemove(key: string): Promise<boolean>;
}
