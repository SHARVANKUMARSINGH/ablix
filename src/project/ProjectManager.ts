import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Shared project system used by BOTH the Desktop (folder icons) and the Ablix
 * IDE (Explorer). A "DesktopFolder" and a "Project" are the same underlying
 * record — opening it from the desktop or editing it in the IDE mutates the
 * same object, persisted in IndexedDB.
 */

export interface ProjectFile {
  path: string; // e.g. "src/index.html"
  content: string;
}

export interface DesktopPosition {
  x: number;
  y: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  parent: string | null; // desktop = null for now (no nested desktop folders yet)
  position: DesktopPosition;
  files: ProjectFile[];
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

interface AblixDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
  };
  meta: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = "ablix-desktop";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AblixDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AblixDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

function makeId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  content?: string;
}

/** Builds a nested tree from the flat ProjectFile[] list (paths use "/"). */
export function buildFileTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderIndex = new Map<string, TreeNode>();

  const ensureFolder = (path: string): TreeNode[] => {
    if (!path) return root;
    if (folderIndex.has(path)) return folderIndex.get(path)!.children;
    const parentPath = path.split("/").slice(0, -1).join("/");
    const name = path.split("/").pop()!;
    const node: TreeNode = { name, path, isFolder: true, children: [] };
    ensureFolder(parentPath).push(node);
    folderIndex.set(path, node);
    return node.children;
  };

  for (const file of files) {
    const parts = file.path.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const siblings = ensureFolder(parentPath);
    siblings.push({
      name: parts[parts.length - 1],
      path: file.path,
      isFolder: false,
      children: [],
      content: file.content,
    });
  }

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1
    );
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(root);
  return root;
}

export const ProjectManager = {
  async list(): Promise<ProjectRecord[]> {
    const db = await getDB();
    return db.getAll("projects");
  },

  async create(name: string, position: DesktopPosition): Promise<ProjectRecord> {
    const db = await getDB();
    const now = Date.now();
    const record: ProjectRecord = {
      id: makeId(),
      name,
      parent: null,
      position,
      files: [],
      metadata: { createdAt: now, updatedAt: now },
    };
    await db.put("projects", record);
    return record;
  },

  async get(id: string): Promise<ProjectRecord | undefined> {
    const db = await getDB();
    return db.get("projects", id);
  },

  async updatePosition(id: string, position: DesktopPosition) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    record.position = position;
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
  },

  async rename(id: string, name: string) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    record.name = name;
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
  },

  async updateFiles(id: string, files: ProjectFile[]) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    record.files = files;
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
  },

  async remove(id: string) {
    const db = await getDB();
    await db.delete("projects", id);
  },

  /** Empty folders are represented by a hidden ".keep" marker file so they
   * survive in the flat file list until something real is added. Explorer
   * filters ".keep" files out of the rendered tree. */
  async createFolder(id: string, folderPath: string) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    const markerPath = `${folderPath}/.keep`;
    if (!record.files.some((f) => f.path === markerPath)) {
      record.files.push({ path: markerPath, content: "" });
    }
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
    return record;
  },

  async createFile(id: string, filePath: string, content = "") {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    if (record.files.some((f) => f.path === filePath)) return record;
    record.files.push({ path: filePath, content });
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
    return record;
  },

  async writeFile(id: string, filePath: string, content: string) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    const file = record.files.find((f) => f.path === filePath);
    if (file) file.content = content;
    else record.files.push({ path: filePath, content });
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
    return record;
  },

  async deletePath(id: string, path: string, isFolder: boolean) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    record.files = record.files.filter((f) =>
      isFolder ? !(f.path === path || f.path.startsWith(`${path}/`)) : f.path !== path
    );
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
    return record;
  },

  async renamePath(id: string, oldPath: string, newPath: string) {
    const db = await getDB();
    const record = await db.get("projects", id);
    if (!record) return;
    record.files = record.files.map((f) => {
      if (f.path === oldPath) return { ...f, path: newPath };
      if (f.path.startsWith(`${oldPath}/`)) {
        return { ...f, path: newPath + f.path.slice(oldPath.length) };
      }
      return f;
    });
    record.metadata.updatedAt = Date.now();
    await db.put("projects", record);
    return record;
  },
};
