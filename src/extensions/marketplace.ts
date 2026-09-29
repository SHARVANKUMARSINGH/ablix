import { Query } from "appwrite";
import { appwriteConfig, appwriteMissingConfig, storage, tablesDB } from "../appwrite/client";

/** A row in the Appwrite "extensions" table. */
export interface MarketplaceRow {
  rowId: string;
  name: string;
  version: string;
  description: string;
  category: string;
  author: string;
  icon: string;
  downloads: number;
  fileId: string;
}

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function explainAppwriteError(err: unknown): string {
  const e = err as { message?: string; code?: number; type?: string } | undefined;
  const msg = e?.message ?? String(err);
  if (e?.code === 401 || e?.type === "user_unauthorized" || /not authorized|missing scope/i.test(msg)) {
    return "Appwrite refused access. In the console, give the role \"Any\" Read permission on the extensions table and the storage bucket.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg) || e?.code === 0) {
    return "Couldn't reach Appwrite. Check your connection, and that this site's domain is added as a Web platform in the Appwrite project (Settings → Platforms).";
  }
  return msg;
}

export async function fetchMarketplace(): Promise<MarketplaceRow[]> {
  if (appwriteMissingConfig.length) {
    throw new Error(`Appwrite is not configured (missing ${appwriteMissingConfig.join(", ")}).`);
  }
  try {
    const res = await tablesDB.listRows({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteConfig.tableId,
      queries: [Query.limit(100), Query.orderDesc("$createdAt")],
    });
    return res.rows
      .map((r): MarketplaceRow => {
        const row = r as unknown as Record<string, unknown>;
        return {
          rowId: r.$id,
          name: s(row.name) || "Untitled",
          version: s(row.version) || "0.0.0",
          description: s(row.description),
          category: s(row.category),
          author: s(row.author),
          icon: s(row.icon),
          downloads: typeof row.downloads === "number" ? row.downloads : Number(row.downloads) || 0,
          fileId: s(row.fileId),
        };
      })
      .filter((r) => r.fileId);
  } catch (err) {
    throw new Error(explainAppwriteError(err));
  }
}

/** Downloads the .ablixext for a row from Appwrite Storage using its fileId. */
export async function downloadPackage(row: MarketplaceRow): Promise<ArrayBuffer> {
  const url = storage.getFileDownload({ bucketId: appwriteConfig.bucketId, fileId: row.fileId });
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(explainAppwriteError(err));
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Appwrite refused the download. Give the role \"Any\" Read permission on the storage bucket (or file).");
    }
    if (res.status === 404) throw new Error("The package file for this extension was not found in storage.");
    throw new Error(`Download failed (HTTP ${res.status}).`);
  }
  return res.arrayBuffer();
}

/** Best-effort: bumps the public download counter. Silently ignored if the table doesn't allow updates. */
export async function bumpDownloads(row: MarketplaceRow): Promise<number | null> {
  try {
    const updated = await tablesDB.updateRow({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteConfig.tableId,
      rowId: row.rowId,
      data: { downloads: row.downloads + 1 },
    });
    const n = (updated as unknown as { downloads?: number }).downloads;
    return typeof n === "number" ? n : row.downloads + 1;
  } catch {
    return null;
  }
}
