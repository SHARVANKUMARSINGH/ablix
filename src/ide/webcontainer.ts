import type { FileSystemTree } from "@webcontainer/api";
import type { ProjectFile } from "../project/ProjectManager";

/**
 * WebContainer requires the page to be cross-origin isolated
 * (window.crossOriginIsolated === true), which in turn requires the
 * Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy response headers
 * set in public/_headers to actually be served by the host (Cloudflare Pages
 * honors _headers; a plain `vite preview`/`vite dev` needs the equivalent
 * dev-server headers, wired in vite.config.ts).
 *
 * This module cannot be exercised in a non-browser build step — booting a
 * WebContainer needs a real, cross-origin-isolated browser tab. Treat this as
 * integration code to verify manually once deployed, not something the build
 * pipeline proves works end to end.
 */

let bootPromise: Promise<import("@webcontainer/api").WebContainer> | null = null;

export function isWebContainerSupported(): boolean {
  return typeof window !== "undefined" && window.crossOriginIsolated === true;
}

/** Returns the booted instance if one already exists, without triggering a boot. */
export function getIfBooted() {
  return bootPromise;
}

export async function getWebContainer() {
  if (!isWebContainerSupported()) {
    throw new Error(
      "WebContainer needs cross-origin isolation (COOP/COEP). This page is not currently isolated — see public/_headers."
    );
  }
  if (!bootPromise) {
    const { WebContainer } = await import("@webcontainer/api");
    bootPromise = WebContainer.boot();
  }
  return bootPromise;
}

/**
 * Write-through: if a WebContainer is already booted for this page (i.e. the
 * terminal has been opened at least once), mirror an editor save into its
 * live filesystem so a running dev server picks up the change. Silently a
 * no-op if no container has been booted yet or the write fails — this is a
 * best-effort convenience, not a requirement for saving to work.
 */
export async function syncFileToContainer(path: string, content: string) {
  const existing = getIfBooted();
  if (!existing) return;
  try {
    const wc = await existing;
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await wc.fs.mkdir(dir, { recursive: true });
    await wc.fs.writeFile(path, content);
  } catch {
    // Best-effort only; the IndexedDB save already succeeded regardless.
  }
}

const WATCH_IGNORE = ["node_modules", ".git", "dist", "build", ".cache", ".next"];
function isIgnoredPath(path: string) {
  const segments = path.split("/");
  return WATCH_IGNORE.some((seg) => segments.includes(seg));
}

/**
 * Mirrors file changes made *inside* the container (from the terminal, from
 * `npm install` writing lockfiles, from a dev server's own writes) back into
 * the project's IndexedDB record so the Explorer/editor stay in sync with
 * what's actually on disk in the container. Deliberately skips
 * node_modules/.git/dist/build — those are huge, ephemeral, and don't belong
 * in a browser-storage-backed project record.
 *
 * Like the rest of this module, this can only be exercised in a real,
 * cross-origin-isolated browser tab — it is not something a build step
 * proves works end to end.
 */
export function watchContainerFiles(
  wc: import("@webcontainer/api").WebContainer,
  onChange: (path: string, content: string) => void
) {
  const watcher = wc.fs.watch(".", { recursive: true }, (event, rawFilename) => {
    const filename =
      typeof rawFilename === "string" ? rawFilename : new TextDecoder().decode(rawFilename);
    if (!filename || isIgnoredPath(filename)) return;
    if (event !== "change" && event !== "rename") return;
    wc.fs
      .readFile(filename, "utf-8")
      .then((content) => onChange(filename, content))
      .catch(() => {
        // Deleted, or a directory rename — nothing to mirror.
      });
  });
  return () => watcher.close();
}

/** Converts the flat ProjectFile[] list into the nested tree @webcontainer/api expects. */
export function toFileSystemTree(files: ProjectFile[]): FileSystemTree {
  const root: FileSystemTree = {};

  for (const file of files) {
    if (file.path.endsWith("/.keep")) continue; // folder marker only, not a real file
    const parts = file.path.split("/");
    let cursor: FileSystemTree = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const existing = cursor[segment];
      if (!existing || !("directory" in existing)) {
        cursor[segment] = { directory: {} };
      }
      cursor = (cursor[segment] as { directory: FileSystemTree }).directory;
    }
    cursor[parts[parts.length - 1]] = { file: { contents: file.content } };
  }

  return root;
}
