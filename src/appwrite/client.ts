import { Client, Storage, TablesDB } from "appwrite";

/** Single place that knows the Appwrite endpoint/project/database/table/bucket. */
// import.meta.env is undefined outside Vite (e.g. the Node test-suite, which passes process.env), so read defensively.
const env = {
  ...((globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}),
  ...((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}),
} as Record<string, string | undefined>;
const endpoint = env.VITE_APPWRITE_ENDPOINT ?? "";
const projectId = env.VITE_APPWRITE_PROJECT_ID ?? "";
const databaseId = env.VITE_APPWRITE_DATABASE_ID ?? "";
const tableId = env.VITE_APPWRITE_TABLE_ID ?? "";
const bucketId = env.VITE_APPWRITE_BUCKET_ID ?? "";

export const appwriteConfig = { endpoint, projectId, databaseId, tableId, bucketId };

export const appwriteMissingConfig = Object.entries({
  VITE_APPWRITE_ENDPOINT: endpoint,
  VITE_APPWRITE_PROJECT_ID: projectId,
  VITE_APPWRITE_DATABASE_ID: databaseId,
  VITE_APPWRITE_TABLE_ID: tableId,
  VITE_APPWRITE_BUCKET_ID: bucketId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

export const client = new Client();
if (endpoint && projectId) client.setEndpoint(endpoint).setProject(projectId);

export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);
