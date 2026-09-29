import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { InstalledExtension } from "./types";

/** IndexedDB persistence for installed .ablixext packages, their settings and small prefs. */
interface PackagesDB extends DBSchema {
  installed: { key: string; value: InstalledExtension };
  settings: { key: string; value: Record<string, unknown> };
  prefs: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<PackagesDB>> | null = null;
function db() {
  dbPromise ??= openDB<PackagesDB>("ablix-extension-packages", 1, {
    upgrade(d) {
      d.createObjectStore("installed", { keyPath: "id" });
      d.createObjectStore("settings");
      d.createObjectStore("prefs");
    },
  });
  return dbPromise;
}

export const ExtensionStore = {
  async list(): Promise<InstalledExtension[]> {
    return (await db()).getAll("installed");
  },
  async get(id: string): Promise<InstalledExtension | undefined> {
    return (await db()).get("installed", id);
  },
  async put(ext: InstalledExtension) {
    await (await db()).put("installed", ext);
  },
  async remove(id: string) {
    const d = await db();
    await d.delete("installed", id);
    await d.delete("settings", id);
  },
  async loadSettings(id: string): Promise<Record<string, unknown>> {
    return (await (await db()).get("settings", id)) ?? {};
  },
  async saveSettings(id: string, values: Record<string, unknown>) {
    await (await db()).put("settings", values, id);
  },
  async getPref<T>(key: string): Promise<T | undefined> {
    return (await (await db()).get("prefs", key)) as T | undefined;
  },
  async setPref(key: string, value: unknown) {
    await (await db()).put("prefs", value, key);
  },
};
