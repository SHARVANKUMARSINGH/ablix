import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * A real extension system, scoped honestly: two built-in extensions that
 * actually change editor behavior, persisted per-browser in IndexedDB, with
 * a subscribe API so the UI updates live. There is no marketplace/registry
 * to install third-party extensions from — that would require a backend
 * this app doesn't have. Adding a new built-in extension means adding an
 * entry to BUILTIN_EXTENSIONS and having a consumer (e.g. CodeEditor,
 * IdeWorkspace) read its enabled state.
 */

export interface ExtensionDescriptor {
  id: string;
  name: string;
  description: string;
}

export const BUILTIN_EXTENSIONS: ExtensionDescriptor[] = [
  {
    id: "word-wrap",
    name: "Word Wrap",
    description: "Wrap long lines in the editor instead of scrolling horizontally.",
  },
  {
    id: "trim-trailing-whitespace",
    name: "Trim Trailing Whitespace on Save",
    description: "Strips trailing spaces/tabs from every line when you save a file.",
  },
];

interface ExtensionsDB extends DBSchema {
  state: {
    key: string; // extension id
    value: boolean; // enabled
  };
}

let dbPromise: Promise<IDBPDatabase<ExtensionsDB>> | null = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ExtensionsDB>("ablix-extensions", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      },
    });
  }
  return dbPromise;
}

type Listener = (enabled: Record<string, boolean>) => void;
const listeners = new Set<Listener>();
let cache: Record<string, boolean> = Object.fromEntries(BUILTIN_EXTENSIONS.map((e) => [e.id, false]));
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  const db = await getDB();
  const next = { ...cache };
  for (const ext of BUILTIN_EXTENSIONS) {
    const stored = await db.get("state", ext.id);
    if (stored !== undefined) next[ext.id] = stored;
  }
  cache = next;
  loaded = true;
  listeners.forEach((l) => l(cache));
}

export const ExtensionManager = {
  /** Returns the current known state immediately (may be stale until ensureLoaded resolves). */
  getSnapshot(): Record<string, boolean> {
    return cache;
  },

  async init() {
    await ensureLoaded();
    return cache;
  },

  async setEnabled(id: string, enabled: boolean) {
    cache = { ...cache, [id]: enabled };
    listeners.forEach((l) => l(cache));
    const db = await getDB();
    await db.put("state", enabled, id);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
